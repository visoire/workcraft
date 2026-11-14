// Universal model router: Claude, ChatGPT, Gemini, DeepSeek, Ollama and own OpenAI-compatible
// endpoints. Runs in the local backend (keys leave the computer only toward the provider in question)
// and in browser mode; no DOM dependencies.
//
// Every provider speaks its own native API (no lowest-common-denominator wrapper):
//   Claude    src/chat/adapters/claude.ts   Messages API, adaptive thinking, signatures, cache_control
//   Gemini    src/chat/adapters/gemini.ts   thinkingConfig, thought parts, thoughtSignature
//   ChatGPT   src/chat/adapters/openai.ts   Responses API, reasoning summaries, encrypted reasoning items
//   DeepSeek  below                         Chat Completions with thinking, reasoning_content passback
//   Ollama    src/chat/adapters/ollama.ts   native /api/chat: num_ctx, think, keep_alive, parsed tool calls
//   Own endpoints                           Chat Completions
// and all of them deliver the same event stream (StreamEvent): text, reasoning, tool calls, usage, done.
// The done event carries the provider state that later requests of a tool chain need (ReplayState).

import { AiError } from './types.js';
import type { AiErrorCode, ChatRequest, ProviderConfig, StreamEvent, TokenUsage, ToolSpec } from './types.js';
import { countRequest, estimateTokens } from './usage.js';
import { DEEPSEEK_FIM_MAX, deepseekRoot, isDeepSeek, normalizeModel, sortTools } from './deepseek.js';
import { familyOf } from './models.js';
import { addressHint, pickReplacement, substitutionNotice } from './model-recovery.js';
import { BROWSER_HEADERS, httpError, networkError, newId, parseArgs, post, sse, type ProviderEvent, type RawUsage } from './http.js';
import { streamClaude } from './adapters/claude.js';
import { streamGemini } from './adapters/gemini.js';
import { streamOpenAIResponses } from './adapters/openai.js';
import { streamOllama } from './adapters/ollama.js';

export { estimateTokens };

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderConfig['kind'];
  baseUrl: string;
  model: string;
  needsKey: boolean;
  local?: boolean;
  docs: string;
}

export const PRESETS: ProviderPreset[] = [
  { id: 'anthropic', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', needsKey: true, docs: 'console.anthropic.com' },
  { id: 'openai', name: 'ChatGPT', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', needsKey: true, docs: 'platform.openai.com' },
  { id: 'gemini', name: 'Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', needsKey: true, docs: 'aistudio.google.com' },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', needsKey: true, docs: 'platform.deepseek.com' },
  { id: 'xai', name: 'Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7', needsKey: true, docs: 'console.x.ai' },
  { id: 'zai', name: 'GLM', kind: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-5.3', needsKey: true, docs: 'z.ai' },
  { id: 'mistral', name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', needsKey: true, docs: 'console.mistral.ai' },
  { id: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', needsKey: true, docs: 'console.groq.com' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', needsKey: true, docs: 'openrouter.ai' },
  { id: 'together', name: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', needsKey: true, docs: 'api.together.ai' },
  { id: 'ollama', name: 'Ollama', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', needsKey: false, local: true, docs: 'ollama.com' },
  { id: 'lmstudio', name: 'LM Studio', kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model', needsKey: false, local: true, docs: 'lmstudio.ai' },
];

/** Presets whose endpoint accepts stream_options.include_usage (the usage numbers arrive in the last chunk). Others get no unknown fields. */
const STREAM_USAGE = new Set(['openai', 'deepseek', 'ollama', 'xai', 'zai', 'groq', 'openrouter', 'together', 'lmstudio']);

// ---------------------------------------------------------------- Chat Completions (DeepSeek, Ollama, own endpoints)

/**
 * Messages in a fixed order, so consecutive requests share the longest possible prefix (DeepSeek
 * context caching hits whole prefix units): (1) core system prompt, (2) tool schemas, rendered by the
 * server from the sorted tools parameter, (3) persistent project context, (4) the conversation.
 *
 * DeepSeek thinking mode with tools: the reasoning_content of every earlier assistant turn goes back to
 * the API, also for turns without a tool call, otherwise the API answers 400. Turns without a chain of
 * thought (another provider, a forced tool call without thinking) send an empty one.
 */
export function openaiMessages(req: Pick<ChatRequest, 'system' | 'context' | 'turns'>, opts: { reasoning?: boolean } = {}) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: req.system }];
  if (req.context) out.push({ role: 'system', content: req.context });
  for (const t of req.turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.images?.length ? [{ type: 'text', text: t.content }, ...t.images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } }))] : t.content });
    else if (t.role === 'assistant') {
      const m: Record<string, unknown> = { role: 'assistant', content: t.text || null };
      if (opts.reasoning) m.reasoning_content = t.reasoning || '';
      if (t.toolCalls.length) m.tool_calls = t.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      out.push(m);
    } else for (const r of t.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  return out;
}

/** Request body for DeepSeek /chat/completions (thinking, effort, limits, tools in stable order). */
export function deepseekBody(cfg: ProviderConfig, req: ChatRequest): Record<string, unknown> {
  const p = req.params || {};
  const legacy = normalizeModel(cfg.model);
  const thinking = p.effort === 'off' ? false : (p.thinking ?? legacy.thinking ?? true);
  const withTools = req.tools.length > 0 && req.toolChoice !== 'none';
  const body: Record<string, unknown> = {
    model: legacy.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: openaiMessages(req, { reasoning: withTools }),
    thinking: { type: thinking ? 'enabled' : 'disabled' },
  };
  // DeepSeek accepts low / high / max (medium maps to high on the server)
  if (thinking && p.effort && p.effort !== 'off') body.reasoning_effort = p.effort === 'medium' ? 'high' : p.effort;
  if (p.maxTokens) body.max_tokens = p.maxTokens;
  if (!thinking && p.temperature !== undefined) body.temperature = p.temperature;
  if (withTools) {
    body.tools = sortTools(req.tools).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    // Named tool_choice is rejected in thinking mode: the backend turns thinking off for forced tools
    const choice = req.toolChoice;
    body.tool_choice = typeof choice === 'object' && !thinking ? { type: 'function', function: { name: choice.name } } : 'auto';
  }
  return body;
}

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

/** Usage of a Chat Completions answer, with the DeepSeek and OpenAI cache and reasoning fields. */
export function readUsage(u: OpenAIUsage): Omit<RawUsage, 'type'> {
  const hit = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input: u.prompt_tokens,
    output: u.completion_tokens,
    cached: hit,
    ...(u.prompt_cache_miss_tokens !== undefined ? { cacheMiss: u.prompt_cache_miss_tokens } : u.prompt_tokens !== undefined ? { cacheMiss: Math.max(0, u.prompt_tokens - hit) } : {}),
    ...(u.completion_tokens_details?.reasoning_tokens !== undefined ? { reasoning: u.completion_tokens_details.reasoning_tokens } : {}),
  };
}

async function* streamCompletions(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  const deepseek = isDeepSeek(cfg);
  let body: Record<string, unknown>;
  if (deepseek) body = deepseekBody(cfg, req);
  else {
    body = { model: cfg.model, stream: true, messages: openaiMessages(req) };
    // Ask for the usage numbers in the last chunk. Own endpoints get no unknown fields (some reject them),
    // but their usage is read as well when they send it.
    if (STREAM_USAGE.has(cfg.id)) body.stream_options = { include_usage: true };
    // Z.ai GLM: thinking is a switch plus an effort (low, high, max). A named tool_choice and thinking do not mix, so thinking goes off then.
    if (familyOf(cfg) === 'zai') {
      const eff = req.params?.effort;
      const forced = typeof req.toolChoice === 'object';
      body.thinking = { type: eff === 'off' || forced ? 'disabled' : 'enabled' };
      if (eff && eff !== 'off' && !forced) body.reasoning_effort = eff === 'medium' ? 'high' : eff;
    }
    if (req.tools.length && req.toolChoice !== 'none') {
      body.tools = sortTools(req.tools).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = req.toolChoice === 'auto' ? 'auto' : { type: 'function', function: { name: req.toolChoice.name } };
    }
  }
  const headers: Record<string, string> = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
  const url = deepseek ? `${deepseekRoot(cfg.baseUrl)}/chat/completions` : `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await post(cfg, url, headers, body, signal);
  const calls = new Map<number, { id: string; name: string; json: string; announced: boolean }>();
  let stop = 'stop';
  let reasoning = '';
  for await (const data of sse(res, signal)) {
    if (data === '[DONE]') break;
    const ev = JSON.parse(data) as {
      error?: { message?: string };
      choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
      usage?: OpenAIUsage | null;
    };
    if (ev.error) throw new AiError({ code: 'PROVIDER', provider: cfg.name, message: ev.error.message || 'Error in the stream' });
    if (ev.usage && (ev.usage.prompt_tokens !== undefined || ev.usage.completion_tokens !== undefined)) yield { type: 'raw_usage', ...readUsage(ev.usage) };
    const ch = ev.choices?.[0];
    if (!ch) continue;
    // reasoning_content (DeepSeek, vLLM) or reasoning (Ollama, LM Studio)
    const thought = ch.delta?.reasoning_content || ch.delta?.reasoning;
    if (thought) {
      reasoning += thought;
      yield { type: 'reasoning', delta: thought };
    }
    if (ch.delta?.content) yield { type: 'text', delta: ch.delta.content };
    for (const tc of ch.delta?.tool_calls || []) {
      const idx = tc.index ?? calls.size;
      let c = calls.get(idx);
      if (!c) {
        c = { id: tc.id || newId('call'), name: '', json: '', announced: false };
        calls.set(idx, c);
      }
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.json += tc.function.arguments;
      if (c.name && !c.announced) {
        c.announced = true;
        yield { type: 'tool_start', id: c.id, name: c.name };
      }
    }
    if (ch.finish_reason) stop = ch.finish_reason;
  }
  if (stop === 'insufficient_system_resource' || stop === 'aborted') {
    throw new AiError({ code: 'PROVIDER', provider: cfg.name, message: stop === 'aborted' ? 'The provider interrupted the generation. Try again.' : 'The provider has no free capacity right now. Try again in a moment.' });
  }
  // Cut off by max_tokens: the arguments of a tool call may be incomplete, and a repaired but shortened
  // write call would damage files. Like DeepSeek Harness, such calls are dropped, not executed.
  if (stop !== 'length') {
    for (const c of [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)) {
      yield { type: 'tool_call', call: { id: c.id, name: c.name, ...parseArgs(c.json) } };
    }
  }
  yield { type: 'done', stop, ...(reasoning ? { reasoning } : {}) };
}

/** ChatGPT: Responses API; endpoints without it (a proxy answering 404) get Chat Completions. */
async function* streamOpenAI(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  const responses = streamOpenAIResponses(cfg, req, signal);
  for (;;) {
    const r = await responses.next();
    if (r.done) {
      if (r.value === false) yield* streamCompletions(cfg, req, signal);
      return;
    }
    yield r.value;
  }
}

// ---------------------------------------------------------------- Public API

export interface StreamOptions {
  /** Exact token counter (DeepSeek V4 or OpenAI o200k in the backend) for running reasoning counts */
  countTokens?: ((text: string) => number) | null;
  /** Prompt tokens counted before the request (stored with the usage for calibration) */
  predicted?: number;
}

const modelName = (cfg: ProviderConfig) => (isDeepSeek(cfg) ? normalizeModel(cfg.model).model : cfg.model);

/**
 * Streams one model request. Every provider ends with a usage event before done: the exact numbers of
 * the provider, or an estimate from the characters when the endpoint (often local models or own
 * endpoints) sends none. Timing: time to the first token and total time. Thinking streams as its own
 * events for every provider, with a running token count at most every 200 ms when a counter is given.
 */
export async function* streamChat(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal, opts: StreamOptions = {}): AsyncGenerator<StreamEvent> {
  if (!cfg.local && PRESETS.find((p) => p.id === cfg.id)?.needsKey && !cfg.apiKey) {
    throw new AiError({ code: 'AUTH', provider: cfg.name, message: `No API key is set for ${cfg.name}.` });
  }
  yield { type: 'start', provider: cfg.name, model: modelName(cfg), providerId: cfg.id, ...(req.params?.effort ? { effort: req.params.effort } : {}) };
  const t0 = Date.now();
  let first = 0;
  let outChars = 0;
  let reasoning = '';
  let counted = 0;
  const raw: Omit<RawUsage, 'type'> = {};
  const usage = (): StreamEvent => {
    const exact = raw.input !== undefined && raw.output !== undefined;
    const input = raw.input ?? countRequest(req, opts.countTokens).total;
    const cached = raw.cached ?? 0;
    const u: TokenUsage = {
      input,
      output: raw.output ?? estimateTokens(outChars),
      cached,
      ...(raw.cacheMiss !== undefined ? { cacheMiss: raw.cacheMiss } : exact ? { cacheMiss: Math.max(0, input - cached) } : {}),
      ...(raw.cacheWrite ? { cacheWrite: raw.cacheWrite } : {}),
      ...(raw.reasoning !== undefined ? { reasoning: raw.reasoning } : reasoning && opts.countTokens ? { reasoning: opts.countTokens(reasoning) } : {}),
      ...(opts.predicted !== undefined ? { predicted: opts.predicted } : {}),
      estimated: !exact,
      firstMs: (first || Date.now()) - t0,
      totalMs: Date.now() - t0,
      provider: cfg.name,
      providerId: cfg.id,
      model: modelName(cfg),
      local: !!cfg.local,
    };
    return { type: 'usage', usage: u };
  };
  let recovered = false;
  for (;;) {
    try {
      const family = familyOf(cfg);
      const inner = family === 'anthropic' ? streamClaude(cfg, req, signal) : family === 'gemini' ? streamGemini(cfg, req, signal) : family === 'openai' ? streamOpenAI(cfg, req, signal) : family === 'ollama' ? streamOllama(cfg, req, signal) : streamCompletions(cfg, req, signal);
      for await (const ev of inner) {
        if (ev.type === 'raw_usage') {
          for (const k of ['input', 'output', 'cached', 'cacheMiss', 'cacheWrite', 'reasoning'] as const) if (ev[k] !== undefined) raw[k] = ev[k];
          continue;
        }
        if (!first && (ev.type === 'text' || ev.type === 'tool_start' || ev.type === 'reasoning')) first = Date.now();
        if (ev.type === 'reasoning') {
          reasoning += ev.delta;
          outChars += ev.delta.length;
          if (opts.countTokens && Date.now() - counted > 200) {
            counted = Date.now();
            yield { ...ev, tokens: opts.countTokens(reasoning) };
            continue;
          }
        } else if (ev.type === 'text') outChars += ev.delta.length;
        else if (ev.type === 'tool_call') outChars += ev.call.name.length + JSON.stringify(ev.call.args).length;
        if (ev.type === 'done') yield usage();
        yield ev;
      }
      return;
    } catch (e) {
      const err = networkError(e, cfg);
      // A 404 before the first byte: ask the provider which models exist and run the request once with the closest one
      if (err.info.code !== 'NOT_FOUND' || recovered || outChars > 0 || first) throw err;
      recovered = true;
      const fix = await recoverModel(cfg, err, signal);
      if (fix instanceof AiError) throw fix;
      if (!fix) throw err;
      const from = cfg.model;
      // What the backend learned about the missing model (thinking, tools) does not apply to the stand-in: keep only the context size
      cfg = { ...cfg, model: fix.model, ...(cfg.ollama ? { ollama: { ...(cfg.ollama.numCtx ? { numCtx: cfg.ollama.numCtx } : {}), ...(cfg.ollama.keepAlive ? { keepAlive: cfg.ollama.keepAlive } : {}), thinking: false } } : {}) };
      yield { type: 'notice', level: 'warning', code: 'MODEL_SUBSTITUTED', message: substitutionNotice(cfg.name, from, fix.model), fix: { providerId: cfg.id, from, to: fix.model } };
      // The interface shows the model that answers
      yield { type: 'start', provider: cfg.name, model: modelName(cfg), providerId: cfg.id, ...(req.params?.effort ? { effort: req.params.effort } : {}) };
    }
  }
}

/**
 * After a 404: the model that can stand in for the missing one, an error that names the real cause, or null when the
 * model exists (the original error stands). Never throws; a list that cannot be read leaves the original error.
 */
async function recoverModel(cfg: ProviderConfig, err: AiError, signal?: AbortSignal): Promise<{ model: string } | AiError | null> {
  if (signal?.aborted) return null;
  const list = await testConnection(cfg, 6000);
  if (!list.ok) {
    if (list.error?.code === 'NOT_FOUND') return new AiError({ code: 'NOT_FOUND', provider: cfg.name, status: 404, message: addressHint(cfg.baseUrl) });
    return null;
  }
  const pick = pickReplacement(list.models.filter((m) => !/^wc-.*-ctx\d+/.test(m)), cfg.model, familyOf(cfg));
  if (!pick) {
    // The model is listed (address and name are fine) or the provider lists nothing to choose from
    if (!list.models.length) return new AiError({ code: 'NOT_FOUND', provider: cfg.name, status: 404, message: `${cfg.name} reports no models. ${cfg.local ? 'Pull one first, for example: ollama pull qwen3:4b.' : 'Check the account and the key.'}` });
    return null;
  }
  void err;
  return { model: pick.model };
}

// ---------------------------------------------------------------- Completions (FIM and prefix)

export interface CompletionRequest {
  /** fim: fill the gap between prompt and suffix (code). prefix: continue the given start of an answer */
  mode: 'fim' | 'prefix';
  prompt: string;
  suffix?: string;
  /** prefix mode: the instruction the answer belongs to */
  instruction?: string;
  maxTokens?: number;
  /** prefix mode: JSON Output (response_format json_object), repaired before it is returned */
  json?: boolean;
  stop?: string[];
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  /** How it was produced: DeepSeek beta endpoint, or a chat request for other providers */
  via: 'deepseek-fim' | 'deepseek-prefix' | 'chat';
}

/**
 * Inline completions for the code editor and document drafts. DeepSeek uses its beta endpoints:
 *   FIM:    POST {root}/beta/completions       { model, prompt, suffix, max_tokens <= 4096 }
 *   prefix: POST {root}/beta/chat/completions  last message { role: 'assistant', content, prefix: true }
 * Both run without thinking. Other providers get the same task as a short chat request.
 */
export async function complete(cfg: ProviderConfig, req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
  const t0 = Date.now();
  const model = modelName(cfg);
  const usageOf = (u: OpenAIUsage | undefined, text: string): TokenUsage => {
    const r = u ? readUsage(u) : {};
    return { input: r.input ?? estimateTokens(req.prompt.length + (req.suffix?.length || 0)), output: r.output ?? estimateTokens(text.length), cached: r.cached ?? 0, ...(r.cacheMiss !== undefined ? { cacheMiss: r.cacheMiss } : {}), estimated: !u, firstMs: Date.now() - t0, totalMs: Date.now() - t0, provider: cfg.name, providerId: cfg.id, model, local: !!cfg.local };
  };
  if (isDeepSeek(cfg)) {
    const headers: Record<string, string> = { authorization: `Bearer ${cfg.apiKey || ''}` };
    const root = `${deepseekRoot(cfg.baseUrl)}/beta`;
    try {
      if (req.mode === 'fim') {
        const res = await post(cfg, `${root}/completions`, headers, { model, prompt: req.prompt, ...(req.suffix ? { suffix: req.suffix } : {}), max_tokens: Math.min(DEEPSEEK_FIM_MAX, req.maxTokens || 256), ...(req.stop?.length ? { stop: req.stop } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) }, signal);
        const j = (await res.json()) as { choices?: { text?: string }[]; usage?: OpenAIUsage };
        const text = j.choices?.[0]?.text || '';
        return { text, usage: usageOf(j.usage, text), via: 'deepseek-fim' };
      }
      const messages: Record<string, unknown>[] = [];
      if (req.json) messages.push({ role: 'system', content: 'Answer with one valid JSON value only (json).' });
      messages.push({ role: 'user', content: req.instruction || 'Continue the text.' }, { role: 'assistant', content: req.prompt, prefix: true });
      const res = await post(cfg, `${root}/chat/completions`, headers, { model, messages, thinking: { type: 'disabled' }, max_tokens: req.maxTokens || 1024, ...(req.json ? { response_format: { type: 'json_object' } } : {}), ...(req.stop?.length ? { stop: req.stop } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) }, signal);
      const j = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; usage?: OpenAIUsage };
      const text = j.choices?.[0]?.message?.content || '';
      return { text, usage: usageOf(j.usage, text), via: 'deepseek-prefix' };
    } catch (e) {
      throw networkError(e, cfg);
    }
  }
  const instruction =
    req.mode === 'fim'
      ? `Fill in the missing part between <prefix> and <suffix>. Reply with the inserted text only, no explanation and no code fence.\n<prefix>${req.prompt}</prefix>\n<suffix>${req.suffix || ''}</suffix>`
      : `${req.instruction || 'Continue the text.'}\nReply with the continuation of this start only${req.json ? ', as valid JSON' : ''}:\n${req.prompt}`;
  let text = '';
  let usage: TokenUsage | undefined;
  for await (const ev of streamChat(cfg, { system: 'You complete text for an editor.', turns: [{ role: 'user', content: instruction }], tools: [], toolChoice: 'none', params: { thinking: false, effort: 'off', ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}) } }, signal)) {
    if (ev.type === 'text') text += ev.delta;
    else if (ev.type === 'usage') usage = ev.usage;
  }
  return { text: text.replace(/^```[\w-]*\n?|\n?```\s*$/g, ''), usage: usage || usageOf(undefined, text), via: 'chat' };
}

/** Connection test: checks reachability and key, returns the available models. */
export async function testConnection(cfg: ProviderConfig, timeoutMs = 8000): Promise<{ ok: boolean; models: string[]; error?: { code: AiErrorCode; message: string } }> {
  const base = cfg.baseUrl.replace(/\/$/, '');
  let url: string;
  const headers: Record<string, string> = {};
  if (cfg.kind === 'anthropic') {
    url = `${base.replace(/\/v1$/, '')}/v1/models?limit=100`;
    headers['x-api-key'] = cfg.apiKey || '';
    headers['anthropic-version'] = '2023-06-01';
    Object.assign(headers, BROWSER_HEADERS);
  } else if (cfg.kind === 'gemini') {
    url = `${base}/v1beta/models?pageSize=200`;
    headers['x-goog-api-key'] = cfg.apiKey || '';
  } else {
    url = `${base}/models`;
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const e = await httpError(res, cfg);
      return { ok: false, models: [], error: { code: e.info.code, message: e.info.message } };
    }
    const j = (await res.json()) as { data?: { id: string }[]; models?: { name: string }[] };
    const models = (j.data?.map((m) => m.id) || j.models?.map((m) => m.name.replace(/^models\//, '')) || []).sort();
    return { ok: true, models };
  } catch (e) {
    const err = networkError(e, cfg);
    return { ok: false, models: [], error: { code: err.info.code, message: err.info.message } };
  }
}

export type { ToolSpec };
