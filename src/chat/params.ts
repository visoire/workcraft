// Request parameters per provider: the effort chosen in the reasoning bar, the DeepSeek preset, the
// cache key and the room kept free for the answer. Shared by the backend (src/server/ai.ts) and browser
// mode (src/app/offline.ts), so both build the same requests. No DOM.

import type { Effort, ModelParams, ProviderConfig } from './types.js';
import { familyOf, type Family } from './models.js';
import { claudeThinking } from './adapters/claude.js';
import { resolveDeepSeekParams, type DeepSeekSettings } from './deepseek.js';

export interface ParamOptions {
  /** Effort from the reasoning bar; undefined: the provider default (for DeepSeek: the preset) */
  effort?: Effort;
  deepseek: DeepSeekSettings;
  /** A / command forces one tool */
  forcedTool: boolean;
  /** Chat id, for provider-side prompt cache routing */
  cacheKey?: string;
}

export interface ResolvedParams {
  family: Family;
  /** Model name to send (legacy DeepSeek names mapped) */
  model: string;
  params: ModelParams;
  /** Output tokens kept free when the request is fitted into the context window */
  reserve: number;
  notes: string[];
}

export function resolveParams(cfg: ProviderConfig, o: ParamOptions): ResolvedParams {
  const family = familyOf(cfg);
  const effort = o.effort;
  if (family === 'deepseek') {
    const r = resolveDeepSeekParams(o.deepseek, { model: cfg.model, forcedTool: o.forcedTool });
    const params: ModelParams = { ...r.params };
    if (effort) {
      // The reasoning bar wins over the preset
      if (effort === 'off') {
        params.thinking = false;
        delete params.effort;
      } else if (o.forcedTool) params.thinking = false;
      else {
        params.thinking = true;
        params.effort = effort;
        delete params.temperature;
      }
    }
    return { family, model: r.model, params, reserve: params.maxTokens ?? 8192, notes: r.notes };
  }
  const params: ModelParams = { ...(effort ? { effort } : {}), ...(o.cacheKey ? { cacheKey: o.cacheKey } : {}) };
  if (family === 'anthropic') return { family, model: cfg.model, params, reserve: claudeThinking(cfg.model, params).maxTokens, notes: [] };
  if (family === 'gemini' || family === 'openai') return { family, model: cfg.model, params, reserve: 16_384, notes: [] };
  // Z.ai GLM: the effort goes to thinking {type} and reasoning_effort
  if (family === 'zai') return { family, model: cfg.model, params: { ...(effort ? { effort } : {}), ...(o.cacheKey ? { cacheKey: o.cacheKey } : {}) }, reserve: 8192, notes: [] };
  // Local models: the effort goes to `think`; a smaller reserve keeps room for the prompt in a 16k window
  if (family === 'ollama') return { family, model: cfg.model, params: effort ? { effort } : {}, reserve: 4096, notes: [] };
  return { family, model: cfg.model, params: {}, reserve: 8192, notes: [] };
}

/** Providers that read PDFs and images natively (the bytes go with the request). */
export const readsDocuments = (family: Family) => family === 'anthropic' || family === 'gemini' || family === 'openai';
