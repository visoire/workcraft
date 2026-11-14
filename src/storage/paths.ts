// Path helpers for the shared file model. App paths and project paths are the same files:
//   project path   /documents/budget.xlsx          what WorkCraft, the tree and the AI use
//   app path       browser:/documents/budget.xlsx  what an independent-app style engine build passes to
//                                                  playgroundFiles.write / read (see app-files-bridge.ts)
// so a build patched for the independent apps' browser storage saves into the project without a change.
//
// The `browser:` scheme and the behavior of these helpers follow the independent apps' browser-files design (see SOURCES.md),
// which is what its patches expect. the upstream collection is open source and free to use (maintainer); the code here is still written
// independently around WorkCraft's projects, and its upstream licence file is to be named in SOURCES.md once confirmed.

export const SCHEME = 'browser:';

/** '/a//b/./c/' to '/a/b/c'. '..' segments are dropped: there is nothing above the project root. */
export function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of String(path).split(/[\\/]/)) if (seg !== '' && seg !== '.' && seg !== '..') parts.push(seg);
  return '/' + parts.join('/');
}

export const toAppPath = (path: string): string => SCHEME + normalize(path);

/** The project path inside an app path, or null for anything that is not one. */
export function fromAppPath(appPath: unknown): string | null {
  if (typeof appPath !== 'string' || !appPath.startsWith(SCHEME)) return null;
  return normalize(appPath.slice(SCHEME.length));
}

export const baseName = (path: string): string => normalize(path).split('/').pop() || '';
export function parentOf(path: string): string {
  const parts = normalize(path).split('/');
  parts.pop();
  return normalize(parts.join('/'));
}
export const join = (dir: string, name: string): string => normalize(dir + '/' + name);

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** A name a user may give a file: not blank, no separators or characters other systems reject. */
export function validName(name: string): boolean {
  const n = name.trim();
  if (n === '' || n === '.' || n === '..') return false;
  return !/[\\/:*?"<>|\u0000-\u001f]/.test(n);
}

export const matchesTypes = (name: string, types?: readonly string[]): boolean => !types || types.length === 0 || types.includes(extOf(name));

/** `name` with the first of `types` added when it has none of them: 'Budget' becomes 'Budget.xlsx'. */
export function withType(name: string, types?: readonly string[]): string {
  if (!types || types.length === 0 || types.includes(extOf(name))) return name;
  return `${name}.${types[0]}`;
}

/** 'Report.docx' when free, else 'Report (2).docx', 'Report (3).docx', and so on. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const ext = extOf(name);
  const stem = ext ? name.slice(0, name.length - ext.length - 1) : name;
  let n = 2;
  while (taken.has(ext ? `${stem} (${n}).${ext}` : `${stem} (${n})`)) n++;
  return ext ? `${stem} (${n}).${ext}` : `${stem} (${n})`;
}