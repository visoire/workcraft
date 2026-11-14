// DeepSeek V4 tokenizer in the backend: exact byte-level BPE counts for budgets, live reasoning token
// counts and the pre-flight check before a request leaves the computer. The engine is shared with the
// interface (src/core/bpe.ts); the data is the compact asset in public/assets/tokenizers/.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpeTokenizer } from '../core/bpe.js';
import { countTokens as o200k } from 'gpt-tokenizer/encoding/o200k_base';
import { countTokens as cl100k } from 'gpt-tokenizer/encoding/cl100k_base';

export const TOKENIZER_ASSET = 'assets/tokenizers/deepseek-v4.bin';

const here = dirname(fileURLToPath(import.meta.url));
// src/server (tsx) and dist-server/server (build) both sit two levels below the repository root
const candidates = () => [process.env.WORKCRAFT_TOKENIZER, resolve(here, '..', '..', 'public', TOKENIZER_ASSET), resolve(process.env.WORKCRAFT_DIST || resolve(here, '..', '..', 'dist'), TOKENIZER_ASSET)].filter((p): p is string => !!p);

let loaded: BpeTokenizer | null | undefined;

/** The DeepSeek V4 tokenizer, or null when the asset is missing (counts then fall back to estimates). */
export function deepseekTokenizer(): BpeTokenizer | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  for (const file of candidates()) {
    if (!existsSync(file)) continue;
    try {
      loaded = BpeTokenizer.fromBytes(new Uint8Array(readFileSync(file)));
      break;
    } catch (e) {
      console.warn(`Tokenizer ${file}: ${(e as Error).message}`);
    }
  }
  return loaded;
}

/** Exact token count with the DeepSeek V4 vocabulary (null without the asset). */
export function countDeepSeek(text: string): number | null {
  const t = deepseekTokenizer();
  return t ? t.count(text) : null;
}

/**
 * OpenAI byte-level BPE (o200k_base for GPT-4o, GPT-4.1, GPT-5 and the o-series, cl100k_base for GPT-4
 * and GPT-3.5) from the maintained gpt-tokenizer package. Backend only: the vocabularies stay out of the
 * browser bundle. Text that contains OpenAI special tokens is counted as plain text.
 */
export function openaiCounter(encoding: 'o200k_base' | 'cl100k_base'): (text: string) => number {
  const count = encoding === 'cl100k_base' ? cl100k : o200k;
  return (text: string) => {
    if (!text) return 0;
    try {
      return count(text, { disallowedSpecial: new Set() });
    } catch {
      return Math.ceil(text.length / 4);
    }
  };
}
