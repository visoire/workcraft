// Project manager in the backend: create, switch, rename, delete (trash),
// export and import as ZIP. Every project is a folder under ~/workcraft/projects/.
// Metadata, chat histories and layout live in the project under .workcraft/.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile, mkdir, rm, rename, stat, readdir } from 'node:fs/promises';
import { trashAdd } from './trash.js';
import { graph } from './graph.js';
import { join, dirname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { zipSync, unzipSync, type Zippable } from 'fflate';
import { PROJECTS_DIR, META_DIR, resolveIn, toProjectPath, normProjectPath, pathKey, safeZipEntry } from './paths.js';
import { config, updateConfig } from './config.js';
import { broadcast } from './events.js';

export interface ProjectMeta {
  id: string;
  name: string;
  created: string;
  updated: string;
}

export interface FileEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
}

const IGNORE = new Set([META_DIR, '.git', 'node_modules', '.DS_Store', 'Thumbs.db']);
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

export class ProjectError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID' | 'EXISTS' | 'IMPORT',
    message: string
  ) {
    super(message);
  }
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'project';

const rootOf = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new ProjectError('INVALID', 'Invalid project ID');
  return join(PROJECTS_DIR, id);
};

function readMeta(id: string): ProjectMeta | null {
  const f = join(rootOf(id), META_DIR, 'project.json');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as ProjectMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: ProjectMeta): void {
  const dir = join(rootOf(meta.id), META_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify(meta, null, 2));
}

export function listProjects(): ProjectMeta[] {
  return readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readMeta(d.name))
    .filter((m): m is ProjectMeta => !!m)
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export function getProject(id: string): { meta: ProjectMeta; root: string } {
  const meta = readMeta(id);
  if (!meta) throw new ProjectError('NOT_FOUND', `Project ${id} not found`);
  return { meta, root: rootOf(id) };
}

let seedFn: ((root: string) => Promise<void>) | null = null;
export function setSeed(fn: (root: string) => Promise<void>): void {
  seedFn = fn;
}

export async function createProject(name: string, template: 'sample' | 'empty' = 'empty'): Promise<ProjectMeta> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new ProjectError('INVALID', 'The project name is missing');
  const id = `${slug(clean)}-${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const meta: ProjectMeta = { id, name: clean, created: now, updated: now };
  mkdirSync(rootOf(id), { recursive: true });
  writeMeta(meta);
  if (template === 'sample' && seedFn) await seedFn(rootOf(id));
  broadcast({ t: 'project', kind: 'changed', id });
  return meta;
}

export function renameProject(id: string, name: string): ProjectMeta {
  const { meta } = getProject(id);
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new ProjectError('INVALID', 'The project name is missing');
  const next = { ...meta, name: clean, updated: new Date().toISOString() };
  writeMeta(next);
  broadcast({ t: 'project', kind: 'changed', id });
  return next;
}

/** Moves the project into the trash (~/workcraft/.trash, restorable for 30 days). */
export async function deleteProject(id: string): Promise<{ trash: string; entry: string }> {
  const { meta } = getProject(id);
  if (active?.id === id) {
    stopWatch();
    active = null;
  }
  const entry = await trashAdd({ kind: 'project', source: rootOf(id), name: meta.name, projectId: id, projectName: meta.name });
  if (config().activeProject === id) updateConfig((c) => void (c.activeProject = null));
  broadcast({ t: 'project', kind: 'deleted', id });
  return { trash: entry.location, entry: entry.id };
}

/** Folder of a project without checking the metadata (trash and wipe). */
export const projectRoot = (id: string) => rootOf(id);

/** Stops the file watcher of a project before its folder moves (trash, wipe). */
export function releaseProject(id: string): void {
  if (active?.id === id) {
    stopWatch();
    active = null;
  }
}

/** Writes metadata of a restored project (new ID when the old one is taken). */
export function adoptProject(id: string, name: string): ProjectMeta {
  const now = new Date().toISOString();
  const old = readMeta(id);
  const meta: ProjectMeta = { id, name: old?.name || name, created: old?.created || now, updated: now };
  writeMeta(meta);
  broadcast({ t: 'project', kind: 'changed', id });
  return meta;
}

// ---------------------------------------------------------------- Active project and file watcher

let active: { id: string; root: string } | null = null;
let watcher: FSWatcher | null = null;
const recentWrites = new Map<string, { origin: string; until: number }>();
const pending = new Map<string, NodeJS.Timeout>();

function stopWatch() {
  watcher?.close();
  watcher = null;
}

function startWatch(id: string, root: string) {
  stopWatch();
  try {
    watcher = watch(root, { recursive: true }, (_ev, file) => {
      // Windows returns backslashes and sometimes no file name
      if (!file) return;
      const rel = String(file).split(sep).join('/').replace(/\\/g, '/');
      if (rel.split('/').some((s) => IGNORE.has(s))) return;
      const path = '/' + rel;
      clearTimeout(pending.get(path));
      pending.set(
        path,
        setTimeout(() => {
          pending.delete(path);
          const w = recentWrites.get(pathKey(path));
          const origin = w && w.until > Date.now() ? w.origin : 'disk';
          const kind = existsSync(join(root, rel)) ? 'change' : 'delete';
          broadcast({ t: 'fs', project: id, path, kind, origin });
        }, 120)
      );
    });
    // On Windows the watcher reports an error when the folder is moved or deleted.
    // Without this handler the backend would crash.
    watcher.on('error', (e) => {
      console.warn('File watcher stopped:', (e as Error).message);
      stopWatch();
    });
  } catch (e) {
    console.warn('File watcher not available:', (e as Error).message);
  }
}

export { moveDir } from './fsutil.js';

/** Name of the bundled sample project ("Load sample data" opens or creates it). */
export const SAMPLE_NAME = 'Sample project';

/**
 * The project a new installation starts with: an empty "My project" of the user's own, so nobody
 * works on shared demo files. WORKCRAFT_FIRST_PROJECT=sample starts with the sample project instead
 * (test stacks and demo machines).
 */
export async function firstProject(): Promise<ProjectMeta> {
  return process.env.WORKCRAFT_FIRST_PROJECT === 'sample' ? createProject(SAMPLE_NAME, 'sample') : createProject('My project', 'empty');
}

/** Opens the sample project, creating it from the template the first time. The user's projects stay as they are. */
export async function openSample(): Promise<{ meta: ProjectMeta; created: boolean }> {
  const existing = listProjects().find((p) => p.name === SAMPLE_NAME);
  const meta = existing || (await createProject(SAMPLE_NAME, 'sample'));
  await switchProject(meta.id);
  return { meta, created: !existing };
}

export async function activeProject(): Promise<{ meta: ProjectMeta; root: string }> {
  const want = config().activeProject;
  if (active && active.id === want && existsSync(active.root)) return getProject(active.id);
  let meta = want ? readMeta(want) : null;
  if (!meta) meta = listProjects()[0] || (await firstProject());
  if (config().activeProject !== meta.id) updateConfig((c) => void (c.activeProject = meta!.id));
  active = { id: meta.id, root: rootOf(meta.id) };
  startWatch(meta.id, active.root);
  return { meta, root: active.root };
}

export async function switchProject(id: string): Promise<ProjectMeta> {
  const { meta } = getProject(id);
  updateConfig((c) => void (c.activeProject = id));
  active = null;
  await activeProject();
  broadcast({ t: 'project', kind: 'switched', id });
  return meta;
}

// ---------------------------------------------------------------- Files

export async function listTree(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const walk = async (dir: string) => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (IGNORE.has(d.name)) continue;
      const abs = join(dir, d.name);
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      const path = toProjectPath(root, abs);
      if (d.isDirectory()) {
        out.push({ path, kind: 'dir', size: 0, mtime: st.mtimeMs });
        await walk(abs);
      } else if (d.isFile()) out.push({ path, kind: 'file', size: st.size, mtime: st.mtimeMs });
    }
  };
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path, 'de'));
}

export async function readProjectFile(root: string, path: string): Promise<Uint8Array> {
  const abs = resolveIn(root, path);
  const st = await stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new ProjectError('NOT_FOUND', `File not found: ${path}`);
  return new Uint8Array(await readFile(abs));
}

export function existsInProject(root: string, path: string): boolean {
  try {
    return existsSync(resolveIn(root, path));
  } catch {
    return false;
  }
}

/** Writes a file and remembers the origin for the change event (live sync). */
export async function writeProjectFile(root: string, path: string, data: Uint8Array | string, origin = 'api'): Promise<string> {
  const p = normProjectPath(path);
  if (p === '/' || p.split('/').some((s) => IGNORE.has(s))) throw new ProjectError('INVALID', `Path not allowed: ${path}`);
  const abs = resolveIn(root, p);
  await mkdir(dirname(abs), { recursive: true });
  recentWrites.set(pathKey(p), { origin, until: Date.now() + 2500 });
  await writeFile(abs, data);
  touch();
  graph.recordWrite(root, p, typeof data === 'string' ? new TextEncoder().encode(data) : data, origin);
  return p;
}

/** Moves a file or folder of the project into the trash (restorable for 30 days). */
export async function trashProjectPath(root: string, path: string, origin = 'api'): Promise<string> {
  const p = normProjectPath(path);
  if (p === '/') throw new ProjectError('INVALID', 'The project itself cannot be deleted here');
  const abs = resolveIn(root, p);
  if (!existsSync(abs)) throw new ProjectError('NOT_FOUND', `Not found: ${p}`);
  const id = root.split(/[\\/]/).filter(Boolean).pop()!;
  const meta = readMeta(id);
  recentWrites.set(pathKey(p), { origin, until: Date.now() + 2500 });
  const entry = await trashAdd({ kind: 'file', source: abs, name: p.split('/').pop() || p, projectId: id, projectName: meta?.name || id, path: p });
  graph.recordDelete(root, p);
  touch();
  return entry.id;
}

export async function mkdirProject(root: string, path: string): Promise<void> {
  await mkdir(resolveIn(root, path), { recursive: true });
}

export async function removeProjectPath(root: string, path: string, origin = 'api'): Promise<void> {
  const p = normProjectPath(path);
  if (p === '/') throw new ProjectError('INVALID', 'The project itself cannot be deleted here');
  recentWrites.set(pathKey(p), { origin, until: Date.now() + 2500 });
  await rm(resolveIn(root, p), { recursive: true, force: true });
  touch();
}

export async function renameProjectPath(root: string, from: string, to: string): Promise<string> {
  const a = resolveIn(root, from);
  const b = resolveIn(root, to);
  // Only the letter case changed: on Windows and macOS the target seems to exist already
  const caseOnly = a !== b && pathKey(a, true) === pathKey(b, true);
  if (existsSync(b) && !caseOnly) throw new ProjectError('EXISTS', `${to} already exists`);
  await mkdir(dirname(b), { recursive: true });
  await rename(a, b);
  touch();
  graph.recordRename(root, normProjectPath(from), normProjectPath(to));
  return normProjectPath(to);
}

function touch() {
  if (!active) return;
  const meta = readMeta(active.id);
  if (meta) writeMeta({ ...meta, updated: new Date().toISOString() });
}

// ---------------------------------------------------------------- Metadaten (Chats, Layout)

export async function readMetaFile(root: string, name: string): Promise<string | null> {
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(name)) throw new ProjectError('INVALID', 'Invalid name');
  try {
    return await readFile(join(root, META_DIR, name), 'utf8');
  } catch {
    return null;
  }
}

export async function writeMetaFile(root: string, name: string, content: string): Promise<void> {
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(name)) throw new ProjectError('INVALID', 'Invalid name');
  const abs = join(root, META_DIR, name);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

export async function listMetaDir(root: string, dir: string): Promise<string[]> {
  try {
    return (await readdir(join(root, META_DIR, dir))).sort();
  } catch {
    return [];
  }
}

export async function removeMetaFile(root: string, name: string): Promise<void> {
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(name)) throw new ProjectError('INVALID', 'Invalid name');
  await rm(join(root, META_DIR, name), { force: true });
}

// ---------------------------------------------------------------- ZIP

export async function exportProject(id: string): Promise<{ name: string; bytes: Uint8Array }> {
  const { meta, root } = getProject(id);
  const files: Zippable = {};
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'node_modules' || d.name === '.git') continue;
      const abs = join(dir, d.name);
      // Version store, search index and snapshots stay on this computer (they can be large)
      const rel = toProjectPath(root, abs);
      if (rel === `/${META_DIR}/objects` || rel === `/${META_DIR}/index.json` || rel === `/${META_DIR}/snapshots` || rel === `/${META_DIR}/graph.json`) continue;
      if (d.isDirectory()) walk(abs);
      else if (d.isFile()) files[toProjectPath(root, abs).slice(1)] = [new Uint8Array(readFileSync(abs)), { mtime: statSync(abs).mtime }];
    }
  };
  walk(root);
  return { name: `${slug(meta.name)}.zip`, bytes: zipSync(files, { level: 6 }) };
}

export async function importProject(bytes: Uint8Array, nameHint?: string): Promise<ProjectMeta> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ProjectError('IMPORT', 'The file is not a valid ZIP archive');
  }
  // Normalize entries (Windows packers write backslashes) and check before creating
  const normalized: Record<string, Uint8Array> = {};
  for (const [raw, data] of Object.entries(entries)) {
    if (raw.endsWith('/') || raw.endsWith('\\')) continue;
    const rel = safeZipEntry(raw);
    if (!rel) throw new ProjectError('IMPORT', `Unsafe path in the archive: ${raw}. The import was stopped.`);
    if (rel.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(rel)) continue;
    normalized[rel] = data;
  }
  entries = normalized;
  const names = Object.keys(entries);
  if (!names.length) throw new ProjectError('IMPORT', 'The archive is empty');
  const total = names.reduce((s, n) => s + entries[n]!.byteLength, 0);
  if (total > MAX_IMPORT_BYTES) throw new ProjectError('IMPORT', 'The archive is larger than 1 GB');
  // gemeinsamen Wurzelordner entfernen
  const first = names[0]!.split('/')[0];
  const strip = names.every((n) => n.includes('/') && n.split('/')[0] === first) ? first + '/' : '';
  let name = nameHint?.replace(/\.zip$/i, '') || 'Imported project';
  const metaEntry = entries[`${strip}${META_DIR}/project.json`];
  if (metaEntry) {
    try {
      name = (JSON.parse(new TextDecoder().decode(metaEntry)) as ProjectMeta).name || name;
    } catch {
      /* name from the file name */
    }
  }
  const meta = await createProject(name, 'empty');
  const root = rootOf(meta.id);
  for (const n of names) {
    const rel = n.slice(strip.length);
    if (!rel || rel === `${META_DIR}/project.json`) continue;
    const abs = resolveIn(root, '/' + rel); // throws for paths outside the project
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, entries[n]!);
  }
  broadcast({ t: 'project', kind: 'changed', id: meta.id });
  return meta;
}
