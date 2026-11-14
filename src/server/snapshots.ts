// Project snapshots: the whole project folder plus the chats in one restorable state.
// "Undo across all tools": before the AI writes the first file of an answer, the backend
// takes an automatic snapshot of that chain; restoring it undoes every file the AI changed in
// WordCraft, GridCraft, DeckCraft, PdfCraft and the code editor at once, and brings back the chat.
// Before every restore a snapshot of the current state is taken, so a restore can be undone too.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { META_DIR } from './paths.js';
import { putObject, getObject, hasObject, gcObjects, hashOf } from './objects.js';
import { listTree, readProjectFile, writeProjectFile, trashProjectPath, listMetaDir, readMetaFile, writeMetaFile, removeMetaFile } from './projects.js';
import { graph } from './graph.js';

const MAX_AUTO = 30;
const MAX_FILE = 25 * 1024 * 1024;

export interface SnapshotFile {
  hash: string;
  size: number;
}
export interface Snapshot {
  id: string;
  created: string;
  label: string;
  auto: boolean;
  chain?: string;
  files: Record<string, SnapshotFile>;
  chats: Record<string, string>;
  /** files left out because they are larger than 25 MB */
  skipped: string[];
}
export type SnapshotSummary = Omit<Snapshot, 'files' | 'chats'> & { fileCount: number; chatCount: number; bytes: number };

const dirOf = (root: string) => join(root, META_DIR, 'snapshots');
const idRe = /^[a-z0-9-]{6,40}$/;

function readSnap(root: string, id: string): Snapshot {
  if (!idRe.test(id)) throw Object.assign(new Error('Invalid snapshot ID'), { code: 'INVALID' });
  const f = join(dirOf(root), `${id}.json`);
  if (!existsSync(f)) throw Object.assign(new Error('Snapshot not found'), { code: 'NOT_FOUND' });
  return JSON.parse(readFileSync(f, 'utf8')) as Snapshot;
}

const summary = (s: Snapshot): SnapshotSummary => {
  const { files, chats, ...rest } = s;
  return { ...rest, fileCount: Object.keys(files).length, chatCount: Object.keys(chats).length, bytes: Object.values(files).reduce((n, f) => n + f.size, 0) };
};

export function listSnapshots(root: string): SnapshotSummary[] {
  if (!existsSync(dirOf(root))) return [];
  const out: SnapshotSummary[] = [];
  for (const f of readdirSync(dirOf(root))) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(summary(JSON.parse(readFileSync(join(dirOf(root), f), 'utf8')) as Snapshot));
    } catch {
      /* broken */
    }
  }
  return out.sort((a, b) => b.created.localeCompare(a.created));
}

export async function createSnapshot(root: string, label: string, opt: { auto?: boolean; chain?: string } = {}): Promise<SnapshotSummary> {
  const snap: Snapshot = { id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, created: new Date().toISOString(), label: label.slice(0, 120) || 'Snapshot', auto: !!opt.auto, ...(opt.chain ? { chain: opt.chain } : {}), files: {}, chats: {}, skipped: [] };
  for (const e of await listTree(root)) {
    if (e.kind !== 'file') continue;
    if (e.size > MAX_FILE) {
      snap.skipped.push(e.path);
      continue;
    }
    const { hash } = putObject(root, await readProjectFile(root, e.path));
    snap.files[e.path] = { hash, size: e.size };
  }
  for (const f of await listMetaDir(root, 'chats')) {
    const raw = await readMetaFile(root, `chats/${f}`);
    if (raw !== null) snap.chats[f] = putObject(root, new TextEncoder().encode(raw)).hash;
  }
  mkdirSync(dirOf(root), { recursive: true });
  writeFileSync(join(dirOf(root), `${snap.id}.json`), JSON.stringify(snap));
  if (snap.auto) pruneAuto(root);
  return summary(snap);
}

function pruneAuto(root: string) {
  const autos = listSnapshots(root).filter((s) => s.auto);
  for (const s of autos.slice(MAX_AUTO)) rmSync(join(dirOf(root), `${s.id}.json`), { force: true });
  if (autos.length > MAX_AUTO) gc(root);
}

export function snapshotForChain(root: string, chain: string): SnapshotSummary | null {
  return listSnapshots(root).find((s) => s.chain === chain) || null;
}

/** Differences between a snapshot and the current state. */
export async function diffSnapshot(root: string, id: string) {
  const s = readSnap(root, id);
  const now = new Map((await listTree(root)).filter((e) => e.kind === 'file').map((e) => [e.path, e]));
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [p, f] of Object.entries(s.files)) {
    const cur = now.get(p);
    if (!cur) removed.push(p);
    else if (cur.size !== f.size || hashOf(await readProjectFile(root, p)) !== f.hash) changed.push(p);
  }
  const added = [...now.keys()].filter((p) => !s.files[p] && !s.skipped.includes(p));
  return { changed, added, removed };
}

/**
 * Restores a snapshot: files of the snapshot are written back, files added since go to the
 * trash, chats come back. A safety snapshot of the current state is taken first.
 */
export async function restoreSnapshot(root: string, id: string, opt: { chats?: boolean } = {}): Promise<{ safety: string; written: number; trashed: number; chats: number }> {
  const s = readSnap(root, id);
  for (const [p, f] of Object.entries(s.files)) if (!hasObject(root, f.hash)) throw Object.assign(new Error(`The snapshot is incomplete: ${p} is missing in the store`), { code: 'INVALID' });
  const safety = await createSnapshot(root, `Before restoring "${s.label}"`, { auto: true });
  const d = await diffSnapshot(root, id);
  let written = 0;
  for (const p of [...d.changed, ...d.removed]) {
    await writeProjectFile(root, p, getObject(root, s.files[p]!.hash), 'snapshot');
    written++;
  }
  let trashed = 0;
  for (const p of d.added) {
    try {
      await trashProjectPath(root, p, 'snapshot');
      trashed++;
    } catch {
      /* gone meanwhile */
    }
  }
  let chats = 0;
  if (opt.chats !== false) {
    for (const f of await listMetaDir(root, 'chats')) if (!s.chats[f]) await removeMetaFile(root, `chats/${f}`);
    for (const [f, hash] of Object.entries(s.chats)) {
      if (!hasObject(root, hash)) continue;
      await writeMetaFile(root, `chats/${f}`, new TextDecoder().decode(getObject(root, hash)));
      chats++;
    }
  }
  return { safety: safety.id, written, trashed, chats };
}

export function deleteSnapshot(root: string, id: string): void {
  readSnap(root, id);
  rmSync(join(dirOf(root), `${id}.json`), { force: true });
  gc(root);
}

/** Frees objects no snapshot and no file version uses. */
export function gc(root: string): number {
  const keep = graph.hashes(root);
  if (existsSync(dirOf(root))) {
    for (const f of readdirSync(dirOf(root))) {
      try {
        const s = JSON.parse(readFileSync(join(dirOf(root), f), 'utf8')) as Snapshot;
        for (const x of Object.values(s.files)) keep.add(x.hash);
        for (const h of Object.values(s.chats)) keep.add(h);
      } catch {
        /* broken */
      }
    }
  }
  return gcObjects(root, keep);
}
