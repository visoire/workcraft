// Claude (Anthropic Messages API, /v1/messages) with its native features:
// - thinking per model: adaptive with output_config.effort and summarized display on the 4.6+ models,
//   between_tools on Sonnet 5.5, budget_tokens on older models (src/chat/models.ts has the rules);
//   thinking_delta streams as reasoning, signature_delta is kept
// - preserved thinking: thinking and redacted_thinking blocks go back verbatim (with signature) in every
//   later request of the conversation; block_binding drop_block (beta thinking-binding-controls) keeps an
//   edited history (context fitting, a persona change) from failing with a 400
// - prompt caching: up to four cache_control breakpoints, on the last tool, the end of the system prompt,
//   the largest attached document and the end of the conversation
// - native PDF document blocks and images; tool_result blocks first in the user turn
// - strict tool use (additionalProperties false); no forced tool_choice where the model rejects it
// A 400 caused by one of the optional features is retried once without it.

import { AiError } from '../types.js';
import type { ChatRequest, ChatTurn, ProviderConfig, ReplayState, ToolCall } from '../types.js';
import { CLAUDE_BUDGET, claudeModel } from '../models.js';
import { BROWSER_HEADERS, compileTools, nativeDocs, networkError, parseArgs, post, sse, textWithoutNative, type ProviderEvent } from '../http.js';

export const BINDING_BETA = 'thinking-binding-controls-2026-08-01';

type Block = Record<string, unknown> & { type: string };
type Msg = { role: 'user' | 'assistant'; content: Block[] };

export interface ClaudeOptions {
  strict: boolean;
  binding: boolean;
  stripThinking: boolean;
}

/** Providers whose endpoint rejected strict tool schemas in this process (sent non-strict after that). */
const noStrict = new Set<string>();

const CACHE = { type: 'ephemeral' } as const;

/** thinking, output_config and max_tokens for one request. */
export function claudeThinking(model: string, p: ChatRequest['params'] = {}): { thinking?: Record<string, unknown>; effort?: string; maxTokens: number; active: boolean } {
  const info = claudeModel(model);
  const effort = p.effort;
  const wire = (e: string) => (e === 'max' && !info.efforts.includes('max') ? 'high' : e);
  const max = p.maxTokens ?? (info.window >= 1_000_000 ? 64_000 : 16_000);
  if (info.thinking === 'budget') {
    if (!effort || effort === 'off') return { maxTokens: max, active: false };
    const budget = CLAUDE_BUDGET[effort];
    return { thinking: { type: 'enabled', budget_tokens: budget }, maxTokens: Math.max(max, budget + 4096), active: true };
  }
  const adaptive = { type: 'adaptive', display: 'summarized' };
  if (effort === 'off') {
    if (info.thinking === 'always') return { thinking: adaptive, effort: 'low', maxTokens: max, active: true };
    if (info.thinking === 'between') return { thinking: { type: 'between_tools' }, effort: 'low', maxTokens: max, active: false };
    return { thinking: { type: 'disabled' }, maxTokens: max, active: false };
  }
  return { thinking: adaptive, ...(effort ? { effort: wire(effort) } : {}), maxTokens: max, active: true };
}

function userBlocks(t: Extract<ChatTurn, { role: 'user' }>): Block[] {
  const docs = nativeDocs(t);
  const out: Block[] = [];
  for (const d of docs) out.push(d.mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data }, title: d.path } : { type: 'image', source: { type: 'base64', media_type: d.mime, data: d.data } });
  for (const im of t.images || []) out.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
  out.push({ type: 'text', text: docs.length ? textWithoutNative(t, docs) : t.content });
  return out;
}

function assistantBlocks(t: Extract<ChatTurn, { role: 'assistant' }>, o: ClaudeOptions): Block[] {
  if (t.replay?.provider === 'anthropic') {
    const items = (t.replay.items as Block[]).filter((b) => !o.stripThinking || (b.type !== 'thinking' && b.type !== 'redacted_thinking'));
    if (items.length) return items;
  }
  const out: Block[] = [];
  if (t.text) out.push({ type: 'text', text: t.text });
  for (const c of t.toolCalls) out.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
  return out.length ? out : [{ type: 'text', text: '…' }];
}

/** Messages with strictly alternating roles; tool_result blocks lead their user turn. */
export function claudeMessages(turns: ChatTurn[], o: ClaudeOptions): Msg[] {
  const out: Msg[] = [];
  const push = (role: Msg['role'], blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      // tool results always first in the user turn
      const results = [...last.content, ...blocks].filter((b) => b.type === 'tool_result');
      last.content = [...results, ...[...last.content, ...blocks].filter((b) => b.type !== 'tool_result')];
    } else out.push({ role, content: blocks });
  };
  for (const t of turns) {
    if (t.role === 'user') push('user', userBlocks(t));
    else if (t.role === 'assistant') push('assistant', assistantBlocks(t, o));
    else push('user', t.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError })));
  }
  return out;
}

/** Cache breakpoints in the messages: the largest document of the last user turn and the very end. */
function markCache(messages: Msg[]): void {
  const last = messages[messages.length - 1];
  if (!last) return;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const doc = lastUser?.content.filter((b) => b.type === 'document' || (b.type === 'text' && String(b.text).length > 16_000)).sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  const tail = last.content[last.content.length - 1];
  if (doc && doc !== tail) doc.cache_control = CACHE;
  if (tail && tail.type !== 'thinking' && tail.type !== 'redacted_thinking') tail.cache_control = CACHE;
}

/** Request body and headers (also used by the count_tokens pre-flight). */
export function claudeRequest(cfg: ProviderConfig, req: ChatRequest, o: ClaudeOptions): { body: Record<string, unknown>; headers: Record<string, string> } {
  const info = claudeModel(cfg.model);
  const th = claudeThinking(cfg.model, req.params);
  const { list } = compileTools(req.tools, 'anthropic-strict', o.strict && req.params?.strictTools !== false && !noStrict.has(cfg.id));
  const tools = list.map((t, i) => ({ name: t.name, description: t.description, input_schema: t.parameters, ...(t.strict ? { strict: true } : {}), ...(i === list.length - 1 ? { cache_control: CACHE } : {}) }));
  const system = [{ type: 'text', text: req.system }, ...(req.context ? [{ type: 'text', text: req.context }] : [])].map((b, i, a) => (i === a.length - 1 ? { ...b, cache_control: CACHE } : b));
  const messages = claudeMessages(req.turns, o);
  markCache(messages);
  const body: Record<string, unknown> = { model: cfg.model, max_tokens: th.maxTokens, stream: true, system, messages };
  const binding = o.binding && !!th.thinking && (th.thinking.type === 'adaptive' || th.thinking.type === 'enabled');
  if (th.thinking) body.thinking = binding ? { ...th.thinking, block_binding: { prefix_mismatch_behavior: 'drop_block' } } : th.thinking;
  if (th.effort) body.output_config = { effort: th.effort };
  if (tools.length) {
    body.tools = tools;
    const choice = req.toolChoice;
    // Forced tools: rejected by the newest models and together with thinking; the prompt names the tool
    body.tool_choice = choice === 'none' ? { type: 'none' } : typeof choice === 'object' && !info.noForcedTool && !th.active ? { type: 'tool', name: choice.name } : { type: 'auto' };
  }
  const headers: Record<string, string> = { 'x-api-key': cfg.apiKey || '', 'anthropic-version': '2023-06-01', ...BROWSER_HEADERS };
  if (binding) headers['anthropic-beta'] = BINDING_BETA;
  return { body, headers };
}

const root = (cfg: ProviderConfig) => cfg.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');

type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

export async function* streamClaude(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  const o: ClaudeOptions = { strict: true, binding: true, stripThinking: false };
  const { normalize } = compileTools(req.tools, 'anthropic-strict');
  let res: Response | null = null;
  for (let attempt = 0; !res; attempt++) {
    const { body, headers } = claudeRequest(cfg, req, o);
    try {
      res = await post(cfg, `${root(cfg)}/v1/messages`, headers, body, signal);
    } catch (e) {
      const err = networkError(e, cfg);
      const msg = err.info.message;
      if (err.info.code !== 'BAD_REQUEST' || attempt >= 3) throw err;
      if (o.binding && /block_binding|thinking-binding|anthropic-beta|beta header/i.test(msg)) o.binding = false;
      else if (!o.stripThinking && /signature|thinking/i.test(msg)) o.stripThinking = true;
      else if (o.strict && /strict|schema|input_schema|additionalProperties/i.test(msg)) {
        o.strict = false;
        noStrict.add(cfg.id);
      } else throw err;
    }
  }
  const blocks = new Map<number, Block & { json?: string }>();
  const items: Block[] = [];
  const calls: ToolCall[] = [];
  let stop = 'stop';
  let reasoning = '';
  for await (const data of sse(res, signal)) {
    const ev = JSON.parse(data) as { type: string; index?: number; content_block?: Block; delta?: { type?: string; text?: string; thinking?: string; signature?: string; partial_json?: string; stop_reason?: string }; error?: { message?: string; type?: string }; message?: { usage?: Usage }; usage?: Usage };
    if (ev.type === 'message_start' && ev.message?.usage) {
      const u = ev.message.usage;
      const read = u.cache_read_input_tokens || 0;
      const write = u.cache_creation_input_tokens || 0;
      yield { type: 'raw_usage', input: (u.input_tokens || 0) + read + write, cached: read, cacheWrite: write, cacheMiss: (u.input_tokens || 0) + write, output: u.output_tokens };
    } else if (ev.type === 'content_block_start' && ev.content_block) {
      const b: Block & { json: string } = { ...ev.content_block, json: '' };
      blocks.set(ev.index ?? 0, b);
      if (b.type === 'tool_use') yield { type: 'tool_start', id: String(b.id), name: String(b.name) };
      if (b.type === 'thinking' && b.thinking) {
        reasoning += String(b.thinking);
        yield { type: 'reasoning', delta: String(b.thinking) };
      }
      if (b.type === 'text' && b.text) yield { type: 'text', delta: String(b.text) };
    } else if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      let b = blocks.get(ev.index ?? 0);
      // A text delta without its block start still counts as text
      if (!b && d.type === 'text_delta') blocks.set(ev.index ?? 0, (b = { type: 'text', text: '', json: '' }));
      if (!b) continue;
      if (d.type === 'thinking_delta' && d.thinking) {
        b.thinking = String(b.thinking || '') + d.thinking;
        reasoning += d.thinking;
        yield { type: 'reasoning', delta: d.thinking };
      } else if (d.type === 'signature_delta') b.signature = String(b.signature || '') + (d.signature || '');
      else if (d.type === 'text_delta' && d.text) {
        b.text = String(b.text || '') + d.text;
        yield { type: 'text', delta: d.text };
      } else if (d.type === 'input_json_delta') b.json += d.partial_json || '';
    } else if (ev.type === 'content_block_stop') {
      const b = blocks.get(ev.index ?? 0);
      if (!b) continue;
      blocks.delete(ev.index ?? 0);
      if (b.type === 'thinking') items.push({ type: 'thinking', thinking: String(b.thinking || ''), signature: String(b.signature || '') });
      else if (b.type === 'redacted_thinking') items.push({ type: 'redacted_thinking', data: b.data });
      else if (b.type === 'text') {
        if (b.text) items.push({ type: 'text', text: String(b.text) });
      } else if (b.type === 'tool_use') {
        const parsed = parseArgs(b.json || '');
        const args = normalize(String(b.name), parsed.args);
        items.push({ type: 'tool_use', id: b.id, name: b.name, input: parsed.argsError ? {} : parsed.args });
        calls.push({ id: String(b.id), name: String(b.name), ...parsed, args });
      } else items.push(Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'json')) as Block);
    } else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      if (ev.usage?.output_tokens !== undefined) yield { type: 'raw_usage', output: ev.usage.output_tokens };
    } else if (ev.type === 'error') {
      throw new AiError({ code: ev.error?.type === 'overloaded_error' || ev.error?.type === 'rate_limit_error' ? 'RATE_LIMIT' : 'PROVIDER', provider: cfg.name, message: ev.error?.message || 'Error in the stream' });
    }
  }
  if (stop === 'refusal') yield { type: 'text', delta: '\n\n_The model declined this request._' };
  // Cut off by max_tokens: a tool call may be incomplete, so none runs (and none stays in the history)
  const truncated = stop === 'max_tokens';
  if (!truncated) for (const c of calls) yield { type: 'tool_call', call: c };
  const replay: ReplayState = { provider: 'anthropic', model: cfg.model, items: truncated ? items.filter((b) => b.type !== 'tool_use') : items };
  yield { type: 'done', stop: truncated ? 'length' : stop === 'end_turn' ? 'stop' : stop === 'tool_use' ? 'tool_calls' : stop, replay, ...(reasoning ? { reasoning } : {}) };
}

/** Exact prompt tokens from /v1/messages/count_tokens (free, rate limited; same body as the request). */
export async function countClaude(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): Promise<number> {
  const { body, headers } = claudeRequest(cfg, req, { strict: true, binding: false, stripThinking: false });
  const { model, system, messages, tools, thinking, tool_choice } = body as Record<string, unknown>;
  const res = await post(cfg, `${root(cfg)}/v1/messages/count_tokens`, headers, { model, system, messages, ...(tools ? { tools, tool_choice } : {}), ...(thinking && (thinking as { type: string }).type !== 'between_tools' ? { thinking } : {}) }, signal, 0);
  const j = (await res.json()) as { input_tokens?: number };
  return j.input_tokens || 0;
}
