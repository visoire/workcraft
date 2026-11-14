// Browser mode (no desktop backend): the trust, search and memory routes on the IndexedDB of
// this browser. Local-only mode and the audit log apply here too, because in browser mode the
// requests go straight from the browser to the provider. Snapshots, project graph, export
// formats, LAN share and plugins need the desktop and answer with a clear message.

import { buildIndex, rank, chunkText, type Chunk } from '../core/search.js';
import { normalizeTeam, registerAgents, type TeamSettings } from '../chat/team.js';
import { runSync, type SyncAdapter, type SyncFile } from '../core/sync.js';
import { DEFAULT_PERSONAS, isLocalUrl, withBuiltinPersonas, type PersonalSettings } from '../core/defaults.js';
import { t as tr } from './i18n.js';
import { uid } from './util.js';
import { handleCloud } from './cloud-browser.js';

export interface BrowserHelpers {
  kvGet<T>(key: string): Promise<T | undefined>;
  kvPut(key: string, value: unknown): Promise<void>;
  json(v: unknown, status?: number): Response;
  fail(status: number, code: string, message: string): never;
  body<T>(init: RequestInit): Promise<T>;
  /** files of the active project */
  files(): Promise<{ path: string; size: number; mtime: number; data?: ArrayBuffer }[]>;
  context(path: string): Promise<{ text: string; kind: string }>;
  chats(): Promise<{ id: string; title?: string; messages?: { role: string; text: string }[] }[]>;
  project(): Promise<{ id: string; name: string }>;
  write(path: string, data: Uint8Array, origin: string): Promise<string>;
  remove(path: string): Promise<void>;
  wipe(): Promise<void>;
}

export interface BrowserTrust {
  privacy: { localOnly: boolean; audit: boolean };
  personal: PersonalSettings;
  search: { embeddings: boolean; embedModel: string; memory: boolean; ragChunks: number };
  metrics: { enabled: boolean };
  /** Team Mode configuration (the desktop keeps it in config.json) */
  team: TeamSettings;
}
const TRUST_KEY = 'workcraft.browser.trust';
export function loadTrust(): BrowserTrust {
  const d: BrowserTrust = { privacy: { localOnly: false, audit: true }, personal: { context: '', active: 'default', personas: DEFAULT_PERSONAS, contexts: [], contextActive: '' }, search: { embeddings: false, embedModel: 'nomic-embed-text', memory: true, ragChunks: 4 }, metrics: { enabled: false }, team: { saved: [], agents: [] } };
  try {
    const j = JSON.parse(localStorage.getItem(TRUST_KEY) || '{}') as Partial<BrowserTrust>;
    const personal = { ...d.personal, ...j.personal };
    return { privacy: { ...d.privacy, ...j.privacy }, personal: { ...personal, personas: withBuiltinPersonas(personal.personas) }, search: { ...d.search, ...j.search }, metrics: { ...d.metrics, ...j.metrics }, team: { ...d.team, ...j.team } };
  } catch {
    return d;
  }
}
function saveTrust(t: BrowserTrust) {
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify(t));
  } catch {
    /* storage blocked */
  }
}

export interface BrowserAudit {
  id: string;
  at: string;
  kind: string;
  destination: string;
  local: boolean;
  provider?: string;
  model?: string;
  bytes: number;
  files: { name: string; kind: string; size: number }[];
  images: number;
  status: 'ok' | 'error' | 'blocked';
  tokens?: { input: number; output: number };
  note?: string;
}

/** Writes an audit entry of browser mode (metadata only). */
export async function browserAudit(h: Pick<BrowserHelpers, 'kvGet' | 'kvPut'>, e: Omit<BrowserAudit, 'id' | 'at' | 'local' | 'destination'> & { url: string; local?: boolean }): Promise<void> {
  if (!loadTrust().privacy.audit) return;
  let host = e.url;
  try {
    host = new URL(e.url).host;
  } catch {
    /* keep */
  }
  const { url, ...rest } = e;
  const entry: BrowserAudit = { id: uid('a'), at: new Date().toISOString(), ...rest, destination: host, local: e.local ?? isLocalUrl(url) };
  const list = ((await h.kvGet<BrowserAudit[]>('audit')) || []).slice(-1999);
  list.push(entry);
  await h.kvPut('audit', list);
}

interface Note {
  id: string;
  text: string;
  created: string;
  source: string;
}

async function chunksOf(h: BrowserHelpers): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for (const f of await h.files()) {
    if (f.size > 8_000_000) continue;
    let text = '';
    let kind: Chunk['kind'] = 'text';
    try {
      const c = await h.context(f.path);
      if (c.kind === 'binary') continue;
      text = c.text;
      kind = c.kind === 'sheet' ? 'sheet' : c.kind === 'pdf' ? 'pdf' : /\.(md|txt|markdown)$/i.test(f.path) ? 'document' : 'code';
    } catch {
      continue;
    }
    for (const [i, t] of chunkText(text).entries()) out.push({ id: `${f.path}#${i}`, source: f.path, kind, loc: kind === 'pdf' ? (t.match(/^Page (\d+)/)?.[0]?.toLowerCase() || `part ${i + 1}`) : `part ${i + 1}`, text: t });
  }
  for (const c of await h.chats()) {
    const msgs = c.messages || [];
    for (let i = 0; i < msgs.length; i += 4) out.push({ id: `chat:${c.id}#${i}`, source: `chat:${c.id}`, kind: 'chat', loc: c.title || 'Chat', text: msgs.slice(i, i + 4).map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n').slice(0, 2400) });
  }
  return out;
}

async function searchBrowser(h: BrowserHelpers, q: string, limit = 20, kinds: string[] = []) {
  const all = await chunksOf(h);
  const pool = kinds.length ? all.filter((c) => kinds.includes(c.kind)) : all;
  const hits = rank(pool, buildIndex(pool), q, { mode: 'text', limit });
  return { hits: hits.map(({ chunk, ...x }) => ({ ...x, source: chunk.source, kind: chunk.kind, loc: chunk.loc, text: chunk.text })), mode: 'text', semantic: false, error: loadTrust().search.embeddings ? tr('Semantic search with embeddings runs on the desktop (Ollama). Browser mode searches the text.') : undefined };
}

const DESKTOP_ONLY = () => tr('This needs the desktop backend. At home, connect the iPad to the desktop PC in the settings (iPad and network).');

/** Serves the extra routes in browser mode. Returns null for paths it does not know. */
export async function handleExtra(p: string, method: string, url: URL, init: RequestInit, h: BrowserHelpers): Promise<Response | null> {
  // Cloud storage (Google Drive, a folder of the computer) works in the browser too: src/app/cloud-browser.ts
  if (p.startsWith('/api/cloud')) {
    const cloud = await handleCloud(p, method, init, h);
    if (cloud) return cloud;
  }
  const t = loadTrust();
  if (p === '/api/config/privacy' && method === 'PUT') {
    Object.assign(t.privacy, await h.body(init));
    saveTrust(t);
    return null; // the caller answers with the public configuration
  }
  if (p === '/api/config/personal' && method === 'PUT') {
    const b = await h.body<Partial<BrowserTrust['personal']>>(init);
    if (b.context !== undefined) t.personal.context = b.context;
    if (b.personas) t.personal.personas = withBuiltinPersonas(b.personas.length ? b.personas : DEFAULT_PERSONAS);
    if (b.active !== undefined) t.personal.active = t.personal.personas.some((x) => x.id === b.active) ? b.active : 'default';
    if (b.contexts) t.personal.contexts = b.contexts;
    if (b.contextActive !== undefined) t.personal.contextActive = (t.personal.contexts || []).some((x) => x.id === b.contextActive) ? b.contextActive : '';
    saveTrust(t);
    return null;
  }
  if (p === '/api/config/team' && method === 'PUT') {
    const b = await h.body<Partial<TeamSettings>>(init);
    // Same order as the desktop route: agents first, because teams refer to them and normalizing drops members that are not registered
    if (b.agents) t.team.agents = b.agents;
    registerAgents(t.team.agents);
    if (b.active !== undefined) t.team.active = normalizeTeam(b.active);
    if (b.saved) t.team.saved = b.saved.map(normalizeTeam);
    saveTrust(t);
    return null;
  }
  if (p === '/api/config/search' && method === 'PUT') {
    Object.assign(t.search, await h.body(init));
    saveTrust(t);
    return null;
  }
  if (p === '/api/audit') {
    if (method === 'DELETE') {
      await h.kvPut('audit', []);
      return h.json({ ok: true });
    }
    const list = ((await h.kvGet<BrowserAudit[]>('audit')) || []).slice().reverse();
    return h.json(url.searchParams.get('cloud') === '1' ? list.filter((e) => !e.local) : list);
  }
  if (p === '/api/audit/export') {
    const list = ((await h.kvGet<BrowserAudit[]>('audit')) || []).slice().reverse();
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['time,kind,destination,local,provider,model,bytes,files,images,status,input_tokens,output_tokens,note', ...list.map((e) => [e.at, e.kind, e.destination, e.local ? 'yes' : 'no', e.provider, e.model, e.bytes, e.files.map((f) => `${f.name} (${f.kind}, ${f.size})`).join('; '), e.images, e.status, e.tokens?.input, e.tokens?.output, e.note].map(q).join(','))].join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv' } });
  }
  if (p === '/api/search') return h.json(await searchBrowser(h, url.searchParams.get('q') || '', Number(url.searchParams.get('limit')) || 20, (url.searchParams.get('kinds') || '').split(',').filter(Boolean)));
  if (p === '/api/search/status' || p === '/api/search/reindex') {
    const files = await h.files();
    return h.json({ phase: 'idle', done: files.length, total: files.length, files: files.length, chunks: 0, vectors: 0, model: null, updated: new Date().toISOString(), embeddings: false, embedModel: t.search.embedModel, errors: [], browser: true });
  }
  if (p === '/api/memory' || p.startsWith('/api/memory/')) {
    const { id } = await h.project();
    const key = `memory:${id}`;
    const notes = (await h.kvGet<Note[]>(key)) || [];
    if (p === '/api/memory' && method === 'GET') return h.json(notes);
    if (p === '/api/memory' && method === 'POST') {
      const b = await h.body<{ text: string }>(init);
      const n: Note = { id: uid('n'), text: String(b.text || '').trim().slice(0, 1200), created: new Date().toISOString(), source: 'user' };
      if (n.text.length < 3) h.fail(400, 'VALIDATION', tr('The note is empty'));
      await h.kvPut(key, [n, ...notes]);
      return h.json(n);
    }
    if (p === '/api/memory' && method === 'DELETE') {
      await h.kvPut(key, []);
      return h.json({ ok: true });
    }
    if (p === '/api/memory/context') {
      if (!t.search.memory) return h.json({ enabled: false, block: '', notes: [], steps: [], passages: [] });
      const b = await h.body<{ query: string; exclude?: string[] }>(init);
      const r = b.query.trim().length > 3 && t.search.ragChunks ? await searchBrowser(h, b.query, t.search.ragChunks + 3) : { hits: [] };
      const passages = r.hits.filter((x) => x.score > 0.25 && !(b.exclude || []).includes(x.source)).slice(0, t.search.ragChunks).map((x) => ({ source: x.source, loc: x.loc, text: x.text.slice(0, 1200), score: x.score }));
      const parts: string[] = [];
      if (notes.length) parts.push('Pinned notes and decisions of this project:\n' + notes.slice(0, 12).map((n) => `- ${n.text}`).join('\n'));
      if (passages.length) parts.push('Passages from project files that may be relevant (search index, cite the path when you use them):\n' + passages.map((x) => `[${x.source}, ${x.loc}]\n${x.text}`).join('\n\n'));
      return h.json({ enabled: true, block: parts.length ? `<project_memory>\n${parts.join('\n\n')}\n</project_memory>` : '', notes: notes.slice(0, 12), steps: [], passages });
    }
    const m = p.match(/^\/api\/memory\/([\w-]+)$/);
    if (m && method === 'DELETE') {
      await h.kvPut(key, notes.filter((n) => n.id !== m[1]));
      return h.json({ ok: true });
    }
  }
  if (p === '/api/trash' && method === 'GET') return h.json([]);
  if (p === '/api/snapshots' && method === 'GET') return h.json({ snapshots: [], store: { count: 0, bytes: 0 }, browser: true });
  if (p.startsWith('/api/snapshots/chain/')) return h.json(null);
  if (p === '/api/graph') return h.json({ nodes: [], edges: [], steps: [], browser: true });
  if (p === '/api/graph/file') return h.json({ node: null, derivedFrom: [], usedBy: [], steps: [] });
  if (p === '/api/plugins') return h.json({ dir: '', plugins: [], catalog: [], external: [], browser: true });
  if (p === '/api/logs' || p === '/api/metrics') return h.json(method === 'GET' ? (p === '/api/logs' ? [] : { enabled: false, since: new Date().toISOString(), series: [] }) : { ok: true });
  if (p === '/api/health/resources') return h.json({ browser: true });
  if (p === '/api/health/full') return h.json({ at: new Date().toISOString(), browser: true, backend: { ok: false, mode: 'browser' }, privacy: t.privacy });
  if (p === '/api/share' && method === 'GET') return h.json({ port: 0, running: false, addresses: [], shares: [], browser: true });
  if (p === '/api/wipe' && method === 'POST') {
    const b = await h.body<{ confirm?: string }>(init);
    if (b.confirm !== 'WIPE') h.fail(400, 'VALIDATION', 'confirm must be WIPE');
    await h.wipe();
    try {
      localStorage.removeItem(TRUST_KEY);
    } catch {
      /* ignore */
    }
    return h.json({ ok: true, done: [tr('all projects, chats, keys and settings of browser mode')] });
  }
  if (/^\/api\/(snapshots|graph|share|sync|plugins|projects\/[^/]+\/export\/)/.test(p)) return h.fail(409, 'BROWSER_MODE', DESKTOP_ONLY());
  return null;
}

// ---------------------------------------------------------------- Sync with the desktop (iPad)

export interface DesktopTarget {
  host: string;
  port: string;
  token: string;
}

async function sha(d: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', d as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Two-way sync of the active browser project with the same project on the desktop PC.
 * The browser calls the desktop directly (x-oc-token). From an HTTPS page the browser blocks
 * plain HTTP to the home network (mixed content): then the workspace has to be opened over HTTP.
 */
export async function syncBrowserWithDesktop(h: BrowserHelpers, d: DesktopTarget, dryRun = false) {
  if (location.protocol === 'https:') throw new Error(tr('This page runs over HTTPS. The browser blocks plain HTTP to the desktop (mixed content). Open WorkCraft once over http:// or put the desktop behind HTTPS.'));
  const pr = await h.project();
  const base = `http://${d.host}:${d.port}/api/sync/${encodeURIComponent(pr.id)}`;
  const headers = { 'x-oc-token': d.token };
  const ok = async (r: Response) => {
    if (!r.ok) throw new Error(`${d.host}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  await ok(await fetch(`${base}/ensure`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ name: pr.name }) }));
  const local: SyncAdapter = {
    name: 'iPad',
    async manifest() {
      const out: SyncFile[] = [];
      for (const f of await h.files()) if (f.data) out.push({ path: f.path, size: f.size, mtime: Math.round(f.mtime), hash: await sha(new Uint8Array(f.data)) });
      return out;
    },
    async read(p) {
      const f = (await h.files()).find((x) => x.path === p);
      if (!f?.data) throw new Error(`${p} not found`);
      return new Uint8Array(f.data);
    },
    write: async (p, data) => void (await h.write(p, data, 'sync')),
    remove: (p) => h.remove(p),
  };
  const remote: SyncAdapter = {
    name: 'desktop',
    manifest: async () => (await (await ok(await fetch(`${base}/manifest`, { headers }))).json()) as SyncFile[],
    read: async (p) => new Uint8Array(await (await ok(await fetch(`${base}/file?path=${encodeURIComponent(p)}`, { headers }))).arrayBuffer()),
    write: async (p, data, mtime) => void (await ok(await fetch(`${base}/file?path=${encodeURIComponent(p)}&mtime=${mtime}`, { method: 'PUT', headers, body: data as BodyInit }))),
    remove: async (p) => void (await ok(await fetch(`${base}/file?path=${encodeURIComponent(p)}`, { method: 'DELETE', headers }))),
  };
  const key = `sync:${pr.id}:${d.host}`;
  const res = await runSync(local, remote, (await h.kvGet<Record<string, string>>(key)) || null, { dryRun, hash: sha });
  if (!dryRun) await h.kvPut(key, res.base);
  await browserAudit(h, { kind: 'sync', url: `http://${d.host}:${d.port}`, local: true, bytes: 0, files: [], images: 0, status: res.errors.length ? 'error' : 'ok', note: `${pr.name}: ${res.pushed} sent, ${res.pulled} received, ${res.conflicts} conflicts` });
  return res;
}
