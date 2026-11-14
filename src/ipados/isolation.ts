// Cross-origin isolation on demand (client side). The service worker (public/sw.js) does the work.
//
// SharedArrayBuffer, needed by multithreaded WebAssembly, exists in Safari only when the page is
// cross-origin isolated (COOP: same-origin and COEP: require-corp). Isolation has a price: a
// cross-origin image or frame without a resource policy stops loading, and pop-ups lose their opener.
// The four current engines use no shared memory, so WorkCraft does NOT isolate by default. When an
// engine says it needs it (public/craft-frame.js posts workcraft:needs-isolation), the workspace
// offers to switch it on; the choice is remembered and a reload applies it.
//
// Without a backend nothing could send the headers, so the service worker adds them to same-origin
// documents and workers. That needs a secure context (HTTPS), like the service worker itself.

const KEY = 'workcraft.coi';

export const isolation = {
  /** The page is isolated right now */
  get active(): boolean {
    return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  },
  /** The user (or an earlier prompt) asked for isolation */
  get wanted(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  },
  /** A service worker can add the headers: secure context and service workers available */
  get possible(): boolean {
    return window.isSecureContext && 'serviceWorker' in navigator;
  },
};

/** Tells the service worker whether to add the isolation headers. Resolves true when it acknowledged. */
export async function setIsolation(enabled: boolean): Promise<boolean> {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    /* storage blocked: the worker still gets the message */
  }
  if (!isolation.possible) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const target = reg.active;
    if (!target) return false;
    return await new Promise<boolean>((resolve) => {
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 3000);
      ch.port1.onmessage = (e: MessageEvent<{ ok?: boolean }>) => (clearTimeout(timer), resolve(!!e.data?.ok));
      target.postMessage({ type: 'coi', enabled }, [ch.port2]);
    });
  } catch {
    return false;
  }
}

/** After a service worker update the worker forgets nothing (the flag is in a cache), but a fresh install needs it. */
export function restoreIsolation(): void {
  if (isolation.wanted && isolation.possible) void setIsolation(true);
}
