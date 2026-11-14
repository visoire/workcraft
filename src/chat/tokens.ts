// DeepSeek V4 tokenizer in the interface: loads the compact asset once (about 560 KB, only when a
// DeepSeek model is in use) for the live count in the chat footer, before the user presses Send.
// The same engine counts in the backend (src/server/tokenizer.ts), so both agree token for token.

import { BpeTokenizer } from '../core/bpe.js';
import { ROOT } from '../app/util.js';

let pending: Promise<BpeTokenizer> | null = null;
let ready: BpeTokenizer | null = null;

/** The asset lives at the site root (ROOT is the site root, also under /workcraft/ on XAMPP). */
const assetUrl = () => new URL('assets/tokenizers/deepseek-v4.bin', ROOT).href;

export function loadTokenizer(): Promise<BpeTokenizer> {
  if (ready) return Promise.resolve(ready);
  pending ||= fetch(assetUrl())
    .then((r) => {
      if (!r.ok) throw new Error(`Tokenizer not found (${r.status})`);
      return r.arrayBuffer();
    })
    .then((b) => (ready = BpeTokenizer.fromBytes(new Uint8Array(b))))
    .catch((e: unknown) => {
      pending = null;
      throw e;
    });
  return pending;
}

/** The tokenizer when it is already loaded (no waiting), else null. */
export const tokenizerNow = () => ready;
