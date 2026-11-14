// API usage and token telemetry, shared by the backend, browser mode and the interface.
// No DOM and no translations here: the backend compiles this file too.
//
// Every model request ends with a usage event (src/chat/providers.ts): exact numbers from the
// provider, or an estimate when it sends none. The totals are kept per provider and model:
// requests, input, output and cached tokens, time to the first token, generation time.
// The cost uses a rate table in US dollars per million tokens that the user maintains;
// local models (Ollama) always cost 0.

import type { ChatRequest, TokenUsage } from './types.js';
import { DEEPSEEK_IMAGE_TOKENS, renderPrompt } from './deepseek.js';
import { contextWindow } from './models.js';

export { contextWindow };

export interface UsageRow {
  key: string;
  providerId: string;
  provider: string;
  model: string;
  local: boolean;
  requests: number;
  input: number;
  output: number;
  /** Input tokens served from the cache (DeepSeek prompt_cache_hit_tokens) */
  cached: number;
  /** Input tokens that missed the cache (DeepSeek prompt_cache_miss_tokens; older stores lack it) */
  cacheMiss?: number;
  /** Thinking tokens inside output (DeepSeek reasoning_tokens) */
  reasoning?: number;
  /** Prompt tokens written to the cache (Claude cache_creation_input_tokens) */
  cacheWrite?: number;
  /** MCP tool calls the model made through this provider and model, how many succeeded, their time */
  toolCalls?: number;
  toolOk?: number;
  toolMs?: number;
  /** Requests where the provider sent no usage and the numbers are estimated */
  estimated: number;
  firstMs: number;
  totalMs: number;
  /** Generation time (from the first to the last token) for tokens per second */
  genMs: number;
  last: string;
}

export interface Rate {
  /** US dollars per million input tokens */
  input: number;
  /** US dollars per million output tokens */
  output: number;
  /** US dollars per million cached input tokens (optional, otherwise the input rate) */
  cached?: number;
  /** US dollars per million tokens written to the cache (Claude, optional, otherwise the input rate) */
  cacheWrite?: number;
}

export interface UsageStore {
  v: 1;
  since: string;
  rows: Record<string, UsageRow>;
  /** Rates by model name (exact) */
  rates: Record<string, Rate>;
  /** Team Mode: totals per role (leader, grid, word, deck, pdf, dev) across all chats */
  roles?: Record<string, RoleUsage>;
}

export const emptyUsage = (): UsageStore => ({ v: 1, since: new Date().toISOString(), rows: {}, rates: {} });

export function validUsage(x: unknown): x is UsageStore {
  const u = x as UsageStore;
  return !!u && u.v === 1 && typeof u.rows === 'object' && typeof u.rates === 'object';
}

export const usageKey = (u: Pick<TokenUsage, 'providerId' | 'model'>) => `${u.providerId}|${u.model}`;

/** Adds one request to the store (changes it in place). role: the Team Mode role that sent it. */
export function addUsage(store: UsageStore, u: TokenUsage, role?: string): UsageStore {
  if (role) addRoleUsage((store.roles ||= {}), role, u);
  const key = usageKey(u);
  const r = (store.rows[key] ||= { key, providerId: u.providerId, provider: u.provider, model: u.model, local: u.local, requests: 0, input: 0, output: 0, cached: 0, estimated: 0, firstMs: 0, totalMs: 0, genMs: 0, last: '' });
  r.requests++;
  r.input += Math.max(0, Math.round(u.input));
  r.output += Math.max(0, Math.round(u.output));
  r.cached += Math.max(0, Math.round(u.cached));
  if (u.cacheMiss !== undefined) r.cacheMiss = (r.cacheMiss || 0) + Math.max(0, Math.round(u.cacheMiss));
  if (u.reasoning !== undefined) r.reasoning = (r.reasoning || 0) + Math.max(0, Math.round(u.reasoning));
  if (u.cacheWrite) r.cacheWrite = (r.cacheWrite || 0) + Math.max(0, Math.round(u.cacheWrite));
  if (u.estimated) r.estimated++;
  r.firstMs += Math.max(0, u.firstMs);
  r.totalMs += Math.max(0, u.totalMs);
  r.genMs += Math.max(0, u.totalMs - u.firstMs);
  r.provider = u.provider;
  r.local = u.local;
  r.last = new Date().toISOString();
  return store;
}

/** One MCP tool call of a model (success rate and duration per provider and model). */
export interface ToolStat {
  providerId: string;
  provider: string;
  model: string;
  local: boolean;
  ok: boolean;
  ms: number;
}

/** Adds one tool call to the row of its provider and model (changes the store in place). */
export function addToolStat(store: UsageStore, t: ToolStat): UsageStore {
  const key = usageKey(t);
  const r = (store.rows[key] ||= { key, providerId: t.providerId, provider: t.provider, model: t.model, local: t.local, requests: 0, input: 0, output: 0, cached: 0, estimated: 0, firstMs: 0, totalMs: 0, genMs: 0, last: '' });
  r.toolCalls = (r.toolCalls || 0) + 1;
  r.toolOk = (r.toolOk || 0) + (t.ok ? 1 : 0);
  r.toolMs = (r.toolMs || 0) + Math.max(0, Math.round(t.ms));
  return store;
}

/**
 * Usage of one role of a Team Mode run (Team Leader or a specialist sub-agent): tokens, cache hits,
 * latency and tool calls, with the provider and model the role ran on. The cost comes from rowCost.
 */
export interface RoleUsage {
  role: string;
  providerId: string;
  provider: string;
  model: string;
  local: boolean;
  requests: number;
  input: number;
  output: number;
  cached: number;
  cacheWrite?: number;
  reasoning?: number;
  estimated: number;
  /** Sum of the times to the first token and of the request times */
  firstMs: number;
  totalMs: number;
  toolCalls?: number;
  toolOk?: number;
  toolMs?: number;
}

/** Adds one model request of a role (changes the map in place). */
export function addRoleUsage(map: Record<string, RoleUsage>, role: string, u: TokenUsage, toolCalls = 0): RoleUsage {
  const r = (map[role] ||= { role, providerId: u.providerId, provider: u.provider, model: u.model, local: u.local, requests: 0, input: 0, output: 0, cached: 0, estimated: 0, firstMs: 0, totalMs: 0 });
  r.providerId = u.providerId;
  r.provider = u.provider;
  r.model = u.model;
  r.local = u.local;
  r.requests++;
  r.input += Math.max(0, Math.round(u.input));
  r.output += Math.max(0, Math.round(u.output));
  r.cached += Math.max(0, Math.round(u.cached));
  if (u.cacheWrite) r.cacheWrite = (r.cacheWrite || 0) + Math.max(0, Math.round(u.cacheWrite));
  if (u.reasoning !== undefined) r.reasoning = (r.reasoning || 0) + Math.max(0, Math.round(u.reasoning));
  if (u.estimated) r.estimated++;
  r.firstMs += Math.max(0, u.firstMs);
  r.totalMs += Math.max(0, u.totalMs);
  if (toolCalls) r.toolCalls = (r.toolCalls || 0) + toolCalls;
  return r;
}

/** Share of successful MCP tool calls, or null without calls. */
export const toolSuccess = (r: Pick<UsageRow, 'toolCalls' | 'toolOk'>) => (r.toolCalls ? (r.toolOk || 0) / r.toolCalls : null);

/** Estimated cost of a row in US dollars. Local models are free. Cache writes cost the write rate. */
export function rowCost(r: Pick<UsageRow, 'local' | 'model' | 'input' | 'output' | 'cached'> & { cacheWrite?: number }, rates: Record<string, Rate>): number {
  if (r.local) return 0;
  const rate = rates[r.model];
  if (!rate) return 0;
  const cachedRate = rate.cached ?? rate.input;
  const write = r.cacheWrite || 0;
  const writeRate = rate.cacheWrite ?? rate.input;
  return ((r.input - r.cached - write) * rate.input + write * writeRate + r.cached * cachedRate + r.output * rate.output) / 1_000_000;
}

/** Rows summed per provider, for the side-by-side comparison of providers. */
export function byProvider(store: UsageStore): UsageRow[] {
  const out = new Map<string, UsageRow>();
  for (const r of Object.values(store.rows)) {
    const p = out.get(r.providerId) || { key: r.providerId, providerId: r.providerId, provider: r.provider, model: '', local: r.local, requests: 0, input: 0, output: 0, cached: 0, cacheMiss: 0, reasoning: 0, cacheWrite: 0, toolCalls: 0, toolOk: 0, toolMs: 0, estimated: 0, firstMs: 0, totalMs: 0, genMs: 0, last: '' };
    for (const k of ['requests', 'input', 'output', 'cached', 'cacheMiss', 'reasoning', 'cacheWrite', 'toolCalls', 'toolOk', 'toolMs', 'estimated', 'firstMs', 'totalMs', 'genMs'] as const) p[k] = (p[k] || 0) + (r[k] || 0);
    p.model = p.model ? `${p.model}, ${r.model}` : r.model;
    if (r.last > p.last) p.last = r.last;
    out.set(r.providerId, p);
  }
  return [...out.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
}

/** Cache misses: the reported value, else input minus cache hits. */
export const missOf = (r: Pick<UsageRow, 'input' | 'cached' | 'cacheMiss'>) => r.cacheMiss ?? Math.max(0, r.input - r.cached);

/**
 * What the cache saved in US dollars: cache hits billed at the cached rate instead of the input rate.
 * 0 without a rate or without a separate cached rate.
 */
export function cacheSavings(r: Pick<UsageRow, 'local' | 'model' | 'cached'>, rates: Record<string, Rate>): number {
  if (r.local) return 0;
  const rate = rates[r.model];
  if (!rate || rate.cached === undefined) return 0;
  return Math.max(0, (r.cached * (rate.input - rate.cached)) / 1_000_000);
}

/** Share of the input tokens served from the cache, 0 to 1. */
export const cacheHitRatio = (r: Pick<UsageRow, 'input' | 'cached'>) => (r.input > 0 ? Math.min(1, r.cached / r.input) : 0);

export const percent = (x: number) => (x > 0 && x < 0.001 ? '<0.1%' : `${(x * 100).toFixed(x >= 0.995 || x === 0 ? 0 : 1)}%`);

export const tokensPerSecond = (r: Pick<UsageRow, 'output' | 'genMs'>) => (r.genMs > 0 ? r.output / (r.genMs / 1000) : 0);

export function usageTotals(store: UsageStore) {
  const rows = Object.values(store.rows);
  return {
    requests: rows.reduce((a, r) => a + r.requests, 0),
    input: rows.reduce((a, r) => a + r.input, 0),
    output: rows.reduce((a, r) => a + r.output, 0),
    cached: rows.reduce((a, r) => a + r.cached, 0),
    cacheMiss: rows.reduce((a, r) => a + (r.cacheMiss || 0), 0),
    reasoning: rows.reduce((a, r) => a + (r.reasoning || 0), 0),
    cost: rows.reduce((a, r) => a + rowCost(r, store.rates), 0),
    savings: rows.reduce((a, r) => a + cacheSavings(r, store.rates), 0),
  };
}

/** 12345 -> "12.3k", 1234567 -> "1.23M" */
export function compactTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function money(n: number): string {
  return n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------- Pre-flight count of a request

/** Rough count when no tokenizer fits the model: about four characters per token. */
export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

export interface PromptCount {
  total: number;
  system: number;
  tools: number;
  context: number;
  history: number;
  images: number;
  /** Counted with the DeepSeek V4 tokenizer (otherwise estimated) */
  exact: boolean;
}

/**
 * Tokens of a whole request before it is sent: system prompt, tool schemas, project context, history
 * with attachments, and images. With a tokenizer (DeepSeek) the text is counted exactly through the chat
 * template; otherwise estimated from the characters.
 */
export function countRequest(req: Pick<ChatRequest, 'system' | 'context' | 'turns' | 'tools'>, count?: ((text: string) => number) | null): PromptCount {
  const r = renderPrompt(req);
  const c = count || ((s: string) => estimateTokens(s.length));
  const system = c(r.parts.system);
  const tools = c(r.parts.tools);
  const context = c(r.parts.context);
  const history = c(r.parts.history);
  const images = r.images * DEEPSEEK_IMAGE_TOKENS;
  return { total: system + tools + context + history + images, system, tools, context, history, images, exact: !!count };
}
