// Search core without DOM or Node dependencies (backend and browser mode): tokenizer for English
// and German, chunking, BM25 with prefix and compound matching, cosine similarity for
// embeddings and a hybrid ranking.

export interface Chunk {
  id: string;
  /** project path or chat:<id> */
  source: string;
  kind: 'sheet' | 'document' | 'presentation' | 'pdf' | 'text' | 'code' | 'chat';
  /** place inside the source: page 3, slide 2, Sheet1 rows 1-20, line 40 */
  loc: string;
  text: string;
  vec?: number[];
}

export interface Hit {
  chunk: Chunk;
  score: number;
  textScore: number;
  semantic: number;
  snippet: string;
}

const STOP = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was were will with you your i me my we our find show where which what who how part about der die das den dem des ein eine einen einem einer und oder ist sind war mit von zu zum zur im in am an auf aus bei für fur nach über uber unter vor wie was wer wo welche welcher teil finde zeige zeig mir mich ich wir uns es sie er nicht auch noch nur so'.split(' ').map((w) => fold(w))
);

/** Small bilingual map for frequent business terms (works without embeddings). */
const SYN: Record<string, string[]> = {
  umsatz: ['revenue', 'sales', 'turnover'],
  revenue: ['umsatz', 'sales', 'erlös'],
  sales: ['umsatz', 'verkauf', 'revenue'],
  prognose: ['forecast', 'projection', 'plan'],
  forecast: ['prognose', 'projection', 'plan'],
  kosten: ['costs', 'cost', 'expenses', 'ausgaben'],
  costs: ['kosten', 'expenses', 'ausgaben'],
  gewinn: ['profit', 'margin', 'ergebnis'],
  profit: ['gewinn', 'margin', 'ergebnis'],
  vertrag: ['contract', 'agreement'],
  contract: ['vertrag', 'agreement'],
  rechnung: ['invoice', 'bill'],
  invoice: ['rechnung', 'bill'],
  kunde: ['customer', 'client'],
  customer: ['kunde', 'client'],
  budget: ['etat', 'plan'],
  angebot: ['proposal', 'offer', 'quote'],
  proposal: ['angebot', 'offer'],
  quartal: ['quarter', 'q1', 'q2', 'q3', 'q4'],
  quarter: ['quartal'],
  unterschrift: ['signature', 'sign'],
  signature: ['unterschrift', 'signatur'],
};

export function fold(s: string): string {
  return s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function tokens(s: string): string[] {
  return (fold(s).match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Query terms with synonyms (synonyms count less). */
export function queryTerms(q: string): { term: string; weight: number }[] {
  const out = new Map<string, number>();
  for (const t of tokens(q)) {
    out.set(t, 1);
    for (const [k, list] of Object.entries(SYN)) {
      const fk = fold(k);
      if (t === fk || (fk.length >= 5 && t.startsWith(fk))) for (const s of list) if (!out.has(fold(s))) out.set(fold(s), 0.5);
    }
  }
  return [...out].map(([term, weight]) => ({ term, weight }));
}

/** Splits text into chunks of about `size` characters along paragraphs and lines. */
export function chunkText(text: string, size = 900): string[] {
  const parts = text.replace(/\r\n?/g, '\n').split(/\n{2,}|(?<=\n)(?=#)/);
  const out: string[] = [];
  let cur = '';
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.length > size * 1.5) {
      if (cur) out.push(cur), (cur = '');
      for (const line of p.split('\n')) {
        if ((cur + '\n' + line).length > size && cur) out.push(cur), (cur = '');
        cur = cur ? cur + '\n' + line : line;
        while (cur.length > size * 2) out.push(cur.slice(0, size * 2)), (cur = cur.slice(size * 2));
      }
      continue;
    }
    if ((cur + '\n\n' + p).length > size && cur) out.push(cur), (cur = '');
    cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** How well a document token matches a query term: exact 1, prefix or compound part 0.6. */
function matchWeight(term: string, tok: string): number {
  if (tok === term) return 1;
  if (term.length >= 4 && tok.startsWith(term)) return 0.7;
  if (tok.length >= 5 && term.startsWith(tok)) return 0.6;
  if (term.length >= 5 && tok.length > term.length + 2 && tok.includes(term)) return 0.5;
  return 0;
}

export interface TextIndex {
  docs: { id: string; len: number; tf: Map<string, number> }[];
  df: Map<string, number>;
  avg: number;
  vocab: string[];
}

export function buildIndex(chunks: Chunk[]): TextIndex {
  const df = new Map<string, number>();
  const docs = chunks.map((c) => {
    const tf = new Map<string, number>();
    const toks = tokens(c.text + ' ' + c.source.replace(/[/._-]+/g, ' ') + ' ' + c.loc);
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { id: c.id, len: toks.length, tf };
  });
  const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  return { docs, df, avg, vocab: [...df.keys()] };
}

/** BM25 score per chunk ID. */
export function bm25(index: TextIndex, q: string): Map<string, number> {
  const terms = queryTerms(q);
  const N = index.docs.length || 1;
  // expand each query term to the matching vocabulary (prefix and compound matches)
  const expanded = terms.map(({ term, weight }) => ({ weight, toks: index.vocab.map((v) => [v, matchWeight(term, v)] as const).filter(([, w]) => w > 0) }));
  const out = new Map<string, number>();
  const k1 = 1.2;
  const b = 0.75;
  for (const d of index.docs) {
    let s = 0;
    for (const e of expanded) {
      let best = 0;
      for (const [tok, w] of e.toks) {
        const f = d.tf.get(tok);
        if (!f) continue;
        const idf = Math.log(1 + (N - index.df.get(tok)! + 0.5) / (index.df.get(tok)! + 0.5));
        best = Math.max(best, w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / (index.avg || 1)))));
      }
      s += best * e.weight;
    }
    if (s > 0) out.set(d.id, s);
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Short excerpt around the first matching term. */
export function snippet(text: string, q: string, len = 220): string {
  const terms = queryTerms(q).map((t) => t.term);
  const f = fold(text);
  let at = -1;
  for (const t of terms) {
    const i = f.indexOf(t.slice(0, Math.max(4, Math.min(t.length, 8))));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - 60);
  const s = text.slice(start, start + len).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '… ' : '') + s + (start + len < text.length ? ' …' : '');
}

/**
 * Ranks chunks. mode text: BM25 only. semantic: cosine only (needs vectors). hybrid: both,
 * normalized and mixed (0.55 semantic, 0.45 text); without vectors hybrid equals text.
 */
export function rank(chunks: Chunk[], index: TextIndex, q: string, opt: { mode?: 'text' | 'semantic' | 'hybrid'; qvec?: number[] | null; limit?: number } = {}): Hit[] {
  const mode = opt.mode || 'hybrid';
  const text = mode === 'semantic' ? new Map<string, number>() : bm25(index, q);
  const maxText = Math.max(0, ...text.values());
  const useVec = mode !== 'text' && !!opt.qvec;
  const hits: Hit[] = [];
  for (const c of chunks) {
    const t = maxText ? (text.get(c.id) || 0) / maxText : 0;
    const raw = useVec && c.vec ? cosine(opt.qvec!, c.vec) : 0;
    // cosine of unrelated texts with typical embedding models sits around 0.3 to 0.5
    const sem = Math.max(0, (raw - 0.35) / 0.5);
    const score = useVec ? (mode === 'semantic' ? sem : 0.55 * sem + 0.45 * t) : t;
    if (score <= 0.02) continue;
    hits.push({ chunk: c, score: Math.min(1, score), textScore: t, semantic: raw, snippet: snippet(c.text, q) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, opt.limit || 20);
}
