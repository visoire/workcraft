// Blob store of browser mode on the Origin Private File System (OPFS), used through a worker.
//
// Browser mode (iPad without a desktop) keeps projects in IndexedDB (src/app/offline.ts). Large
// files go here instead: IndexedDB would copy a 50 MB value whole on every save. IndexedDB keeps the
// metadata and, for a large file, only a blob id. Every write gets a NEW blob id and the old blob is
// deleted after the record points at the new one, so a crash in between never leaves a broken file.
//
// Without OPFS (plain HTTP on the home network, private browsing, an old iPadOS) available() is false
// and offline.ts keeps everything in IndexedDB as before. The store never throws away data: a failed
// OPFS write falls back to IndexedDB for that file.

/** Files from this size on go to OPFS. Smaller ones stay in IndexedDB (fewer worker round trips). */
export const OFFLOAD_MIN_BYTES = 128 * 1024;

export const shouldOffload = (bytes: number, opfsAvailable: boolean): boolean => opfsAvailable && bytes >= OFFLOAD_MIN_BYTES;

/** A fresh id: letters, digits and dash only (the worker accepts exactly that). */
export function newBlobId(random: () => number = Math.random, now: () => number = Date.now): string {
  const r = () => Math.floor(random() * 0xffffffff).toString(36).padStart(7, '0');
  return `b${now().toString(36)}-${r()}${r()}`;
}

type Reply = { id: number; ok: boolean; error?: string; sync?: boolean; data?: ArrayBuffer | null; keys?: string[] };

class BlobStore {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  private probe: Promise<boolean> | null = null;
  private ok = false;

  /** Starts the worker and confirms it can open a synchronous handle. Cached. */
  available(): Promise<boolean> {
    this.probe ||= (async () => {
      try {
        if (typeof Worker !== 'function' || !window.isSecureContext || typeof navigator.storage?.getDirectory !== 'function') return false;
        this.worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (ev: MessageEvent<Reply>) => {
          const w = this.waiting.get(ev.data.id);
          if (!w) return;
          this.waiting.delete(ev.data.id);
          if (ev.data.ok) w.resolve(ev.data);
          else w.reject(new Error(ev.data.error || 'OPFS error'));
        };
        this.worker.onerror = () => this.fail();
        const r = await this.call({ op: 'ping' }, 4000);
        this.ok = !!r.sync;
        if (!this.ok) this.fail();
        return this.ok;
      } catch {
        this.fail();
        return false;
      }
    })();
    return this.probe;
  }

  private fail(): void {
    this.ok = false;
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiting.values()) w.reject(new Error('OPFS worker stopped'));
    this.waiting.clear();
  }

  private call(msg: Record<string, unknown>, timeoutMs = 60_000, transfer: Transferable[] = []): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      const w = this.worker;
      if (!w) return reject(new Error('OPFS is not available'));
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('OPFS timeout'));
      }, timeoutMs);
      this.waiting.set(id, {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      w.postMessage({ id, ...msg }, transfer);
    });
  }

  /** Stores a copy; the caller keeps its buffer. */
  async put(key: string, data: ArrayBuffer): Promise<void> {
    const copy = data.slice(0);
    await this.call({ op: 'put', key, data: copy }, 120_000, [copy]);
  }
  async get(key: string): Promise<ArrayBuffer | null> {
    return (await this.call({ op: 'get', key })).data ?? null;
  }
  async delete(key: string): Promise<void> {
    await this.call({ op: 'delete', key });
  }
  async clear(): Promise<void> {
    if (await this.available()) await this.call({ op: 'clear' });
  }
  async keys(): Promise<string[]> {
    return (await this.call({ op: 'keys' })).keys || [];
  }
  get working(): boolean {
    return this.ok;
  }
}

export const blobs = new BlobStore();

/** Asks Safari not to evict this site's data. Resolves with the answer; never throws. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
