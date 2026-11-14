// Project files in the frontend: a mirror of the file tree from the backend plus read and write access.
// Changes (also from AI tools or other programs) arrive live over the WebSocket.

import { api } from '../app/backend.js';
import { bus } from '../app/bus.js';
import { normPath, dirname, basename, extname, debounce, isText } from '../app/util.js';

export interface Entry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
}

const mirror = new Map<string, Entry>();
let projectId = '';

const enc = encodeURIComponent;

const refresh = debounce(async () => {
  await fs.reload();
}, 150);

export const fs = {
  get project() {
    return projectId;
  },

  async reload(): Promise<void> {
    const r = await api.get<{ project: string; entries: Entry[] }>('/api/files/tree');
    projectId = r.project;
    mirror.clear();
    for (const e of r.entries) mirror.set(e.path, e);
    bus.emit('fs:change');
  },

  init(): Promise<void> {
    bus.on('fs:file', () => refresh());
    return this.reload();
  },

  list(): Entry[] {
    return [...mirror.values()];
  },
  files(): Entry[] {
    return this.list().filter((e) => e.kind === 'file');
  },
  children(dir: string): Entry[] {
    const d = normPath(dir);
    return this.list().filter((e) => dirname(e.path) === d && e.path !== '/');
  },
  exists(path: string): boolean {
    return mirror.has(normPath(path));
  },
  stat(path: string): Entry | null {
    return mirror.get(normPath(path)) || null;
  },

  async readBinary(path: string): Promise<ArrayBuffer> {
    return api.bytes(`/api/files/raw?path=${enc(normPath(path))}`);
  },
  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  },

  /** Writes a file. origin names the sender (panel), so it recognises its own change. */
  async write(path: string, data: ArrayBuffer | Uint8Array | Blob | string, origin = 'ui'): Promise<string> {
    let body: ArrayBuffer | string;
    if (typeof data === 'string') body = data;
    else if (typeof (data as Blob).arrayBuffer === 'function' && !ArrayBuffer.isView(data)) body = await (data as Blob).arrayBuffer();
    else if (ArrayBuffer.isView(data)) body = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    else body = data as ArrayBuffer;
    const r = await api.send<{ path: string }>('PUT', `/api/files/raw?path=${enc(normPath(path))}`, body, { 'x-oc-origin': origin });
    const p = r.path;
    mirror.set(p, { path: p, kind: 'file', size: typeof body === 'string' ? new TextEncoder().encode(body).length : body.byteLength, mtime: Date.now() });
    bus.emit('fs:change');
    return p;
  },

  async mkdir(path: string): Promise<void> {
    await api.send('POST', '/api/files/mkdir', { path: normPath(path) });
    refresh();
  },
  async remove(path: string): Promise<void> {
    await api.send('DELETE', `/api/files?path=${enc(normPath(path))}`);
    await this.reload();
  },
  async rename(from: string, to: string): Promise<string> {
    const r = await api.send<{ path: string }>('POST', '/api/files/rename', { from: normPath(from), to: normPath(to) });
    await this.reload();
    return r.path;
  },

  /** Text representation for @ mentions (sheet as Markdown, document as text, PDF text). */
  async context(path: string): Promise<{ text: string; kind: string }> {
    return api.get(`/api/files/context?path=${enc(normPath(path))}`);
  },

  uniquePath(path: string): string {
    const p = normPath(path);
    if (!mirror.has(p)) return p;
    const ext = extname(p);
    const base = ext ? p.slice(0, -(ext.length + 1)) : p;
    for (let i = 2; ; i++) {
      const c = ext ? `${base}-${i}.${ext}` : `${base}-${i}`;
      if (!mirror.has(c)) return c;
    }
  },

  /** Finds a file by path or by a unique file name (for @ mentions). */
  resolve(ref: string): Entry | null {
    const r = ref.replace(/^@/, '');
    const exact = mirror.get(normPath(r));
    if (exact) return exact;
    const byName = this.list().filter((e) => basename(e.path).toLowerCase() === r.toLowerCase());
    return byName.length ? byName.sort((a, b) => (a.kind === b.kind ? a.path.length - b.path.length : a.kind === 'file' ? -1 : 1))[0]! : null;
  },

  isText,
};
