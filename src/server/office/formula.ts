// Formula engine for read-sheet: evaluates formulas when the file has no calculated values.
// Supports dynamic arrays (spill into neighbouring cells, A1# references).

export type Scalar = number | string | boolean | null | { err: string };
export type Value = Scalar | Scalar[][];
type Matrix = Scalar[][];

export const ERR = (code: string): { err: string } => ({ err: code });
export const isErr = (v: unknown): v is { err: string } => !!v && typeof v === 'object' && !Array.isArray(v) && 'err' in v;
const isArr = (v: unknown): v is Matrix => Array.isArray(v);

export function colToIdx(col: string): number {
  let n = 0;
  for (const c of col.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}
export function idxToCol(i: number): string {
  let s = '';
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
export function parseRef(ref: string): { c: number; r: number } | null {
  const m = String(ref).replace(/\$/g, '').match(/^([A-Za-z]{1,3})(\d{1,7})$/);
  return m ? { c: colToIdx(m[1]!), r: Number(m[2]) - 1 } : null;
}
export const refOf = (c: number, r: number): string => idxToCol(c) + (r + 1);

// ---------------------------------------------------------------- Parser
type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean } | { t: 'ref' | 'range' | 'spill' | 'id' | 'op'; v: string };
type Ast =
  | { k: 'lit'; v: Scalar }
  | { k: 'ref' | 'range' | 'spill'; v: string }
  | { k: 'fn'; name: string; args: Ast[] }
  | { k: 'bin'; op: string; a: Ast; b: Ast }
  | { k: 'neg'; a: Ast };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = '';
      i++;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (src[i] === '"') break;
        else s += src[i++];
      }
      i++;
      out.push({ t: 'str', v: s });
      continue;
    }
    const num = rest.match(/^(\d+(\.\d+)?([eE][+-]?\d+)?|\.\d+)/);
    if (num) {
      out.push({ t: 'num', v: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }
    const rng = rest.match(/^\$?[A-Za-z]{1,3}\$?\d{1,7}(:\$?[A-Za-z]{1,3}\$?\d{1,7})?#?/);
    if (rng && !/^[A-Za-z]{1,3}\d{1,7}\s*\(/.test(rest) && !/^[A-Za-z]{1,3}\d{1,7}[A-Za-z_.]/.test(rest)) {
      const txt = rng[0];
      const v = txt.replace(/[$#]/g, '').toUpperCase();
      out.push({ t: txt.endsWith('#') ? 'spill' : txt.includes(':') ? 'range' : 'ref', v });
      i += txt.length;
      continue;
    }
    const id = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (id) {
      const up = id[0].toUpperCase().replace(/^_XLFN\.(_XLWS\.)?/, '');
      if (up === 'TRUE' || up === 'FALSE') out.push({ t: 'bool', v: up === 'TRUE' });
      else out.push({ t: 'id', v: up });
      i += id[0].length;
      continue;
    }
    const op = rest.match(/^(<=|>=|<>|[-+*/^&=<>(),;%])/);
    if (op) {
      out.push({ t: 'op', v: op[0] === ';' ? ',' : op[0] });
      i += op[0].length;
      continue;
    }
    throw new Error('Unexpected character ' + ch);
  }
  return out;
}

function parse(src: string): Ast {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const eat = (v: string) => {
    if (!isOp(v)) throw new Error(`"${v}" expected`);
    p++;
  };
  const bin = (next: () => Ast, ops: string[]) => (): Ast => {
    let left = next();
    while (peek()?.t === 'op' && ops.includes(String(peek()!.v))) {
      const op = String(toks[p++]!.v);
      left = { k: 'bin', op, a: left, b: next() };
    }
    return left;
  };
  const primary = (): Ast => {
    const t = toks[p++];
    if (!t) throw new Error('Unexpected end');
    if (t.t === 'num' || t.t === 'str' || t.t === 'bool') return { k: 'lit', v: t.v };
    if (t.t === 'ref' || t.t === 'range' || t.t === 'spill') return { k: t.t, v: t.v };
    if (t.t === 'id') {
      eat('(');
      const args: Ast[] = [];
      if (!isOp(')')) {
        for (;;) {
          args.push(isOp(',') || isOp(')') ? { k: 'lit', v: null } : compare());
          if (!isOp(',')) break;
          p++;
        }
      }
      eat(')');
      return { k: 'fn', name: t.v, args };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = compare();
      eat(')');
      return e;
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      const a = power();
      return t.v === '-' ? { k: 'neg', a } : a;
    }
    throw new Error('Unerwartet: ' + String(t.v));
  };
  const postfix = (): Ast => {
    let e = primary();
    while (isOp('%')) {
      p++;
      e = { k: 'bin', op: '/', a: e, b: { k: 'lit', v: 100 } };
    }
    return e;
  };
  const power = bin(postfix, ['^']);
  const mul = bin(power, ['*', '/']);
  const add = bin(mul, ['+', '-']);
  const concat = bin(add, ['&']);
  const compare: () => Ast = bin(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const ast = compare();
  if (p < toks.length) throw new Error('Unerwartet: ' + String(toks[p]!.v));
  return ast;
}

// ---------------------------------------------------------------- Funktionen
const flat = (args: Value[]): Scalar[] => args.flatMap((a) => (isArr(a) ? a.flat() : [a]));
const nums = (args: Value[]) => flat(args).filter((v): v is number => typeof v === 'number');
const firstErr = (args: Value[]) => flat(args).find(isErr);
const toNum = (v: Scalar): number | { err: string } => {
  if (isErr(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  return Number.isNaN(n) ? ERR('#VALUE!') : n;
};
const toStr = (v: Scalar) => (v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : isErr(v) ? v.err : String(v));
const toBool = (v: Scalar) => (typeof v === 'string' ? v.toUpperCase() === 'TRUE' : !!v && !isErr(v));
const asMatrix = (v: Value): Matrix => (isArr(v) ? v : [[v]]);
const scalar = (v: Value | undefined): Scalar => (v === undefined ? null : isArr(v) ? (v[0]?.[0] ?? null) : v);
const cmp = (a: Scalar, b: Scalar) => (typeof a === 'number' && typeof b === 'number' ? a - b : toStr(a).localeCompare(toStr(b), 'de', { sensitivity: 'base' }));
const num1 = (v: Value | undefined, d: number) => {
  const n = toNum(scalar(v ?? d));
  return isErr(n) ? d : n;
};

const FUNCS: Record<string, (a: Value[]) => Value> = {
  SUM: (a) => firstErr(a) || nums(a).reduce((s, x) => s + x, 0),
  AVERAGE: (a) => firstErr(a) || (nums(a).length ? nums(a).reduce((s, x) => s + x, 0) / nums(a).length : ERR('#DIV/0!')),
  MIN: (a) => firstErr(a) || (nums(a).length ? Math.min(...nums(a)) : 0),
  MAX: (a) => firstErr(a) || (nums(a).length ? Math.max(...nums(a)) : 0),
  COUNT: (a) => nums(a).length,
  COUNTA: (a) => flat(a).filter((v) => v !== null && v !== '').length,
  PRODUCT: (a) => firstErr(a) || nums(a).reduce((s, x) => s * x, 1),
  ROUND: ([v, d]) => {
    const n = toNum(scalar(v));
    if (isErr(n)) return n;
    const f = 10 ** num1(d, 0);
    return Math.round(n * f) / f;
  },
  ABS: ([v]) => {
    const n = toNum(scalar(v));
    return isErr(n) ? n : Math.abs(n);
  },
  IF: ([c, a, b]) => (isErr(scalar(c)) ? scalar(c) : toBool(scalar(c)) ? (a ?? true) : (b ?? false)),
  IFERROR: ([v, alt]) => (isErr(scalar(v)) ? (alt ?? '') : (v ?? null)),
  AND: (a) => flat(a).every(toBool),
  OR: (a) => flat(a).some(toBool),
  CONCAT: (a) => firstErr(a) || flat(a).map(toStr).join(''),
  LEN: ([v]) => toStr(scalar(v)).length,
  UPPER: ([v]) => toStr(scalar(v)).toUpperCase(),
  LOWER: ([v]) => toStr(scalar(v)).toLowerCase(),
  SEQUENCE: ([rows, cols, start, step]) => {
    const R = num1(rows, 1);
    const C = num1(cols, 1);
    const s = num1(start, 1);
    const st = num1(step, 1);
    if (R < 1 || C < 1 || R * C > 100000) return ERR('#VALUE!');
    return Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => s + (r * C + c) * st));
  },
  SORT: ([v, idx, order]) => {
    const k = num1(idx, 1) - 1;
    const dir = num1(order, 1) < 0 ? -1 : 1;
    return asMatrix(v ?? null).map((r) => [...r]).sort((a, b) => cmp(a[k] ?? null, b[k] ?? null) * dir);
  },
  UNIQUE: ([v]) => {
    const seen = new Set<string>();
    return asMatrix(v ?? null).filter((r) => {
      const key = JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  FILTER: ([v, cond, empty]) => {
    const M = asMatrix(v ?? null);
    const C = asMatrix(cond ?? null);
    const out = M.filter((_, i) => toBool(C[i]?.[0] ?? C[0]?.[i] ?? null));
    return out.length ? out : (empty ?? ERR('#CALC!'));
  },
  TRANSPOSE: ([v]) => {
    const M = asMatrix(v ?? null);
    return (M[0] || []).map((_, c) => M.map((r) => r[c] ?? null));
  },
};

// ---------------------------------------------------------------- Blatt
export class Sheet {
  raw: Record<string, string>;
  values: Record<string, Scalar> = {};
  private computed = new Map<string, Value>();
  private evaluating = new Set<string>();
  private prevSpill: Record<string, string> = {};
  private asts = new Map<string, Ast | { k: 'error' }>();

  constructor(raw: Record<string, string>) {
    this.raw = raw;
    this.recalc();
  }

  private literal(raw: string | undefined): Scalar {
    if (raw === undefined || raw === '') return null;
    const s = raw.trim();
    if (/^[+-]?(\d+([.,]\d+)?|[.,]\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s.replace(',', '.'));
    if (/^(true|false)$/i.test(s)) return s.toUpperCase() === 'TRUE';
    return raw;
  }

  private ast(ref: string, src: string) {
    const key = ref + '\u0000' + src;
    if (!this.asts.has(key)) {
      try {
        this.asts.set(key, parse(src.slice(1)));
      } catch {
        this.asts.set(key, { k: 'error' });
      }
    }
    return this.asts.get(key)!;
  }

  recalc(): void {
    const anchors = Object.keys(this.raw).filter((r) => this.raw[r]!.startsWith('='));
    for (let pass = 0; pass < 4; pass++) {
      this.computed = new Map();
      this.evaluating = new Set();
      for (const ref of anchors) this.evalCell(ref);
      const spill: Record<string, string> = {};
      for (const ref of anchors) {
        const v = this.computed.get(ref);
        if (!isArr(v)) continue;
        const a = parseRef(ref)!;
        let blocked = false;
        v.forEach((row, i) =>
          row.forEach((_, j) => {
            if (!i && !j) return;
            const t = refOf(a.c + j, a.r + i);
            if ((this.raw[t] ?? '') !== '' || spill[t]) blocked = true;
          })
        );
        if (blocked) {
          this.computed.set(ref, ERR('#SPILL!'));
          continue;
        }
        v.forEach((row, i) => row.forEach((_, j) => (i || j) && (spill[refOf(a.c + j, a.r + i)] = ref)));
      }
      const same = JSON.stringify(spill) === JSON.stringify(this.prevSpill);
      this.prevSpill = spill;
      if (same) break;
    }
    const values: Record<string, Scalar> = {};
    for (const ref of Object.keys(this.raw)) {
      const v = this.raw[ref]!.startsWith('=') ? this.computed.get(ref) : this.literal(this.raw[ref]);
      values[ref] = scalar(v);
    }
    for (const [t, anchor] of Object.entries(this.prevSpill)) {
      const arr = this.computed.get(anchor);
      const a = parseRef(anchor)!;
      const b = parseRef(t)!;
      if (isArr(arr)) values[t] = arr[b.r - a.r]?.[b.c - a.c] ?? null;
    }
    this.values = values;
  }

  private evalCell(ref: string): Value {
    if (this.computed.has(ref)) return this.computed.get(ref)!;
    const raw = this.raw[ref];
    if (raw === undefined || !raw.startsWith('=')) return this.literal(raw);
    if (this.evaluating.has(ref)) return ERR('#CYCLE!');
    this.evaluating.add(ref);
    let v: Value;
    try {
      const a = this.ast(ref, raw);
      v = a.k === 'error' ? ERR('#NAME?') : this.evalAst(a);
    } catch {
      v = ERR('#VALUE!');
    }
    this.evaluating.delete(ref);
    if (isArr(v) && v.length === 1 && v[0]!.length === 1) v = v[0]![0]!;
    this.computed.set(ref, v);
    return v;
  }

  private cellValue(ref: string): Scalar {
    const raw = this.raw[ref];
    if (raw !== undefined && raw.startsWith('=')) return scalar(this.evalCell(ref));
    if (raw !== undefined && raw !== '') return this.literal(raw);
    const anchor = this.prevSpill[ref];
    if (anchor) {
      const arr = this.evalCell(anchor);
      if (isArr(arr)) {
        const a = parseRef(anchor)!;
        const b = parseRef(ref)!;
        return arr[b.r - a.r]?.[b.c - a.c] ?? null;
      }
    }
    return null;
  }

  private range(r: string): Value {
    const [a, b] = r.split(':').map(parseRef);
    if (!a || !b) return ERR('#REF!');
    const out: Matrix = [];
    for (let row = Math.min(a.r, b.r); row <= Math.max(a.r, b.r); row++) {
      const line: Scalar[] = [];
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) line.push(this.cellValue(refOf(c, row)));
      out.push(line);
    }
    return out;
  }

  private lift(a: Value, b: Value, fn: (x: Scalar, y: Scalar) => Scalar): Value {
    if (!isArr(a) && !isArr(b)) return fn(a, b);
    const A = asMatrix(a);
    const B = asMatrix(b);
    const rows = Math.max(A.length, B.length);
    const cols = Math.max(A[0]?.length ?? 1, B[0]?.length ?? 1);
    const pick = (M: Matrix, r: number, c: number) => M[M.length === 1 ? 0 : r]?.[(M[0]?.length ?? 1) === 1 ? 0 : c] ?? ERR('#N/A');
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => fn(pick(A, r, c), pick(B, r, c))));
  }

  private evalAst(n: Ast): Value {
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'ref':
        return this.cellValue(n.v);
      case 'range':
        return this.range(n.v);
      case 'spill': {
        const v = this.evalCell(n.v);
        return isArr(v) ? v : v;
      }
      case 'neg':
        return this.lift(this.evalAst(n.a), 0, (x) => {
          const v = toNum(x);
          return isErr(v) ? v : -v;
        });
      case 'fn': {
        const f = FUNCS[n.name];
        return f ? f(n.args.map((a) => this.evalAst(a))) : ERR('#NAME?');
      }
      case 'bin':
        return this.lift(this.evalAst(n.a), this.evalAst(n.b), (x, y) => {
          if (isErr(x)) return x;
          if (isErr(y)) return y;
          switch (n.op) {
            case '&':
              return toStr(x) + toStr(y);
            case '=':
              return cmp(x, y) === 0;
            case '<>':
              return cmp(x, y) !== 0;
            case '<':
              return cmp(x, y) < 0;
            case '>':
              return cmp(x, y) > 0;
            case '<=':
              return cmp(x, y) <= 0;
            case '>=':
              return cmp(x, y) >= 0;
          }
          const p = toNum(x);
          const q = toNum(y);
          if (isErr(p)) return p;
          if (isErr(q)) return q;
          if (n.op === '+') return p + q;
          if (n.op === '-') return p - q;
          if (n.op === '*') return p * q;
          if (n.op === '/') return q === 0 ? ERR('#DIV/0!') : p / q;
          if (n.op === '^') return p ** q;
          return ERR('#VALUE!');
        });
    }
  }
}

export function display(v: Scalar): string | number | boolean | null {
  return isErr(v) ? v.err : v;
}
