// Worker of the OPFS blob store (src/ipados/opfs.ts).
//
// Safari offers the synchronous Origin Private File System handle (createSyncAccessHandle) only in a
// dedicated worker; on the main thread or in an iframe it throws. Reading and writing a 50 MB file
// through it is a block copy without garbage collection pressure, which is why large files live here
// and not in IndexedDB.
//
// Protocol (all replies carry the BlobRequest id):
//   { id, op: 'ping' }                      -> { id, ok: true, sync: boolean }
//   { id, op: 'put', key, data }            -> { id, ok: true }
//   { id, op: 'get', key }                  -> { id, ok: true, data: ArrayBuffer | null }  (transferred)
//   { id, op: 'delete', key }               -> { id, ok: true }
//   { id, op: 'clear' }                     -> { id, ok: true }
//   { id, op: 'keys' }                      -> { id, ok: true, keys: string[] }
// A handle is closed after every operation (Safari allows one open handle per file), and operations run
// one after the other.

interface SyncHandle {
  getSize(): number;
  read(buffer: ArrayBufferView, opts?: { at: number }): number;
  write(buffer: ArrayBufferView, opts?: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
export {};

type FileHandle = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncHandle> };
type DirHandle = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };

type BlobRequest =
  | { id: number; op: 'ping' }
  | { id: number; op: 'put'; key: string; data: ArrayBuffer }
  | { id: number; op: 'get'; key: string }
  | { id: number; op: 'delete'; key: string }
  | { id: number; op: 'clear' }
  | { id: number; op: 'keys' };

const DIR = 'workcraft-blobs';
let dirp: Promise<DirHandle> | null = null;
const dir = (): Promise<DirHandle> => (dirp ||= navigator.storage.getDirectory().then((r) => r.getDirectoryHandle(DIR, { create: true }) as Promise<DirHandle>));

/** Keys are ids made by the store (letters, digits, dash), so they are safe file names as they are. */
const safe = (key: string): string => {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(key)) throw new Error('Invalid blob key');
  return key;
};

async function put(key: string, data: ArrayBuffer): Promise<void> {
  const fh = (await (await dir()).getFileHandle(safe(key), { create: true })) as FileHandle;
  if (!fh.createSyncAccessHandle) throw new Error('createSyncAccessHandle is not available');
  const h = await fh.createSyncAccessHandle();
  try {
    h.truncate(0);
    const view = new Uint8Array(data);
    let at = 0;
    while (at < view.byteLength) {
      const n = h.write(view.subarray(at), { at });
      if (n <= 0) throw new Error('Short write');
      at += n;
    }
    h.flush();
  } finally {
    h.close();
  }
}

async function get(key: string): Promise<ArrayBuffer | null> {
  let fh: FileHandle;
  try {
    fh = (await (await dir()).getFileHandle(safe(key))) as FileHandle;
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') return null;
    throw e;
  }
  if (!fh.createSyncAccessHandle) throw new Error('createSyncAccessHandle is not available');
  const h = await fh.createSyncAccessHandle();
  try {
    const size = h.getSize();
    const out = new Uint8Array(size);
    let at = 0;
    while (at < size) {
      const n = h.read(out.subarray(at), { at });
      if (n <= 0) throw new Error('Short read');
      at += n;
    }
    return out.buffer;
  } finally {
    h.close();
  }
}

async function remove(key: string): Promise<void> {
  try {
    await (await dir()).removeEntry(safe(key));
  } catch (e) {
    if ((e as DOMException).name !== 'NotFoundError') throw e;
  }
}

let queue: Promise<unknown> = Promise.resolve();
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.addEventListener('message', (ev: MessageEvent<BlobRequest>) => {
  const req = ev.data;
  queue = queue.then(async () => {
    try {
      switch (req.op) {
        case 'ping': {
          await dir();
          const fh = (await (await dir()).getFileHandle('.probe', { create: true })) as FileHandle;
          post({ id: req.id, ok: true, sync: typeof fh.createSyncAccessHandle === 'function' });
          break;
        }
        case 'put':
          await put(req.key, req.data);
          post({ id: req.id, ok: true });
          break;
        case 'get': {
          const data = await get(req.key);
          post({ id: req.id, ok: true, data }, data ? [data] : []);
          break;
        }
        case 'delete':
          await remove(req.key);
          post({ id: req.id, ok: true });
          break;
        case 'clear': {
          const d = await dir();
          for await (const [name] of d.entries()) await d.removeEntry(name);
          post({ id: req.id, ok: true });
          break;
        }
        case 'keys': {
          const d = await dir();
          const keys: string[] = [];
          for await (const [name] of d.entries()) if (!name.startsWith('.')) keys.push(name);
          post({ id: req.id, ok: true, keys });
          break;
        }
      }
    } catch (e) {
      post({ id: req.id, ok: false, error: (e as Error).message || String(e) });
    }
  });
});

