// Context window and capabilities of Ollama models.
//
// Ollama starts a model with 4096 tokens unless OLLAMA_CONTEXT_LENGTH or its VRAM default says otherwise, and a
// model's own limit (qwen3.5 has 262144) never applies by itself. The native chat adapter
// (src/chat/adapters/ollama.ts) therefore sends options.num_ctx with every request; this module decides the
// number, and reads what the model can do (thinking, tools, vision) from /api/show.
//
// Older WorkCraft versions made `wc-<model>-ctx<size>` copies of a model to carry the context. Those showed up
// in the user's `ollama list`; they are deleted once, and the model lists still hide them until then.
import type { ProviderConfig } from '../chat/types.js';
import { setContextWindow } from '../chat/models.js';
import { log } from './logs.js';

const root = (cfg: ProviderConfig) => cfg.baseUrl.replace(/\/v1\/?$/, '');
const PREFIX = 'wc-';

/** A model an older WorkCraft derived itself (hidden from the model lists, deleted once). */
export const isDerivedModel = (name: string) => name.startsWith(PREFIX) && /-ctx\d+(:latest)?$/.test(name);

export const CONTEXT_CHOICES = [8192, 16384, 32768, 65536, 131072, 262144, 0] as const;

async function post(url: string, body: unknown, ms = 15000): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
}

export interface OllamaModelInfo {
  /** Largest context the model supports (0 = unknown) */
  max: number;
  /** Reports the thinking capability: `think` may be sent */
  thinking: boolean;
  /** Reports tool support. Unknown counts as supported. */
  tools: boolean;
  vision: boolean;
}

const infoCache = new Map<string, OllamaModelInfo & { at: number }>();

/** Limit and capabilities of the model (/api/show), cached for ten minutes. */
export async function ollamaInfo(cfg: ProviderConfig): Promise<OllamaModelInfo> {
  const hit = infoCache.get(cfg.model);
  if (hit && Date.now() - hit.at < 600_000) return { max: hit.max, thinking: hit.thinking, tools: hit.tools, vision: hit.vision };
  let info: OllamaModelInfo = { max: 0, thinking: false, tools: true, vision: true };
  try {
    const r = await post(`${root(cfg)}/api/show`, { model: cfg.model }, 4000);
    if (r.ok) {
      const j = (await r.json()) as { model_info?: Record<string, unknown>; capabilities?: string[] };
      let max = 0;
      for (const [k, v] of Object.entries(j.model_info || {})) if (/\.context_length$/.test(k) && typeof v === 'number') max = Math.max(max, v);
      const caps = j.capabilities;
      // Servers that do not report capabilities: never guess `think`, assume tools and images work
      info = caps ? { max, thinking: caps.includes('thinking'), tools: caps.includes('tools'), vision: caps.includes('vision') } : { ...info, max };
    }
  } catch {
    /* Ollama not reachable: the request itself reports it */
  }
  infoCache.set(cfg.model, { ...info, at: Date.now() });
  return info;
}

/** Largest context the model supports (from its metadata), or 0 when Ollama does not say. */
export const ollamaMaxContext = async (cfg: ProviderConfig) => (await ollamaInfo(cfg)).max;

export interface OllamaContext {
  /** Tokens the request may use (sent as options.num_ctx) */
  window: number;
  /** Largest context the model supports (0 = unknown) */
  max: number;
  /** Share of the loaded model that sits in GPU memory (0 to 1), when known. Below 1 the rest runs on the CPU, which is slow. */
  gpu?: number;
  /** The size was chosen by the Automatic setting */
  auto?: boolean;
  /** What the model can do, for the request */
  thinking: boolean;
  tools: boolean;
  vision: boolean;
}

/** Setting value for "Automatic": the largest context that still fits into GPU memory. */
export const OLLAMA_AUTO = -1;
/** Sizes Automatic tries, largest first. 64k is the minimum Ollama recommends for agents and coding tools. */
const AUTO_STEPS = [65536, 32768, 16384];
/** A model counts as fitting when this share of it is in GPU memory (Ollama rounds the split by layer). */
const FITS = 0.97;

const fitCache = new Map<string, { ctx: number; gpu?: number; at: number }>();
const fitting = new Map<string, Promise<{ ctx: number; gpu?: number }>>();

const tagged = (name: string) => (name.includes(':') ? name : `${name}:latest`);

/** How much of the loaded model sits in GPU memory (/api/ps), or undefined when it is not loaded. */
async function gpuShare(cfg: ProviderConfig): Promise<number | undefined> {
  try {
    const r = await fetch(`${root(cfg)}/api/ps`, { signal: AbortSignal.timeout(2000) });
    const want = tagged(cfg.model);
    const m = ((await r.json()) as { models?: { name: string; model?: string; size?: number; size_vram?: number }[] }).models?.find((x) => tagged(x.name) === want || (x.model && tagged(x.model) === want));
    return m?.size ? Math.min(1, (m.size_vram || 0) / m.size) : undefined;
  } catch {
    return undefined;
  }
}

/** Loads the model with this context without generating anything, so /api/ps shows where its memory went. */
async function preload(cfg: ProviderConfig, ctx: number): Promise<void> {
  const r = await post(`${root(cfg)}/api/generate`, { model: cfg.model, prompt: '', stream: false, keep_alive: '15m', options: { num_ctx: ctx } }, 180_000);
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
}

/**
 * Automatic context: the largest of 64k, 32k and 16k that keeps the model in GPU memory. Each step loads the
 * model once to see the split, so the first request after a start takes a few seconds longer; the answer is
 * remembered. 16k is the floor even when the model then spills to the CPU, a smaller window would not hold
 * the system prompt and the tool definitions.
 */
async function autoContext(cfg: ProviderConfig, max: number): Promise<{ ctx: number; gpu?: number }> {
  const steps = AUTO_STEPS.filter((n) => !max || n <= max);
  if (!steps.length) steps.push(Math.max(2048, max || 16384));
  const hit = fitCache.get(cfg.model);
  if (hit && Date.now() - hit.at < 6 * 3_600_000 && steps.includes(hit.ctx)) return hit;
  let job = fitting.get(cfg.model);
  if (!job) {
    job = (async () => {
      let pick = { ctx: steps[steps.length - 1], gpu: undefined as number | undefined };
      for (let i = 0; i < steps.length; i++) {
        const ctx = steps[i];
        let gpu: number | undefined;
        try {
          await preload(cfg, ctx);
          gpu = await gpuShare(cfg);
        } catch (e) {
          log('warn', 'ollama', `Could not load ${cfg.model} at ${ctx} tokens: ${(e as Error).message}`);
        }
        pick = { ctx, gpu };
        // Not measurable (gpu unknown) counts as fitting: Ollama decides, and probing further would only reload
        if (gpu === undefined || gpu >= FITS) break;
      }
      fitCache.set(cfg.model, { ...pick, at: Date.now() });
      log('info', 'ollama', `${cfg.model}: automatic context ${pick.ctx} tokens${pick.gpu !== undefined ? `, ${Math.round(pick.gpu * 100)}% on the GPU` : ''}`);
      return pick;
    })().finally(() => fitting.delete(cfg.model));
    fitting.set(cfg.model, job);
  }
  return job;
}

let cleaned = false;

/** Deletes the `wc-…-ctx…` copies an older WorkCraft left in Ollama. Once per start, failures are ignored. */
async function removeDerived(cfg: ProviderConfig): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  try {
    const r = await fetch(`${root(cfg)}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const names = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name).filter(isDerivedModel) || [];
    for (const model of names) {
      const d = await fetch(`${root(cfg)}/api/delete`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(10_000) });
      if (d.ok) log('info', 'ollama', `Removed ${model}, the context is now sent with every request`);
    }
  } catch {
    cleaned = false;
  }
}

/**
 * The context an Ollama request will run with. `wanted` is the setting (OLLAMA_AUTO = what fits the GPU,
 * 0 = the model's maximum, else a fixed size), never above what the model supports.
 */
export async function ollamaContext(cfg: ProviderConfig, wanted: number): Promise<OllamaContext> {
  void removeDerived(cfg);
  const info = await ollamaInfo(cfg);
  const caps = { thinking: info.thinking, tools: info.tools, vision: info.vision };
  if (wanted === OLLAMA_AUTO) {
    const a = await autoContext(cfg, info.max);
    setContextWindow(cfg.model, a.ctx);
    return { window: a.ctx, max: info.max, ...(a.gpu !== undefined ? { gpu: a.gpu } : {}), auto: true, ...caps };
  }
  const window = Math.max(2048, Math.min(wanted > 0 ? wanted : info.max || 32768, info.max || Infinity));
  setContextWindow(cfg.model, window);
  const gpu = await gpuShare(cfg);
  return { window, max: info.max, ...(gpu !== undefined ? { gpu } : {}), ...caps };
}
