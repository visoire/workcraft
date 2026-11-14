// Pure part of the offline-cache check (no registry, no browser): does a set of apps fit the storage quota? Tested in tests/server/ipados.test.ts.

export interface StorageEstimateLike {
  quota?: number;
  usage?: number;
}

/** Bytes the apps need on the device once cached. Pure: sizes come from the caller. */
export function neededBytes(ids: readonly string[], sizeOf: (id: string) => number | undefined): number {
  return ids.reduce((n, id) => n + (sizeOf(id) ?? 0), 0);
}

/** Does it fit? Keeps a tenth in reserve (the project, IndexedDB and the other caches live in the same quota). An unknown quota fits. Pure. */
export function cacheFit(est: StorageEstimateLike | undefined, needed: number): { ok: boolean; free: number } {
  if (!est || typeof est.quota !== 'number' || est.quota <= 0) return { ok: true, free: Infinity };
  const free = Math.max(0, est.quota - (est.usage ?? 0));
  return { ok: needed * 1.1 <= free, free };
}
