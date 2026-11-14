// Full-text and semantic search across the whole project: Word, Excel, PowerPoint, PDF, Markdown,
// code and the chats. The index lives in .workcraft/index.json and is updated per file when its
// size or time changed. With embeddings switched on (Settings, Search and memory) Ollama
// computes a vector per chunk on this computer, so "find the part with the revenue forecast"
// also finds "Umsatzprognose 2027". Nothing leaves the device.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { META_DIR } from './paths.js';
import { listTree, readProjectFile, listMetaDir, readMetaFile } from './projects.js';
import { readSheet } from './office/sheets.js';
import { readDocument } from './office/docs.js';
import { readPptxText } from './office/slides.js';
import { readPdf } from './office/pdf.js';
import { buildIndex, chunkText, rank, type Chunk, type Hit, type TextIndex } from '../core/search.js';
import { config, providerConfig } from './config.js';
import { auditRecord } from './audit.js';
import { log } from './logs.js';

const TEXT = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'xml', 'svg', 'yml', 'yaml', 'toml', 'py', 'sh', 'sql', 'ini', 'log', 'tex', 'rs', 'go', 'java', 'c', 'h', 'cpp']);
const CODE = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'xml', 'svg', 'yml', 'yaml', 'toml', 'py', 'sh', 'sql', 'ini', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'json']);
const MAX_FILE = 30 * 1024 * 1024;
const VERSION = 2;

interface FileIndex {
  mtime: number;
  size: number;
  chunks: Chunk[];
  error?: string;
}
interface StoredIndex {
  version: number;
  model: string | null;
  updated: string;
  files: Record<string, FileIndex>;
  chats: Record<string, { updated: string; chunks: Chunk[] }>;
}

const ext = (p: string) => extname(p).slice(1).toLowerCase();
const fileOf = (root: string) => join(root, META_DIR, 'index.json');
const cache = new Map<string, { stored: StoredIndex; text: TextIndex | null; all: Chunk[] | null }>();
const building = new Map<string, Promise<void>>();
const state = new Map<string, { phase: 'idle' | 'indexing' | 'embedding'; done: number; total: number; error?: string }>();

function load(root: string) {
  let c = cache.get(root);
  if (c) return c;
  let stored: StoredIndex | null = null;
  try {
    stored = existsSync(fileOf(root)) ? (JSON.parse(readFileSync(fileOf(root), 'utf8')) as StoredIndex) : null;
  } catch {
    stored = null;
  }
  if (!stored || stored.version !== VERSION) stored = { version: VERSION, model: null, updated: '', files: {}, chats: {} };
  c = { stored, text: null, all: null };
  cache.set(root, c);
  return c;
}

/** Text chunks of one file with their place (page, slide, sheet, line). */
export async function extractChunks(path: string, data: Uint8Array): Promise<Chunk[]> {
  const e = ext(path);
  const out: Chunk[] = [];
  const add = (kind: Chunk['kind'], loc: string, text: string) => {
    for (const [i, t] of chunkText(text).entries()) if (t.trim()) out.push({ id: `${path}#${out.length}`, source: path, kind, loc: i ? `${loc} (${i + 1})` : loc, text: t });
  };
  if (['xlsx', 'csv', 'tsv'].includes(e)) {
    const first = await readSheet(data, e, {});
    for (const name of first.sheets.length ? first.sheets : [first.sheet]) {
      const d = name === first.sheet ? first : await readSheet(data, e, { sheet: name });
      for (let r = 0; r < d.rows.length; r += 25) {
        const rows = d.rows.slice(r, r + 25);
        add('sheet', `${d.sheet} rows ${r + 1}-${r + rows.length}`, rows.map((row) => row.map((v) => (v === null ? '' : String(v))).join(' | ')).join('\n'));
      }
    }
  } else if (['docx', 'odt'].includes(e) || ['md', 'markdown', 'txt'].includes(e)) {
    const md = await readDocument(data, e);
    // section by heading so a hit names its section
    const parts = md.split(/\n(?=#{1,6}\s)/);
    parts.forEach((p, i) => add('document', (p.match(/^#{1,6}\s+(.+)/)?.[1] || (i ? `section ${i + 1}` : 'start')).slice(0, 80), p));
  } else if (e === 'pptx') {
    for (const s of readPptxText(data)) add('presentation', `slide ${s.slide}`, s.texts.join('\n'));
  } else if (e === 'pdf') {
    for (const p of (await readPdf(data)).text) add('pdf', `page ${p.page}`, p.text);
  } else if (TEXT.has(e)) {
    const lines = new TextDecoder().decode(data).split('\n');
    for (let i = 0; i < lines.length; i += 60) add(CODE.has(e) ? 'code' : 'text', `line ${i + 1}`, lines.slice(i, i + 60).join('\n'));
  }
  return out.slice(0, 400);
}

async function chatChunks(root: string): Promise<Record<string, { updated: string; chunks: Chunk[] }>> {
  const out: Record<string, { updated: string; chunks: Chunk[] }> = {};
  for (const f of await listMetaDir(root, 'chats')) {
    const raw = await readMetaFile(root, `chats/${f}`);
    if (!raw) continue;
    try {
      const j = JSON.parse(raw) as { id: string; title?: string; updated?: string; messages?: { role: string; text: string }[] };
      const chunks: Chunk[] = [];
      const msgs = j.messages || [];
      for (let i = 0; i < msgs.length; i += 4) {
        const text = msgs
          .slice(i, i + 4)
          .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`)
          .join('\n');
        if (text.trim()) chunks.push({ id: `chat:${j.id}#${chunks.length}`, source: `chat:${j.id}`, kind: 'chat', loc: j.title || 'Chat', text: text.slice(0, 2400) });
      }
      out[j.id] = { updated: j.updated || '', chunks };
    } catch {
      /* broken chat */
    }
  }
  return out;
}

// ---------------------------------------------------------------- Embeddings (Ollama)

function ollamaBase(): string {
  return (providerConfig('ollama')?.baseUrl || 'http://127.0.0.1:11434/v1').replace(/\/v1\/?$/, '');
}

/**
 * Retrieval prefixes of embedding models that expect one on the query side. Documents stay raw, so indexes made
 * without a prefix remain valid.
 */
export function queryPrefix(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith('nomic-embed-text')) return 'search_query: ';
  if (m.startsWith('mxbai-embed-large')) return 'Represent this sentence for searching relevant passages: ';
  if (m.startsWith('qwen3-embedding')) return 'Instruct: Given a search query, retrieve relevant passages that answer the query\nQuery: ';
  return '';
}

/** Vectors from Ollama (/api/embed). Throws with a clear message when the model is missing. */
export async function embed(texts: string[], signal?: AbortSignal, kind: 'document' | 'query' = 'document'): Promise<number[][]> {
  const model = config().search.embedModel;
  const base = ollamaBase();
  const prefix = kind === 'query' ? queryPrefix(model) : '';
  const res = await fetch(`${base}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts.map((t) => prefix + t.slice(0, 4000)) }), signal: signal || AbortSignal.timeout(120_000) }).catch((e: Error) => {
    throw new Error(`Ollama at ${base} is not reachable (${e.message}). Start Ollama for semantic search.`);
  });
  if (res.status === 404) throw new Error(`The embedding model ${model} is missing. Run: ollama pull ${model}`);
  if (!res.ok) throw new Error(`Ollama embeddings: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { embeddings?: number[][] };
  if (!j.embeddings || j.embeddings.length !== texts.length) throw new Error('Ollama returned no embeddings');
  return j.embeddings.map((v) => v.map((x) => Math.round(x * 1e5) / 1e5));
}

// ---------------------------------------------------------------- Index

export function searchStatus(root: string) {
  const c = load(root);
  const files = Object.keys(c.stored.files).length;
  const chunks = Object.values(c.stored.files).reduce((n, f) => n + f.chunks.length, 0) + Object.values(c.stored.chats).reduce((n, f) => n + f.chunks.length, 0);
  const vectors = Object.values(c.stored.files).reduce((n, f) => n + f.chunks.filter((x) => x.vec).length, 0) + Object.values(c.stored.chats).reduce((n, f) => n + f.chunks.filter((x) => x.vec).length, 0);
  return { ...(state.get(root) || { phase: 'idle', done: 0, total: 0 }), files, chunks, vectors, model: c.stored.model, updated: c.stored.updated, embeddings: config().search.embeddings, embedModel: config().search.embedModel, errors: Object.entries(c.stored.files).filter(([, f]) => f.error).map(([p, f]) => ({ path: p, error: f.error })) };
}

/** Brings the index up to date (only changed files are read again). */
export function updateIndex(root: string, force = false): Promise<void> {
  const running = building.get(root);
  if (running) return running;
  const p = (async () => {
    const c = load(root);
    const st = { phase: 'indexing' as 'idle' | 'indexing' | 'embedding', done: 0, total: 0, error: undefined as string | undefined };
    state.set(root, st);
    const tree = (await listTree(root)).filter((e) => e.kind === 'file');
    const seen = new Set<string>();
    st.total = tree.length;
    let changed = false;
    for (const e of tree) {
      seen.add(e.path);
      st.done++;
      const old = c.stored.files[e.path];
      if (!force && old && old.mtime === e.mtime && old.size === e.size) continue;
      changed = true;
      if (e.size > MAX_FILE) {
        c.stored.files[e.path] = { mtime: e.mtime, size: e.size, chunks: [], error: 'larger than 30 MB' };
        continue;
      }
      try {
        c.stored.files[e.path] = { mtime: e.mtime, size: e.size, chunks: await extractChunks(e.path, await readProjectFile(root, e.path)) };
      } catch (err) {
        c.stored.files[e.path] = { mtime: e.mtime, size: e.size, chunks: [], error: (err as Error).message.slice(0, 200) };
      }
    }
    for (const k of Object.keys(c.stored.files)) if (!seen.has(k)) (delete c.stored.files[k], (changed = true));
    const chats = await chatChunks(root);
    for (const [id, ch] of Object.entries(chats)) {
      const old = c.stored.chats[id];
      if (old && old.updated === ch.updated && !force) continue;
      c.stored.chats[id] = ch;
      changed = true;
    }
    for (const id of Object.keys(c.stored.chats)) if (!chats[id]) (delete c.stored.chats[id], (changed = true));

    // Embeddings for chunks without a vector (or after a model change)
    const cfg = config().search;
    if (cfg.embeddings) {
      const model = cfg.embedModel;
      const all = [...Object.values(c.stored.files).flatMap((f) => f.chunks), ...Object.values(c.stored.chats).flatMap((f) => f.chunks)];
      if (c.stored.model !== model) for (const ch of all) delete ch.vec;
      const todo = all.filter((ch) => !ch.vec);
      st.phase = 'embedding';
      st.done = 0;
      st.total = todo.length;
      let bytes = 0;
      try {
        for (let i = 0; i < todo.length; i += 32) {
          const batch = todo.slice(i, i + 32);
          bytes += batch.reduce((n, b) => n + b.text.length, 0);
          const vecs = await embed(batch.map((b) => `${b.loc}\n${b.text}`));
          batch.forEach((b, j) => (b.vec = vecs[j]));
          st.done += batch.length;
          changed = true;
        }
        c.stored.model = model;
      } catch (err) {
        st.error = (err as Error).message;
        log('warn', 'search', st.error);
      }
      if (todo.length) auditRecord({ kind: 'embed', url: ollamaBase(), local: true, provider: 'Ollama', model, bytes, files: [], status: st.error ? 'error' : 'ok', note: `${st.done} of ${todo.length} chunks embedded` });
    }
    if (changed) {
      c.stored.updated = new Date().toISOString();
      c.text = null;
      c.all = null;
      mkdirSync(join(root, META_DIR), { recursive: true });
      writeFileSync(fileOf(root), JSON.stringify(c.stored));
    }
    st.phase = 'idle';
  })().finally(() => building.delete(root));
  building.set(root, p);
  return p;
}

function chunksOf(root: string): { all: Chunk[]; text: TextIndex } {
  const c = load(root);
  if (!c.all || !c.text) {
    c.all = [...Object.values(c.stored.files).flatMap((f) => f.chunks), ...Object.values(c.stored.chats).flatMap((f) => f.chunks)];
    c.text = buildIndex(c.all);
  }
  return { all: c.all, text: c.text };
}

export interface SearchOptions {
  mode?: 'text' | 'semantic' | 'hybrid';
  limit?: number;
  kinds?: Chunk['kind'][];
  /** skip the index update (fast path for the chat context) */
  stale?: boolean;
}

export async function search(root: string, q: string, opt: SearchOptions = {}): Promise<{ hits: (Omit<Hit, 'chunk'> & { source: string; kind: string; loc: string; text: string })[]; mode: string; semantic: boolean; error?: string }> {
  if (!opt.stale) await updateIndex(root);
  const { all, text } = chunksOf(root);
  const pool = opt.kinds?.length ? all.filter((c) => opt.kinds!.includes(c.kind)) : all;
  let qvec: number[] | null = null;
  let error: string | undefined;
  const mode = opt.mode || 'hybrid';
  if (mode !== 'text' && config().search.embeddings && pool.some((c) => c.vec)) {
    try {
      qvec = (await embed([q], AbortSignal.timeout(20_000), 'query'))[0] || null;
    } catch (e) {
      error = (e as Error).message;
    }
  } else if (mode === 'semantic') error = config().search.embeddings ? 'No embeddings yet: rebuild the index with Ollama running.' : 'Semantic search needs embeddings: switch them on in Settings, Search and memory.';
  const hits = rank(pool, text, q, { mode: qvec ? mode : 'text', qvec, limit: opt.limit || 20 });
  return { hits: hits.map(({ chunk, ...h }) => ({ ...h, source: chunk.source, kind: chunk.kind, loc: chunk.loc, text: chunk.text })), mode: qvec ? mode : 'text', semantic: !!qvec, error };
}

export function dropIndex(root: string): void {
  cache.delete(root);
}
