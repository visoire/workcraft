// Byte-level BPE tokenizer for the DeepSeek V4 vocabulary. Shared by the backend (src/server/tokenizer.ts)
// and the interface (src/chat/tokens.ts): no DOM and no Node APIs here.
//
// Data: public/assets/tokenizers/deepseek-v4.bin, packed from the official tokenizer.json by
// scripts/build-tokenizer.mjs. The steps follow the Hugging Face tokenizers pipeline of that file:
//   1. special (added) tokens are cut out of the raw text first and count as one token each,
//   2. three isolated regex splits (digit groups of 1 to 3, CJK runs, words and punctuation),
//   3. byte-level mapping of every piece (UTF-8 bytes, each byte is one start symbol),
//   4. BPE merges, lowest rank first and leftmost on ties, exactly like tokenizers' Word::merge_all.

export interface BpeHeader {
  name: string;
  sha256: string;
  vocabSize: number;
  mergeCount: number;
  /** Id of the token that merge rank 0 produces; merge r produces mergeBase + r */
  mergeBase: number;
  byteIds: number[];
  specials: [string, number][];
  split: string[];
}

const MAGIC = 'DSBPE001';
/** Ids stay below 2^17, so a pair fits into one safe integer key. */
const SHIFT = 131072;
const CACHE_LIMIT = 60_000;

function readVarints(bytes: Uint8Array, start: number, count: number): Uint32Array {
  const out = new Uint32Array(count);
  let pos = start;
  for (let i = 0; i < count; i++) {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[pos++];
      if (b === undefined) throw new Error('Tokenizer data ends early');
      v += (b & 127) * 2 ** shift;
      if (b < 128) break;
      shift += 7;
    }
    out[i] = v;
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Min-heap of merge candidates ordered by rank, then position (the order of tokenizers' BinaryHeap). */
class MergeHeap {
  private rank: number[] = [];
  private pos: number[] = [];
  get size() {
    return this.rank.length;
  }
  private less(a: number, b: number) {
    return this.rank[a]! < this.rank[b]! || (this.rank[a] === this.rank[b] && this.pos[a]! < this.pos[b]!);
  }
  private swap(a: number, b: number) {
    [this.rank[a], this.rank[b]] = [this.rank[b]!, this.rank[a]!];
    [this.pos[a], this.pos[b]] = [this.pos[b]!, this.pos[a]!];
  }
  push(rank: number, pos: number) {
    this.rank.push(rank);
    this.pos.push(pos);
    let i = this.rank.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.rank[0]!, this.pos[0]!];
    const lastRank = this.rank.pop()!;
    const lastPos = this.pos.pop()!;
    if (this.rank.length) {
      this.rank[0] = lastRank;
      this.pos[0] = lastPos;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.rank.length && this.less(l, m)) m = l;
        if (r < this.rank.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

export class BpeTokenizer {
  readonly header: BpeHeader;
  private readonly ranks = new Map<number, number>();
  private readonly specialIds = new Map<string, number>();
  private readonly specialRe: RegExp | null;
  private readonly splits: RegExp[];
  private readonly cache = new Map<string, number[]>();
  private readonly enc = new TextEncoder();

  private constructor(header: BpeHeader, pairs: Uint32Array) {
    this.header = header;
    for (let r = 0; r < header.mergeCount; r++) this.ranks.set(pairs[2 * r]! * SHIFT + pairs[2 * r + 1]!, r);
    for (const [content, id] of header.specials) this.specialIds.set(content, id);
    const specials = [...this.specialIds.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    this.specialRe = specials.length ? new RegExp(specials.join('|'), 'g') : null;
    this.splits = header.split.map((p) => new RegExp(p, 'gu'));
  }

  /** Reads the packed asset (see scripts/build-tokenizer.mjs). */
  static fromBytes(data: Uint8Array): BpeTokenizer {
    const magic = String.fromCharCode(...data.subarray(0, 8));
    if (magic !== MAGIC) throw new Error('Not a DeepSeek tokenizer asset');
    const len = data[8]! | (data[9]! << 8) | (data[10]! << 16) | (data[11]! << 24);
    const header = JSON.parse(new TextDecoder().decode(data.subarray(12, 12 + len))) as BpeHeader;
    if (header.byteIds.length !== 256 || header.mergeBase + header.mergeCount > SHIFT) throw new Error('Tokenizer header is invalid');
    return new BpeTokenizer(header, readVarints(data, 12 + len, header.mergeCount * 2));
  }

  /** Id of a special token such as <｜User｜>, or undefined. */
  special(content: string): number | undefined {
    return this.specialIds.get(content);
  }

  /** Token ids of a text (no BOS, like tokenizer.encode with add_bos_token false). */
  encode(text: string): number[] {
    const out: number[] = [];
    this.walk(text, (ids) => {
      for (const id of ids) out.push(id);
    });
    return out;
  }

  /** Number of tokens of a text. */
  count(text: string): number {
    if (!text) return 0;
    let n = 0;
    this.walk(text, (ids) => (n += ids.length));
    return n;
  }

  private walk(text: string, emit: (ids: readonly number[]) => void): void {
    if (!this.specialRe) return this.plain(text, emit);
    let last = 0;
    this.specialRe.lastIndex = 0;
    for (let m = this.specialRe.exec(text); m; m = this.specialRe.exec(text)) {
      if (m.index > last) this.plain(text.slice(last, m.index), emit);
      emit([this.specialIds.get(m[0])!]);
      last = m.index + m[0].length;
    }
    if (last < text.length) this.plain(text.slice(last), emit);
  }

  private plain(text: string, emit: (ids: readonly number[]) => void): void {
    let pieces = [text];
    for (const re of this.splits) {
      const next: string[] = [];
      for (const piece of pieces) {
        let last = 0;
        re.lastIndex = 0;
        for (let m = re.exec(piece); m; m = re.exec(piece)) {
          if (!m[0]) {
            re.lastIndex++;
            continue;
          }
          if (m.index > last) next.push(piece.slice(last, m.index));
          next.push(m[0]);
          last = m.index + m[0].length;
        }
        if (last < piece.length) next.push(piece.slice(last));
      }
      pieces = next;
    }
    for (const piece of pieces) emit(this.word(piece));
  }

  /** BPE of one pre-tokenized piece, with a bounded cache (long documents repeat most words). */
  private word(piece: string): number[] {
    const hit = this.cache.get(piece);
    if (hit) return hit;
    const bytes = this.enc.encode(piece);
    const n = bytes.length;
    const ids = new Array<number>(n);
    const prev = new Int32Array(n);
    const next = new Int32Array(n);
    const alive = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      ids[i] = this.header.byteIds[bytes[i]!]!;
      prev[i] = i - 1;
      next[i] = i + 1 < n ? i + 1 : -1;
      alive[i] = 1;
    }
    const heap = new MergeHeap();
    const rankOf = (a: number, b: number) => this.ranks.get(a * SHIFT + b);
    for (let i = 0; i + 1 < n; i++) {
      const r = rankOf(ids[i]!, ids[i + 1]!);
      if (r !== undefined) heap.push(r, i);
    }
    while (heap.size) {
      const [rank, pos] = heap.pop();
      if (!alive[pos]) continue;
      const right = next[pos]!;
      if (right < 0) continue;
      // Expired entry: the pair at this position no longer produces this merge
      if (rankOf(ids[pos]!, ids[right]!) !== rank) continue;
      ids[pos] = this.header.mergeBase + rank;
      alive[right] = 0;
      const after = next[right]!;
      next[pos] = after;
      if (after >= 0) prev[after] = pos;
      const before = prev[pos]!;
      if (before >= 0) {
        const r = rankOf(ids[before]!, ids[pos]!);
        if (r !== undefined) heap.push(r, before);
      }
      if (after >= 0) {
        const r = rankOf(ids[pos]!, ids[after]!);
        if (r !== undefined) heap.push(r, pos);
      }
    }
    const out: number[] = [];
    for (let i = 0; i >= 0 && i < n; i = next[i]!) out.push(ids[i]!);
    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(piece, out);
    return out;
  }
}
