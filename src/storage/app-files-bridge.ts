// `globalThis.playgroundFiles` for an engine panel: the browser file storage API that independent-app style builds of the
// Craft apps call for Open, Save As, AutoSave and "Open in app" (their shell and its design spec
// docs/superpowers/specs/2026-10-09-browser-files-design.md; see SOURCES.md). The contract (names, arguments, result shapes)
// is followed so that its patches work unchanged. the upstream collection is open source and free to use; this implementation is written independently around WorkCraft projects.
//
// WorkCraft does not add a second store next to its project files. The bridge maps the contract onto the project:
//   browser:/documents/a.docx  <->  /documents/a.docx
// so a build that saves with playgroundFiles.write() saves into the project, shows up in the tree, is searchable by
// the AI and syncs like any other file. An engine that never looks for playgroundFiles keeps working through the
// download and file picker capture in panels/craftapp.ts; nothing is required of an engine.
//
// Contract (the same names and result shapes as the independent apps, so a new release of its patches needs no change here):
//   open({ types })                 -> [{ path, name, bytes }] | null      path is an app path, or null for "From computer"
//   saveAs({ name, types, bytes? }) -> { path } | { download: true } | null
//   write(path, bytes)              queued per path, applied in order; resolves when stored
//   read(path)                      -> Uint8Array
//   files(folder)                   -> [app path] of every file at or below a folder
//   remove(path)                    removes a file (missing is fine)
//   download(name, bytes)           a plain browser download
//   setUnsaved(flag)                the app's own unsaved state
//   onOpen(cb)                      cb({ path, name, bytes }) for a file the workspace hands to this app
//
// The host (craftapp.ts) supplies the project access and the dialogs; this module is pure logic so it is tested
// without a browser (tests/server/ecosystems.test.ts).

import { baseName, fromAppPath, matchesTypes, normalize, toAppPath, withType } from './paths.js';

export interface BridgeFile {
  path: string | null;
  name: string;
  bytes: Uint8Array;
}

export interface BridgeHost {
  /** Paths of all files in the project */
  files(): string[];
  exists(path: string): boolean;
  read(path: string): Promise<ArrayBuffer | Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  /** The Open dialog of the workspace: a project path, a file from the device, or null for cancel */
  pick(opts: { types: string[] }): Promise<{ path: string } | { file: { name: string; bytes: Uint8Array } } | null>;
  /** Save As: where to keep the file. A project path, or "download", or null for cancel */
  ask(opts: { name: string; types: string[] }): Promise<{ path: string } | { download: true } | null>;
  download(name: string, bytes: Uint8Array): void;
  /** The engine's own unsaved state (the panel shows it and asks before it closes) */
  unsaved(flag: boolean): void;
  /** A write failed (quota, backend): the host tells the user and can offer a download instead */
  failed(path: string, error: Error, bytes: Uint8Array): void;
}

export interface AppFiles {
  open(opts?: { types?: string[] }): Promise<BridgeFile[] | null>;
  saveAs(opts?: { name?: string; types?: string[]; bytes?: Uint8Array }): Promise<{ path: string } | { download: true } | null>;
  write(path: string, bytes: Uint8Array | ArrayBuffer): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  files(folder?: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  download(name: string, bytes: Uint8Array | ArrayBuffer): void;
  setUnsaved(flag: boolean): void;
  onOpen(cb: (file: BridgeFile) => void): void;
}

export interface Bridge {
  api: AppFiles;
  /** Hand a project file to the engine through its onOpen callback. False when the engine never registered one. */
  deliver(path: string): Promise<boolean>;
  /** Writes still in flight (the panel waits for them before it unloads) */
  pending(): number;
  hasHandler(): boolean;
}

const bytesOf = (d: ArrayBuffer | Uint8Array): Uint8Array => (d instanceof Uint8Array ? d : new Uint8Array(d));

export function createBridge(host: BridgeHost): Bridge {
  let handler: ((f: BridgeFile) => void) | null = null;
  let inflight = 0;
  const queues = new Map<string, Promise<void>>();

  const projectPath = (p: string): string => {
    const own = fromAppPath(p);
    if (own) return own;
    if (typeof p !== 'string' || !p) throw new Error('playgroundFiles: a path is required');
    // A plain path is taken as a project path (an engine that dropped the scheme)
    return normalize(p);
  };

  const fileAt = async (path: string): Promise<BridgeFile> => ({ path: toAppPath(path), name: baseName(path), bytes: bytesOf(await host.read(path)) });

  const api: AppFiles = {
    async open({ types = [] } = {}) {
      const got = await host.pick({ types });
      if (!got) return null;
      if ('file' in got) return [{ path: null, name: got.file.name, bytes: got.file.bytes }];
      return [await fileAt(got.path)];
    },

    async saveAs({ name = 'Untitled', types = [], bytes } = {}) {
      const answer = await host.ask({ name: withType(name, types), types });
      if (!answer) return null;
      if ('download' in answer) {
        // Like the independent apps: given the bytes, the shell downloads them itself; without, the engine downloads
        if (bytes) host.download(withType(name, types), bytes);
        return { download: true };
      }
      const path = normalize(answer.path);
      if (types.length && !matchesTypes(path, types)) return { path: toAppPath(withType(path, types)) };
      return { path: toAppPath(path) };
    },

    write(path, data) {
      const p = projectPath(path);
      const bytes = bytesOf(data);
      inflight++;
      // One queue per path: writes land in the order the engine made them (its write hooks cannot wait)
      const task = (queues.get(p) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => host.write(p, bytes))
        .catch((e: unknown) => {
          host.failed(p, e instanceof Error ? e : new Error(String(e)), bytes);
          throw e;
        })
        .finally(() => {
          inflight--;
          if (queues.get(p) === task) queues.delete(p);
        });
      queues.set(p, task);
      return task;
    },

    async read(path) {
      const p = projectPath(path);
      // A read after a write sees the write
      await queues.get(p)?.catch(() => undefined);
      return bytesOf(await host.read(p));
    },

    async files(folder = '/') {
      const base = fromAppPath(folder) ?? normalize(folder);
      const under = base === '/' ? '/' : base + '/';
      return host
        .files()
        .filter((f) => f.startsWith(under))
        .map(toAppPath);
    },

    async remove(path) {
      const p = projectPath(path);
      await queues.get(p)?.catch(() => undefined);
      if (host.exists(p)) await host.remove(p);
    },

    download(name, data) {
      host.download(name, bytesOf(data));
    },

    setUnsaved(flag) {
      host.unsaved(!!flag);
    },

    onOpen(cb) {
      handler = typeof cb === 'function' ? cb : null;
    },
  };

  return {
    api,
    async deliver(path) {
      if (!handler) return false;
      handler(await fileAt(normalize(path)));
      return true;
    },
    pending: () => inflight,
    hasHandler: () => handler !== null,
  };
}
