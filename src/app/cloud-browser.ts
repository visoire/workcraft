// Cloud storage in browser mode (no desktop backend): the same /api/cloud routes the desktop serves, answered inside the browser, so the
// settings page works unchanged and "/api/cloud is not available in browser mode" is gone. Two places a project can be kept besides this
// browser:
//   - Google Drive, signed in from the browser itself (OAuth 2.0 for client-side web apps, your own "Web application" client, the token
//     stays in this browser). Works in every browser, also Safari on an iPad.
//   - A folder of this computer that you choose (File System Access API, Chrome and Edge): iCloud Drive, OneDrive, Dropbox or Google Drive
//     for desktop keep that folder in sync by themselves, WorkCraft mirrors the project into WorkCraft/<project> inside it.
// A project can stay local only, live in both places (two-way sync, the browser keeps its own copy and works offline), or be opened from the
// cloud on another device ("Open a project from the cloud"). The sync is the same three-way sync as everywhere else (src/core/sync.ts): a
// file changed on both sides keeps both versions. Only the active project syncs (browser mode works on one project at a time).
// Safari and Firefox cannot keep a folder open: there Google Drive is the way, or Export as ZIP and save it with the Files app.

import { runSync, type SyncAdapter, type SyncFile } from '../core/sync.js';
import type { BrowserHelpers } from './offline-extra.js';
import { browserAudit, loadTrust } from './offline-extra.js';
import { t as tr } from './i18n.js';
import { bus } from './bus.js';

const KEY = 'cloud';
const TOKEN_KEY = 'workcraft.cloud.google';
const STATE_KEY = 'workcraft.cloud.state';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SCOPES = { file: 'https://www.googleapis.com/auth/drive.file', full: 'https://www.googleapis.com/auth/drive' };

// ---------------------------------------------------------------- File System Access (typed by hand: not in the TS DOM lib)

interface FsFile {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }>;
}
export interface FsDir {
  kind: 'directory';
  name: string;
  entries(): AsyncIterable<[string, FsFile | FsDir]>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FsFile>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<FsDir>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<string>;
}
const picker = () => (window as unknown as { showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite' }) => Promise<FsDir> }).showDirectoryPicker;
/** This browser can keep a folder of the computer in sync (Chrome, Edge). Safari and Firefox cannot. */
export const canPickFolder = (): boolean => typeof picker() === 'function';

// ---------------------------------------------------------------- stored state

interface Binding {
  provider: string;
  remote: string;
  label: string;
  auto: boolean;
  last?: string;
  error?: string;
  name: string;
}
interface StoredFolder {
  id: string;
  name: string;
  kind: 'icloud' | 'folder';
  handle: FsDir;
}
export interface Stored {
  google: { clientId: string; scope: 'file' | 'full'; email?: string };
  folders: StoredFolder[];
  bindings: Record<string, Binding>;
}
const empty = (): Stored => ({ google: { clientId: '', scope: 'file' }, folders: [], bindings: {} });
async function load(h: Pick<BrowserHelpers, 'kvGet'>): Promise<Stored> {
  return { ...empty(), ...((await h.kvGet<Stored>(KEY)) || {}) };
}
const save = (h: Pick<BrowserHelpers, 'kvPut'>, s: Stored) => h.kvPut(KEY, s);

interface Token {
  token: string;
  expiresAt: number;
  scope: string;
}
const readToken = (): Token | null => {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') as Token | null;
    return t && t.expiresAt > Date.now() + 30_000 ? t : null;
  } catch {
    return null;
  }
};
const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* blocked */
  }
};

class CloudErr extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

async function sha(d: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', d as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'Project';
const redirectUri = () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}oauth-callback.html`;
const allowed = () => {
  if (loadTrust().privacy.localOnly) throw new CloudErr('LOCAL_ONLY', tr('Local-only mode is on, so cloud storage is blocked. Switch it off in Settings, Privacy.'), 403);
};

// ---------------------------------------------------------------- Google Drive from the browser

function accessToken(): string {
  allowed();
  const t = readToken();
  if (!t) throw new CloudErr('AUTH', tr('Sign in to Google Drive again: the browser keeps the sign-in for one hour. Press Connect in Settings, Cloud storage.'), 401);
  return t.token;
}

async function drive(url: string, init: RequestInit = {}, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${accessToken()}` } });
    if ((res.status === 429 || res.status >= 500) && i < tries - 1) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      continue;
    }
    if (res.status === 401) {
      clearToken();
      throw new CloudErr('AUTH', tr('Google Drive refused the sign-in. Press Connect in Settings, Cloud storage.'), 401);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new CloudErr(res.status === 403 ? 'FORBIDDEN' : res.status === 404 ? 'NOT_FOUND' : 'DRIVE', `Google Drive: ${body.error?.message || res.status}`);
    }
    return res;
  }
}
const driveJson = async <T>(url: string, init?: RequestInit) => (await (await drive(url, init)).json()) as T;
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
}
const FIELDS = 'id,name,mimeType,size,modifiedTime,md5Checksum,appProperties,parents';

async function listChildren(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const u = new URL(`${DRIVE}/files`);
    u.searchParams.set('q', `'${q(folderId)}' in parents and trashed=false`);
    u.searchParams.set('fields', `nextPageToken,files(${FIELDS})`);
    u.searchParams.set('pageSize', '1000');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const page = await driveJson<{ files: DriveFile[]; nextPageToken?: string }>(u.toString());
    out.push(...page.files);
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function findFolder(name: string, parent: string, create: boolean): Promise<string | null> {
  const u = new URL(`${DRIVE}/files`);
  u.searchParams.set('q', `'${q(parent)}' in parents and name='${q(name)}' and mimeType='${FOLDER}' and trashed=false`);
  u.searchParams.set('fields', 'files(id)');
  const hit = (await driveJson<{ files: { id: string }[] }>(u.toString())).files[0];
  if (hit) return hit.id;
  if (!create) return null;
  return (await driveJson<{ id: string }>(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id;
}

const MIME: Record<string, string> = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';

async function upload(meta: Record<string, unknown>, data: Uint8Array, mime: string, existingId?: string): Promise<DriveFile> {
  const base = existingId ? `${UPLOAD}/files/${encodeURIComponent(existingId)}` : `${UPLOAD}/files`;
  const method = existingId ? 'PATCH' : 'POST';
  if (data.byteLength <= 4 * 1024 * 1024) {
    const boundary = `wc${crypto.randomUUID().replace(/-/g, '')}`;
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + data.length + tail.length);
    body.set(head, 0);
    body.set(data, head.length);
    body.set(tail, head.length + data.length);
    return (await (await drive(`${base}?uploadType=multipart&fields=${FIELDS}`, { method, headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body })).json()) as DriveFile;
  }
  const start = await drive(`${base}?uploadType=resumable&fields=${FIELDS}`, { method, headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mime, 'x-upload-content-length': String(data.byteLength) }, body: JSON.stringify(meta) });
  const location = start.headers.get('location');
  if (!location) throw new CloudErr('DRIVE', tr('Google Drive gave no upload address.'));
  return (await (await drive(location, { method: 'PUT', headers: { 'content-type': mime }, body: data as BodyInit })).json()) as DriveFile;
}

function driveAdapter(rootId: string): SyncAdapter {
  const files = new Map<string, DriveFile>();
  const folders = new Map<string, string>([['', rootId]]);
  const ensureFolder = async (dir: string): Promise<string> => {
    const known = folders.get(dir);
    if (known) return known;
    const parent = await ensureFolder(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '');
    const id = (await findFolder(dir.slice(dir.lastIndexOf('/') + 1), parent, true))!;
    folders.set(dir, id);
    return id;
  };
  return {
    name: 'Google Drive',
    async manifest() {
      files.clear();
      const out: SyncFile[] = [];
      const walk = async (id: string, prefix: string) => {
        for (const f of await listChildren(id)) {
          const path = prefix ? `${prefix}/${f.name}` : f.name;
          if (f.mimeType === FOLDER) {
            folders.set(path, f.id);
            await walk(f.id, path);
          } else if (!f.mimeType.startsWith('application/vnd.google-apps.')) {
            files.set('/' + path, f);
            out.push({ path: '/' + path, size: Number(f.size || 0), mtime: f.modifiedTime ? Date.parse(f.modifiedTime) : 0, hash: f.appProperties?.sha256 || (f.md5Checksum ? `md5:${f.md5Checksum}` : '') });
          }
        }
      };
      await walk(rootId, '');
      return out;
    },
    async read(path) {
      const f = files.get(path);
      if (!f) throw new CloudErr('NOT_FOUND', tr('{path} is not in Google Drive', { path }), 404);
      return new Uint8Array(await (await drive(`${DRIVE}/files/${encodeURIComponent(f.id)}?alt=media`)).arrayBuffer());
    },
    async write(path, data, mtime) {
      const rel = path.replace(/^\//, '');
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const props = { sha256: await sha(data) };
      const modifiedTime = new Date(mtime || Date.now()).toISOString();
      const existing = files.get(path);
      const saved = existing ? await upload({ appProperties: props, modifiedTime }, data, mimeOf(name), existing.id) : await upload({ name, parents: [await ensureFolder(dir)], appProperties: props, modifiedTime }, data, mimeOf(name));
      files.set(path, saved);
    },
    async remove(path) {
      const f = files.get(path);
      if (!f) return;
      await drive(`${DRIVE}/files/${encodeURIComponent(f.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      files.delete(path);
    },
  };
}

async function googleEmail(): Promise<string | undefined> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${accessToken()}` } });
    return r.ok ? ((await r.json()) as { email?: string }).email : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- a folder of this computer

const SKIP = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.git|\.workcraft|\.tmp\.drivedownload|\.sync)$|^~\$|\.icloud$|\.tmp$/;

async function ensureAccess(dir: FsDir): Promise<void> {
  if (!dir.queryPermission) return;
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return;
  if (dir.requestPermission && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted') return;
  throw new CloudErr('PERMISSION', tr('The browser needs your permission to use the folder again. Press Sync now to allow it.'), 403);
}

async function subDir(root: FsDir, rel: string, create: boolean): Promise<FsDir> {
  let d = root;
  for (const part of rel.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create });
  return d;
}

function folderAdapter(root: FsDir, name: string): SyncAdapter {
  const cache = new Map<string, { size: number; mtime: number; hash: string }>();
  return {
    name,
    async manifest() {
      await ensureAccess(root);
      const out: SyncFile[] = [];
      const walk = async (dir: FsDir, prefix: string) => {
        for await (const [n, h] of dir.entries()) {
          if (SKIP.test(n)) continue;
          const path = prefix + '/' + n;
          if (h.kind === 'directory') await walk(h, path);
          else {
            const f = await h.getFile();
            const c = cache.get(path);
            let hash = c && c.size === f.size && c.mtime === f.lastModified ? c.hash : '';
            if (!hash) {
              hash = await sha(new Uint8Array(await f.arrayBuffer()));
              cache.set(path, { size: f.size, mtime: f.lastModified, hash });
            }
            out.push({ path, size: f.size, mtime: f.lastModified, hash });
          }
        }
      };
      await walk(root, '');
      return out;
    },
    async read(path) {
      const parts = path.split('/').filter(Boolean);
      const file = parts.pop()!;
      return new Uint8Array(await (await (await (await subDir(root, parts.join('/'), false)).getFileHandle(file)).getFile()).arrayBuffer());
    },
    async write(path, data) {
      const parts = path.split('/').filter(Boolean);
      const file = parts.pop()!;
      const w = await (await (await subDir(root, parts.join('/'), true)).getFileHandle(file, { create: true })).createWritable();
      await w.write(data as BufferSource);
      await w.close();
      cache.delete(path);
    },
    async remove(path) {
      const parts = path.split('/').filter(Boolean);
      const file = parts.pop()!;
      await (await subDir(root, parts.join('/'), false)).removeEntry(file);
      cache.delete(path);
    },
  };
}

// ---------------------------------------------------------------- providers

const folderOf = (s: Stored, provider: string): StoredFolder | undefined => s.folders.find((f) => (provider === 'icloud' ? f.kind === 'icloud' : `folder:${f.id}` === provider));

function providerLabel(s: Stored, p: string): string {
  if (p === 'google') return 'Google Drive';
  if (p === 'icloud') return 'iCloud Drive';
  return folderOf(s, p)?.name || tr('Cloud folder');
}

async function resolveRemote(s: Stored, provider: string, projectName: string, create = true): Promise<string> {
  if (provider === 'google') {
    const root = await findFolder('WorkCraft', 'root', create);
    const id = root ? await findFolder(safeName(projectName), root, create) : null;
    if (!id) throw new CloudErr('NOT_FOUND', tr('{name} is not in Google Drive', { name: projectName }), 404);
    return id;
  }
  const f = folderOf(s, provider);
  if (!f) throw new CloudErr('NOT_FOUND', provider === 'icloud' ? tr('Choose your iCloud Drive folder first (Settings, Cloud storage).') : tr('This cloud folder is no longer in the list.'), 404);
  await ensureAccess(f.handle);
  if (create) {
    await subDir(f.handle, `WorkCraft/${safeName(projectName)}`, true);
  }
  return `WorkCraft/${safeName(projectName)}`;
}

async function adapterFor(s: Stored, provider: string, remote: string): Promise<SyncAdapter> {
  if (provider === 'google') return driveAdapter(remote);
  const f = folderOf(s, provider);
  if (!f) throw new CloudErr('NOT_FOUND', tr('This cloud folder is no longer in the list.'), 404);
  await ensureAccess(f.handle);
  return folderAdapter(await subDir(f.handle, remote, true), providerLabel(s, provider));
}

function localAdapter(h: BrowserHelpers): SyncAdapter {
  return {
    name: tr('this browser'),
    async manifest() {
      const out: SyncFile[] = [];
      for (const f of await h.files()) if (f.data) out.push({ path: f.path, size: f.size, mtime: Math.round(f.mtime), hash: await sha(new Uint8Array(f.data)) });
      return out;
    },
    async read(p) {
      const f = (await h.files()).find((x) => x.path === p);
      if (!f?.data) throw new CloudErr('NOT_FOUND', `${p} not found`, 404);
      return new Uint8Array(f.data);
    },
    write: async (p, data) => void (await h.write(p, data, 'sync')),
    remove: (p) => h.remove(p),
  };
}

// ---------------------------------------------------------------- sync

const running = new Set<string>();

export async function syncActive(h: BrowserHelpers, opt: { dryRun?: boolean } = {}) {
  const pr = await h.project();
  const s = await load(h);
  const b = s.bindings[pr.id];
  if (!b) throw new CloudErr('NOT_BOUND', tr('This project is not kept in the cloud.'), 404);
  if (running.has(pr.id)) return { skipped: true as const };
  running.add(pr.id);
  try {
    allowed();
    const key = `cloudbase:${pr.id}:${b.provider}:${b.remote}`;
    const res = await runSync(localAdapter(h), await adapterFor(s, b.provider, b.remote), (await h.kvGet<Record<string, string>>(key)) || null, { dryRun: opt.dryRun, hash: sha });
    if (!opt.dryRun) {
      await h.kvPut(key, res.base);
      const fresh = await load(h);
      const x = fresh.bindings[pr.id];
      if (x) {
        x.last = new Date().toISOString();
        x.error = res.errors.length ? `${res.errors.length} files failed: ${res.errors[0]!.message}`.slice(0, 300) : undefined;
        await save(h, fresh);
      }
    }
    if (b.provider === 'google') await browserAudit(h, { kind: 'sync', url: DRIVE, bytes: 0, files: [], images: 0, status: res.errors.length ? 'error' : 'ok', note: `${pr.name} with Google Drive: ${res.pushed} up, ${res.pulled} down, ${res.conflicts} conflicts${opt.dryRun ? ' (preview)' : ''}` });
    const { base: _base, ...summary } = res;
    return { skipped: false as const, ...summary };
  } catch (e) {
    if (!opt.dryRun) {
      const fresh = await load(h);
      if (fresh.bindings[pr.id]) {
        fresh.bindings[pr.id]!.error = (e as Error).message.slice(0, 300);
        await save(h, fresh);
      }
    }
    throw e;
  } finally {
    running.delete(pr.id);
  }
}

// ---------------------------------------------------------------- what the settings page reads

async function stateOf(h: BrowserHelpers) {
  const s = await load(h);
  const tok = readToken();
  const ic = s.folders.find((f) => f.kind === 'icloud');
  return {
    browser: true,
    canPickFolder: canPickFolder(),
    redirectUri: redirectUri(),
    google: { configured: !!s.google.clientId, connected: !!tok, email: tok ? s.google.email || null : null, scope: s.google.scope, clientIdHint: s.google.clientId ? `…${s.google.clientId.slice(-18)}` : '' },
    icloud: { found: !!ic, path: ic ? ic.name : null, custom: '' },
    folders: s.folders.filter((f) => f.kind === 'folder').map((f) => ({ id: f.id, name: f.name, path: tr('a folder of this computer') })),
    bindings: Object.fromEntries(Object.entries(s.bindings).map(([id, b]) => [id, { ...b, label: providerLabel(s, b.provider) }])),
    localOnly: loadTrust().privacy.localOnly,
  };
}

/** Chooses a folder of this computer (needs a click: call it from a button). kind icloud: the iCloud Drive folder. */
export async function chooseCloudFolder(h: BrowserHelpers, name: string, kind: 'icloud' | 'folder'): Promise<string> {
  const open = picker();
  if (!open) throw new Error(tr('This browser cannot keep a folder of the computer in sync (use Chrome or Edge on a computer). Google Drive works in every browser.'));
  const handle = await open({ id: kind === 'icloud' ? 'workcraft-icloud' : 'workcraft-cloud', mode: 'readwrite' });
  const s = await load(h);
  if (kind === 'icloud') {
    s.folders = s.folders.filter((f) => f.kind !== 'icloud');
    s.folders.push({ id: 'icloud', name: handle.name || 'iCloud Drive', kind, handle });
    await save(h, s);
    return 'icloud';
  }
  const id = (name || handle.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'folder';
  s.folders = [...s.folders.filter((f) => f.id !== id), { id, name: (name || handle.name).trim().slice(0, 60), kind, handle }];
  await save(h, s);
  // The provider id the project is bound to ("folder:<id>")
  return `folder:${id}`;
}

// ---------------------------------------------------------------- routes

/** Serves /api/cloud in browser mode. Returns null for other paths. */
export async function handleCloud(p: string, method: string, init: RequestInit, h: BrowserHelpers): Promise<Response | null> {
  if (!p.startsWith('/api/cloud')) return null;
  const sub = p.slice('/api/cloud'.length);
  try {
    if (sub === '' && method === 'GET') return h.json(await stateOf(h));
    // A browser cannot look at the folders of the computer; the guide offers the folder picker or a ZIP instead
    if (sub === '/detect' && method === 'GET') return h.json({ found: [] });
    if (sub === '/google' && method === 'PUT') {
      const b = await h.body<{ clientId?: string; scope?: 'file' | 'full' }>(init);
      const s = await load(h);
      const changed = (b.clientId && b.clientId.trim() !== s.google.clientId) || (b.scope && b.scope !== s.google.scope);
      if (b.clientId) s.google.clientId = b.clientId.trim();
      if (b.scope) s.google.scope = b.scope;
      if (changed) {
        clearToken();
        s.google.email = undefined;
      }
      await save(h, s);
      return h.json(await stateOf(h));
    }
    if (sub === '/google/start' && method === 'POST') {
      allowed();
      const s = await load(h);
      if (!s.google.clientId) throw new CloudErr('CONFIG', tr('Paste the client ID of your Google OAuth client first.'));
      const state = crypto.randomUUID();
      try {
        localStorage.setItem(STATE_KEY, state);
      } catch {
        throw new CloudErr('STORAGE', tr('This browser blocks storage, so the sign-in cannot be completed.'));
      }
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.searchParams.set('client_id', s.google.clientId);
      u.searchParams.set('redirect_uri', redirectUri());
      u.searchParams.set('response_type', 'token');
      u.searchParams.set('scope', `${SCOPES[s.google.scope]} openid email`);
      u.searchParams.set('state', state);
      u.searchParams.set('include_granted_scopes', 'true');
      return h.json({ url: u.toString() });
    }
    if (sub === '/google/finish' && method === 'POST') {
      // the sign-in window stored the token: read the account name once
      const s = await load(h);
      s.google.email = await googleEmail();
      await save(h, s);
      return h.json(await stateOf(h));
    }
    if (sub === '/google/disconnect' && method === 'POST') {
      const tok = readToken();
      clearToken();
      if (tok) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.token)}`, { method: 'POST' }).catch(() => {});
      const s = await load(h);
      s.google.email = undefined;
      await save(h, s);
      return h.json(await stateOf(h));
    }
    if (sub === '/icloud' && method === 'PUT') return h.json(await stateOf(h));
    if (sub === '/folders' && method === 'POST') throw new CloudErr('PICKER', tr('Press Choose folder to pick the folder; the browser asks for it.'));
    const fd = sub.match(/^\/folders\/([\w-]+)$/);
    if (fd && method === 'DELETE') {
      const s = await load(h);
      s.folders = s.folders.filter((f) => f.id !== fd[1]);
      for (const [pid, b] of Object.entries(s.bindings)) if (b.provider === `folder:${fd[1]}`) delete s.bindings[pid];
      await save(h, s);
      return h.json(await stateOf(h));
    }
    if (sub === '/bind' && method === 'POST') {
      const b = await h.body<{ project: string; provider: string; auto?: boolean }>(init);
      const pr = await h.project();
      if (b.project !== pr.id) throw new CloudErr('ACTIVE', tr('Open this project first: browser mode keeps one project in the cloud sync at a time.'));
      const s = await load(h);
      const remote = await resolveRemote(s, b.provider, pr.name);
      s.bindings[pr.id] = { provider: b.provider, remote, label: providerLabel(s, b.provider), auto: b.auto ?? true, name: pr.name };
      await save(h, s);
      return h.json({ ...(await stateOf(h)), result: await syncActive(h) });
    }
    const bind = sub.match(/^\/bind\/([^/]+)$/);
    if (bind && method === 'PUT') {
      const b = await h.body<{ auto: boolean }>(init);
      const s = await load(h);
      if (s.bindings[bind[1]!]) s.bindings[bind[1]!]!.auto = b.auto;
      await save(h, s);
      return h.json(await stateOf(h));
    }
    if (bind && method === 'DELETE') {
      const s = await load(h);
      delete s.bindings[bind[1]!];
      await save(h, s);
      return h.json(await stateOf(h));
    }
    if (sub === '/sync' && method === 'POST') {
      const b = await h.body<{ project: string; dryRun?: boolean }>(init);
      const pr = await h.project();
      if (b.project !== pr.id) throw new CloudErr('ACTIVE', tr('Open this project first: browser mode syncs the project that is open.'));
      return h.json({ result: await syncActive(h, { dryRun: b.dryRun }), ...(await stateOf(h)) });
    }
    // A project that lives in the cloud, opened in this browser (a new device, a new browser)
    if (sub === '/remote' && method === 'POST') {
      const b = await h.body<{ provider: string }>(init);
      allowed();
      const s = await load(h);
      return h.json({ names: await remoteProjects(s, b.provider) });
    }
    return null;
  } catch (e) {
    if (e instanceof CloudErr) return h.json({ error: { code: e.code, message: e.message } }, e.status === 401 ? 401 : e.status);
    throw e;
  }
}

/** The names of the projects a provider holds under WorkCraft/. */
export async function remoteProjects(s: Stored, provider: string): Promise<string[]> {
  if (provider === 'google') {
    const root = await findFolder('WorkCraft', 'root', false);
    if (!root) return [];
    return (await listChildren(root)).filter((f) => f.mimeType === FOLDER).map((f) => f.name).sort();
  }
  const f = folderOf(s, provider);
  if (!f) return [];
  await ensureAccess(f.handle);
  let wc: FsDir;
  try {
    wc = await f.handle.getDirectoryHandle('WorkCraft');
  } catch {
    return [];
  }
  const out: string[] = [];
  for await (const [n, x] of wc.entries()) if (x.kind === 'directory' && !SKIP.test(n)) out.push(n);
  return out.sort();
}

export const listRemoteProjects = async (h: BrowserHelpers, provider: string): Promise<string[]> => remoteProjects(await load(h), provider);

/** Binds the open project to an existing cloud project and pulls it (the project was just created for it). */
export async function bindToRemote(h: BrowserHelpers, provider: string, remoteName: string): Promise<void> {
  const pr = await h.project();
  const s = await load(h);
  const remote = await resolveRemote(s, provider, remoteName, false);
  s.bindings[pr.id] = { provider, remote, label: providerLabel(s, provider), auto: true, name: pr.name };
  await save(h, s);
  await syncActive(h);
}

// ---------------------------------------------------------------- automatic sync

let installed = false;
/** Syncs the open project a few seconds after a change and every five minutes (the same rhythm as the desktop). Call once in browser mode. */
export function installBrowserCloud(h: BrowserHelpers): void {
  if (installed) return;
  installed = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () =>
    void (async () => {
      try {
        const pr = await h.project();
        const b = (await load(h)).bindings[pr.id];
        if (b?.auto) await syncActive(h);
      } catch (e) {
        console.warn('Cloud sync', (e as Error).message);
      }
    })();
  bus.on('fs:file', (ev) => {
    if (ev.origin === 'sync') return;
    clearTimeout(timer);
    timer = setTimeout(run, 8000);
  });
  setInterval(run, 5 * 60_000);
}
