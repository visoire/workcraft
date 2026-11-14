// Browser mode: the workspace works without the desktop backend (iPad on the road).
//
// Projects, files, chats and layout live in the IndexedDB of this browser. The router serves
// the same /api paths as the Node backend, so the project tree, apps, chat history and
// settings keep working unchanged. Files move through the native file dialog of iPadOS
// (import and export of single files or whole projects as ZIP).
//
// In this mode AI requests go straight from the browser to the provider. API keys stay in
// memory until a reload by default. On explicit request the browser stores them
// permanently (localStorage of this device), with a clear notice in the settings.
//
// Not available: terminal and the tools that write Office files on the desktop.

import { bus } from './bus.js';
import { normPath, dirname, extname, isText, uid } from './util.js';
import { PRESETS, streamChat, testConnection, complete, type CompletionRequest } from '../chat/providers.js';
import { repairJson } from '../core/json-repair.js';
import { addUsage, emptyUsage, validUsage, contextWindow, type UsageStore } from '../chat/usage.js';
import { AiError, type ChatRequest, type Effort, type ModelParams, type ProviderConfig, type StreamEvent } from '../chat/types.js';
import { DEFAULT_DEEPSEEK, isDeepSeek, type DeepSeekSettings } from '../chat/deepseek.js';
import { readsDocuments, resolveParams } from '../chat/params.js';
import { addToolStat, type ToolStat } from '../chat/usage.js';
import { fitRequest } from '../chat/budget.js';
import { loadTokenizer } from '../chat/tokens.js';
import { t as tr } from './i18n.js';
import { handleExtra, loadTrust, browserAudit, type BrowserHelpers } from './offline-extra.js';
import { isLocalUrl } from '../core/defaults.js';
import { blobs, shouldOffload, newBlobId } from '../ipados/opfs.js';

export { VERSION } from './status.js';
import { VERSION } from './status.js';

// ---------------------------------------------------------------- IndexedDB

// The name predates the product rename. An IndexedDB cannot be renamed, and browser-mode projects
// on an iPad live in it, so it stays as it is.
const DB_NAME = 'opencraft-browser';
const STORES = ['projects', 'files', 'meta', 'kv'] as const;
type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const get = <T>(store: Store, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
const put = (store: Store, key: string, value: unknown) => tx(store, 'readwrite', (s) => void s.put(value, key));
const del = (store: Store, key: string) => tx(store, 'readwrite', (s) => void s.delete(key));
async function entries<T>(store: Store, prefix: string): Promise<[string, T][]> {
  const range = IDBKeyRange.bound(prefix, prefix + '￿');
  const keys = await tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys(range));
  const vals = await tx<T[]>(store, 'readonly', (s) => s.getAll(range) as IDBRequest<T[]>);
  return keys.map((k, i) => [String(k), vals[i]!]);
}

/** Deletes all data of browser mode (settings, reset). */
export async function wipeBrowserData(): Promise<void> {
  for (const s of STORES) await tx(s, 'readwrite', (st) => void st.clear());
  await blobs.clear().catch(() => undefined);
}

// ---------------------------------------------------------------- Datenmodell

interface ProjectMeta {
  id: string;
  name: string;
  created: string;
  updated: string;
}
interface FileRec {
  kind: 'file' | 'dir';
  /** Content kept in IndexedDB (small files, or when OPFS is not available) */
  data?: ArrayBuffer;
  /** Id of the content in the OPFS blob store (large files, src/ipados/opfs.ts) */
  blob?: string;
  size: number;
  mtime: number;
}

// ---------------------------------------------------------------- Content storage (IndexedDB or OPFS)

/**
 * Where the bytes of a file go: small files stay in the record, large ones go to the Origin Private File
 * System through its worker, which Safari needs for synchronous access. A failed OPFS write falls back
 * to IndexedDB for that file, so a save never fails because of the faster store.
 */
async function packBytes(buf: ArrayBuffer): Promise<Pick<FileRec, 'data' | 'blob'>> {
  if (shouldOffload(buf.byteLength, true) && (await blobs.available())) {
    const id = newBlobId();
    try {
      await blobs.put(id, buf);
      return { blob: id };
    } catch {
      /* fall through: keep it in IndexedDB */
    }
  }
  return { data: buf };
}

/** The bytes of a file record, or null when the content is gone (for example evicted OPFS data). */
async function bytesOf(rec: FileRec | undefined): Promise<ArrayBuffer | null> {
  if (!rec) return null;
  if (rec.data) return rec.data;
  if (rec.blob) return blobs.get(rec.blob).catch(() => null);
  return null;
}

/** Releases the OPFS content of a record that is replaced or deleted. Never throws. */
async function dropBytes(rec: FileRec | undefined): Promise<void> {
  if (rec?.blob) await blobs.delete(rec.blob).catch(() => undefined);
}
const fkey = (project: string, path: string) => `${project}\u0000${path}`;
const mkey = (project: string, name: string) => `${project}\u0000${name}`;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};

/** Path check like in the backend: no empty, reserved or hidden control paths. */
function cleanPath(p: string | null): string {
  if (!p) fail(400, 'PATH', tr('The path is missing'));
  const n = normPath(p!);
  if (n === '/' ) fail(400, 'PATH', tr('The project folder itself is not a valid path'));
  if (n.split('/').some((seg) => seg === '.workcraft')) fail(400, 'PATH', tr('.workcraft is reserved for chats and layout'));
  return n;
}

// ---------------------------------------------------------------- Projects

async function projectList(): Promise<ProjectMeta[]> {
  return (await entries<ProjectMeta>('projects', '')).map(([, v]) => v);
}

async function usageStore(): Promise<UsageStore> {
  const u = await get<UsageStore>('kv', 'usage');
  return validUsage(u) ? u : emptyUsage();
}

async function activeProject(): Promise<ProjectMeta> {
  const id = await get<string>('kv', 'active');
  const list = await projectList();
  let meta = list.find((p) => p.id === id);
  if (!meta) {
    // A new browser starts with an empty project of its own; "Load sample data" opens the sample project
    meta = list[0] || (await createProject('My project', 'empty'));
    await put('kv', 'active', meta.id);
  }
  return meta;
}

/** Opens the sample project of this browser, creating it from the template the first time. */
async function openSample(): Promise<{ meta: ProjectMeta; created: boolean }> {
  const existing = (await projectList()).find((p) => p.name === 'Sample project');
  const meta = existing || (await createProject('Sample project', 'sample'));
  await put('kv', 'active', meta.id);
  return { meta, created: !existing };
}

async function touch(project: string) {
  const m = await get<ProjectMeta>('projects', project);
  if (m) await put('projects', project, { ...m, updated: new Date().toISOString() });
}

async function createProject(name: string, template: 'empty' | 'sample'): Promise<ProjectMeta> {
  const now = new Date().toISOString();
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const meta: ProjectMeta = { id: `${slug}-${uid('p').slice(2, 7)}`, name, created: now, updated: now };
  await put('projects', meta.id, meta);
  if (template === 'sample') await seed(meta.id);
  return meta;
}

async function writeFile(project: string, path: string, data: ArrayBuffer | Uint8Array | string, origin = 'ui', silent = false): Promise<string> {
  const p = cleanPath(path);
  const buf = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data instanceof Uint8Array ? data.slice().buffer : data;
  // Create the parent folders
  let d = dirname(p);
  while (d !== '/') {
    if (!(await get<FileRec>('files', fkey(project, d)))) await put('files', fkey(project, d), { kind: 'dir', size: 0, mtime: Date.now() });
    d = dirname(d);
  }
  const before = await get<FileRec>('files', fkey(project, p));
  const existed = !!before;
  // A new blob id per write: the record switches to the new content in one IndexedDB put, the old content
  // is released afterwards, so an interrupted save never leaves a half written file behind
  await put('files', fkey(project, p), { kind: 'file', ...(await packBytes(buf)), size: buf.byteLength, mtime: Date.now() });
  await dropBytes(before);
  await touch(project);
  if (!silent) bus.emit('fs:file', { path: p, kind: existed ? 'change' : 'create', origin });
  return p;
}

const WELCOME = `# Welcome to browser mode

The desktop backend is not reachable right now, so WorkCraft works directly in the browser of this device. Projects live in the IndexedDB, and you exchange files through the iPadOS file dialog.

## What works

- WordCraft, GridCraft, DeckCraft and PdfCraft with files from this project
- Create and switch projects, export and import them as ZIP
- AI chat with your own API key (Settings, iPad and network)
- Apple Pencil: sign, draw, highlight and redact in PdfCraft

## What needs the desktop

Terminal, Ollama and the Office tools of the AI. At home, connect the iPad to the desktop PC in the settings.
`;

async function seed(project: string): Promise<void> {
  await writeFile(project, '/README.md', '# Sample project (browser)\n\nThis project lives in the IndexedDB of this browser.\n', 'seed', true);
  await writeFile(project, '/documents/welcome.md', WELCOME, 'seed', true);
  await writeFile(project, '/sheets/finances.csv', 'Quarter,Revenue,Costs,Result\nQ1,48200,31900,16300\nQ2,53650,34100,19550\nQ3,58900,36250,22650\nQ4,66400,39800,26600\n', 'seed', true);
  await writeFile(project, '/sheets/contacts.csv', 'Name,Company,City\nMara Lindt,Studio North,Hamburg\nJonas Pietsch,Atelier South,Munich\nEwa Nowak,Office East,Leipzig\n', 'seed', true);
  await writeFile(project, '/code/main.js', '// Example\nexport const margin = (revenue, costs) => Math.round(((revenue - costs) / revenue) * 1000) / 10;\n', 'seed', true);
  try {
    await writeFile(project, '/pdf/contract.pdf', await samplePdf(), 'seed', true);
  } catch (e) {
    console.warn('Sample PDF', e);
  }
}

async function samplePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lines: [string, boolean][] = [
    ['Sample contract', true],
    ['Studio North and Atelier South agree on the following.', false],
    ['1. Service', true],
    ['The contractor builds a local application.', false],
    ['2. Fee', true],
    ['The fee is 12,400 euros net.', false],
    ['3. Confidentiality', true],
    ['Both parties treat all information as confidential.', false],
    ['', false],
    ['Place, date, signature', false],
  ];
  let y = 780;
  for (const [t, b] of lines) {
    page.drawText(t, { x: 56, y, size: b ? 15 : 11.5, font: b ? bold : font, color: rgb(0.05, 0.05, 0.07) });
    y -= b ? 30 : 22;
  }
  page.drawLine({ start: { x: 56, y: y + 6 }, end: { x: 300, y: y + 6 }, thickness: 0.8, color: rgb(0.4, 0.43, 0.5) });
  return doc.save();
}

// ---------------------------------------------------------------- Configuration and keys

interface LocalConfig {
  active: string;
  providers: Record<string, { model?: string; baseUrl?: string }>;
  custom: { id: string; name: string; baseUrl: string; model: string }[];
  deepseek?: DeepSeekSettings;
}
const CFG_KEY = 'workcraft.browser.config';
const KEYS_KEY = 'workcraft.browser.keys';
const PERSIST_KEY = 'workcraft.browser.persistKeys';
/** Keys in memory (default: gone after a reload) */
const memKeys: Record<string, string> = {};

function loadCfg(): LocalConfig {
  try {
    return { active: 'auto', providers: {}, custom: [], ...(JSON.parse(localStorage.getItem(CFG_KEY) || '{}') as Partial<LocalConfig>) };
  } catch {
    return { active: 'auto', providers: {}, custom: [] };
  }
}
function saveCfg(c: LocalConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked */
  }
}

export const keyStore = {
  /** Are keys stored permanently in the browser? */
  get persistent(): boolean {
    try {
      return localStorage.getItem(PERSIST_KEY) === '1';
    } catch {
      return false;
    }
  },
  setPersistent(on: boolean): void {
    try {
      if (on) {
        localStorage.setItem(PERSIST_KEY, '1');
        localStorage.setItem(KEYS_KEY, JSON.stringify({ ...this.stored(), ...memKeys }));
      } else {
        localStorage.removeItem(PERSIST_KEY);
        localStorage.removeItem(KEYS_KEY);
      }
    } catch {
      /* storage blocked */
    }
  },
  stored(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(KEYS_KEY) || '{}') as Record<string, string>;
    } catch {
      return {};
    }
  },
  get(id: string): string | undefined {
    return memKeys[id] || (this.persistent ? this.stored()[id] : undefined);
  },
  set(id: string, key: string | null): void {
    if (key) memKeys[id] = key;
    else delete memKeys[id];
    if (!this.persistent) return;
    const all = this.stored();
    if (key) all[id] = key;
    else delete all[id];
    try {
      localStorage.setItem(KEYS_KEY, JSON.stringify(all));
    } catch {
      /* storage full */
    }
  },
};

const hint = (k?: string) => (k ? `…${k.slice(-4)}` : '');

function publicConfig() {
  const c = loadCfg();
  return {
    activeProject: '',
    mcpServers: [],
    lan: { enabled: false },
    mode: 'browser',
    keysPersistent: keyStore.persistent,
    ...loadTrust(),
    plugins: { disabled: [] },
    ai: {
      active: c.active,
      providers: PRESETS.map((p) => {
        const e = c.providers[p.id] || {};
        const key = keyStore.get(p.id);
        return { id: p.id, name: p.name, kind: p.kind, local: !!p.local, needsKey: p.needsKey, docs: p.docs, model: e.model || p.model, baseUrl: e.baseUrl || p.baseUrl, hasKey: !!key, keyHint: hint(key) };
      }),
      custom: c.custom.map((x) => ({ id: x.id, name: x.name, baseUrl: x.baseUrl, model: x.model, hasKey: !!keyStore.get(x.id), keyHint: hint(keyStore.get(x.id)) })),
      deepseek: c.deepseek || DEFAULT_DEEPSEEK,
    },
  };
}

function providerConfig(id: string): ProviderConfig | null {
  const c = loadCfg();
  const preset = PRESETS.find((p) => p.id === id);
  if (preset) {
    const e = c.providers[id] || {};
    return { id, name: preset.name, kind: preset.kind, baseUrl: e.baseUrl || preset.baseUrl, apiKey: keyStore.get(id), model: e.model || preset.model, local: preset.local };
  }
  const x = c.custom.find((y) => y.id === id);
  return x ? { id, name: x.name, kind: 'openai', baseUrl: x.baseUrl, apiKey: keyStore.get(id), model: x.model } : null;
}
const isConfigured = (id: string) => {
  const p = providerConfig(id);
  if (!p) return false;
  const preset = PRESETS.find((x) => x.id === id);
  if (preset?.local) return true;
  if (!preset) return true;
  return !!p.apiKey;
};

async function ollamaUp(cfg: ProviderConfig | null): Promise<boolean> {
  if (!cfg) return false;
  try {
    const r = await fetch(`${cfg.baseUrl.replace(/\/v1\/?$/, '')}/api/tags`, { signal: AbortSignal.timeout(900) });
    return r.ok;
  } catch {
    return false;
  }
}

const isLocalProvider = (id: string) => {
  const p = providerConfig(id);
  return !!p && (!!p.local || isLocalUrl(p.baseUrl));
};

async function resolveProvider(id?: string): Promise<ProviderConfig> {
  const want = id || loadCfg().active;
  const localOnly = loadTrust().privacy.localOnly;
  if (want && want !== 'auto') {
    const p = providerConfig(want);
    if (!p) throw new AiError({ code: 'NOT_FOUND', message: tr('Provider {name} is not set up.', { name: want }) });
    if (localOnly && !isLocalProvider(want)) {
      if (!id) return resolveProvider('auto');
      throw new AiError({ code: 'LOCAL_ONLY', provider: p.name, message: tr('Local-only mode is on: {name} is a cloud provider and is blocked.', { name: p.name }) });
    }
    if (!isConfigured(want)) throw new AiError({ code: 'AUTH', provider: p.name, message: tr('No API key is set for {name} in browser mode.', { name: p.name }) });
    return p;
  }
  for (const pid of [...PRESETS.filter((p) => !p.local).map((p) => p.id), ...loadCfg().custom.map((c) => c.id)]) if ((!localOnly || isLocalProvider(pid)) && isConfigured(pid)) return providerConfig(pid)!;
  const ollama = providerConfig('ollama');
  if (await ollamaUp(ollama)) return ollama!;
  if (localOnly) throw new AiError({ code: 'LOCAL_ONLY', message: tr('Local-only mode is on and no local model answers. Start Ollama or add a local endpoint.') });
  throw new AiError({ code: 'NO_PROVIDER', message: tr('Browser mode: add an API key in the settings (iPad and network) or connect the iPad to the desktop.') });
}

async function aiStatus() {
  const c = loadCfg();
  let active: ProviderConfig | null = null;
  let error: string | undefined;
  try {
    active = await resolveProvider();
  } catch (e) {
    error = (e as Error).message;
  }
  const localOnly = loadTrust().privacy.localOnly;
  return {
    mode: c.active,
    localOnly,
    active: active ? { id: active.id, name: active.name, model: active.model, local: !!active.local } : null,
    error,
    ollamaReachable: false,
    providers: [...PRESETS.map((p) => ({ id: p.id, name: p.name, local: !!p.local })), ...c.custom.map((x) => ({ id: x.id, name: x.name, local: false }))].map((p) => ({ ...p, configured: isConfigured(p.id), local: isLocalProvider(p.id), blocked: localOnly && !isLocalProvider(p.id) })),
  };
}

// ---------------------------------------------------------------- Context for @ mentions

function csvToMarkdown(text: string, sep: string): string {
  const rows = text.trim().split(/\r?\n/).slice(0, 120).map((l) => l.split(sep));
  if (!rows.length) return '';
  const head = rows[0]!;
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** Native documents in browser mode: the bytes of PDFs and images from this browser's project store. */
async function browserDocs(turns: ChatRequest['turns'], native: boolean): Promise<ChatRequest['turns']> {
  if (!turns.some((t) => t.role === 'user' && t.docs?.length)) return turns;
  if (!native) return turns.map((t) => (t.role === 'user' && t.docs ? { ...t, docs: undefined } : t));
  const project = (await activeProject()).id;
  const out: ChatRequest['turns'] = [];
  for (const t of turns) {
    if (t.role !== 'user' || !t.docs?.length) {
      out.push(t);
      continue;
    }
    const docs = [];
    for (const d of t.docs) {
      const rec = await get<FileRec>('files', fkey(project, cleanPath(d.path)));
      if (!rec || rec.size > 20 * 1024 * 1024) continue;
      const content = await bytesOf(rec);
      if (!content) continue;
      const bytes = new Uint8Array(content);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      docs.push({ ...d, data: btoa(bin) });
    }
    out.push({ ...t, docs });
  }
  return out;
}

async function contextOf(project: string, path: string, limit = 24000) {
  const rec = await get<FileRec>('files', fkey(project, cleanPath(path)));
  const content = rec && rec.kind === 'file' ? await bytesOf(rec) : null;
  if (!rec || !content) return fail(404, 'NOT_FOUND', tr('File not found: {path}', { path }));
  const e = extname(path);
  let text: string;
  let kind = 'text';
  if (e === 'csv' || e === 'tsv') {
    text = csvToMarkdown(new TextDecoder().decode(content), e === 'tsv' ? '\t' : ',');
    kind = 'sheet';
  } else if (e === 'pdf') {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(content));
      const r = await extractText(pdf, { mergePages: false });
      text = (r.text as string[]).map((t, i) => `Page ${i + 1}: ${t}`).join('\n\n');
      kind = 'pdf';
    } catch {
      text = `[PDF, ${rec.size} bytes, text not readable in the browser]`;
    }
  } else if (isText(path)) text = new TextDecoder().decode(content);
  else {
    text = `[${e.toUpperCase()} file, ${rec.size} bytes. The AI reads the content of Office files only through the desktop backend.]`;
    kind = 'binary';
  }
  return { text: text.length > limit ? text.slice(0, limit) + `\n[shortened, ${text.length} characters in total]` : text, kind };
}

// ---------------------------------------------------------------- ZIP

async function exportProject(id: string): Promise<{ name: string; bytes: Uint8Array }> {
  const { zipSync } = await import('fflate');
  const meta = await get<ProjectMeta>('projects', id);
  if (!meta) return fail(404, 'NOT_FOUND', tr('Project not found'));
  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of await entries<FileRec>('files', fkey(id, ''))) {
    if (v.kind !== 'file') continue;
    const content = await bytesOf(v);
    if (!content) continue;
    files[k.split('\u0000')[1]!.slice(1)] = new Uint8Array(content);
  }
  for (const [k, v] of await entries<string>('meta', mkey(id, ''))) files['.workcraft/' + k.split('\u0000')[1]!] = new TextEncoder().encode(v);
  files['.workcraft/project.json'] = new TextEncoder().encode(JSON.stringify({ name: meta.name, created: meta.created }));
  return { name: `${meta.name}.zip`, bytes: zipSync(files, { level: 6 }) };
}

async function importProject(bytes: Uint8Array, name?: string | null): Promise<ProjectMeta> {
  const { unzipSync, strFromU8 } = await import('fflate');
  let entriesZ: Record<string, Uint8Array>;
  try {
    entriesZ = unzipSync(bytes);
  } catch {
    return fail(422, 'IMPORT', tr('The ZIP archive is damaged or not a ZIP.'));
  }
  const names = Object.keys(entriesZ).map((n) => n.replace(/\\/g, '/'));
  for (const n of names) if (n.split('/').includes('..') || n.startsWith('/') || /^[a-z]:/i.test(n)) fail(422, 'IMPORT', tr('Unsafe path in the archive: {path}', { path: n }));
  // Remove a common root folder (ZIP from the Finder or the Files app)
  const top = new Set(names.filter((n) => !n.endsWith('/')).map((n) => n.split('/')[0]));
  const strip = top.size === 1 && names.every((n) => n.includes('/')) ? [...top][0] + '/' : '';
  let projName = name || 'Import';
  const pj = entriesZ[strip + '.workcraft/project.json'];
  if (pj) {
    try {
      projName = (JSON.parse(strFromU8(pj)) as { name?: string }).name || projName;
    } catch {
      /* name from the file name */
    }
  }
  const meta = await createProject(projName, 'empty');
  for (const [raw, data] of Object.entries(entriesZ)) {
    const n = raw.replace(/\\/g, '/').slice(strip.length);
    if (!n || n.endsWith('/')) continue;
    if (n.startsWith('.workcraft/')) {
      const sub = n.slice('.workcraft/'.length);
      if (sub === 'layout.json' || /^chats\/[\w-]{4,64}\.json$/.test(sub)) await put('meta', mkey(meta.id, sub), strFromU8(data));
      continue;
    }
    if (n.startsWith('.git/')) continue;
    await writeFile(meta.id, '/' + n, data, 'import', true);
  }
  return meta;
}

// ---------------------------------------------------------------- Router

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function sse(gen: AsyncGenerator<unknown>, onError: (e: unknown) => unknown): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        for await (const ev of gen) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      } catch (e) {
        const info = onError(e);
        if (info) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(info)}\n\n`));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function bodyJson<T>(init: RequestInit): Promise<T> {
  const b = init.body;
  if (typeof b === 'string') return JSON.parse(b) as T;
  return {} as T;
}
async function bodyBytes(init: RequestInit): Promise<Uint8Array> {
  const b = init.body as BodyInit | null | undefined;
  if (!b) return new Uint8Array();
  if (typeof b === 'string') return new TextEncoder().encode(b);
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  if (b instanceof Blob) return new Uint8Array(await b.arrayBuffer());
  return new Uint8Array();
}

const kvHelpers = { kvGet: <T,>(k: string) => get<T>('kv', k), kvPut: async (k: string, v: unknown) => void (await put('kv', k, v)) };

/** Access of the extra routes and the sync to the data of browser mode. */
export function browserHelpers(): BrowserHelpers {
  return {
    ...kvHelpers,
    json,
    fail,
    body: bodyJson,
    async files() {
      const id = (await activeProject()).id;
      const list = (await entries<FileRec>('files', fkey(id, ''))).filter(([, v]) => v.kind === 'file');
      const out = [];
      for (const [k, v] of list) out.push({ path: k.split('\u0000')[1]!, size: v.size, mtime: v.mtime, data: (await bytesOf(v)) ?? undefined });
      return out;
    },
    async context(path) {
      return contextOf((await activeProject()).id, path);
    },
    async chats() {
      const id = (await activeProject()).id;
      const out = [];
      for (const [k, v] of await entries<string>('meta', mkey(id, 'chats/'))) {
        try {
          out.push(JSON.parse(v) as { id: string; title?: string; messages?: { role: string; text: string }[] });
        } catch {
          void k;
        }
      }
      return out;
    },
    project: () => activeProject(),
    async write(path, data, origin) {
      return writeFile((await activeProject()).id, path, data, origin);
    },
    async remove(path) {
      const id = (await activeProject()).id;
      const target = cleanPath(path);
      for (const [k, v] of await entries<FileRec>('files', fkey(id, ''))) {
        const pth = k.split('\u0000')[1]!;
        if (pth === target || pth.startsWith(target + '/')) {
          await del('files', k);
          await dropBytes(v);
        }
      }
      bus.emit('fs:file', { path: target, kind: 'delete', origin: 'sync' });
    },
    wipe: () => wipeBrowserData().then(() => keyStore.setPersistent(false)),
  };
}


/** Serves an /api request in browser mode. */
export async function handle(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, 'http://browser.local');
  const p = url.pathname;
  const q = (k: string) => url.searchParams.get(k);
  const method = (init.method || 'GET').toUpperCase();
  try {
    if (p === '/api/health') return json({ ok: true, version: VERSION, mode: 'browser', home: 'IndexedDB', pty: false, platform: 'browser', dev: false, lan: false });

    // ---------- Konfiguration ----------
    if (p === '/api/config' && method === 'GET') return json(publicConfig());
    if (p === '/api/config/provider' && method === 'PUT') {
      const b = await bodyJson<{ id: string; apiKey?: string | null; model?: string; baseUrl?: string }>(init);
      const c = loadCfg();
      const e = (c.providers[b.id] ||= {});
      if (b.apiKey === null) keyStore.set(b.id, null);
      else if (b.apiKey) keyStore.set(b.id, b.apiKey.trim());
      if (b.model !== undefined) e.model = b.model.trim() || undefined;
      if (b.baseUrl !== undefined) e.baseUrl = b.baseUrl.trim() || undefined;
      saveCfg(c);
      return json(publicConfig());
    }
    if (p === '/api/config/custom' && method === 'POST') {
      const b = await bodyJson<{ name: string; baseUrl: string; apiKey?: string; model: string }>(init);
      if (!b.name || !b.baseUrl || !b.model) fail(400, 'VALIDATION', tr('Name, base URL and model are required'));
      const c = loadCfg();
      const id = `custom-${uid('c').slice(2, 10).toLowerCase()}`;
      c.custom.push({ id, name: b.name, baseUrl: b.baseUrl.replace(/\/$/, ''), model: b.model });
      if (b.apiKey) keyStore.set(id, b.apiKey);
      saveCfg(c);
      return json({ id, config: publicConfig() });
    }
    const cm = p.match(/^\/api\/config\/custom\/([\w-]+)$/);
    if (cm) {
      const c = loadCfg();
      if (method === 'DELETE') {
        c.custom = c.custom.filter((x) => x.id !== cm[1]);
        keyStore.set(cm[1]!, null);
        if (c.active === cm[1]) c.active = 'auto';
      } else {
        const b = await bodyJson<{ name?: string; baseUrl?: string; apiKey?: string | null; model?: string }>(init);
        const x = c.custom.find((y) => y.id === cm[1]) || fail(404, 'NOT_FOUND', tr('Endpoint not found'));
        if (b.name) x.name = b.name;
        if (b.baseUrl) x.baseUrl = b.baseUrl.replace(/\/$/, '');
        if (b.model) x.model = b.model;
        if (b.apiKey === null) keyStore.set(x.id, null);
        else if (b.apiKey) keyStore.set(x.id, b.apiKey);
      }
      saveCfg(c);
      return json(publicConfig());
    }
    if (p === '/api/config/deepseek' && method === 'PUT') {
      const c = loadCfg();
      c.deepseek = await bodyJson<DeepSeekSettings>(init);
      saveCfg(c);
      return json(publicConfig());
    }
    if (p === '/api/config/active' && method === 'PUT') {
      const c = loadCfg();
      c.active = (await bodyJson<{ active: string }>(init)).active;
      saveCfg(c);
      return json(publicConfig());
    }
    if (p === '/api/config/mcp') return fail(409, 'BROWSER_MODE', tr('External MCP servers only start on the desktop.'));
    if (p === '/api/mcp/external') return json([]);
    if (p === '/api/lan') return fail(409, 'BROWSER_MODE', tr('Home network mode is switched on at the desktop.'));

    // ---------- KI ----------
    if (p === '/api/ai/status') return json(await aiStatus());
    if (p === '/api/ai/test' && method === 'POST') {
      const b = await bodyJson<{ id: string; apiKey?: string; baseUrl?: string; model?: string }>(init);
      const saved = providerConfig(b.id);
      const cfg: ProviderConfig | null = saved
        ? { ...saved, apiKey: b.apiKey || saved.apiKey, baseUrl: b.baseUrl || saved.baseUrl, model: b.model || saved.model }
        : b.baseUrl
          ? { id: b.id, name: tr('Own endpoint'), kind: 'openai', baseUrl: b.baseUrl, apiKey: b.apiKey, model: b.model || '' }
          : null;
      if (!cfg) return json({ ok: false, models: [], error: { code: 'NOT_FOUND', message: tr('Unknown provider') } });
      if (loadTrust().privacy.localOnly && !cfg.local && !isLocalUrl(cfg.baseUrl)) {
        await browserAudit(kvHelpers, { kind: 'blocked', url: cfg.baseUrl, local: true, provider: cfg.name, bytes: 0, files: [], images: 0, status: 'blocked', note: 'connection test' });
        return json({ ok: false, models: [], error: { code: 'LOCAL_ONLY', message: tr('Local-only mode is on: the connection test to {name} is blocked.', { name: cfg.name }) } });
      }
      await browserAudit(kvHelpers, { kind: 'ai-test', url: cfg.baseUrl, local: !!cfg.local || undefined, provider: cfg.name, model: cfg.model, bytes: 0, files: [], images: 0, status: 'ok', note: 'connection test' });
      return json(await testConnection(cfg));
    }
    if (p === '/api/ai/chat' && method === 'POST') {
      const raw = typeof init.body === 'string' ? init.body : '';
      const b = await bodyJson<{ provider?: string; model?: string; system: string; context?: string; turns: ChatRequest['turns']; tools?: ChatRequest['tools']; toolChoice?: ChatRequest['toolChoice']; effort?: Effort; meta?: { files?: { name: string; kind: string; size: number }[]; chat?: string } }>(init);
      const signal = init.signal || undefined;
      const images = b.turns.reduce((n, t) => n + (t.role === 'user' ? t.images?.length || 0 : 0), 0);
      const gen = (async function* () {
        let cfg: ProviderConfig | null = null;
        let status: 'ok' | 'error' | 'blocked' = 'ok';
        let tokens: { input: number; output: number } | undefined;
        try {
          cfg = { ...(await resolveProvider(b.provider)) };
          if (b.model) cfg.model = b.model;
          // Same preparation as the backend: parameters per provider, exact count with the tokenizer, fitting
          const r = resolveParams(cfg, { ...(b.effort ? { effort: b.effort } : {}), deepseek: loadCfg().deepseek || DEFAULT_DEEPSEEK, forcedTool: typeof b.toolChoice === 'object', ...(b.meta?.chat ? { cacheKey: b.meta.chat } : {}) });
          cfg.model = r.model;
          const params: ModelParams = r.params;
          const tok = isDeepSeek(cfg) ? await loadTokenizer().catch(() => null) : null;
          const count = tok ? (s: string) => tok.count(s) : null;
          const fit = fitRequest({ system: b.system, ...(b.context ? { context: b.context } : {}), turns: b.turns, tools: b.tools || [], toolChoice: b.toolChoice || 'auto', params }, { window: contextWindow(cfg.model), reserve: r.reserve, count });
          if (fit.overflow) throw new AiError({ code: 'BAD_REQUEST', provider: cfg.name, message: tr('The request is larger than the context window of {model}. Shorten the latest message or remove attachments.', { model: cfg.model }) });
          if (fit.report.maxTokens) fit.req.params = { ...fit.req.params, maxTokens: fit.report.maxTokens };
          fit.req.turns = await browserDocs(fit.req.turns, readsDocuments(r.family));
          yield { type: 'budget', budget: fit.report } as StreamEvent;
          for await (const ev of streamChat(cfg, fit.req, signal, { countTokens: count, predicted: fit.report.after })) {
            // Usage per provider and model, kept in this browser like the projects
            if (ev.type === 'usage') {
              await put('kv', 'usage', addUsage(await usageStore(), ev.usage));
              tokens = { input: ev.usage.input, output: ev.usage.output };
            }
            if (ev.type === 'error') status = 'error';
            yield ev;
          }
        } catch (e) {
          status = e instanceof AiError && e.info.code === 'LOCAL_ONLY' ? 'blocked' : 'error';
          throw e;
        } finally {
          const target = cfg || (b.provider ? providerConfig(b.provider) : null);
          if (target) await browserAudit(kvHelpers, { kind: status === 'blocked' ? 'blocked' : 'ai', url: target.baseUrl, local: status === 'blocked' ? true : !!target.local || undefined, provider: target.name, model: target.model, bytes: status === 'blocked' ? 0 : raw.length, files: b.meta?.files || [], images, status, tokens });
        }
      })();
      return sse(gen, (e) => {
        const info = e instanceof AiError ? e.info : { code: 'PROVIDER', message: (e as Error).message };
        return info.code === 'ABORTED' ? null : { type: 'error', error: info };
      });
    }
    if (p === '/api/ai/complete' && method === 'POST') {
      const b = await bodyJson<CompletionRequest & { provider?: string }>(init);
      try {
        const cfg = { ...(await resolveProvider(b.provider)) };
        const r = await complete(cfg, b, init.signal || undefined);
        await put('kv', 'usage', addUsage(await usageStore(), r.usage));
        const parsed = b.json ? repairJson(b.mode === 'prefix' ? b.prompt + r.text : r.text) : null;
        return json({ text: r.text, via: r.via, usage: r.usage, ...(b.json ? { json: parsed?.value ?? null, repaired: parsed?.repaired ?? false } : {}) });
      } catch (e) {
        const info = e instanceof AiError ? e.info : { code: 'PROVIDER', message: (e as Error).message };
        return fail(502, info.code, info.message);
      }
    }
    if (p === '/api/approvals' && method === 'POST') return json({ token: uid('appr') });

    // ---------- Usage ----------
    if (p === '/api/usage') {
      if (method === 'DELETE') {
        const next = { ...emptyUsage(), rates: (await usageStore()).rates };
        await put('kv', 'usage', next);
        return json(next);
      }
      return json(await usageStore());
    }
    if (p === '/api/usage/tool' && method === 'POST') {
      await put('kv', 'usage', addToolStat(await usageStore(), await bodyJson<ToolStat>(init)));
      return json({ ok: true });
    }
    if (p === '/api/ai/count' && method === 'POST') return fail(409, 'BROWSER_MODE', tr('Exact counts for this provider need the desktop backend.'));
    if (p === '/api/usage/rates' && method === 'PUT') {
      const st = await usageStore();
      st.rates = await bodyJson<UsageStore['rates']>(init);
      await put('kv', 'usage', st);
      return json(st);
    }

    // ---------- Projects ----------
    if (p === '/api/projects' && method === 'GET') {
      const active = await activeProject();
      return json({ active, projects: await projectList() });
    }
    if (p === '/api/projects' && method === 'POST') {
      const b = await bodyJson<{ name: string; template?: 'empty' | 'sample'; switchTo?: boolean }>(init);
      if (!b.name?.trim()) fail(400, 'VALIDATION', tr('The name is missing.'));
      const meta = await createProject(b.name.trim(), b.template || 'empty');
      if (b.switchTo !== false) await put('kv', 'active', meta.id);
      return json(meta);
    }
    if (p === '/api/projects/sample' && method === 'POST') return json(await openSample());
    if (p === '/api/projects/import' && method === 'POST') {
      const meta = await importProject(await bodyBytes(init), q('name'));
      if (q('switch') !== '0') await put('kv', 'active', meta.id);
      return json(meta);
    }
    const pm = p.match(/^\/api\/projects\/([^/]+)(\/switch|\/export)?$/);
    if (pm) {
      const id = decodeURIComponent(pm[1]!);
      const meta = (await get<ProjectMeta>('projects', id)) || fail(404, 'NOT_FOUND', tr('Project not found'));
      if (pm[2] === '/switch') {
        await put('kv', 'active', id);
        return json(meta);
      }
      if (pm[2] === '/export') {
        const { name, bytes } = await exportProject(id);
        return new Response(bytes as BodyInit, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}"` } });
      }
      if (method === 'PATCH') {
        const name = (await bodyJson<{ name: string }>(init)).name?.trim() || fail(400, 'VALIDATION', tr('The name is missing.'));
        const next = { ...meta, name, updated: new Date().toISOString() };
        await put('projects', id, next);
        return json(next);
      }
      if (method === 'DELETE') {
        for (const [k, v] of await entries<FileRec>('files', fkey(id, ''))) {
          await del('files', k);
          await dropBytes(v);
        }
        for (const [k] of await entries('meta', mkey(id, ''))) await del('meta', k);
        await del('projects', id);
        if ((await get<string>('kv', 'active')) === id) await del('kv', 'active');
        return json({ ok: true });
      }
    }

    // ---------- Files ----------
    const project = (await activeProject()).id;
    if (p === '/api/files/tree') {
      const list = (await entries<FileRec>('files', fkey(project, ''))).map(([k, v]) => ({ path: k.split('\u0000')[1]!, kind: v.kind, size: v.size, mtime: v.mtime }));
      return json({ project, entries: list.sort((a, b) => a.path.localeCompare(b.path)) });
    }
    if (p === '/api/files/raw' && method === 'GET') {
      const rec = await get<FileRec>('files', fkey(project, cleanPath(q('path'))));
      const content = rec && rec.kind === 'file' ? await bytesOf(rec) : null;
      if (!content) return fail(404, 'NOT_FOUND', tr('File not found: {path}', { path: q('path') || '' }));
      return new Response(content, { headers: { 'content-type': 'application/octet-stream' } });
    }
    if (p === '/api/files/raw' && method === 'PUT') {
      const hdr = new Headers(init.headers);
      return json({ path: await writeFile(project, q('path') || '', await bodyBytes(init), hdr.get('x-oc-origin') || 'ui') });
    }
    if (p === '/api/files/mkdir' && method === 'POST') {
      const d = cleanPath((await bodyJson<{ path: string }>(init)).path);
      let cur = d;
      while (cur !== '/') {
        if (!(await get<FileRec>('files', fkey(project, cur)))) await put('files', fkey(project, cur), { kind: 'dir', size: 0, mtime: Date.now() });
        cur = dirname(cur);
      }
      bus.emit('fs:file', { path: d, kind: 'create', origin: 'ui' });
      return json({ ok: true });
    }
    if (p === '/api/files/rename' && method === 'POST') {
      const b = await bodyJson<{ from: string; to: string }>(init);
      const from = cleanPath(b.from);
      const to = cleanPath(b.to);
      if (await get<FileRec>('files', fkey(project, to))) fail(409, 'EXISTS', tr('{name} already exists', { name: to }));
      const moved = (await entries<FileRec>('files', fkey(project, ''))).filter(([k]) => {
        const path = k.split('\u0000')[1]!;
        return path === from || path.startsWith(from + '/');
      });
      if (!moved.length) fail(404, 'NOT_FOUND', tr('{name} not found', { name: from }));
      for (const [k, v] of moved) {
        const path = k.split('\u0000')[1]!;
        await put('files', fkey(project, to + path.slice(from.length)), v);
        await del('files', k);
      }
      bus.emit('fs:file', { path: from, kind: 'delete', origin: 'ui' });
      bus.emit('fs:file', { path: to, kind: 'create', origin: 'ui' });
      return json({ path: to });
    }
    if (p === '/api/files' && method === 'DELETE') {
      const target = cleanPath(q('path'));
      for (const [k, v] of (await entries<FileRec>('files', fkey(project, ''))).filter(([k]) => {
        const path = k.split('\u0000')[1]!;
        return path === target || path.startsWith(target + '/');
      })) {
        await del('files', k);
        await dropBytes(v);
      }
      bus.emit('fs:file', { path: target, kind: 'delete', origin: new Headers(init.headers).get('x-oc-origin') || 'ui' });
      return json({ ok: true });
    }
    if (p === '/api/files/context') return json(await contextOf(project, q('path') || '', Number(q('limit')) || 24000));

    // ---------- Layout and chats ----------
    if (p === '/api/meta/layout') {
      if (method === 'PUT') {
        await put('meta', mkey(project, 'layout.json'), typeof init.body === 'string' ? init.body : '{}');
        return json({ ok: true });
      }
      const raw = await get<string>('meta', mkey(project, 'layout.json'));
      return json(raw ? JSON.parse(raw) : null);
    }
    if (p === '/api/chats') {
      if (method === 'DELETE') {
        const list = await entries<string>('meta', mkey(project, 'chats/'));
        for (const [k] of list) await del('meta', k);
        return json({ ok: true, removed: list.length });
      }
      const all = q('scope') === 'all';
      const metas = all ? await projectList() : [(await get<ProjectMeta>('projects', project))!].filter(Boolean);
      const out = [];
      for (const m of metas) {
        for (const [, raw] of await entries<string>('meta', mkey(m.id, 'chats/'))) {
          try {
            const j = JSON.parse(raw) as { id: string; title?: string; updated?: string; messages?: unknown[] };
            out.push({ id: j.id, title: j.title || 'Chat', updated: j.updated, count: j.messages?.length || 0, project: m.id, projectName: m.name });
          } catch {
            /* broken */
          }
        }
      }
      return json(out.sort((a, b) => String(b.updated).localeCompare(String(a.updated))));
    }
    const chat = p.match(/^\/api\/chats\/([\w-]{4,64})$/);
    if (chat) {
      const k = mkey(project, `chats/${chat[1]}.json`);
      if (method === 'PUT') {
        await put('meta', k, typeof init.body === 'string' ? init.body : '{}');
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await del('meta', k);
        return json({ ok: true });
      }
      const raw = await get<string>('meta', k);
      return raw ? json(JSON.parse(raw)) : fail(404, 'NOT_FOUND', tr('Chat not found'));
    }

    // ---------- Trust, search, memory (offline-extra.ts) ----------
    const extra = await handleExtra(p, method, url, init, browserHelpers());
    if (extra) return extra;
    // The routes handleExtra stores answer null and are completed here with the public configuration (team: the reported
    // "/api/config/team is not available in browser mode" came from this list missing it)
    if (/^\/api\/config\/(privacy|personal|search|team)$/.test(p)) return json(publicConfig());

    return fail(404, 'NOT_FOUND', tr('{path} is not available in browser mode', { path: p }));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status);
    return json({ error: { code: 'BROWSER', message: (e as Error).message } }, 500);
  }
}

/** Takes files from the native file dialog of iPadOS into the active project. */
export async function importFiles(files: File[], folder = '/imported'): Promise<string[]> {
  const project = (await activeProject()).id;
  const out: string[] = [];
  for (const f of files) out.push(await writeFile(project, normPath(`${folder}/${f.name}`), await f.arrayBuffer(), 'import'));
  return out;
}
