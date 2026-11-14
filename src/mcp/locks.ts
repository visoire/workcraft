// Per-file write locks for MCP tool calls (Team Mode runs several agents at the same time).
//
// - Reads never wait: read-sheet, read-document, read-pdf run as often as they come.
// - Writes take a lock keyed by the normalized project path. Writes to different files run in
//   parallel (WordCraft and DeckCraft update side by side), two writes to the same file queue in the
//   order they arrived, so a read-modify-write like write-sheet in merge mode never loses an update.
// - Writes without a path argument (run-command) share one lock per app.
//
// No DOM and no imports from the interface: the backend tests use this file directly.

/** Lock key of a project path: forward slashes, no . or .. segments, case-insensitive (Windows). */
export function lockKey(path: string): string {
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/').toLowerCase();
}

/** What a tool call needs to lock: nothing for reads, its target files for writes. */
export function lockKeysFor(tool: { name: string; app: string; writes?: boolean; pathArg?: string; source?: string }, args: Record<string, unknown>): string[] {
  if (!tool.writes) return [];
  const keys = new Set<string>();
  const p = tool.pathArg ? args[tool.pathArg] : undefined;
  if (typeof p === 'string' && p) keys.add(lockKey(p));
  if (typeof args.output === 'string' && args.output) keys.add(lockKey(args.output));
  // External MCP tools only queue behind themselves; built-in writers without a path share their app
  if (!keys.size) keys.add(tool.source === 'external' ? `#ext:${tool.name}` : `#${tool.app}`);
  // Always the same order, so two calls that lock the same two files cannot deadlock
  return [...keys].sort();
}

export interface LockStats {
  /** Writes running right now and the most that ever ran at the same time */
  active: number;
  peak: number;
  /** Writes that had to wait for another write to the same file */
  queued: number;
}

/** FIFO mutex per key. */
export class FileLocks {
  private tails = new Map<string, Promise<void>>();
  private holders = new Map<string, number>();
  readonly stats: LockStats = { active: 0, peak: 0, queued: 0 };

  /** Keys that are locked right now. */
  busy(): string[] {
    return [...this.holders.keys()];
  }

  isBusy(key: string): boolean {
    return this.holders.has(lockKey(key)) || this.holders.has(key);
  }

  /**
   * Runs fn while it holds every key. onWait fires once when the call has to queue behind another
   * write. An aborted signal leaves the queue without running fn.
   */
  async run<T>(keys: string[], fn: () => Promise<T>, opt: { signal?: AbortSignal; onWait?: (keys: string[]) => void } = {}): Promise<T> {
    if (!keys.length) return fn();
    const waiting = keys.filter((k) => this.tails.has(k));
    if (waiting.length) {
      this.stats.queued++;
      opt.onWait?.(waiting);
    }
    const releases: (() => void)[] = [];
    const ready: Promise<void>[] = [];
    for (const k of keys) {
      const prev = this.tails.get(k) || Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((r) => (release = r));
      const tail = prev.then(() => mine);
      this.tails.set(k, tail);
      releases.push(() => {
        release();
        // The last one in the queue cleans up
        if (this.tails.get(k) === tail) this.tails.delete(k);
      });
      ready.push(prev);
    }
    const free = () => releases.forEach((r) => r());
    try {
      await abortable(Promise.all(ready), opt.signal);
    } catch (e) {
      // Leave the queue in order: the next writer waits for the one before this call
      void Promise.all(ready).then(free);
      throw e;
    }
    for (const k of keys) this.holders.set(k, (this.holders.get(k) || 0) + 1);
    this.stats.active++;
    this.stats.peak = Math.max(this.stats.peak, this.stats.active);
    try {
      return await fn();
    } finally {
      this.stats.active--;
      for (const k of keys) {
        const n = (this.holders.get(k) || 1) - 1;
        if (n <= 0) this.holders.delete(k);
        else this.holders.set(k, n);
      }
      free();
    }
  }
}

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => (signal.removeEventListener('abort', onAbort), resolve(v)),
      (e) => (signal.removeEventListener('abort', onAbort), reject(e))
    );
  });
}
