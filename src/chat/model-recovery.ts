// Recovery from "Model or endpoint not found" (HTTP 404 of a chat request).
//
// A 404 has two causes that look the same: the model name does not exist at this provider (a preset default such as
// qwen2.5:7b that was never pulled, a retired model id, a typo), or the address is wrong (an OpenAI-compatible
// endpoint without /v1). The router asks the provider for its model list once, then
//   - model not in the list      -> the request is repeated with the closest model that is, and the user gets a notice
//                                   with a button to keep that choice
//   - model in the list          -> the address is fine, the original error stands
//   - the list itself is a 404   -> the address is wrong: the error names the address and the usual fix
// Pure functions here (no DOM, no network); src/chat/providers.ts does the asking.

import type { Family } from './models.js';

/** Models that cannot answer a chat request, whatever the provider calls them. */
const NOT_CHAT = /embed|whisper|tts|speech|transcri|moderation|rerank|dall-e|imagen|image-|-image|stable-diffusion|sdxl|flux|veo|sora|lyria|vision-preview|guard|safety|bge-|nomic-embed|clip|ocr/i;

/** Preference per family, best first. The first pattern that matches an available model wins. */
const PREFER: Record<Family, RegExp[]> = {
  anthropic: [/sonnet-5/, /opus-5/, /haiku-5/, /sonnet-4/, /opus-4/, /haiku-4/, /claude/],
  openai: [/^gpt-5(?!.*(mini|nano|codex))/, /^gpt-5/, /^gpt-4\.1(?!.*(mini|nano))/, /^gpt-4o(?!.*mini)/, /^o\d/, /^gpt-/],
  gemini: [/gemini-3.*pro/, /gemini-3.*flash/, /gemini-2\.5-pro/, /gemini-2\.5-flash(?!.*lite)/, /gemini-/],
  deepseek: [/deepseek-(pro|chat|flash)/, /deepseek/],
  xai: [/grok-4/, /grok/],
  zai: [/glm-5/, /glm-4/, /glm/],
  ollama: [/qwen3(?!.*(embed|vl))/, /qwen2\.5/, /gpt-oss/, /llama3\.[1-9]/, /mistral|ministral/, /gemma/, /phi/, /deepseek/, /./],
  compatible: [/instruct|chat|versatile|turbo|large|auto/, /./],
};

const clean = (m: string) => m.replace(/^models\//, '').trim();
/** Name without the tag or the date suffix: `qwen2.5:7b` -> `qwen2.5`, `claude-sonnet-5-5-20261001` -> `claude-sonnet-5-5`. */
export const baseName = (m: string) => clean(m).toLowerCase().split(':')[0]!.replace(/-(20\d{6}|latest|preview.*|exp.*)$/, '');

/** Natural order, newest first: dates and version numbers compare as numbers (`gpt-5.1` before `gpt-5`). */
const newestFirst = (a: string, b: string) => b.localeCompare(a, 'en', { numeric: true });

export type Pick = { model: string; how: 'same-name' | 'same-family' | 'preferred' | 'first' };

/**
 * The model to use instead of `wanted`, from the models the provider reports. null when the provider reports
 * none that can chat, or when `wanted` is available (nothing to replace).
 */
export function pickReplacement(available: string[], wanted: string, family: Family): Pick | null {
  const chat = [...new Set(available.map(clean).filter((m) => m && !NOT_CHAT.test(m)))];
  if (!chat.length) return null;
  const w = clean(wanted).toLowerCase();
  if (chat.some((m) => m.toLowerCase() === w)) return null;
  // Ollama lists `name:latest` for a model pulled without a tag
  const tagless = chat.find((m) => m.toLowerCase() === `${w}:latest`);
  if (tagless) return { model: tagless, how: 'same-name' };
  // Same name, other tag or date (qwen2.5:7b -> qwen2.5:14b, claude-sonnet-5-5 -> claude-sonnet-5-5-20261001)
  const wb = baseName(wanted);
  if (wb) {
    const same = chat.filter((m) => baseName(m) === wb).sort(newestFirst);
    if (same.length) return { model: same[0]!, how: 'same-name' };
    // Same family: the longest shared prefix of the base names, at least the first two segments (`claude-sonnet`, `gpt-5`, `qwen3`)
    const seg = (s: string) => s.split(/[-_/]/);
    const score = (m: string) => {
      const a = seg(baseName(m));
      const b = seg(wb);
      let n = 0;
      while (n < a.length && n < b.length && a[n] === b[n]) n++;
      return n;
    };
    const ranked = chat.map((m) => ({ m, s: score(m) })).filter((x) => x.s >= 2).sort((x, y) => y.s - x.s || newestFirst(x.m, y.m));
    if (ranked.length) return { model: ranked[0]!.m, how: 'same-family' };
  }
  for (const re of PREFER[family] || PREFER.compatible) {
    const hit = chat.filter((m) => re.test(m.toLowerCase())).sort(newestFirst);
    if (hit.length) return { model: hit[0]!, how: 'preferred' };
  }
  return { model: [...chat].sort(newestFirst)[0]!, how: 'first' };
}

/** Does this error message point at the model (and not at the address)? Used to word the final error. */
export const mentionsModel = (message: string) => /model|not found|does not exist|unknown|no such/i.test(message);

/** The sentence of the notice shown when a request was repeated with another model. */
export function substitutionNotice(provider: string, from: string, to: string): string {
  return `${provider} has no model named ${from}. This answer used ${to}.`;
}

/** Final error when the model list shows the address is wrong. */
export function addressHint(baseUrl: string): string {
  const v1 = !/\/v\d+(\/|$)/.test(baseUrl) && !/anthropic|googleapis|11434/.test(baseUrl);
  return `${baseUrl} does not answer the models endpoint.${v1 ? ' OpenAI-compatible addresses usually end in /v1.' : ''} Check the address in Settings, AI models.`;
}
