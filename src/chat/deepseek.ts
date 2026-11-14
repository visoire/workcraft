// DeepSeek specifics shared by the backend and the interface (no DOM, no translations):
// models and limits from the API reference, the parameter presets, the rules that keep requests valid,
// and the chat template of the V4 tokenizer for exact prompt counting.
//
// Reference: DeepSeek API docs (Chat Completions, Thinking Mode, Tool Calls, Context Caching,
// FIM and Chat Prefix Completion beta) and the deepseek_v4_tokenizer chat template.

import type { ChatRequest, ModelParams, ProviderConfig, ToolSpec } from './types.js';

export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;
/** Combined input and output capacity (DeepSeek Harness default for both models). */
export const DEEPSEEK_WINDOW = 1_000_000;
/** max_tokens must be between 1 and 384K. */
export const DEEPSEEK_MAX_OUTPUT = 393_216;
/** Defaults of the API when max_tokens is not set. */
export const DEEPSEEK_DEFAULT_MAX = { chat: 8_192, thinking: 65_536, max: 131_072 } as const;
/** FIM completions return at most 4K tokens. */
export const DEEPSEEK_FIM_MAX = 4_096;
/** Upper bound of tokens one image costs after resizing. */
export const DEEPSEEK_IMAGE_TOKENS = 1_024;

/** Model names older configurations still carry. They map to the current model and thinking setting. */
const LEGACY: Record<string, { model: string; thinking: boolean }> = {
  'deepseek-chat': { model: 'deepseek-flash', thinking: false },
  'deepseek-reasoner': { model: 'deepseek-flash', thinking: true },
};

export function isDeepSeek(cfg: Pick<ProviderConfig, 'id' | 'baseUrl'>): boolean {
  return cfg.id === 'deepseek' || /(^|\.)deepseek\.com/i.test(hostOf(cfg.baseUrl));
}
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** https://api.deepseek.com, also from .../v1 or .../beta */
export const deepseekRoot = (baseUrl: string) => baseUrl.replace(/\/+$/, '').replace(/\/(v1|beta)$/, '');

export function normalizeModel(model: string): { model: string; thinking?: boolean } {
  return LEGACY[model] || { model };
}

// ---------------------------------------------------------------- Presets

export type DeepSeekPresetId = 'chat' | 'reasoning' | 'max' | 'coding';

export interface DeepSeekPreset {
  id: DeepSeekPresetId;
  name: string;
  hint: string;
  thinking: boolean;
  effort?: 'low' | 'high' | 'max';
  /** undefined: API default (1.0), not sent */
  temperature?: number;
  maxTokens: number;
  /** max_tokens of FIM and prefix completions in the code editor */
  completionTokens: number;
}

export const DEEPSEEK_PRESETS: DeepSeekPreset[] = [
  { id: 'chat', name: 'Standard chat', hint: 'No thinking, fast answers. Temperature 1.0, 8K output.', thinking: false, maxTokens: DEEPSEEK_DEFAULT_MAX.chat, completionTokens: 256 },
  { id: 'reasoning', name: 'Thinking', hint: 'Chain of thought before the answer (effort high), 64K output. Temperature has no effect.', thinking: true, effort: 'high', maxTokens: DEEPSEEK_DEFAULT_MAX.thinking, completionTokens: 256 },
  { id: 'max', name: 'Deep thinking', hint: 'Effort max for the hardest tasks, 128K output. Slower and uses more tokens.', thinking: true, effort: 'max', maxTokens: DEEPSEEK_DEFAULT_MAX.max, completionTokens: 256 },
  { id: 'coding', name: 'Coding and FIM', hint: 'No thinking, temperature 0 for exact code, 8K output, FIM completions up to 1K.', thinking: false, temperature: 0, maxTokens: DEEPSEEK_DEFAULT_MAX.chat, completionTokens: 1_024 },
];

/** Stored choice (config.json ai.deepseek): a preset plus optional overrides. */
export interface DeepSeekSettings {
  preset: DeepSeekPresetId;
  maxTokens?: number;
  temperature?: number;
  effort?: 'low' | 'high' | 'max';
}

export const DEFAULT_DEEPSEEK: DeepSeekSettings = { preset: 'reasoning' };

export const presetOf = (id: string | undefined) => DEEPSEEK_PRESETS.find((p) => p.id === id) || DEEPSEEK_PRESETS[1]!;

/**
 * Parameters for one chat request, with the rules of the API reference:
 * - thinking mode ignores temperature, so it is not sent,
 * - required or named tool_choice returns 400 in thinking mode, so a forced tool switches thinking off,
 * - max_tokens stays between 1 and 384K,
 * - legacy model names (deepseek-chat from older settings) map to the current model; the preset
 *   decides about thinking, so choosing a mode always takes effect.
 */
export function resolveDeepSeekParams(s: DeepSeekSettings, opts: { model: string; forcedTool?: boolean }): { model: string; params: ModelParams; notes: string[] } {
  const p = presetOf(s.preset);
  const notes: string[] = [];
  const legacy = normalizeModel(opts.model);
  let thinking = p.thinking;
  if (thinking && opts.forcedTool) {
    thinking = false;
    notes.push('thinking off for a forced tool call (the API rejects named tool_choice in thinking mode)');
  }
  const effort = thinking ? s.effort || p.effort || 'high' : undefined;
  const fallbackMax = !thinking ? DEEPSEEK_DEFAULT_MAX.chat : effort === 'max' ? DEEPSEEK_DEFAULT_MAX.max : DEEPSEEK_DEFAULT_MAX.thinking;
  const maxTokens = Math.min(DEEPSEEK_MAX_OUTPUT, Math.max(1, Math.round(s.maxTokens || (thinking === p.thinking ? p.maxTokens : fallbackMax))));
  const temperature = thinking ? undefined : (s.temperature ?? p.temperature);
  return { model: legacy.model, params: { thinking, ...(effort ? { effort } : {}), maxTokens, ...(temperature !== undefined ? { temperature: Math.min(2, Math.max(0, temperature)) } : {}) }, notes };
}

/** Tools in a stable order: the same set always renders the same prompt prefix. */
export function sortTools(tools: ToolSpec[]): ToolSpec[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------- Chat template (V4 tokenizer)

const T = {
  bos: '<｜begin▁of▁sentence｜>',
  eos: '<｜end▁of▁sentence｜>',
  user: '<｜User｜>',
  assistant: '<｜Assistant｜>',
  callsBegin: '<｜tool▁calls▁begin｜>',
  callsEnd: '<｜tool▁calls▁end｜>',
  callBegin: '<｜tool▁call▁begin｜>',
  callEnd: '<｜tool▁call▁end｜>',
  sep: '<｜tool▁sep｜>',
  outsBegin: '<｜tool▁outputs▁begin｜>',
  outsEnd: '<｜tool▁outputs▁end｜>',
  outBegin: '<｜tool▁output▁begin｜>',
  outEnd: '<｜tool▁output▁end｜>',
  think: '<think>',
  thinkEnd: '</think>',
};

/** Tool schemas as the model sees them in the system part (sorted, compact JSON). */
export const toolsText = (tools: ToolSpec[]) => (tools.length ? `## Tools\n${sortTools(tools).map((t) => JSON.stringify({ type: 'function', function: t })).join('\n')}` : '');

/**
 * The prompt as the chat template of the tokenizer renders it. The text parts are exact; how the server
 * renders tool schemas is not published, so they count as compact JSON (the usage of the previous
 * request calibrates the difference, see src/chat/usage.ts).
 */
export function renderPrompt(req: Pick<ChatRequest, 'system' | 'context' | 'turns' | 'tools'>, opts: { reasoning?: boolean } = {}): { parts: { system: string; tools: string; context: string; history: string }; images: number } {
  const keepReasoning = opts.reasoning ?? req.tools.length > 0;
  let history = '';
  let images = 0;
  let inTool = false;
  for (const t of req.turns) {
    if (t.role === 'user') {
      inTool = false;
      // Native documents count like images (a PDF about one unit per 60 KB)
      images += (t.images?.length || 0) + (t.docs || []).reduce((n, d) => n + (d.mime === 'application/pdf' ? Math.max(1, Math.ceil(d.size / 60_000)) : 1), 0);
      history += T.user + t.content;
    } else if (t.role === 'assistant') {
      history += inTool ? T.outsEnd : T.assistant;
      inTool = false;
      if (keepReasoning && t.reasoning) history += T.think + t.reasoning + T.thinkEnd;
      history += t.text;
      if (t.toolCalls.length) history += T.callsBegin + t.toolCalls.map((c) => `${T.callBegin}function${T.sep}${c.name}\n\`\`\`json\n${JSON.stringify(c.args)}\n\`\`\`${T.callEnd}`).join('\n') + T.callsEnd;
      history += T.eos;
    } else {
      history += (inTool ? '\n' : T.outsBegin) + t.results.map((r) => T.outBegin + r.content + T.outEnd).join('\n');
      inTool = true;
    }
  }
  history += (inTool ? T.outsEnd : '') + T.assistant;
  return { parts: { system: T.bos + req.system, tools: toolsText(req.tools), context: req.context || '', history }, images };
}
