// Trash: deleted projects and files stay in ~/workcraft/.trash for 30 days and can be restored.
// index.json lists the entries. Folders of earlier versions (<id>-<time>, without an index entry)
// show up as projects too.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PROJECTS_DIR, TRASH_DIR } from './paths.js';
import { moveDir, sizeOf, secureRemove } from './fsutil.js';
import { broadcast } from './events.js';

export const TRASH_DAYS = 30;
const INDEX = join(TRASH_DIR, 'index.json');

export interface TrashEntry {
  id: string;
  kind: 'project' | 'file';
  name: string;
  projectId: string;
  projectName: string;
  /** original path inside the project (files) */
  path?: string;
  deleted: string;
  size: number;
  /** folder in the trash */
  location: string;
  /** a folder was deleted (kind file) */
  dir?: boolean;
}

function readIndex(): TrashEntry[] {
  try {
    return existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, 'utf8')) as TrashEntry[]) : [];
  } catch {
    return [];
  }
}
function writeIndex(list: TrashEntry[]) {
  mkdirSync(TRASH_DIR, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(list, null, 2));
}

export async function trashAdd(e: { kind: 'project' | 'file'; source: string; name: string; projectId: string; projectName: string; path?: string }): Promise<TrashEntry> {
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const location = join(TRASH_DIR, id);
  mkdirSync(location, { recursive: true });
  const dir = statSync(e.source).isDirectory();
  const size = sizeOf(e.source);
  await moveDir(e.source, join(location, 'payload'));
  const entry: TrashEntry = { id, kind: e.kind, name: e.name, projectId: e.projectId, projectName: e.projectName, path: e.path, deleted: new Date().toISOString(), size, location, ...(e.kind === 'file' ? { dir } : {}) };
  writeIndex([entry, ...readIndex()]);
  return entry;
}

/** All entries, newest first, including project folders of earlier versions. */
export function trashList(): (TrashEntry & { expires: string })[] {
  const list = readIndex();
  const known = new Set(list.map((e) => e.location));
  for (const d of readdirSync(TRASH_DIR, { withFileTypes: true })) {
    const m = d.isDirectory() && d.name.match(/^([a-z0-9-]+)-(\d{13})$/);
    if (!m || known.has(join(TRASH_DIR, d.name))) continue;
    const loc = join(TRASH_DIR, d.name);
    let name = m[1]!;
    try {
      name = (JSON.parse(readFileSync(join(loc, '.workcraft', 'project.json'), 'utf8')) as { name: string }).name || name;
    } catch {
      /* no metadata */
    }
    list.push({ id: `legacy-${d.name}`, kind: 'project', name, projectId: m[1]!, projectName: name, deleted: new Date(Number(m[2])).toISOString(), size: sizeOf(loc), location: loc });
  }
  return list
    .filter((e) => existsSync(e.location))
    .sort((a, b) => b.deleted.localeCompare(a.deleted))
    .map((e) => ({ ...e, expires: new Date(Date.parse(e.deleted) + TRASH_DAYS * 86400_000).toISOString() }));
}

const payloadOf = (e: TrashEntry) => (e.id.startsWith('legacy-') ? e.location : join(e.location, 'payload'));

function findEntry(id: string): TrashEntry {
  const e = trashList().find((x) => x.id === id);
  if (!e) throw Object.assign(new Error('Not in the trash (already restored or deleted)'), { code: 'NOT_FOUND' });
  return e;
}

/** Free name next to an existing path: report.docx -> report (restored).docx, report (restored 2).docx */
function freeName(abs: string): string {
  if (!existsSync(abs)) return abs;
  const ext = extname(abs);
  const base = abs.slice(0, abs.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const c = `${base} (restored${i > 1 ? ' ' + i : ''})${ext}`;
    if (!existsSync(c)) return c;
  }
  return `${base}-${Date.now()}${ext}`;
}

export interface RestoreResult {
  kind: 'project' | 'file';
  projectId: string;
  path?: string;
}

/**
 * Restores an entry. Projects come back under their old ID (or a new one when it is taken).
 * Files go back to their old path in their project, next to it when the path is taken.
 */
export async function trashRestore(id: string, hooks: { adopt(id: string, name: string): void; rootOf(id: string): string; exists(id: string): boolean }): Promise<RestoreResult> {
  const e = findEntry(id);
  const src = payloadOf(e);
  if (e.kind === 'project') {
    let pid = e.projectId;
    if (existsSync(join(PROJECTS_DIR, pid))) pid = `${pid.replace(/-r[0-9a-f]{4}$/, '')}-r${randomBytes(2).toString('hex')}`;
    await moveDir(src, join(PROJECTS_DIR, pid));
    hooks.adopt(pid, e.projectName);
    drop(e);
    return { kind: 'project', projectId: pid };
  }
  if (!hooks.exists(e.projectId)) throw Object.assign(new Error(`The project "${e.projectName}" no longer exists. Restore the project first.`), { code: 'NOT_FOUND' });
  const root = hooks.rootOf(e.projectId);
  const target = freeName(join(root, ...e.path!.split('/').filter(Boolean)));
  mkdirSync(dirname(target), { recursive: true });
  await moveDir(src, target);
  drop(e);
  const path = '/' + target.slice(root.length + 1).split(/[\\/]/).join('/');
  broadcast({ t: 'fs', project: e.projectId, path, kind: 'change', origin: 'trash' });
  return { kind: 'file', projectId: e.projectId, path };
}

function drop(e: TrashEntry) {
  writeIndex(readIndex().filter((x) => x.id !== e.id));
  if (!e.id.startsWith('legacy-')) {
    try {
      secureRemove(e.location);
    } catch {
      /* already empty */
    }
  }
}

/** Deletes an entry for good (the data is overwritten first). */
export function trashPurge(id: string): void {
  const e = findEntry(id);
  secureRemove(e.location);
  writeIndex(readIndex().filter((x) => x.id !== e.id));
}

export function trashEmpty(): number {
  const list = trashList();
  for (const e of list) secureRemove(e.location);
  writeIndex([]);
  return list.length;
}

/** Removes entries older than 30 days (on start and every six hours). */
export function trashAutoPurge(now = Date.now()): number {
  let n = 0;
  for (const e of trashList()) {
    if (now - Date.parse(e.deleted) < TRASH_DAYS * 86400_000) continue;
    try {
      secureRemove(e.location);
      n++;
    } catch {
      /* next time */
    }
  }
  if (n) writeIndex(readIndex().filter((x) => existsSync(x.location)));
  return n;
}
