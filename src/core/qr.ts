// A small QR code encoder (byte mode, error correction M, versions 1 to 10: up to 213 bytes), no dependencies.
// Used to pair an iPad: the desktop shows the pairing address as a code, the iPad camera opens it.
// Layout and tables follow ISO/IEC 18004; tests/server/qr.test.ts decodes the result with an independent reader.

const ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

const rawModules = (ver: number): number => {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
};
const dataCodewords = (ver: number): number => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK_M[ver - 1]! * BLOCKS_M[ver - 1]!;

// ---------------------------------------------------------------- Reed-Solomon over GF(256), polynomial 0x11D
const mul = (x: number, y: number): number => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
};
function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j]!, root);
      if (j + 1 < r.length) r[j] ^= r[j + 1]!;
    }
    root = mul(root, 0x02);
  }
  return r;
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= mul(c, f)));
  }
  return r;
}

// ---------------------------------------------------------------- Bits and codewords
function codewords(bytes: number[], ver: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return out;
}
function withEcc(data: number[], ver: number): number[] {
  const blocks = BLOCKS_M[ver - 1]!;
  const eccLen = ECC_PER_BLOCK_M[ver - 1]!;
  const total = Math.floor(rawModules(ver) / 8);
  const shortBlocks = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks) - eccLen;
  const div = rsDivisor(eccLen);
  const parts: { d: number[]; e: number[] }[] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const d = data.slice(k, k + shortLen + (i < shortBlocks ? 0 : 1));
    k += d.length;
    parts.push({ d, e: rsRemainder(d, div) });
  }
  const out: number[] = [];
  for (let i = 0; i < shortLen + 1; i++) parts.forEach((p, j) => (i !== shortLen || j >= shortBlocks) && i < p.d.length && out.push(p.d[i]!));
  for (let i = 0; i < eccLen; i++) parts.forEach((p) => out.push(p.e[i]!));
  return out;
}

// ---------------------------------------------------------------- Matrix
export interface QrCode {
  size: number;
  version: number;
  /** true is a dark module */
  modules: boolean[][];
}

function alignPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.floor((ver * 4 + n * 2 + 1) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = ver * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

export function qrEncode(text: string): QrCode {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  while (ver <= MAX_VERSION && dataCodewords(ver) * 8 < 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8) ver++;
  if (ver > MAX_VERSION) throw new Error('The text is too long for the code (213 bytes at most).');
  const size = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    m[y]![x] = dark;
    fn[y]![x] = true;
  };
  // Timing, finders with separators, alignment
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
  const ap = alignPositions(ver);
  ap.forEach((ax, i) => ap.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // Reserve the format and version areas, then fill the data
  const formatBits = (mask: number): number => {
    const data = (0b00 << 3) | mask; // error correction M is 00
    let r = data;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((data << 10) | r) ^ 0x5412;
  };
  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    const b = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6));
    set(8, 8, b(7));
    set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  const all = withEcc(codewords(bytes, ver), ver);
  const placed: boolean[][] = m.map((row) => [...row]);
  let bit = 0;
  const totalBits = all.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
        if (!fn[y]![x] && bit < totalBits) {
          placed[y]![x] = ((all[bit >>> 3]! >>> (7 - (bit & 7))) & 1) !== 0;
          bit++;
        }
      }
    }
  }
  // Choose the mask with the lowest penalty
  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  let best: { score: number; grid: boolean[][]; mask: number } | null = null;
  for (let k = 0; k < 8; k++) {
    const g = placed.map((row, y) => row.map((v, x) => (fn[y]![x] ? v : v !== masks[k]!(x, y))));
    const score = penalty(g);
    if (!best || score < best.score) best = { score, grid: g, mask: k };
  }
  // Final format bits for the chosen mask, drawn on the masked grid
  const final = best!.grid;
  const bits = formatBits(best!.mask);
  const put = (x: number, y: number, i: number) => void (final[y]![x] = ((bits >>> i) & 1) !== 0);
  for (let i = 0; i <= 5; i++) put(8, i, i);
  put(8, 7, 6);
  put(8, 8, 7);
  put(7, 8, 8);
  for (let i = 9; i < 15; i++) put(14 - i, 8, i);
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, i);
  final[size - 8]![8] = true;
  return { size, version: ver, modules: final };
}

function penalty(g: boolean[][]): number {
  const n = g.length;
  let score = 0;
  const runs = (line: boolean[]) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (line[i] === line[i - 1]) {
        run++;
        if (run === 5) s += 3;
        else if (run > 5) s++;
      } else run = 1;
    }
    return s;
  };
  const pat = [true, false, true, true, true, false, true];
  const finderLike = (line: boolean[]) => {
    let s = 0;
    for (let i = 0; i + 7 <= n; i++) {
      if (!pat.every((v, k) => line[i + k] === v)) continue;
      const before = [1, 2, 3, 4].every((k) => i - k < 0 || !line[i - k]);
      const after = [7, 8, 9, 10].every((k) => i + k >= n || !line[i + k]);
      if (before || after) s += 40;
    }
    return s;
  };
  for (let y = 0; y < n; y++) {
    const row = g[y]!;
    const col = g.map((r) => r[y]!);
    score += runs(row) + runs(col) + finderLike(row) + finderLike(col);
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = g[y]![x];
    if (c === g[y]![x + 1] && c === g[y + 1]![x] && c === g[y + 1]![x + 1]) score += 3;
  }
  const dark = g.reduce((s, r) => s + r.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 20) / (n * n) - 10) - 0.0001) * 10;
  return score;
}

/** The code as a standalone SVG (black modules on white, with the quiet zone), crisp at any size. */
export function qrSvg(text: string, opt: { quiet?: number; label?: string } = {}): string {
  const q = qrEncode(text);
  const quiet = opt.quiet ?? 4;
  const dim = q.size + quiet * 2;
  let path = '';
  q.modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) { x++; continue; }
      let w = 1;
      while (row[x + w]) w++;
      path += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${(opt.label || 'QR code').replace(/"/g, '')}"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
