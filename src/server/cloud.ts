// Cloud storage: a project can be kept in Google Drive, in iCloud Drive or in any synced folder (OneDrive,
// Dropbox, a network drive) instead of only on this computer. Each of them is a SyncAdapter for the three-way
// sync that already connects two desktops (src/core/sync.ts): changes flow both ways, a file changed on both
// sides keeps both versions, a delete of an unchanged file follows, nothing is ever overwritten silently.
//
//  Google Drive  OAuth 2.0 for desktop apps with PKCE and a loopback redirect, using YOUR OWN OAuth client (create
//                a "Desktop app" client in Google Cloud Console; nothing of WorkCraft's is shared). Scope drive.file
//                (only files WorkCraft created) or drive (all of Drive, needed to open existing Google Docs).
//                Office files are mirrored as files; Google-native Docs, Sheets and Slides are opened and saved
//                through the cloud-list, cloud-import and cloud-export tools (export/convert, never silently).
//  iCloud Drive  Apple has no public file API for third-party apps outside Apple platforms. iCloud for Windows and
//                macOS keep a normal folder (iCloudDrive, ~/Library/Mobile Documents/com~apple~CloudDocs) that
//                syncs by itself, so the project is mirrored into WorkCraft/<project> inside it.
//  Folder        Any other synced folder, same mechanism.
//
// The local copy stays: the apps and the AI work on real files. Remote deletes go to the Drive trash.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, relative, sep } from 'node:path';
import { config, updateConfig } from './config.js';
import { runSync, type SyncAdapter, type SyncFile } from '../core/sync.js';
import { createProject, getProject, listProjects } from './projects.js';
import { localAdapter, readBase, saveBase, sha } from './sync.js';
import { auditRecord } from './audit.js';
import { log } from './logs.js';
import { onEvent } from './events.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SCOPES = { file: 'https://www.googleapis.com/auth/drive.file', full: 'https://www.googleapis.com/auth/drive' };

export class CloudError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function assertCloudAllowed() {
  if (config().privacy.localOnly) throw new CloudError('LOCAL_ONLY', 'Local-only mode is on: cloud storage is blocked. Switch it off in Settings, Privacy.');
}

// ---------------------------------------------------------------- Google OAuth (PKCE, loopback)

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pending = new Map<string, { verifier: string; redirect: string; at: number }>();

export function googleStatus() {
  const g = config().cloud.google;
  return { configured: !!(g.clientId && g.clientSecret), connected: !!g.refreshToken, email: g.email || null, scope: g.scope, clientIdHint: g.clientId ? `${g.clientId.slice(0, 12)}…` : '' };
}

/** The URL the user opens to allow access. The redirect is this backend on a loopback address. */
export function googleStart(redirect: string): string {
  assertCloudAllowed();
  const g = config().cloud.google;
  if (!g.clientId || !g.clientSecret) throw new CloudError('NOT_CONFIGURED', 'Save the OAuth client ID and secret of your Google Cloud "Desktop app" client first.');
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
  const state = b64url(randomBytes(18));
  const verifier = b64url(randomBytes(48));
  pending.set(state, { verifier, redirect, at: Date.now() });
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: `${SCOPES[g.scope]} openid email`,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string; id_token?: string }> {
  const g = config().cloud.google;
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: g.clientId || '', client_secret: g.clientSecret || '', ...body }), signal: AbortSignal.timeout(15_000) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string; access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string };
  if (!res.ok || !data.access_token) throw new CloudError(data.error === 'invalid_grant' ? 'REVOKED' : 'AUTH', data.error_description || data.error || `Google answered ${res.status}`);
  return data as never;
}

/** Called by the redirect: trades the code for tokens and stores them. */
export async function googleCallback(code: string, state: string): Promise<{ email: string | null }> {
  assertCloudAllowed();
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.at > 10 * 60_000) throw new CloudError('STATE', 'This sign-in link expired or was not started here. Start again from Settings.');
  const t = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: p.redirect });
  let email: string | null = null;
  try {
    email = (JSON.parse(Buffer.from(t.id_token!.split('.')[1]!, 'base64url').toString('utf8')) as { email?: string }).email || null;
  } catch {
    /* no email claim */
  }
  updateConfig((c) => {
    c.cloud.google.accessToken = t.access_token;
    c.cloud.google.expiresAt = Date.now() + t.expires_in * 1000;
    if (t.refresh_token) c.cloud.google.refreshToken = t.refresh_token;
    c.cloud.google.email = email || c.cloud.google.email;
  });
  auditRecord({ kind: 'sync', url: TOKEN_URL, bytes: 0, status: 'ok', note: 'Google Drive: signed in' });
  return { email };
}

export function googleDisconnect() {
  updateConfig((c) => {
    c.cloud.google.accessToken = undefined;
    c.cloud.google.refreshToken = undefined;
    c.cloud.google.expiresAt = 0;
    c.cloud.google.email = undefined;
  });
}

async function accessToken(): Promise<string> {
  const g = config().cloud.google;
  if (!g.refreshToken) throw new CloudError('NOT_CONNECTED', 'Google Drive is not connected. Connect it in Settings, Cloud.');
  if (g.accessToken && g.expiresAt - 60_000 > Date.now()) return g.accessToken;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: g.refreshToken });
  updateConfig((c) => {
    c.cloud.google.accessToken = t.access_token;
    c.cloud.google.expiresAt = Date.now() + t.expires_in * 1000;
  });
  return t.access_token;
}

// ---------------------------------------------------------------- Drive REST

async function drive(url: string, init: RequestInit = {}, tries = 3): Promise<Response> {
  assertCloudAllowed();
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(120_000) });
    if ((res.status === 429 || res.status >= 500) && i < tries - 1) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      continue;
    }
    if (res.status === 401 && i === 0) {
      updateConfig((c) => void (c.cloud.google.expiresAt = 0));
      continue;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new CloudError(res.status === 403 ? 'FORBIDDEN' : res.status === 404 ? 'NOT_FOUND' : 'DRIVE', `Google Drive: ${body.error?.message || res.status}`);
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
  parents?: string[];
  webViewLink?: string;
}
const FIELDS = 'id,name,mimeType,size,modifiedTime,md5Checksum,appProperties,parents,webViewLink';

async function listChildren(folderId: string, extra = ''): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const u = new URL(`${DRIVE}/files`);
    u.searchParams.set('q', `'${q(folderId)}' in parents and trashed=false${extra}`);
    u.searchParams.set('fields', `nextPageToken,files(${FIELDS})`);
    u.searchParams.set('pageSize', '1000');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const page = await driveJson<{ files: DriveFile[]; nextPageToken?: string }>(u.toString());
    out.push(...page.files);
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function findFolderIn(name: string, parent: string): Promise<string | null> {
  const u = new URL(`${DRIVE}/files`);
  u.searchParams.set('q', `'${q(parent)}' in parents and name='${q(name)}' and mimeType='${FOLDER}' and trashed=false`);
  u.searchParams.set('fields', 'files(id)');
  return (await driveJson<{ files: { id: string }[] }>(u.toString())).files[0]?.id ?? null;
}
async function findOrCreateFolder(name: string, parent: string): Promise<string> {
  const u = new URL(`${DRIVE}/files`);
  u.searchParams.set('q', `'${q(parent)}' in parents and name='${q(name)}' and mimeType='${FOLDER}' and trashed=false`);
  u.searchParams.set('fields', 'files(id)');
  const hit = (await driveJson<{ files: { id: string }[] }>(u.toString())).files[0];
  if (hit) return hit.id;
  return (await driveJson<{ id: string }>(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id;
}

const MIME: Record<string, string> = { '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const mimeOf = (name: string) => MIME[extname(name).toLowerCase()] || 'application/octet-stream';

/** Uploads bytes with metadata: multipart up to 4 MB, resumable above. Returns the file id. */
async function upload(meta: Record<string, unknown>, data: Uint8Array, mime: string, existingId?: string): Promise<DriveFile> {
  const base = existingId ? `${UPLOAD}/files/${encodeURIComponent(existingId)}` : `${UPLOAD}/files`;
  const method = existingId ? 'PATCH' : 'POST';
  if (data.byteLength <= 4 * 1024 * 1024) {
    const boundary = `wc${randomBytes(8).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const body = Buffer.concat([head, Buffer.from(data), Buffer.from(`\r\n--${boundary}--`)]);
    return (await (await drive(`${base}?uploadType=multipart&fields=${FIELDS}`, { method, headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body })).json()) as DriveFile;
  }
  const start = await drive(`${base}?uploadType=resumable&fields=${FIELDS}`, { method, headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mime, 'x-upload-content-length': String(data.byteLength) }, body: JSON.stringify(meta) });
  const location = start.headers.get('location');
  if (!location) throw new CloudError('DRIVE', 'Google Drive gave no upload address.');
  return (await (await drive(location, { method: 'PUT', headers: { 'content-type': mime }, body: Buffer.from(data) })).json()) as DriveFile;
}

// ---------------------------------------------------------------- Drive as a SyncAdapter

/** The folder of a project in Drive: WorkCraft/<name>, created when missing. Returns its id. */
export async function driveProjectFolder(name: string): Promise<string> {
  const root = await findOrCreateFolder('WorkCraft', 'root');
  return findOrCreateFolder(name, root);
}

export function driveAdapter(rootId: string): SyncAdapter {
  const files = new Map<string, DriveFile>(); // path -> file
  const folders = new Map<string, string>([['', rootId]]); // folder path -> id
  const ensureFolder = async (dir: string): Promise<string> => {
    const known = folders.get(dir);
    if (known) return known;
    const parent = await ensureFolder(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '');
    const id = await findOrCreateFolder(dir.slice(dir.lastIndexOf('/') + 1), parent);
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
            // Google-native documents are not mirrored (see cloud-import); every other file is
            files.set('/' + path, f);
            const hash = f.appProperties?.sha256 || (f.md5Checksum ? `md5:${f.md5Checksum}` : '');
            out.push({ path: '/' + path, size: Number(f.size || 0), mtime: f.modifiedTime ? Date.parse(f.modifiedTime) : 0, hash });
          }
        }
      };
      await walk(rootId, '');
      return out;
    },
    async read(path) {
      const f = files.get(path);
      if (!f) throw new CloudError('NOT_FOUND', `${path} is not in Google Drive`);
      return new Uint8Array(await (await drive(`${DRIVE}/files/${encodeURIComponent(f.id)}?alt=media`)).arrayBuffer());
    },
    async write(path, data, mtime) {
      const rel = path.replace(/^\//, '');
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const props = { sha256: sha(data) };
      const modifiedTime = new Date(mtime || Date.now()).toISOString();
      const existing = files.get(path);
      const saved = existing ? await upload({ appProperties: props, modifiedTime }, data, mimeOf(name), existing.id) : await upload({ name, parents: [await ensureFolder(dir)], appProperties: props, modifiedTime }, data, mimeOf(name));
      files.set(path, saved);
    },
    async remove(path) {
      const f = files.get(path);
      if (!f) return;
      // Into the Drive trash, where it can be restored for 30 days
      await drive(`${DRIVE}/files/${encodeURIComponent(f.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      files.delete(path);
    },
  };
}

// ---------------------------------------------------------------- Google-native documents (tools)

export interface DriveItem {
  id: string;
  name: string;
  kind: 'folder' | 'doc' | 'sheet' | 'slides' | 'file';
  mime: string;
  size: number;
  modified: string | null;
  url: string | null;
}
const kindOf = (mime: string): DriveItem['kind'] => (mime === FOLDER ? 'folder' : mime === 'application/vnd.google-apps.document' ? 'doc' : mime === 'application/vnd.google-apps.spreadsheet' ? 'sheet' : mime === 'application/vnd.google-apps.presentation' ? 'slides' : 'file');

/** Lists a Drive folder (default: the top level), or searches by name. */
export async function driveList(opt: { folder?: string; query?: string; limit?: number } = {}): Promise<DriveItem[]> {
  const u = new URL(`${DRIVE}/files`);
  const parts = ['trashed=false'];
  if (opt.query) parts.push(`name contains '${q(opt.query)}'`);
  else parts.push(`'${q(opt.folder || 'root')}' in parents`);
  u.searchParams.set('q', parts.join(' and '));
  u.searchParams.set('fields', `files(${FIELDS})`);
  u.searchParams.set('orderBy', 'modifiedTime desc');
  u.searchParams.set('pageSize', String(Math.min(100, opt.limit ?? 30)));
  const res = await driveJson<{ files: DriveFile[] }>(u.toString());
  return res.files.map((f) => ({ id: f.id, name: f.name, kind: kindOf(f.mimeType), mime: f.mimeType, size: Number(f.size || 0), modified: f.modifiedTime || null, url: f.webViewLink || null }));
}

const EXPORT: Record<DriveItem['kind'], { mime: string; ext: string } | null> = {
  doc: { mime: MIME['.docx']!, ext: '.docx' },
  sheet: { mime: MIME['.xlsx']!, ext: '.xlsx' },
  slides: { mime: MIME['.pptx']!, ext: '.pptx' },
  folder: null,
  file: null,
};

/** Downloads a Drive file; Google Docs, Sheets and Slides are exported as .docx, .xlsx and .pptx. */
export async function driveFetch(id: string): Promise<{ name: string; data: Uint8Array; from: DriveItem['kind'] }> {
  const meta = await driveJson<DriveFile>(`${DRIVE}/files/${encodeURIComponent(id)}?fields=${FIELDS}`);
  const kind = kindOf(meta.mimeType);
  if (kind === 'folder') throw new CloudError('BAD_TYPE', `${meta.name} is a folder.`);
  const ex = EXPORT[kind];
  if (ex) {
    const data = new Uint8Array(await (await drive(`${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(ex.mime)}`)).arrayBuffer());
    return { name: meta.name.replace(/[\\/:*?"<>|]+/g, '_') + ex.ext, data, from: kind };
  }
  if (meta.mimeType.startsWith('application/vnd.google-apps.')) throw new CloudError('BAD_TYPE', `${meta.name} (${meta.mimeType}) cannot be downloaded as a file.`);
  return { name: meta.name.replace(/[\\/:*?"<>|]+/g, '_'), data: new Uint8Array(await (await drive(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`)).arrayBuffer()), from: 'file' };
}

const NATIVE: Record<string, string> = { '.docx': 'application/vnd.google-apps.document', '.xlsx': 'application/vnd.google-apps.spreadsheet', '.pptx': 'application/vnd.google-apps.presentation' };

/** Uploads a file into a Drive folder (default: WorkCraft/exports); convert turns .docx, .xlsx and .pptx into Google Docs, Sheets and Slides. */
export async function driveSend(name: string, data: Uint8Array, opt: { folder?: string; convert?: boolean } = {}): Promise<DriveItem> {
  const parent = opt.folder || (await findOrCreateFolder('exports', await findOrCreateFolder('WorkCraft', 'root')));
  const native = opt.convert ? NATIVE[extname(name).toLowerCase()] : undefined;
  const title = native ? name.replace(/\.[^.]+$/, '') : name;
  const f = await upload({ name: title, parents: [parent], ...(native ? { mimeType: native } : { appProperties: { sha256: sha(data) } }) }, data, mimeOf(name));
  auditRecord({ kind: 'sync', url: UPLOAD, bytes: data.byteLength, status: 'ok', note: `Google Drive: sent ${name}${native ? ' as a Google file' : ''}` });
  return { id: f.id, name: f.name, kind: kindOf(f.mimeType), mime: f.mimeType, size: Number(f.size || 0), modified: f.modifiedTime || null, url: f.webViewLink || null };
}

// ---------------------------------------------------------------- Folder provider (iCloud Drive and other synced folders)

/** iCloud Drive on this computer: iCloud for Windows (iCloudDrive in the user folder) or macOS. */
export function icloudRoot(): string | null {
  const set = config().cloud.icloudPath;
  const guesses = [set, join(homedir(), 'iCloudDrive'), join(homedir(), 'iCloud Drive'), join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs')].filter((x): x is string => !!x);
  return guesses.find((p) => existsSync(p)) || null;
}

const SKIP = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.git|\.workcraft|\.tmp\.drivedownload|\.sync)$|^~\$|\.icloud$|\.tmp$/;

export function folderAdapter(root: string, name = 'cloud folder'): SyncAdapter {
  mkdirSync(root, { recursive: true });
  const cache = new Map<string, { size: number; mtime: number; hash: string }>();
  const abs = (p: string) => join(root, ...p.split('/').filter(Boolean));
  return {
    name,
    async manifest() {
      const out: SyncFile[] = [];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (SKIP.test(e.name)) continue;
          const full = join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.isFile()) {
            const st = statSync(full);
            const path = '/' + relative(root, full).split(sep).join('/');
            const c = cache.get(path);
            const hash = c && c.size === st.size && c.mtime === st.mtimeMs ? c.hash : sha(readFileSync(full));
            cache.set(path, { size: st.size, mtime: st.mtimeMs, hash });
            out.push({ path, size: st.size, mtime: Math.round(st.mtimeMs), hash });
          }
        }
      };
      walk(root);
      return out;
    },
    async read(p) {
      return new Uint8Array(readFileSync(abs(p)));
    },
    async write(p, data, mtime) {
      const f = abs(p);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, data);
      try {
        utimesSync(f, new Date(), new Date(mtime));
      } catch {
        /* time stays now */
      }
      cache.delete(p);
    },
    async remove(p) {
      rmSync(abs(p), { force: true });
      cache.delete(p);
    },
  };
}

// ---------------------------------------------------------------- Bindings and sync

export type Provider = 'google' | 'icloud' | `folder:${string}`;

export function providerLabel(p: string): string {
  if (p === 'google') return 'Google Drive';
  if (p === 'icloud') return 'iCloud Drive';
  return config().cloud.folders.find((f) => `folder:${f.id}` === p)?.name || 'Cloud folder';
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'Project';

/** Where a project goes for a provider: creates the remote folder and returns its address (Drive folder id or path). */
export async function resolveRemote(provider: string, projectName: string): Promise<string> {
  if (provider === 'google') return driveProjectFolder(safeName(projectName));
  if (provider === 'icloud') {
    const base = icloudRoot();
    if (!base) throw new CloudError('NOT_FOUND', 'iCloud Drive was not found on this computer. Install iCloud for Windows (or sign in to iCloud on a Mac), or set the folder in Settings, Cloud.');
    return join(base, 'WorkCraft', safeName(projectName));
  }
  const f = config().cloud.folders.find((x) => `folder:${x.id}` === provider);
  if (!f) throw new CloudError('NOT_FOUND', 'This cloud folder is no longer in the list.');
  if (!existsSync(f.path)) throw new CloudError('NOT_FOUND', `${f.path} does not exist (is the drive connected?).`);
  return join(f.path, 'WorkCraft', safeName(projectName));
}

export function adapterFor(provider: string, remote: string): SyncAdapter {
  return provider === 'google' ? driveAdapter(remote) : folderAdapter(remote, providerLabel(provider));
}

export async function bindProject(projectId: string, provider: string, auto = true) {
  const { meta } = getProject(projectId);
  const remote = await resolveRemote(provider, meta.name);
  updateConfig((c) => void (c.cloud.bindings[projectId] = { provider, remote, label: providerLabel(provider), auto, last: undefined, error: undefined }));
  return syncProject(projectId);
}

/** The names of the projects a provider holds under WorkCraft/ (a new computer asks this to open one of them). */
export async function remoteProjects(provider: string): Promise<string[]> {
  assertCloudAllowed();
  if (provider === 'google') {
    const root = await findFolderIn('WorkCraft', 'root');
    if (!root) return [];
    return (await listChildren(root)).filter((f) => f.mimeType === FOLDER).map((f) => f.name).sort();
  }
  const base = provider === 'icloud' ? icloudRoot() : config().cloud.folders.find((x) => `folder:${x.id}` === provider)?.path;
  if (!base) throw new CloudError('NOT_FOUND', 'This cloud folder is not set up.');
  const dir = join(base, 'WorkCraft');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP.test(e.name)).map((e) => e.name).sort();
}

/** Opens a project that lives in the cloud on this computer: a new local project with that name, kept in the cloud, pulled once. */
export async function openRemoteProject(provider: string, name: string) {
  assertCloudAllowed();
  if (!(await remoteProjects(provider)).includes(name)) throw new CloudError('NOT_FOUND', `${name} is not in ${providerLabel(provider)}.`);
  const meta = await createProject(name, 'empty');
  const result = await bindProject(meta.id, provider, true);
  return { project: meta, result };
}
export function unbindProject(projectId: string) {
  updateConfig((c) => void delete c.cloud.bindings[projectId]);
}

const running = new Set<string>();

/** Two-way sync of a bound project. Safe to call often: a second call while one runs is skipped. */
export async function syncProject(projectId: string, opt: { dryRun?: boolean; letDeletesGo?: boolean } = {}) {
  const b = config().cloud.bindings[projectId];
  if (!b) throw new CloudError('NOT_BOUND', 'This project is not kept in the cloud.');
  if (running.has(projectId)) return { skipped: true as const };
  running.add(projectId);
  try {
    assertCloudAllowed();
    const { root, meta } = getProject(projectId);
    const key = `cloud-${b.provider}-${b.remote}`;
    const res = await runSync(localAdapter(projectId, 'this computer'), adapterFor(b.provider, b.remote), readBase(root, key), { dryRun: opt.dryRun, hash: async (d) => sha(d), guardDeletes: true, letDeletesGo: opt.letDeletesGo });
    if (!opt.dryRun) {
      saveBase(root, key, res.base);
      updateConfig((c) => {
        const x = c.cloud.bindings[projectId];
        if (x) {
          x.last = new Date().toISOString();
          x.error = res.errors.length ? `${res.errors.length} files failed: ${res.errors[0]!.message}`.slice(0, 300) : undefined;
        }
      });
    }
    if (b.provider !== 'icloud' && !b.provider.startsWith('folder:')) auditRecord({ kind: 'sync', url: DRIVE, bytes: 0, status: res.errors.length ? 'error' : 'ok', note: `${meta.name} with ${providerLabel(b.provider)}: ${res.pushed} up, ${res.pulled} down, ${res.conflicts} conflicts${opt.dryRun ? ' (preview)' : ''}` });
    log('info', 'cloud', `${meta.name} with ${providerLabel(b.provider)}: ${res.pushed} up, ${res.pulled} down, ${res.conflicts} conflicts, ${res.errors.length} errors`);
    const { base: _base, ...summary } = res;
    return { skipped: false as const, ...summary };
  } catch (e) {
    if (!opt.dryRun) updateConfig((c) => void (c.cloud.bindings[projectId] && (c.cloud.bindings[projectId]!.error = (e as Error).message.slice(0, 300))));
    throw e;
  } finally {
    running.delete(projectId);
  }
}

// ---------------------------------------------------------------- Automatic sync

const timers = new Map<string, NodeJS.Timeout>();
let started = false;

/** Syncs bound projects a few seconds after a change by the user or the AI, and every five minutes. */
export function startAutoSync() {
  if (started) return;
  started = true;
  const run = (id: string) => void syncProject(id).catch((e) => log('warn', 'cloud', `${id}: ${(e as Error).message}`));
  onEvent((ev) => {
    if (ev.t !== 'fs' || ev.origin === 'sync' || !config().cloud.bindings[ev.project]?.auto) return;
    clearTimeout(timers.get(ev.project));
    timers.set(ev.project, setTimeout(() => run(ev.project), 8000));
  });
  const every = setInterval(() => {
    for (const [id, b] of Object.entries(config().cloud.bindings)) if (b.auto && listProjects().some((p) => p.id === id)) run(id);
  }, 5 * 60_000);
  every.unref();
}
