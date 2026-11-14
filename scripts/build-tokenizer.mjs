#!/usr/bin/env node
// Packs the DeepSeek V4 tokenizer (tokenizer.json from the official deepseek_v4_tokenizer.zip) into the
// compact asset public/assets/tokenizers/deepseek-v4.bin that src/core/bpe.ts reads.
//
//   node scripts/build-tokenizer.mjs <path to tokenizer.json> [output]
//
// Only needed when DeepSeek ships a new tokenizer. The source file is not part of the repository.
//
// Format (little endian):
//   "DSBPE001"                 8 bytes magic
//   u32 header length          followed by the header as UTF-8 JSON:
//     { name, sha256, vocabSize, mergeCount, mergeBase, byteIds[256], specials[[content, id]], split[regex] }
//   merge pairs                varint(leftId) varint(rightId) per merge, in rank order.
//                              The merged token id is mergeBase + rank (checked while packing).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const src = process.argv[2];
const out = resolve(process.argv[3] || 'public/assets/tokenizers/deepseek-v4.bin');
if (!src) {
  console.error('Usage: node scripts/build-tokenizer.mjs <tokenizer.json> [output]');
  process.exit(2);
}
const raw = readFileSync(src);
const j = JSON.parse(raw.toString('utf8'));
if (j.model?.type !== 'BPE') throw new Error('Not a BPE tokenizer');

// Byte-level alphabet of GPT-2 style tokenizers: printable bytes keep their code point, the rest move to 256+
const bs = [];
for (let c = 33; c <= 126; c++) bs.push(c);
for (let c = 161; c <= 172; c++) bs.push(c);
for (let c = 174; c <= 255; c++) bs.push(c);
const cs = bs.slice();
let n = 0;
for (let b = 0; b < 256; b++) if (!bs.includes(b)) (bs.push(b), cs.push(256 + n++));
const byteChar = new Array(256);
bs.forEach((b, i) => (byteChar[b] = String.fromCodePoint(cs[i])));

const vocab = j.model.vocab;
const byteIds = byteChar.map((ch) => {
  const id = vocab[ch];
  if (id === undefined) throw new Error(`Byte symbol ${ch} is missing in the vocabulary`);
  return id;
});
const merges = j.model.merges.map((m) => (Array.isArray(m) ? m : m.split(' ')));
const mergeBase = vocab[merges[0][0] + merges[0][1]];
const bytes = [];
const varint = (v) => {
  while (v >= 128) {
    bytes.push((v & 127) | 128);
    v >>>= 7;
  }
  bytes.push(v);
};
merges.forEach(([a, b], rank) => {
  const left = vocab[a];
  const right = vocab[b];
  const merged = vocab[a + b];
  if (left === undefined || right === undefined) throw new Error(`Merge ${rank} uses an unknown symbol`);
  if (merged !== mergeBase + rank) throw new Error(`Merge ${rank} produces id ${merged}, expected ${mergeBase + rank}`);
  varint(left);
  varint(right);
});

const split = (j.pre_tokenizer?.pretokenizers || [])
  .filter((p) => p.type === 'Split')
  .map((p) => {
    if (p.behavior !== 'Isolated' || p.invert) throw new Error('Only isolated, non-inverted splits are supported');
    return p.pattern.Regex;
  });
const header = {
  name: 'deepseek-v4',
  sha256: createHash('sha256').update(raw).digest('hex'),
  vocabSize: Object.keys(vocab).length + j.added_tokens.filter((t) => vocab[t.content] === undefined).length,
  mergeCount: merges.length,
  mergeBase,
  byteIds,
  specials: j.added_tokens.map((t) => [t.content, t.id]),
  split,
};
const head = Buffer.from(JSON.stringify(header), 'utf8');
const len = Buffer.alloc(4);
len.writeUInt32LE(head.length);
const file = Buffer.concat([Buffer.from('DSBPE001', 'latin1'), len, head, Buffer.from(bytes)]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, file);
console.log(`${out}: ${(file.length / 1024).toFixed(0)} KB, ${merges.length} merges, ${header.specials.length} special tokens`);
