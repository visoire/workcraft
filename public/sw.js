// WorkCraft service worker: offline use of the workspace after the first load.
//
// - Workspace (HTML, JS, CSS, logos, sounds): network first, from the cache when there is no
//   connection. The build writes precache.json with every file of the workspace.
// - Apps under apps/<app>/ (WebAssembly, 40 MB per app): cache first, because the file names
//   carry a content hash. Each app is stored when it is first opened. The message
//   {type: 'cache-apps', apps?: [ids]} loads the four office apps (or the given apps) ahead of time.
//   Apps of other ecosystems (public/web-builds.json) use the same rule: a file with a 16 digit hash in its name is
//   kept for good, everything else is checked against the network first, so a new upstream version needs no change here.
// - Requests to other origins and to /api, /mcp and /ws (local backend) never use the cache.

// Cross-origin isolation on demand (iPadOS, no backend to send headers): when the workspace asks
// ({type: 'coi', enabled: true}, see src/ipados/isolation.ts) the worker adds COOP: same-origin and
// COEP: require-corp to same-origin documents and workers, which gives a multithreaded engine
// SharedArrayBuffer. Off by default: the four current engines use no shared memory, and isolation
// stops cross-origin images and pop-ups from working. The flag lives in its own cache, because
// activate deletes every cache that is not listed below, and the setting must survive an update.

// Bump VERSION when the workspace changes in a way old caches must not survive, and APPS with every
// app release (public/releases.json): activate deletes every cache with another name, so the old
// WebAssembly binaries leave the device at once. apps-v5: WordCraft 0.18.1, GridCraft 0.19.1, DeckCraft 0.18.1, PdfCraft 0.21.1.
const VERSION = 'workcraft-v7';
const SHELL = `${VERSION}-shell`;
const APPS = 'workcraft-apps-v5';
const FLAGS = 'workcraft-flags';
const APP_IDS = ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft'];
const BASE = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      let list = ['./', './workspace.webmanifest', './favicon.svg'];
      try {
        const res = await fetch('./precache.json', { cache: 'no-store' });
        if (res.ok) list = [...new Set([...list, ...(await res.json()).files])];
      } catch {
        /* development mode: no precache.json, files are stored as they load */
      }
      let count = 0;
      await Promise.all(
        list.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) {
              await cache.put(url, res);
              count++;
            }
          } catch {
            /* a single file is missing */
          }
        })
      );
      self.precached = count;
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL && key !== APPS && key !== FLAGS) await caches.delete(key);
      await self.clients.claim();
      for (const c of await self.clients.matchAll()) c.postMessage({ type: 'precached', count: self.precached || 0 });
    })()
  );
});

const isApp = (url) => url.href.startsWith(BASE + 'apps/');
const immutable = (url) => /-[0-9a-f]{16}(_bg)?\.(wasm|js|ico|png)$/.test(url.pathname);

// ---------- Cross-origin isolation on demand ----------
let coi = null;
async function isolationOn() {
  if (coi === null) coi = !!(await (await caches.open(FLAGS)).match('coi'));
  return coi;
}
async function setIsolation(enabled) {
  const cache = await caches.open(FLAGS);
  if (enabled) await cache.put('coi', new Response('1'));
  else await cache.delete('coi');
  coi = !!enabled;
}
// Documents and workers carry the policy; images, scripts and data of the same origin need nothing
const ISOLATED_DESTINATIONS = new Set(['document', 'iframe', 'frame', 'worker', 'sharedworker']);
async function isolate(req, res) {
  if (!res || res.status === 0 || res.type !== 'basic' || !ISOLATED_DESTINATIONS.has(req.destination) || !(await isolationOn())) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return isolate(req, res);
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' ? await cache.match('./') : null);
    if (hit) return isolate(req, hit);
    throw e;
  }
}

async function appFirst(req, url) {
  const cache = await caches.open(APPS);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit && immutable(url)) return isolate(req, hit);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return isolate(req, res);
  } catch (e) {
    if (hit) return isolate(req, hit);
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/@vite') || url.pathname.includes('/@fs/') || url.searchParams.has('import')) return; // Vite development
  // Local backend: project data, AI streams, MCP and WebSocket never come from the cache
  if (/^\/(api|mcp|ws)(\/|$)/.test(url.pathname)) return;
  event.respondWith(isApp(url) ? appFirst(req, url) : networkFirst(req));
});

// <scan>
/**
 * The files a page, a script or a list of parts names, so an app can be cached for offline use without knowing how it loads
 * itself: import and new URL() and module_or_path strings, link and script tags, and the lines of a parts list (a split
 * build lists its wasm parts in app/parts.txt). Only the app's own folder counts. Pure; tests/server/ecosystems.test.ts
 * runs this block.
 */
function assetPaths(text, fileUrl, root) {
  const out = new Set();
  const add = (rel) => {
    try {
      const u = new URL(rel, fileUrl);
      const href = u.origin + u.pathname;
      if (href.startsWith(root) && href !== root) out.add(href);
    } catch {
      /* not a path */
    }
  };
  const quoted = /["'`]((?:\.{1,2}\/)?[\w@\-./]+\.(?:wasm|m?js|css|otf|ttf|woff2?|svg|png|jpe?g|webp|json|webmanifest|txt|part-[a-z]+))["'`]/g;
  for (const m of String(text).matchAll(quoted)) add(m[1]);
  for (const m of String(text).matchAll(/^([\w@\-.]+\.part-[a-z]+)\s*$/gm)) add(m[1]);
  return [...out];
}
// </scan>

/** Loads every file of the given apps (default: the four office apps) into the cache, so they run offline. The page
 *  sends {type: 'cache-apps', apps: ['photocraft', ...]} for the apps of an ecosystem (src/ecosystems/offline-apps.ts).
 *  Starts at index.html and follows what each page and script names (assetPaths), up to 120 files per app. */
async function cacheApps(port, ids) {
  const cache = await caches.open(APPS);
  const wanted = Array.isArray(ids) && ids.length ? ids.filter((id) => typeof id === 'string' && /^[a-z][a-z-]{1,24}$/.test(id)) : APP_IDS;
  const seen = new Set();
  let done = 0;
  let bytes = 0;
  let failed = 0;
  const report = () => port?.postMessage({ type: 'progress', done, total: seen.size, bytes });
  for (const id of wanted) {
    const root = `${BASE}apps/${id}/`;
    const queue = [root, root + 'index.html'];
    let count = 0;
    while (queue.length && count < 120) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      count++;
      try {
        const res = await fetch(url);
        // A name found in a script that is not a file (a comment, a string) is a 404: skipped, not a failure
        if (res.status === 404) {
          seen.delete(url);
          continue;
        }
        if (!res.ok) throw new Error(res.status);
        const type = res.headers.get('content-type') || '';
        const size = Number(res.headers.get('content-length') || 0);
        if (/html|javascript|text\/plain/.test(type) && size < 1.5e6) {
          const text = await res.clone().text();
          for (const next of assetPaths(text, url, root)) if (!seen.has(next)) queue.push(next);
        }
        bytes += (await res.clone().blob()).size;
        await cache.put(url, res);
      } catch {
        failed++;
      }
      done++;
      report();
    }
  }
  port?.postMessage({ type: 'done', files: done - failed, failed, bytes });
}
self.addEventListener('message', (event) => {
  if (event.data?.type === 'cache-apps') event.waitUntil(cacheApps(event.ports[0], event.data.apps));
  if (event.data?.type === 'coi') {
    const port = event.ports[0];
    event.waitUntil(
      setIsolation(!!event.data.enabled).then(
        () => port?.postMessage({ ok: true }),
        () => port?.postMessage({ ok: false })
      )
    );
  }
});
