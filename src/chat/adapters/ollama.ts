// Ollama through its native /api/chat, not the OpenAI-compatible /v1.
//
// What /v1 cannot do and this endpoint can: the context of one request (options.num_ctx, so no derived models
// in the user's `ollama list`), thinking on or off (`think`), how long the model stays loaded (`keep_alive`),
// an error instead of silently dropped history when the prompt is too long (`truncate: false`), tool calls
// that arrive as parsed objects, and exact token and timing numbers. The stream is newline-delimited JSON.

import { AiError } from '../types.js';
import type { ChatRequest, ChatTurn, ProviderConfig } from '../types.js';
import { compileTools, lines, newId, parseArgs, post, systemText, type ProviderEvent } from '../http.js';
import { ollamaThink } from '../models.js';

/** Context used when the backend did not set one (browser mode): Ollama's own default of 4096 cuts tool chains short. */
const DEFAULT_CTX = 16384;
const KEEP_ALIVE = '15m';

type NativeCall = { function?: { name?: string; arguments?: unknown } };

/** Conversation in Ollama's message format. Reasoning is replayed only inside the running tool chain. */
export function ollamaMessages(req: Pick<ChatRequest, 'system' | 'context' | 'turns'>, vision = true): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: 'system', content: systemText(req as ChatRequest) }];
  const lastUser = req.turns.map((t) => t.role).lastIndexOf('user');
  req.turns.forEach((t: ChatTurn, i) => {
    if (t.role === 'user') {
      const images = vision ? t.images?.map((im) => im.data).filter(Boolean) : undefined;
      out.push({ role: 'user', content: t.content, ...(images?.length ? { images } : {}) });
    } else if (t.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: t.text || '',
        ...(t.reasoning && t.toolCalls.length && i > lastUser ? { thinking: t.reasoning } : {}),
        ...(t.toolCalls.length ? { tool_calls: t.toolCalls.map((c) => ({ type: 'function', function: { name: c.name, arguments: c.args } })) } : {}),
      });
    } else for (const r of t.results) out.push({ role: 'tool', tool_name: r.name, content: r.content });
  });
  return out;
}

/** Request body for /api/chat. */
export function ollamaBody(cfg: ProviderConfig, req: ChatRequest): { body: Record<string, unknown>; normalize: (name: string, args: Record<string, unknown>) => Record<string, unknown> } {
  const o = cfg.ollama || {};
  // A forced tool leaves only that tool; the native API has no tool_choice
  const forced = typeof req.toolChoice === 'object' ? req.toolChoice.name : undefined;
  const wanted = req.toolChoice === 'none' || o.tools === false ? [] : forced ? req.tools.filter((t) => t.name === forced) : req.tools;
  const compiled = compileTools(wanted, 'plain', false);
  const think = o.thinking === false ? undefined : ollamaThink(cfg.model, req.params?.effort);
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: true,
    messages: ollamaMessages(req, o.vision !== false),
    keep_alive: o.keepAlive || KEEP_ALIVE,
    // Too long a prompt is an error with a clear message instead of a silent cut of the history
    truncate: false,
    options: { num_ctx: o.numCtx || DEFAULT_CTX, ...(req.params?.temperature !== undefined ? { temperature: req.params.temperature } : {}), ...(req.params?.maxTokens ? { num_predict: req.params.maxTokens } : {}) },
  };
  if (think !== undefined) body.think = think;
  if (compiled.list.length) body.tools = compiled.list.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return { body, normalize: compiled.normalize };
}

const root = (cfg: ProviderConfig) => cfg.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');

export async function* streamOllama(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  const { body, normalize } = ollamaBody(cfg, req);
  const res = await post(cfg, `${root(cfg)}/api/chat`, {}, body, signal, 0).catch((e: unknown) => {
    // 400 on an overlong prompt: say what to do, the raw text names no setting
    if (e instanceof AiError && e.info.code === 'BAD_REQUEST' && /context|too long|exceed/i.test(e.info.message)) {
      throw new AiError({ ...e.info, message: `The request is longer than the context window of ${cfg.model} (${(body.options as { num_ctx: number }).num_ctx.toLocaleString('en-US')} tokens). Raise the context in Settings, AI models, Ollama, or shorten the message.` });
    }
    throw e;
  });
  let reasoning = '';
  let sawText = false;
  let doneReason = 'stop';
  const calls: { id: string; name: string; args: Record<string, unknown>; argsError?: string }[] = [];
  for await (const line of lines(res, signal)) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line) as {
      error?: string;
      message?: { content?: string; thinking?: string; tool_calls?: NativeCall[] };
      done?: boolean;
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (ev.error) throw new AiError({ code: 'PROVIDER', provider: cfg.name, message: ev.error });
    const m = ev.message;
    if (m?.thinking) {
      reasoning += m.thinking;
      yield { type: 'reasoning', delta: m.thinking };
    }
    if (m?.content) {
      sawText = true;
      yield { type: 'text', delta: m.content };
    }
    for (const c of m?.tool_calls || []) {
      const name = c.function?.name || '';
      if (!name) continue;
      const raw = c.function?.arguments;
      // Parsed object (native), or a JSON string from older servers and some templates
      const parsed = typeof raw === 'string' ? parseArgs(raw) : { args: (raw as Record<string, unknown>) || {} };
      const id = newId('call');
      calls.push({ id, name, args: 'argsError' in parsed && parsed.argsError ? parsed.args : normalize(name, parsed.args), ...('argsError' in parsed && parsed.argsError ? { argsError: parsed.argsError } : {}) });
      yield { type: 'tool_start', id, name };
    }
    if (ev.done) {
      doneReason = ev.done_reason || 'stop';
      yield { type: 'raw_usage', ...(ev.prompt_eval_count !== undefined ? { input: ev.prompt_eval_count } : {}), ...(ev.eval_count !== undefined ? { output: ev.eval_count } : {}) };
    }
  }
  // Cut off by the context or the output limit: the arguments of a tool call may be incomplete, drop them
  if (doneReason !== 'length') for (const c of calls) yield { type: 'tool_call', call: c };
  if (doneReason === 'length' && !sawText && reasoning) {
    throw new AiError({ code: 'PROVIDER', provider: cfg.name, message: `${cfg.model} used its whole budget on thinking before it answered. Switch thinking off in the reasoning menu or raise the context.` });
  }
  yield { type: 'done', stop: calls.length && doneReason !== 'length' ? 'tool_calls' : doneReason, ...(reasoning ? { reasoning } : {}) };
}
