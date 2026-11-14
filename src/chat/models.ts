// What each provider and model can do: context window, output limit, thinking controls and their
// rules. Shared by the backend (request building) and the interface (reasoning bar, footer).
// No DOM and no translations here.
//
// Sources: the reference sets in artifical-intelligence/ (DeepSeek, Gemini, Claude, OpenAI) and, for
// Claude, the current Messages API rules: adaptive thinking with output_config.effort on the 4.6+ models,
// thinking that cannot be switched off on Fable 5.x and Opus 5.5, between_tools on Sonnet 5.5,
// budget_tokens only on older models, forced tool_choice rejected on Fable 5.1 / Opus 5.5 / Sonnet 5.5.

import type { Effort, ProviderConfig } from './types.js';

export type Family = 'deepseek' | 'anthropic' | 'gemini' | 'openai' | 'ollama' | 'xai' | 'zai' | 'compatible';

/** Which wire protocol a provider speaks. openai: the official ChatGPT preset (Responses API). ollama: the native /api/chat. */
export function familyOf(cfg: Pick<ProviderConfig, 'id' | 'kind' | 'baseUrl'>): Family {
  if (cfg.kind === 'anthropic') return 'anthropic';
  if (cfg.kind === 'gemini') return 'gemini';
  if (cfg.id === 'ollama') return 'ollama';
  if (cfg.id === 'deepseek' || /(^|\.)deepseek\.com/i.test(host(cfg.baseUrl))) return 'deepseek';
  if (cfg.id === 'openai' || /(^|\.)api\.openai\.com$/i.test(host(cfg.baseUrl))) return 'openai';
  if (cfg.id === 'xai' || /(^|\.)x\.ai$/i.test(host(cfg.baseUrl))) return 'xai';
  if (cfg.id === 'zai' || /(^|\.)(z\.ai|bigmodel\.cn)$/i.test(host(cfg.baseUrl))) return 'zai';
  return 'compatible';
}
const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------- Claude

/**
 * always:   thinking cannot be switched off (Fable 5.x, Mythos, Opus 5.5); effort is the only control
 * between:  Sonnet 5.5, off means thinking: {type: "between_tools"} at effort high or below
 * optional: adaptive on, {type: "disabled"} accepted (Opus 5, Haiku 5.5 only at effort high or below)
 * budget:   older models: {type: "enabled", budget_tokens} (minimum 1024, below max_tokens)
 */
export type ClaudeThinking = 'always' | 'between' | 'optional' | 'budget';

export interface ClaudeModel {
  thinking: ClaudeThinking;
  /** Effort values of output_config.effort the model accepts */
  efforts: string[];
  /** tool_choice any / tool returns 400 */
  noForcedTool: boolean;
  window: number;
  maxOutput: number;
}

export function claudeModel(model: string): ClaudeModel {
  const m = model.toLowerCase();
  const all = ['low', 'medium', 'high', 'xhigh', 'max'];
  if (/claude-(fable|mythos)/.test(m)) return { thinking: 'always', efforts: all, noForcedTool: /-5-1|-5\.1/.test(m), window: 1_000_000, maxOutput: 128_000 };
  if (/claude-opus-5-5/.test(m)) return { thinking: 'always', efforts: all, noForcedTool: true, window: 1_000_000, maxOutput: 128_000 };
  if (/claude-sonnet-5-5/.test(m)) return { thinking: 'between', efforts: all, noForcedTool: true, window: 1_000_000, maxOutput: 128_000 };
  if (/claude-(opus-5|haiku-5|sonnet-5)(\b|-|$)/.test(m) || /claude-opus-4-[78]/.test(m)) return { thinking: 'optional', efforts: all, noForcedTool: false, window: 1_000_000, maxOutput: 128_000 };
  if (/claude-(opus|sonnet)-4-6/.test(m)) return { thinking: 'optional', efforts: ['low', 'medium', 'high', 'max'], noForcedTool: false, window: 1_000_000, maxOutput: 128_000 };
  // Haiku 4.5, Sonnet 4.5, Opus 4.5 and older: budget tokens, 200k context
  return { thinking: 'budget', efforts: [], noForcedTool: false, window: 200_000, maxOutput: /haiku-3|claude-3-(opus|sonnet|haiku)/.test(m) ? 8_192 : 64_000 };
}

/** budget_tokens per effort on models that still use a thinking budget. */
export const CLAUDE_BUDGET: Record<Exclude<Effort, 'off'>, number> = { low: 2_048, medium: 6_000, high: 16_000, max: 32_000 };

// ---------------------------------------------------------------- Gemini

export interface GeminiModel {
  /** Gemini 3 and newer: thinkingLevel; 2.5: thinkingBudget */
  levels: boolean;
  /** Thinking can be switched off completely (2.5 Flash, Flash-Lite) */
  canDisable: boolean;
  window: number;
  maxOutput: number;
}

export function geminiModel(model: string): GeminiModel {
  const m = model.toLowerCase();
  const v = parseFloat(m.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || '3');
  const levels = v >= 3 || /latest/.test(m);
  return { levels, canDisable: !levels && /flash/.test(m), window: 1_048_576, maxOutput: /argon/.test(m) ? 1_048_576 : 65_536 };
}

/** thinkingConfig for one effort. */
export function geminiThinking(model: string, effort: Effort | undefined): Record<string, unknown> {
  const g = geminiModel(model);
  const out: Record<string, unknown> = { includeThoughts: effort !== 'off' };
  if (!effort) return out;
  if (g.levels) out.thinkingLevel = effort === 'off' ? (/pro/i.test(model) ? 'low' : 'minimal') : effort === 'max' ? 'high' : effort;
  else out.thinkingBudget = effort === 'off' ? (g.canDisable ? 0 : 128) : { low: 1_024, medium: 8_192, high: 24_576, max: -1 }[effort];
  return out;
}

// ---------------------------------------------------------------- OpenAI

export interface OpenAIModel {
  /** Reasoning model: reasoning.effort, no temperature, reasoning summaries in the Responses API */
  reasoning: boolean;
  /** 'minimal' is the lowest effort (GPT-5 family), else 'low' */
  minimal: boolean;
  encoding: 'o200k_base' | 'cl100k_base';
  window: number;
  maxOutput: number;
}

export function openaiModel(model: string): OpenAIModel {
  const m = model.toLowerCase();
  const reasoning = /^(o\d|gpt-5|gpt-oss)/.test(m);
  const encoding = /^(gpt-4o|gpt-4\.1|gpt-5|o\d|chatgpt|gpt-oss|gpt-6)/.test(m) ? 'o200k_base' : /^(gpt-4|gpt-3\.5)/.test(m) ? 'cl100k_base' : 'o200k_base';
  const window = /^gpt-4\.1/.test(m) ? 1_047_576 : /^gpt-5/.test(m) ? 400_000 : /^o\d/.test(m) ? 200_000 : /^gpt-4o/.test(m) ? 128_000 : 128_000;
  const maxOutput = /^gpt-5/.test(m) ? 128_000 : /^o\d/.test(m) ? 100_000 : /^gpt-4\.1/.test(m) ? 32_768 : 16_384;
  return { reasoning, minimal: /^gpt-5/.test(m), encoding, window, maxOutput };
}

// ---------------------------------------------------------------- Ollama

/** Local model families that think before they answer (Ollama reports the capability, this only drives the menu). */
export const OLLAMA_THINKERS = /qwen3|qwq|deepseek-r1|gpt-oss|magistral|phi4-reasoning|cogito|smollm3|gemma4|reasoning|think/i;

/**
 * The `think` value for a native Ollama request, or undefined to leave the model's default. Boolean models
 * take true/false; gpt-oss takes low, medium or high and cannot be switched off (off sends low).
 */
export function ollamaThink(model: string, effort: Effort | undefined): boolean | 'low' | 'medium' | 'high' | undefined {
  if (!effort) return undefined;
  if (/gpt-oss/i.test(model)) return effort === 'off' ? 'low' : effort === 'max' ? 'high' : effort;
  return effort !== 'off';
}

// ---------------------------------------------------------------- Effort choices for the interface

export interface EffortChoice {
  id: Effort;
  /** How the level maps for this model, for the menu hint (DM Mono) */
  wire: string;
}

/**
 * Effort levels the reasoning bar offers for one provider and model, with the wire value each maps to.
 * Levels a model cannot express are left out (Ollama and own endpoints: none).
 */
export function effortChoices(family: Family, model: string): EffortChoice[] {
  if (family === 'deepseek') return [
    { id: 'off', wire: 'thinking disabled' },
    { id: 'low', wire: 'effort low' },
    { id: 'high', wire: 'effort high' },
    { id: 'max', wire: 'effort max' },
  ];
  if (family === 'anthropic') {
    const c = claudeModel(model);
    if (c.thinking === 'budget') return [{ id: 'off', wire: 'no thinking' }, ...(['low', 'medium', 'high', 'max'] as const).map((e) => ({ id: e, wire: `budget ${CLAUDE_BUDGET[e]}` }))];
    const off = c.thinking === 'always' ? 'effort low (always thinks)' : c.thinking === 'between' ? 'between_tools' : 'thinking disabled';
    return [{ id: 'off', wire: off }, { id: 'low', wire: 'effort low' }, { id: 'medium', wire: 'effort medium' }, { id: 'high', wire: 'effort high' }, { id: 'max', wire: c.efforts.includes('max') ? 'effort max' : 'effort high' }];
  }
  if (family === 'gemini') {
    const g = geminiModel(model);
    return (['off', 'low', 'medium', 'high', 'max'] as const).map((id) => {
      const t = geminiThinking(model, id);
      return { id, wire: g.levels ? `level ${String(t.thinkingLevel)}` : `budget ${String(t.thinkingBudget)}` };
    });
  }
  if (family === 'zai') {
    // Z.ai: thinking {type} plus reasoning_effort low / high / max (medium maps to high)
    return [
      { id: 'off', wire: 'thinking disabled' },
      { id: 'low', wire: 'effort low' },
      { id: 'high', wire: 'effort high' },
      { id: 'max', wire: 'effort max' },
    ];
  }
  if (family === 'ollama') {
    // The backend only sends `think` when the model reports the thinking capability (/api/show); the names below
    // decide whether the menu is offered at all. gpt-oss cannot switch thinking off, it has three levels.
    if (!OLLAMA_THINKERS.test(model)) return [];
    if (/gpt-oss/i.test(model)) return [{ id: 'low', wire: 'think low' }, { id: 'medium', wire: 'think medium' }, { id: 'high', wire: 'think high' }];
    return [{ id: 'off', wire: 'think false' }, { id: 'medium', wire: 'think true' }];
  }
  if (family === 'openai') {
    const o = openaiModel(model);
    if (!o.reasoning) return [];
    return [{ id: 'off', wire: o.minimal ? 'effort minimal' : 'effort low' }, { id: 'low', wire: 'effort low' }, { id: 'medium', wire: 'effort medium' }, { id: 'high', wire: 'effort high' }, { id: 'max', wire: o.minimal ? 'effort high' : 'effort high' }];
  }
  return [];
}

/**
 * Context window by model name (tokens). Exact for the four cloud providers, a guide otherwise:
 * unknown models count with 128k.
 */
/** Context sizes measured at run time (Ollama reports what a model really runs with); they beat the guesses below. */
const measured = new Map<string, number>();
export function setContextWindow(model: string, tokens: number): void {
  if (tokens > 0) measured.set(model.toLowerCase(), tokens);
}

export function contextWindow(model: string | undefined): number {
  if (!model) return 128_000;
  const m = model.toLowerCase();
  const known = measured.get(m);
  if (known) return known;
  if (/claude/.test(m)) return claudeModel(m).window;
  if (/gemini/.test(m)) return geminiModel(m).window;
  if (/deepseek/.test(m)) return 1_000_000;
  if (/grok/.test(m)) return 500_000; // grok-4.7: 500k, long-prompt pricing doubles from 200k
  if (/glm-5/.test(m)) return 1_000_000;
  if (/glm-4/.test(m)) return 128_000;
  if (/^(gpt|o\d|chatgpt)/.test(m)) return openaiModel(m).window;
  if (/llama3\.[1-9]|llama-3\.[1-9]/.test(m)) return 128_000;
  if (/qwen2\.5|qwen3/.test(m)) return 32_768;
  if (/mistral|mixtral/.test(m)) return 32_768;
  if (/phi|gemma/.test(m)) return 8_192;
  return 128_000;
}
