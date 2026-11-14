// Home-network sync of the desktop backend: endpoints for the other side (iPad in browser mode
// or a second desktop) and a client that syncs a local project with a peer desktop.
// Every request to /api/sync goes through the same token check as the rest of /api.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { META_DIR, resolveIn, normProjectPath } from './paths.js';
import { getProject, listTree, readProjectFile, writeProjectFile, trashProjectPath, listProjects, createProject, adoptProject, projectRoot } from './projects.js';
import { runSync, type SyncAdapter, type SyncFile } from '../core/sync.js';
import { auditRecord } from './audit.js';
import { log } from './logs.js';

const hashCache = new Map<string, { size: number; mtime: number; hash: string }>();
export const sha = (d: Uint8Array) => createHash('sha256').update(d).digest('hex');

export async function manifest(id: string): Promise<SyncFile[]> {
  const { root } = getProject(id);
  const out: SyncFile[] = [];
  for (const e of await listTree(root)) {
    if (e.kind !== 'file') continue;
    const key = `${root}\u0000${e.path}`;
    const c = hashCache.get(key);
    let hash = c && c.size === e.size && c.mtime === e.mtime ? c.hash : '';
    if (!hash) {
      hash = sha(await readProjectFile(root, e.path));
      hashCache.set(key, { size: e.size, mtime: e.mtime, hash });
    }
    out.push({ path: e.path, size: e.size, mtime: Math.round(e.mtime), hash });
  }
  return out;
}

/** Creates a project with exactly this ID when it is missing (the other side names it). */
export async function ensureProject(id: string, name: string) {
  if (!/^[a-z0-9-]{3,80}$/.test(id)) throw Object.assign(new Error('Invalid project ID'), { code: 'INVALID' });
  if (listProjects().some((p) => p.id === id)) return getProject(id).meta;
  mkdirSync(projectRoot(id), { recursive: true });
  return adoptProject(id, name);
}

export function localAdapter(id: string, name = 'desktop'): SyncAdapter {
  const { root } = getProject(id);
  return {
    name,
    manifest: () => manifest(id),
    read: (p) => readProjectFile(root, p),
    async write(p, data, mtime) {
      await writeProjectFile(root, p, data, 'sync');
      try {
        utimesSync(resolveIn(root, p), new Date(), new Date(mtime));
      } catch {
        /* time stays now */
      }
    },
    async remove(p) {
      await trashProjectPath(root, p, 'sync');
    },
  };
}

export interface Peer {
  host: string;
  port: number;
  token: string;
}

function peerAdapter(peer: Peer, remoteId: string): SyncAdapter {
  const base = `http://${peer.host}:${peer.port}/api/sync/${encodeURIComponent(remoteId)}`;
  const headers = { 'x-oc-token': peer.token };
  const check = async (r: Response) => {
    if (!r.ok) throw new Error(`${peer.host}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  return {
    name: peer.host,
    manifest: async () => (await (await check(await fetch(`${base}/manifest`, { headers, signal: AbortSignal.timeout(30_000) }))).json()) as SyncFile[],
    read: async (p) => new Uint8Array(await (await check(await fetch(`${base}/file?path=${encodeURIComponent(p)}`, { headers }))).arrayBuffer()),
    async write(p, data, mtime) {
      await check(await fetch(`${base}/file?path=${encodeURIComponent(p)}&mtime=${mtime}`, { method: 'PUT', headers, body: data }));
    },
    async remove(p) {
      await check(await fetch(`${base}/file?path=${encodeURIComponent(p)}`, { method: 'DELETE', headers }));
    },
  };
}

export const baseFile = (root: string, key: string) => join(root, META_DIR, `sync-${key.replace(/[^\w.-]+/g, '_').slice(0, 80)}.json`);
export function readBase(root: string, key: string): Record<string, string> | null {
  try {
    return existsSync(baseFile(root, key)) ? (JSON.parse(readFileSync(baseFile(root, key), 'utf8')) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

export function saveBase(root: string, key: string, base: Record<string, string>) {
  mkdirSync(join(root, META_DIR), { recursive: true });
  writeFileSync(baseFile(root, key), JSON.stringify(base));
}

/** Syncs a local project with the same project on a peer desktop (two-way). */
export async function syncWithPeer(localId: string, peer: Peer, opt: { remoteId?: string; dryRun?: boolean } = {}) {
  const { root, meta } = getProject(localId);
  const remoteId = opt.remoteId || localId;
  const headers = { 'x-oc-token': peer.token, 'content-type': 'application/json' };
  const ensure = await fetch(`http://${peer.host}:${peer.port}/api/sync/${encodeURIComponent(remoteId)}/ensure`, { method: 'POST', headers, body: JSON.stringify({ name: meta.name }), signal: AbortSignal.timeout(10_000) }).catch((e: Error) => {
    throw Object.assign(new Error(`${peer.host}:${peer.port} is not reachable (${e.message}). Is home network sharing on at the other desktop?`), { code: 'UNREACHABLE' });
  });
  if (!ensure.ok) throw Object.assign(new Error(`${peer.host}: ${ensure.status} ${(await ensure.text()).slice(0, 200)}`), { code: ensure.status === 401 ? 'AUTH' : 'SYNC' });
  const key = `${peer.host}-${peer.port}-${remoteId}`;
  const res = await runSync(localAdapter(localId, 'this desktop'), peerAdapter(peer, remoteId), readBase(root, key), { dryRun: opt.dryRun, hash: async (d) => sha(d) });
  if (!opt.dryRun) {
    mkdirSync(join(root, META_DIR), { recursive: true });
    writeFileSync(baseFile(root, key), JSON.stringify(res.base));
  }
  auditRecord({ kind: 'sync', url: `http://${peer.host}:${peer.port}`, local: true, bytes: 0, status: res.errors.length ? 'error' : 'ok', note: `${meta.name}: ${res.pushed} sent, ${res.pulled} received, ${res.conflicts} conflicts, ${res.deleted} deleted${opt.dryRun ? ' (preview)' : ''}` });
  log('info', 'sync', `${meta.name} with ${peer.host}: ${res.pushed} up, ${res.pulled} down, ${res.conflicts} conflicts`);
  const { base: _b, ...summary } = res;
  return summary;
}

export async function readSyncFile(id: string, path: string) {
  return readProjectFile(getProject(id).root, normProjectPath(path));
}
export async function writeSyncFile(id: string, path: string, data: Uint8Array, mtime?: number) {
  const { root } = getProject(id);
  const p = await writeProjectFile(root, normProjectPath(path), data, 'sync');
  if (mtime) {
    try {
      utimesSync(resolveIn(root, p), new Date(), new Date(mtime));
    } catch {
      /* ignore */
    }
  }
  return p;
}
export async function removeSyncFile(id: string, path: string) {
  return trashProjectPath(getProject(id).root, normProjectPath(path), 'sync');
}
export { createProject };
