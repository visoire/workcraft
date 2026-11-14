// Cloud storage in browser mode (src/app/cloud-browser.ts): the /api/cloud routes answered inside the browser, a folder of the computer
// as the cloud side (an in-memory stand-in for the File System Access API) and Google Drive's sign-in state. No browser, no network.
//   npx tsx --test tests/server/cloud-browser.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- the browser globals the module reads
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
(globalThis as unknown as { location: unknown }).location = { origin: 'https://wc.example', href: 'https://wc.example/index.html', pathname: '/index.html', protocol: 'https:' };

// ---- an in-memory folder with the shape of a FileSystemDirectoryHandle
class MemFile {
  kind = 'file' as const;
  constructor(
    public name: string,
    public parent: MemDir
  ) {}
  async getFile() {
    const rec = this.parent.files.get(this.name)!;
    return new File([rec.data as BlobPart], this.name, { lastModified: rec.mtime });
  }
  async createWritable() {
    const parent = this.parent;
    const name = this.name;
    return {
      async write(d: BufferSource) {
        parent.files.set(name, { data: new Uint8Array(d as ArrayBuffer), mtime: Date.now() });
      },
      async close() {},
    };
  }
}
class MemDir {
  kind = 'directory' as const;
  files = new Map<string, { data: Uint8Array; mtime: number }>();
  dirs = new Map<string, MemDir>();
  constructor(public name: string) {}
  async *entries(): AsyncGenerator<[string, MemFile | MemDir]> {
    for (const n of this.dirs.keys()) yield [n, this.dirs.get(n)!];
    for (const n of this.files.keys()) yield [n, new MemFile(n, this)];
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!o?.create) throw new Error('NotFoundError');
      this.files.set(name, { data: new Uint8Array(), mtime: Date.now() });
    }
    return new MemFile(name, this);
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    if (!this.dirs.has(name)) {
      if (!o?.create) throw new Error('NotFoundError');
      this.dirs.set(name, new MemDir(name));
    }
    return this.dirs.get(name)!;
  }
  async removeEntry(name: string) {
    this.files.delete(name);
    this.dirs.delete(name);
  }
}
const cloudRoot = new MemDir('iCloud Drive');
(globalThis as unknown as { window: unknown }).window = { showDirectoryPicker: async () => cloudRoot };

const { handleCloud, chooseCloudFolder, syncActive, listRemoteProjects, canPickFolder } = await import('../../src/app/cloud-browser.js');
import type { BrowserHelpers } from '../../src/app/offline-extra.js';

// ---- the data of "this browser": one project, a few files
const kv = new Map<string, unknown>();
const files = new Map<string, { data: Uint8Array; mtime: number }>();
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (d: Uint8Array) => new TextDecoder().decode(d);
const helpers: BrowserHelpers = {
  kvGet: async <T,>(k: string) => kv.get(k) as T | undefined,
  kvPut: async (k, v) => void kv.set(k, v),
  json: (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } }),
  fail: (status, code, message) => {
    throw Object.assign(new Error(message), { status, code });
  },
  body: async <T,>(init: RequestInit) => JSON.parse(String(init.body || '{}')) as T,
  files: async () => [...files].map(([path, v]) => ({ path, size: v.data.length, mtime: v.mtime, data: v.data.slice().buffer as ArrayBuffer })),
  context: async () => ({ text: '', kind: 'text' }),
  chats: async () => [],
  project: async () => ({ id: 'proj-1', name: 'Quarterly: report' }),
  write: async (path, data) => {
    files.set(path, { data: new Uint8Array(data), mtime: Date.now() });
    return path;
  },
  remove: async (path) => void files.delete(path),
  wipe: async () => {},
};
const call = async (path: string, method = 'GET', body?: unknown) => {
  const r = await handleCloud(`/api/cloud${path}`, method, body === undefined ? {} : { body: JSON.stringify(body) }, helpers);
  assert.ok(r, `${method} ${path} is a cloud route`);
  return { status: r!.status, json: (await r!.json()) as Record<string, any> };
};

test('The cloud routes exist in browser mode and describe an empty state', async () => {
  assert.equal(await handleCloud('/api/projects', 'GET', {}, helpers), null, 'other paths are not taken');
  const s = (await call('')).json;
  assert.equal(s.browser, true);
  assert.equal(s.canPickFolder, true);
  assert.equal(s.google.connected, false);
  assert.equal(s.google.configured, false);
  assert.equal(s.icloud.found, false);
  assert.deepEqual(s.bindings, {});
  assert.equal(s.redirectUri, 'https://wc.example/oauth-callback.html');
  assert.equal(canPickFolder(), true);
});

test('Google Drive: the client ID is kept, the sign-in address is built, the token is read from this browser', async () => {
  let r = await call('/google/start', 'POST');
  assert.equal(r.status, 400, 'no client ID yet');
  r = await call('/google', 'PUT', { clientId: 'abc123.apps.googleusercontent.com', scope: 'file' });
  assert.equal(r.json.google.configured, true);
  assert.equal(r.json.google.connected, false);
  r = await call('/google/start', 'POST');
  const u = new URL(r.json.url);
  assert.equal(u.host, 'accounts.google.com');
  assert.equal(u.searchParams.get('response_type'), 'token');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://wc.example/oauth-callback.html');
  assert.match(u.searchParams.get('scope')!, /drive\.file/);
  assert.equal(u.searchParams.get('state'), store.get('workcraft.cloud.state'));
  // what public/oauth-callback.js stores after a sign-in
  store.set('workcraft.cloud.google', JSON.stringify({ token: 't', expiresAt: Date.now() + 3_600_000, scope: '' }));
  assert.equal((await call('')).json.google.connected, true);
  // an expired token is no sign-in
  store.set('workcraft.cloud.google', JSON.stringify({ token: 't', expiresAt: Date.now() - 1000, scope: '' }));
  assert.equal((await call('')).json.google.connected, false);
  // a different client needs a new sign-in
  store.set('workcraft.cloud.google', JSON.stringify({ token: 't', expiresAt: Date.now() + 3_600_000, scope: '' }));
  r = await call('/google', 'PUT', { clientId: 'other.apps.googleusercontent.com' });
  assert.equal(r.json.google.connected, false);
  assert.equal(store.has('workcraft.cloud.google'), false);
});

test('Local-only mode blocks the sign-in', async () => {
  store.set('workcraft.browser.trust', JSON.stringify({ privacy: { localOnly: true, audit: true } }));
  const r = await call('/google/start', 'POST');
  assert.equal(r.status, 403);
  assert.match(r.json.error.message, /Local-only/);
  store.delete('workcraft.browser.trust');
});

test('A folder of the computer is the cloud: keep a project there, both sides stay in step', async () => {
  files.set('/documents/report.docx', { data: enc('v1'), mtime: 1000 });
  files.set('/notes.md', { data: enc('hello'), mtime: 1000 });
  await chooseCloudFolder(helpers, '', 'icloud');
  const s = (await call('')).json;
  assert.equal(s.icloud.found, true);

  const bound = await call('/bind', 'POST', { project: 'proj-1', provider: 'icloud' });
  assert.equal(bound.json.result.pushed, 2);
  const wc = cloudRoot.dirs.get('WorkCraft')!.dirs.get('Quarterly_ report')!;
  assert.ok(wc, 'the project folder is WorkCraft/<name> with a safe name');
  assert.equal(dec(wc.dirs.get('documents')!.files.get('report.docx')!.data), 'v1');
  assert.equal(bound.json.bindings['proj-1'].label, 'iCloud Drive');

  // a change in the cloud folder (made by another device through iCloud) comes in
  wc.files.set('notes.md', { data: enc('hello from the other device'), mtime: Date.now() + 10_000 });
  let r = await call('/sync', 'POST', { project: 'proj-1' });
  assert.equal(r.json.result.pulled, 1);
  assert.equal(dec(files.get('/notes.md')!.data), 'hello from the other device');

  // a change here goes out
  files.set('/documents/report.docx', { data: enc('v2'), mtime: Date.now() + 20_000 });
  r = await call('/sync', 'POST', { project: 'proj-1' });
  assert.equal(r.json.result.pushed, 1);
  assert.equal(dec(wc.dirs.get('documents')!.files.get('report.docx')!.data), 'v2');

  // both sides changed: both versions are kept
  files.set('/notes.md', { data: enc('mine'), mtime: Date.now() + 30_000 });
  wc.files.set('notes.md', { data: enc('theirs'), mtime: Date.now() + 25_000 });
  r = await call('/sync', 'POST', { project: 'proj-1' });
  assert.equal(r.json.result.conflicts, 1);
  assert.equal(dec(files.get('/notes.md')!.data), 'mine');
  assert.ok([...files.keys()].some((k) => /notes \(conflict .*\)\.md$/.test(k)), 'the other version is kept next to it');

  // a file removed here is removed there
  files.delete('/documents/report.docx');
  const before = [...files.keys()].length;
  r = await call('/sync', 'POST', { project: 'proj-1' });
  assert.equal(r.json.result.deleted, 1);
  assert.equal(wc.dirs.get('documents')!.files.has('report.docx'), false);
  assert.equal([...files.keys()].length, before);
});

test('A project that lives in the cloud can be found from another device', async () => {
  assert.deepEqual(await listRemoteProjects(helpers, 'icloud'), ['Quarterly_ report']);
  assert.deepEqual(await listRemoteProjects(helpers, 'folder:nothing'), []);
  const r = await call('/remote', 'POST', { provider: 'icloud' });
  assert.deepEqual(r.json.names, ['Quarterly_ report']);
});

test('Automatic sync can be switched off per project, a project can leave the cloud, a folder can be removed', async () => {
  let r = await call('/bind/proj-1', 'PUT', { auto: false });
  assert.equal(r.json.bindings['proj-1'].auto, false);
  r = await call('/bind/proj-1', 'DELETE');
  assert.deepEqual(r.json.bindings, {});
  await assert.rejects(() => syncActive(helpers), /not kept in the cloud/);
  r = await call('/folders/icloud', 'DELETE');
  assert.equal(r.json.icloud.found, false, 'the iCloud folder is removed too');
});

test('Only the open project can be bound or synced in browser mode, and the folder picker is a button, not a route', async () => {
  let r = await call('/bind', 'POST', { project: 'another', provider: 'icloud' });
  assert.equal(r.status, 400);
  r = await call('/sync', 'POST', { project: 'another' });
  assert.equal(r.status, 400);
  r = await call('/folders', 'POST', { name: 'x', path: 'y' });
  assert.equal(r.status, 400);
});
