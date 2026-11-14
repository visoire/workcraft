// HTTP and SSE plumbing shared by the provider adapters (src/chat/providers.ts and src/chat/adapters/).
// Plain fetch, no SDKs: the same code runs in the Node backend and in browser mode, and the raw
// stream keeps provider state such as Claude thinking signatures and Gemini thought signatures intact.

import { AiError } from './types.js';
import type { AiErrorCode, ChatRequest, ChatTurn, ProviderConfig, StreamEvent, ToolSpec, TurnDoc } from './types.js';
import { repairArgs } from '../core/json-repair.js';
import { compileToolSchema, normalizeToolArgs, type SchemaTarget } from '../mcp/schemas.js';
import { sortTools } from './deepseek.js';

/** Usage numbers as a provider reports them (fields it does not send stay undefined). */
export type RawUsage = { type: 'raw_usage'; input?: number; output?: number; cached?: number; cacheMiss?: number; cacheWrite?: number; reasoning?: number };
export type ProviderEvent = StreamEvent | RawUsage;

/** In browser mode (without the desktop backend) requests go straight from the browser to Anthropic. */
export const BROWSER_HEADERS: Record<string, string> = typeof (globalThis as { document?: unknown }).document !== 'undefined' ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {};

let idCounter = 0;
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// ---------------------------------------------------------------- Errors

export function codeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  return 'PROVIDER';
}

export async function httpError(res: Response, cfg: ProviderConfig): Promise<AiError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      detail = (typeof j.error === 'string' ? j.error : j.error?.message) || j.message || text;
    } catch {
      detail = text;
    }
  } catch {
    detail = res.statusText;
  }
  return new AiError({ code: codeForStatus(res.status), status: res.status, provider: cfg.name, message: detail.slice(0, 600) || res.statusText });
}

export function networkError(e: unknown, cfg: ProviderConfig): AiError {
  if (e instanceof AiError) return e;
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  if (err?.name === 'AbortError') return new AiError({ code: 'ABORTED', provider: cfg.name, message: 'Request stopped' });
  if (err?.name === 'TimeoutError') return new AiError({ code: 'TIMEOUT', provider: cfg.name, message: 'Timed out' });
  return new AiError({ code: 'UNREACHABLE', provider: cfg.name, message: `${cfg.baseUrl} not reachable (${err?.cause?.code || err?.message || 'network error'})` });
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529]);

/**
 * POST with up to two retries on 429, 5xx and Claude's 529 overloaded_error (exponential backoff with
 * jitter, honoring retry-after up to 20 s). Errors before the first byte only: a started stream is
 * never repeated.
 */
export async function post(cfg: ProviderConfig, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal, retries = 2): Promise<Response> {
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    } catch (e) {
      throw networkError(e, cfg);
    }
    if (res.ok && res.body) return res;
    if (attempt < retries && RETRY_STATUS.has(res.status) && !signal?.aborted) {
      const after = Number(res.headers.get('retry-after'));
      const wait = after > 0 ? Math.min(20_000, after * 1000) : delay * (0.8 + Math.random() * 0.4);
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, wait));
      delay = Math.min(delay * 2, 8000);
      continue;
    }
    throw await httpError(res, cfg);
  }
}

// ---------------------------------------------------------------- Read streams

export async function* lines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        yield buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
      }
    }
    if (buf) yield buf;
  } finally {
    reader.releaseLock();
  }
}

/** Server-sent events: the data field of each event (comments such as ": keep-alive" are skipped). */
export async function* sse(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  let data: string[] = [];
  for await (const line of lines(res, signal)) {
    if (line === '') {
      if (data.length) yield data.join('\n');
      data = [];
    } else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length) yield data.join('\n');
}

// ---------------------------------------------------------------- Request pieces

/** Tool arguments: strict JSON, else the repair pass (fences, quotes, truncation), else argsError. */
export function parseArgs(text: string): { args: Record<string, unknown>; argsError?: string; repaired?: string[] } {
  const r = repairArgs(text);
  return 'argsError' in r ? { args: {}, argsError: r.argsError } : r;
}

/** System prompt and persistent project context in one text (providers with a single system field). */
export const systemText = (req: ChatRequest) => (req.context ? `${req.system}\n\n${req.context}` : req.system);

/** Tools sorted by name and compiled for one provider, plus a lookup for normalizing the arguments. */
export function compileTools(tools: ToolSpec[], target: SchemaTarget, strict = true) {
  const list = sortTools(tools).map((t) => {
    const c = compileToolSchema(t.parameters, target);
    return { name: t.name, description: t.description, parameters: c.parameters, strict: strict && c.strict };
  });
  const byName = new Map(tools.map((t) => [t.name, t.parameters]));
  const normalize = (name: string, args: Record<string, unknown>) => {
    const s = byName.get(name);
    return s ? normalizeToolArgs(s, args, target) : args;
  };
  return { list, normalize };
}

/** Documents the provider reads natively (PDF and images with loaded bytes). */
export const nativeDocs = (t: Extract<ChatTurn, { role: 'user' }>, pdf = true): TurnDoc[] => (t.docs || []).filter((d) => !!d.data && (d.mime.startsWith('image/') || (pdf && d.mime === 'application/pdf')));

/**
 * The user text for a provider that reads the documents natively: the extracted text of those files in
 * the <context> block is replaced by a short note, so the model gets the file once (as a document) and
 * the prompt stays the same on every request.
 */
export function textWithoutNative(t: Extract<ChatTurn, { role: 'user' }>, docs: TurnDoc[]): string {
  let out = t.content;
  for (const d of docs) {
    const p = d.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(<entry\\b[^>]*path="${p}"[^>]*>\\n)[\\s\\S]*?(\\n</entry>)`), `$1[${d.mime === 'application/pdf' ? 'PDF' : 'Image'} attached as a native document block.]$2`);
  }
  return out;
}
