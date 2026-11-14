// Recent files: a short list of the files you opened last, to reopen them in one tap (launcher, command palette,
// the AI tool recent-files). Like the project tree it only knows paths; the bytes stay in the project, so a recent
// entry is never a second copy and works the same with the desktop backend and in browser mode (iPad).
//
// Storage: localStorage key `workcraft.recent` (per browser). One list for all projects, each entry names its
// project, so switching projects does not lose the others. The pure functions below take and return plain data
// (tests/server/ecosystems.test.ts); the IO functions at the end read and write the key.
//
// Idea: the upstream collection keeps the last documents so a previous file launches quickly, and the browser editor
// `document` reopens recent work from the browser (see SOURCES.md). Written fresh here around WorkCraft's projects.

export interface RecentEntry {
  /** Project path, for example /documents/budget.xlsx */
  path: string;
  /** Tool the file was opened in (an app id or 'code') */
  tool: string;
  /** Project id, so another project's files are not offered in this one */
  project: string;
  /** Milliseconds since 1970 */
  at: number;
}

export const RECENT_MAX = 40;

/** Puts an opened file first. The same path + tool + project moves up instead of repeating, and the list stays short. */
export function pushRecent(list: readonly RecentEntry[], e: RecentEntry, max = RECENT_MAX): RecentEntry[] {
  const rest = list.filter((x) => !(x.path === e.path && x.tool === e.tool && x.project === e.project));
  return [e, ...rest].slice(0, max);
}

/** The entries of one project, newest first, without files that no longer exist. */
export function recentFor(list: readonly RecentEntry[], project: string, exists: (path: string) => boolean, limit = 12): RecentEntry[] {
  const seen = new Set<string>();
  const out: RecentEntry[] = [];
  for (const e of [...list].sort((a, b) => b.at - a.at)) {
    if (e.project !== project || !exists(e.path)) continue;
    const key = e.path + '\n' + e.tool;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** A path was renamed or moved: the entries follow it. */
export function renameRecent(list: readonly RecentEntry[], project: string, from: string, to: string): RecentEntry[] {
  return list.map((e) => (e.project === project && (e.path === from || e.path.startsWith(from + '/')) ? { ...e, path: to + e.path.slice(from.length) } : e));
}

/** Damaged or foreign data in the storage key becomes an empty list instead of an error. */
export function sanitizeRecent(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is RecentEntry => !!e && typeof e === 'object' && typeof (e as RecentEntry).path === 'string' && typeof (e as RecentEntry).tool === 'string' && typeof (e as RecentEntry).project === 'string' && Number.isFinite((e as RecentEntry).at))
    .slice(0, RECENT_MAX * 4);
}

// ---------------------------------------------------------------- storage

const KEY = 'workcraft.recent';

export function loadRecent(): RecentEntry[] {
  try {
    return sanitizeRecent(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return [];
  }
}

export function saveRecent(list: readonly RecentEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked or full: Recent files is a convenience, not data */
  }
}

/** Remembers that a file was opened. Called from the workspace when a panel gets a path. */
export function noteOpened(path: string, tool: string, project: string, now = Date.now()): void {
  if (!path || !project) return;
  saveRecent(pushRecent(loadRecent(), { path, tool, project, at: now }));
}

export function clearRecent(project?: string): void {
  saveRecent(project ? loadRecent().filter((e) => e.project !== project) : []);
}
