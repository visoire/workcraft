// Keep the apps of an ecosystem available offline: asks the service worker (public/sw.js, message cache-apps) to load
// every file of those apps into its cache. This is what makes a standalone iPad (no desktop, Add to Home Screen) work
// on a plane: the ecosystem's engines are on the device, and the project lives in IndexedDB and OPFS (browser mode).
//
// Only apps that have a web build here are sent; the worker answers with progress and a final summary.

import { AVAILABLE, WEB_BUILDS, releaseOf } from '../workspace/registry.js';
import type { CraftId } from './catalog.js';

export interface OfflineProgress {
  done: number;
  total: number;
  bytes: number;
}
export interface OfflineResult {
  ok: boolean;
  files: number;
  failed: number;
  bytes: number;
  reason?: 'no-worker' | 'nothing' | 'no-space';
  /** With reason no-space: what the apps need and what the device has left (bytes) */
  needed?: number;
  free?: number;
}

/** The office apps are known by their zip (about 40 % of the unpacked size); the others by the size of the installed build. */
const UNPACK = 2.5;

export { cacheFit, neededBytes, type StorageEstimateLike } from './storage-fit.js';
import { cacheFit, neededBytes } from './storage-fit.js';

/** Installed size of an app: the build folder from web-builds.json, or the office zip unpacked. */
export const appBytes = (id: string): number | undefined => WEB_BUILDS.find((b) => b.app === id)?.bytes ?? (releaseOf(id) ? Math.round(releaseOf(id)!.webZipBytes * UNPACK) : undefined);

/** The apps of this list that can be cached (they have a web build). */
export const cacheable = (ids: readonly CraftId[]): CraftId[] => ids.filter((id) => AVAILABLE.has(id));

export async function cacheApps(ids: readonly CraftId[], onProgress?: (p: OfflineProgress) => void): Promise<OfflineResult> {
  const apps = cacheable(ids);
  if (!apps.length) return { ok: false, files: 0, failed: 0, bytes: 0, reason: 'nothing' };
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
  const sw = navigator.serviceWorker?.controller || reg?.active;
  if (!sw) return { ok: false, files: 0, failed: 0, bytes: 0, reason: 'no-worker' };
  // Safari keeps a standalone web app's storage only when it is persistent, and refuses a cache that does not fit: ask first and say so
  try {
    await navigator.storage?.persist?.();
    const fit = cacheFit(await navigator.storage?.estimate?.(), neededBytes(apps, appBytes));
    if (!fit.ok) return { ok: false, files: 0, failed: 0, bytes: 0, reason: 'no-space', needed: neededBytes(apps, appBytes), free: fit.free };
  } catch {
    /* no storage API: try anyway */
  }
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e: MessageEvent<{ type: string } & Record<string, number>>) => {
      if (e.data.type === 'progress') onProgress?.({ done: e.data.done!, total: e.data.total!, bytes: e.data.bytes! });
      if (e.data.type === 'done') resolve({ ok: !e.data.failed, files: e.data.files!, failed: e.data.failed!, bytes: e.data.bytes! });
    };
    sw.postMessage({ type: 'cache-apps', apps }, [ch.port2]);
  });
}
