// AI routing in the backend: picks the provider and streams answers to the frontend over SSE.
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { streamChat, testConnection, complete, PRESETS } from '../chat/providers.js';
import { AiError, type ChatRequest, type ModelParams, type ProviderConfig } from '../chat/types.js';
import { config, providerConfig, isConfigured, isLocalProvider, isLocalUrl } from './config.js';
import { usage } from './usage.js';
import { auditRecord, type AuditFile } from './audit.js';
import { log, metric } from './logs.js';
import { deepseekTokenizer, openaiCounter } from './tokenizer.js';
import { isDeepSeek, presetOf } from '../chat/deepseek.js';
import { contextWindow, countRequest, compactTokens, addToolStat, type ToolStat } from '../chat/usage.js';
import { fitRequest } from '../chat/budget.js';
import { repairJson } from '../core/json-repair.js';
import { familyOf, openaiModel } from '../chat/models.js';
import { readsDocuments, resolveParams } from '../chat/params.js';
import { countClaude } from '../chat/adapters/claude.js';
import { countGemini } from '../chat/adapters/gemini.js';
import { activeProject, readProjectFile } from './projects.js';
import { EFFORTS, type ChatTurn, type Effort } from '../chat/types.js';
import { ollamaContext, isDerivedModel } from './ollama.js';

const ollamaRoot = (cfg: ProviderConfig) => cfg.baseUrl.replace(/\/v1\/?$/, '');

async function ollamaUp(cfg: ProviderConfig | null): Promise<boolean> {
  if (!cfg) return false;
  try {
    const r = await fetch(`${ollamaRoot(cfg)}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Provider for a request: the chosen one, or automatically a cloud provider with a key, otherwise Ollama. */
export async function resolveProvider(id?: string): Promise<ProviderConfig> {
  const want = id || config().ai.active;
  const localOnly = config().privacy.localOnly;
  if (want && want !== 'auto') {
    const p = providerConfig(want);
    if (!p) throw new AiError({ code: 'NOT_FOUND', message: `Provider ${want} is not set up.` });
    if (localOnly && !isLocalProvider(want)) {
      // Local-only mode wins over a chosen cloud provider: fall back to a local model when one is set up
      if (!id) return resolveProvider('auto');
      throw new AiError({ code: 'LOCAL_ONLY', provider: p.name, message: `Local-only mode is on: ${p.name} is a cloud provider and is blocked. Use Ollama or a local endpoint, or switch the mode off in Settings, Privacy.` });
    }
    if (!isConfigured(want)) throw new AiError({ code: 'AUTH', provider: p.name, message: `No API key is set for ${p.name}.` });
    return p;
  }
  const order = [...PRESETS.filter((p) => !p.local).map((p) => p.id), ...config().ai.custom.map((c) => c.id)].filter((pid) => !localOnly || isLocalProvider(pid));
  for (const pid of order) if (isConfigured(pid)) return providerConfig(pid)!;
  const ollama = providerConfig('ollama');
  if (await ollamaUp(ollama)) return ollama!;
  if (localOnly) throw new AiError({ code: 'LOCAL_ONLY', message: 'Local-only mode is on and no local model answers. Start Ollama or add a local endpoint (localhost or home network).' });
  throw new AiError({ code: 'NO_PROVIDER', message: 'No model set up. Add an API key or start Ollama.' });
}

export async function aiStatus() {
  const c = config();
  let active: ProviderConfig | null = null;
  let error: string | undefined;
  try {
    active = await resolveProvider();
  } catch (e) {
    error = (e as Error).message;
  }
  const ollama = providerConfig('ollama');
  return {
    mode: c.ai.active,
    localOnly: c.privacy.localOnly,
    active: active ? { id: active.id, name: active.name, model: active.model, local: !!active.local } : null,
    error,
    ollamaReachable: await ollamaUp(ollama),
    providers: [...PRESETS.map((p) => ({ id: p.id, name: p.name, local: !!p.local })), ...c.ai.custom.map((x) => ({ id: x.id, name: x.name, local: false }))].map((p) => ({ ...p, configured: isConfigured(p.id), local: isLocalProvider(p.id), blocked: c.privacy.localOnly && !isLocalProvider(p.id) })),
  };
}

const TurnSchema = z.union([
  z.object({
    role: z.literal('user'),
    content: z.string(),
    images: z.array(z.object({ mime: z.string().regex(/^image\/(png|jpeg|gif|webp)$/), data: z.string().max(8_000_000) })).max(6).optional(),
    /** Project files sent natively (PDF, images): references only, the backend loads the bytes */
    docs: z.array(z.object({ path: z.string().max(400), mime: z.string().regex(/^(application\/pdf|image\/(png|jpeg|gif|webp))$/), size: z.number().min(0) })).max(8).optional(),
  }),
  z.object({
    role: z.literal('assistant'),
    text: z.string(),
    toolCalls: z.array(z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) })),
    raw: z.unknown().optional(),
    reasoning: z.string().optional(),
    replay: z.object({ provider: z.enum(['anthropic', 'gemini', 'openai']), model: z.string(), items: z.array(z.unknown()) }).optional(),
  }),
  z.object({ role: z.literal('tool'), results: z.array(z.object({ id: z.string(), name: z.string(), content: z.string(), isError: z.boolean() })) }),
]);

const ChatBody = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  system: z.string(),
  /** Persistent project context, sent right after the system prompt (prefix cache) */
  context: z.string().optional(),
  turns: z.array(TurnSchema).max(400),
  tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown()) })).default([]),
  toolChoice: z.union([z.literal('auto'), z.literal('none'), z.object({ name: z.string() })]).default('auto'),
  /** Thinking effort from the reasoning bar (provider default when missing) */
  effort: z.enum(EFFORTS as [Effort, ...Effort[]]).optional(),
  /** Metadata of attached files for the audit log (never content) */
  meta: z
    .object({
      files: z.array(z.object({ name: z.string(), kind: z.string(), size: z.number() })).max(50).default([]),
      chat: z.string().max(80).optional(),
      /** Team Mode role that sends the request (usage per role) */
      // Any role id: the five historic specialists, the app specialists and the agents you create (`a-<slug>`). A fixed list
      // rejected every request of those with a 400.
      role: z.string().regex(/^[\w-]{1,40}$/).optional(),
    })
    .optional(),
});

/**
 * Exact text counter per provider: the DeepSeek V4 tokenizer, OpenAI o200k_base / cl100k_base for
 * ChatGPT and OpenAI-compatible endpoints serving GPT models. null: estimate (Claude, Gemini, local models).
 */
export function counterFor(cfg: ProviderConfig): ((text: string) => number) | null {
  if (isDeepSeek(cfg)) {
    const t = deepseekTokenizer();
    return t ? (s: string) => t.count(s) : null;
  }
  const family = familyOf(cfg);
  if (family === 'openai' || (family === 'compatible' && /^(gpt|o\d|chatgpt)/i.test(cfg.model))) return openaiCounter(openaiModel(cfg.model).encoding);
  return null;
}

const MAX_DOC_BYTES = 20 * 1024 * 1024;

/**
 * Native documents: providers that read PDFs and images get the bytes of the referenced project files
 * (loaded now, never stored in the chat); the others keep only the extracted text of the <context> block.
 */
export async function hydrateDocs(turns: ChatTurn[], native: boolean): Promise<ChatTurn[]> {
  if (!turns.some((t) => t.role === 'user' && t.docs?.length)) return turns;
  if (!native) return turns.map((t) => (t.role === 'user' && t.docs ? { ...t, docs: undefined } : t));
  const { root } = await activeProject();
  let budget = 40 * 1024 * 1024;
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (t.role !== 'user' || !t.docs?.length) {
      out.push(t);
      continue;
    }
    const docs = [];
    for (const d of t.docs) {
      if (d.size > MAX_DOC_BYTES || d.size > budget) continue;
      try {
        const bytes = await readProjectFile(root, d.path);
        budget -= bytes.length;
        docs.push({ ...d, data: Buffer.from(bytes).toString('base64') });
      } catch {
        /* file gone: the extracted text stays the only source */
      }
    }
    out.push({ ...t, docs });
  }
  return out;
}

/**
 * Prepares one chat request: parameters per provider (effort from the reasoning bar, DeepSeek preset,
 * cache key), then the pre-flight check that counts the whole prompt (system, tool schemas, project
 * context, history, attachments) and fits it into the context window with the harness strategy instead
 * of letting the API fail.
 */
export function prepareRequest(cfg: ProviderConfig, body: Pick<z.infer<typeof ChatBody>, 'system' | 'context' | 'turns' | 'tools' | 'toolChoice' | 'effort' | 'meta'>) {
  const r = resolveParams(cfg, { ...(body.effort ? { effort: body.effort } : {}), deepseek: config().ai.deepseek, forcedTool: typeof body.toolChoice === 'object', ...(body.meta?.chat ? { cacheKey: body.meta.chat } : {}) });
  cfg.model = r.model;
  const params: ModelParams = r.params;
  const notes = r.notes;
  const count = counterFor(cfg);
  const req: ChatRequest = { system: body.system, ...(body.context ? { context: body.context } : {}), turns: body.turns as ChatRequest['turns'], tools: body.tools, toolChoice: body.toolChoice, params };
  const fit = fitRequest(req, { window: contextWindow(cfg.model), reserve: r.reserve, count });
  if (fit.overflow) {
    throw new AiError({ code: 'BAD_REQUEST', provider: cfg.name, message: `The request needs ${compactTokens(fit.report.after)} tokens even after shortening, more than the context window of ${cfg.model} (${compactTokens(fit.report.window)}). Shorten the latest message or remove attachments.` });
  }
  if (fit.report.maxTokens) fit.req.params = { ...fit.req.params, maxTokens: fit.report.maxTokens };
  fit.report.actions.unshift(...notes);
  return { req: fit.req, report: fit.report, count, family: r.family };
}

/**
 * Ollama starts models with 4096 tokens: every request carries the context of the setting and what the model can do.
 * Every request to the same model must send the same size, otherwise Ollama reloads the model.
 */
async function attachOllama(cfg: ProviderConfig): Promise<void> {
  if (cfg.id !== 'ollama') return;
  const o = await ollamaContext(cfg, config().ai.ollamaContext);
  cfg.ollama = { numCtx: o.window, thinking: o.thinking, tools: o.tools, vision: o.vision };
}

export async function chatRoute(c: Context) {
  const raw = await c.req.text();
  const body = ChatBody.parse(JSON.parse(raw));
  const images = body.turns.reduce((n, t) => n + (t.role === 'user' ? t.images?.length || 0 : 0), 0);
  const files: AuditFile[] = body.meta?.files || [];
  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    let cfg: ProviderConfig | null = null;
    let tokens: { input: number; output: number } | undefined;
    let status: 'ok' | 'error' | 'blocked' = 'ok';
    let note: string | undefined;
    const t0 = Date.now();
    try {
      cfg = { ...(await resolveProvider(body.provider)) };
      if (body.model) cfg.model = body.model;
      await attachOllama(cfg);
      const { req, report, count, family } = prepareRequest(cfg, body);
      req.turns = await hydrateDocs(req.turns, readsDocuments(family));
      await stream.writeSSE({ data: JSON.stringify({ type: 'budget', budget: report }) });
      if (report.actions.length) log('info', 'ai', `Context fitted for ${cfg.model}: ${report.actions.join('; ')}`);
      for await (const ev of streamChat(cfg, req, ac.signal, { countTokens: count, predicted: report.after })) {
        // Usage of every request is kept per provider and model (~/workcraft/usage.json)
        if (ev.type === 'usage') {
          usage.record(ev.usage, body.meta?.role);
          tokens = { input: ev.usage.input, output: ev.usage.output };
          metric(`ttft:${cfg.id}`, ev.usage.firstMs);
        }
        if (ev.type === 'error') {
          status = 'error';
          note = ev.error.code;
        }
        await stream.writeSSE({ data: JSON.stringify(ev) });
      }
    } catch (e) {
      const info = e instanceof AiError ? e.info : { code: 'PROVIDER' as const, message: (e as Error).message };
      status = info.code === 'LOCAL_ONLY' ? 'blocked' : 'error';
      note = info.code;
      if (info.code !== 'ABORTED') {
        log(status === 'blocked' ? 'warn' : 'error', 'ai', `${info.provider || 'AI'}: ${info.message}`);
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: info }) }).catch(() => {});
      }
    } finally {
      const blockedCfg = !cfg && body.provider ? providerConfig(body.provider) : null;
      const target = cfg || blockedCfg;
      if (target) {
        // A blocked request never left the device: it is logged with the destination it would have had
        auditRecord({ kind: status === 'blocked' ? 'blocked' : 'ai', url: target.baseUrl, local: status === 'blocked' ? true : !!target.local || undefined, provider: target.name, model: target.model, bytes: status === 'blocked' ? 0 : raw.length, files, images, tools: body.tools.length, status, tokens, note });
        log('info', 'ai', `${target.name} ${target.model}: ${status}${tokens ? `, ${tokens.input} in / ${tokens.output} out` : ''}`, Date.now() - t0);
      }
    }
  });
}

const CompleteBody = z.object({
  provider: z.string().optional(),
  mode: z.enum(['fim', 'prefix']),
  prompt: z.string().max(400_000),
  suffix: z.string().max(400_000).optional(),
  instruction: z.string().max(20_000).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  json: z.boolean().optional(),
  stop: z.array(z.string().max(40)).max(16).optional(),
});

/**
 * Inline completion for the code editor and document drafts: DeepSeek FIM or prefix completion (beta),
 * a chat request for other providers. JSON answers go through the repair pass before they come back.
 */
export async function completeRoute(c: Context) {
  const b = CompleteBody.parse(await c.req.json());
  let cfg: ProviderConfig | null = null;
  try {
    cfg = { ...(await resolveProvider(b.provider)) };
    await attachOllama(cfg);
    const preset = presetOf(config().ai.deepseek.preset);
    const ds = isDeepSeek(cfg);
    const r = await complete(cfg, { mode: b.mode, prompt: b.prompt, ...(b.suffix ? { suffix: b.suffix } : {}), ...(b.instruction ? { instruction: b.instruction } : {}), maxTokens: b.maxTokens ?? (ds ? preset.completionTokens : 256), ...(b.json ? { json: true } : {}), ...(b.stop ? { stop: b.stop } : {}), ...(ds && preset.temperature !== undefined ? { temperature: preset.temperature } : {}) }, c.req.raw.signal);
    usage.record(r.usage);
    auditRecord({ kind: 'ai', url: cfg.baseUrl, local: !!cfg.local || undefined, provider: cfg.name, model: r.usage.model, bytes: b.prompt.length + (b.suffix?.length || 0), files: [], images: 0, tools: 0, status: 'ok', tokens: { input: r.usage.input, output: r.usage.output }, note: r.via });
    const parsed = b.json ? repairJson(b.mode === 'prefix' ? b.prompt + r.text : r.text) : null;
    return c.json({ text: r.text, via: r.via, usage: r.usage, ...(b.json ? { json: parsed?.value ?? null, repaired: parsed?.repaired ?? false } : {}) });
  } catch (e) {
    const info = e instanceof AiError ? e.info : { code: 'PROVIDER' as const, message: (e as Error).message };
    if (cfg) auditRecord({ kind: info.code === 'LOCAL_ONLY' ? 'blocked' : 'ai', url: cfg.baseUrl, provider: cfg.name, model: cfg.model, bytes: 0, files: [], images: 0, tools: 0, status: info.code === 'LOCAL_ONLY' ? 'blocked' : 'error', note: info.code });
    return c.json({ error: info }, info.code === 'AUTH' ? 401 : info.code === 'LOCAL_ONLY' ? 403 : info.code === 'BAD_REQUEST' ? 400 : 502);
  }
}

const CountBody = z.object({
  text: z.string().max(20_000_000).optional(),
  request: ChatBody.pick({ system: true, context: true, turns: true, tools: true }).optional(),
  /** Count for this provider (default: DeepSeek V4) */
  provider: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(EFFORTS as [Effort, ...Effort[]]).optional(),
  /** Ask Claude (count_tokens) or Gemini (countTokens) for the exact number; sends the request content */
  remote: z.boolean().optional(),
});

const methodOf = (cfg: ProviderConfig) => (isDeepSeek(cfg) ? 'deepseek-v4' : counterFor(cfg) ? openaiModel(cfg.model).encoding : 'estimate');

/**
 * Token count of a text or a whole request (system, tools, project context, history, attachments).
 * Without provider: the DeepSeek V4 tokenizer. With a provider: its own tokenizer where one is
 * available locally (DeepSeek V4, OpenAI o200k_base / cl100k_base), an estimate otherwise, or with
 * remote: true the provider's count endpoint (Claude, Gemini), which sees the content like a request.
 */
export async function countRoute(c: Context) {
  const b = CountBody.parse(await c.req.json());
  if (!b.provider) {
    const t = deepseekTokenizer();
    if (!t) return c.json({ error: { code: 'NOT_FOUND', message: 'The DeepSeek tokenizer asset is missing (public/assets/tokenizers/deepseek-v4.bin).' } }, 404);
    const count = (s: string) => t.count(s);
    return c.json({
      tokenizer: t.header.name,
      ...(b.text !== undefined ? { tokens: count(b.text) } : {}),
      ...(b.request ? { request: countRequest({ ...b.request, turns: b.request.turns as ChatRequest['turns'] }, count) } : {}),
    });
  }
  const base = providerConfig(b.provider);
  if (!base) return c.json({ error: { code: 'NOT_FOUND', message: `Provider ${b.provider} is not set up.` } }, 404);
  const cfg: ProviderConfig = { ...base, ...(b.model ? { model: b.model } : {}) };
  const r = resolveParams(cfg, { ...(b.effort ? { effort: b.effort } : {}), deepseek: config().ai.deepseek, forcedTool: false });
  cfg.model = r.model;
  if (cfg.id === 'ollama') await ollamaContext(cfg, config().ai.ollamaContext);
  const count = counterFor(cfg);
  const out: Record<string, unknown> = { provider: cfg.id, model: cfg.model, method: methodOf(cfg), window: contextWindow(cfg.model) };
  if (b.text !== undefined) out.tokens = count ? count(b.text) : Math.ceil(b.text.length / 4);
  if (b.request) {
    const req: ChatRequest = { ...b.request, turns: b.request.turns as ChatRequest['turns'], toolChoice: 'auto', params: r.params };
    const local = countRequest(req, count);
    out.request = local;
    const family = familyOf(cfg);
    if (b.remote && (family === 'anthropic' || family === 'gemini')) {
      try {
        // Same privacy rules as a chat request: blocked in local-only mode, logged in the audit log
        await resolveProvider(cfg.id);
        const total = family === 'anthropic' ? await countClaude(cfg, req) : await countGemini(cfg, req);
        out.request = { ...local, total, exact: true };
        out.method = family === 'anthropic' ? 'count_tokens' : 'countTokens';
        auditRecord({ kind: 'ai', url: cfg.baseUrl, provider: cfg.name, model: cfg.model, bytes: JSON.stringify(req.turns).length, files: [], images: 0, tools: req.tools.length, status: 'ok', note: 'token count' });
      } catch (e) {
        out.remoteError = e instanceof AiError ? e.info.message : (e as Error).message;
      }
    }
  }
  return c.json(out);
}

const ToolStatBody = z.object({ providerId: z.string().max(80), provider: z.string().max(80), model: z.string().max(120), local: z.boolean().default(false), ok: z.boolean(), ms: z.number().min(0).max(3_600_000) });

/** One MCP tool call of a model for the telemetry (success rate per provider and model). */
export async function toolStatRoute(c: Context) {
  const t: ToolStat = ToolStatBody.parse(await c.req.json());
  usage.recordTool(t);
  return c.json({ ok: true });
}

const TestBody = z.object({ id: z.string(), apiKey: z.string().optional(), baseUrl: z.string().optional(), model: z.string().optional() });

/** Connection test with stored values or values just entered. */
export async function testRoute(c: Context) {
  const b = TestBody.parse(await c.req.json());
  const saved = providerConfig(b.id);
  const preset = PRESETS.find((p) => p.id === b.id);
  const cfg: ProviderConfig | null = saved
    ? { ...saved, apiKey: b.apiKey || saved.apiKey, baseUrl: b.baseUrl || saved.baseUrl, model: b.model || saved.model }
    : b.baseUrl
      ? { id: b.id, name: 'Own endpoint', kind: 'openai', baseUrl: b.baseUrl, apiKey: b.apiKey, model: b.model || '' }
      : null;
  if (!cfg) return c.json({ ok: false, models: [], error: { code: 'NOT_FOUND', message: 'Unknown provider' } });
  if (config().privacy.localOnly && !cfg.local && !isLocalUrl(cfg.baseUrl)) {
    auditRecord({ kind: 'blocked', url: cfg.baseUrl, local: true, provider: cfg.name, bytes: 0, status: 'blocked', note: 'connection test' });
    return c.json({ ok: false, models: [], error: { code: 'LOCAL_ONLY', message: `Local-only mode is on: the connection test to ${cfg.name} is blocked.` } });
  }
  auditRecord({ kind: 'ai-test', url: cfg.baseUrl, local: !!cfg.local || undefined, provider: cfg.name, model: cfg.model, bytes: 0, status: 'ok', note: 'connection test' });
  if (preset?.local) {
    const up = await ollamaUp(cfg);
    if (!up) return c.json({ ok: false, models: [], error: { code: 'UNREACHABLE', message: `Ollama at ${ollamaRoot(cfg)} not reachable` } });
    const r = await fetch(`${ollamaRoot(cfg)}/api/tags`).then((x) => x.json() as Promise<{ models?: { name: string }[] }>);
    return c.json({ ok: true, models: (r.models || []).map((m) => m.name).filter((n) => !isDerivedModel(n)) });
  }
  return c.json(await testConnection(cfg));
}
