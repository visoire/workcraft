// What the Model and Base URL dropdowns of Settings > AI models offer. Pure data and one merge function (no DOM), so it is unit-tested
// (tests/server/model-choices.test.ts). The lists are suggestions, never a limit: every dropdown ends in "Other ..." where a name or an
// address can be typed, and "Test connection" adds the models the endpoint really reports. Names and addresses come from the presets in
// src/chat/providers.ts and from docs/AI-PROVIDERS.md; add a model there first.

export interface Choice {
  value: string;
  label: string;
}

/** Models worth suggesting per provider id (the first one is the preset's own). */
export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  openai: ['gpt-5', 'gpt-4.1', 'gpt-4o'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  xai: ['grok-4.7'],
  zai: ['glm-5.3'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  groq: ['llama-3.3-70b-versatile'],
  openrouter: ['openrouter/auto'],
  together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  ollama: ['qwen2.5:7b', 'qwen3.5:4b'],
  lmstudio: ['local-model'],
  custom: [],
};

/** Other addresses a provider is known to answer on (the preset's own address is always offered first). */
export const BASE_ALTERNATIVES: Record<string, Choice[]> = {
  deepseek: [{ value: 'https://api.deepseek.com/v1', label: 'api.deepseek.com/v1 (OpenAI compatible path)' }],
  zai: [{ value: 'https://open.bigmodel.cn/api/paas/v4', label: 'open.bigmodel.cn (China)' }],
  mistral: [{ value: 'https://codestral.mistral.ai/v1', label: 'codestral.mistral.ai (code models)' }],
  ollama: [{ value: 'http://localhost:11434/v1', label: 'localhost:11434' }],
  lmstudio: [{ value: 'http://localhost:1234/v1', label: 'localhost:1234' }],
};

/** Known servers for an own endpoint: the usual local servers and a few hosted ones, all OpenAI compatible. */
export const ENDPOINT_PRESETS: Choice[] = [
  { value: 'http://127.0.0.1:1234/v1', label: 'LM Studio (this computer)' },
  { value: 'http://127.0.0.1:11434/v1', label: 'Ollama (this computer)' },
  { value: 'http://127.0.0.1:8080/v1', label: 'llama.cpp server (this computer)' },
  { value: 'http://127.0.0.1:8000/v1', label: 'vLLM (this computer)' },
  { value: 'http://127.0.0.1:1337/v1', label: 'Jan (this computer)' },
  { value: 'http://127.0.0.1:4000/v1', label: 'LiteLLM proxy (this computer)' },
  { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  { value: 'https://api.together.xyz/v1', label: 'Together AI' },
  { value: 'https://api.fireworks.ai/inference/v1', label: 'Fireworks AI' },
  { value: 'https://api.cerebras.ai/v1', label: 'Cerebras' },
];

/** The marker of the last option: the person types a name or an address. */
export const OTHER = '__other__';

/**
 * The options of one dropdown: the current value first (so a saved choice is never lost), then the suggestions, then what the endpoint
 * reported, without doubles, and the "Other" entry last.
 */
export function mergeChoices(current: string, suggested: Choice[], live: string[] = []): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  const add = (c: Choice) => {
    if (!c.value || seen.has(c.value)) return;
    seen.add(c.value);
    out.push(c);
  };
  if (current) add({ value: current, label: suggested.find((s) => s.value === current)?.label || current });
  for (const s of suggested) add(s);
  for (const m of live) add({ value: m, label: m });
  return out;
}

export const modelChoices = (id: string): Choice[] => (MODEL_SUGGESTIONS[id] || []).map((m) => ({ value: m, label: m }));

/** The address choices of a provider: its own address, the known alternatives, or (own endpoint) the server presets. */
export function baseChoices(id: string, own: string): Choice[] {
  if (id === 'custom') return ENDPOINT_PRESETS;
  return [{ value: own, label: own }, ...(BASE_ALTERNATIVES[id] || [])];
}
