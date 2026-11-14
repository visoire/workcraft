// Mirrors a web app that is deployed on GitHub Pages into a local folder, for apps whose repository publishes no web zip
// (catalog.json channel "pages": TraceDraw, SubCraft). Used by scripts/fetch-apps.mjs; run through `npm run apps:fetch`.
//
// How: index.html is fetched, then every file it and the scripts it loads name (src and href attributes, import "...", new URL("...",
// import.meta.url), and string literals that end in a file type the browser loads: .wasm .js .mjs .css .json .png ...), recursively, in
// the same folder tree only. Nothing outside the site's own path is fetched, no cookies or credentials are sent, redirects are not
// followed to another host, and the total is capped. A name that turns out to be no file (404) is skipped, because a string that
// looks like a path is not always one; the required files (index.html, every .wasm a script names) must come.
//
// Safety, the same rules as a zip install: only the host and path prefix named in the catalog; no `..`; brand/ folders and host
// files (.htaccess, _headers) are never written; the files are written into a staging folder that the caller moves into place.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const FILE_TYPES = 'wasm|js|mjs|css|json|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|otf|webmanifest|txt|bin|glb|gltf|onnx|ogg|mp3|wav';
export const MAX_FILES = 300;
export const MAX_BYTES = 400 * 1024 * 1024;

/** Names of files a page or script refers to, as written (not yet resolved). Pure. */
export function extractRefs(text, kind) {
  const out = new Set();
  const add = (s) => {
    if (!s || /^(?:data:|blob:|javascript:|#|mailto:)/i.test(s) || /[\s{}$<>]/.test(s) || s.length > 300) return;
    out.add(s.split('#')[0].split('?')[0]);
  };
  if (kind === 'html') {
    for (const m of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) add(m[1]);
    for (const m of text.matchAll(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)) for (const r of extractRefs(m[1], 'js')) out.add(r);
  }
  // import "./x.js", from "./x.js", import("./x.js"), new URL("x.wasm", import.meta.url), and plain string literals of a file type
  for (const m of text.matchAll(new RegExp(`["'\`]((?:\\.{0,2}/)?[\\w@./-]+\\.(?:${FILE_TYPES}))["'\`]`, 'gi'))) add(m[1]);
  return [...out].filter((s) => s !== '');
}

/** Resolves a reference against the file that names it; null when it leaves the site's own folder tree. */
export function resolveRef(ref, from, base) {
  let u;
  try {
    u = new URL(ref, from);
  } catch {
    return null;
  }
  if (u.origin !== new URL(base).origin || !u.pathname.startsWith(new URL(base).pathname)) return null;
  u.hash = '';
  u.search = '';
  return u.href;
}

/** Local relative path of a mirrored URL, or null when it is not safe or not wanted. */
export function localPath(url, base) {
  const rel = decodeURIComponent(new URL(url).pathname.slice(new URL(base).pathname.length)) || 'index.html';
  const path = rel.endsWith('/') ? rel + 'index.html' : rel;
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || /^[a-zA-Z]:/.test(path)) return null;
  if (path.split('/').some((p) => p.toLowerCase() === 'brand')) return null;
  const base0 = path.split('/').pop();
  if (base0 === '.htaccess' || base0 === '_headers') return null;
  return path;
}

/**
 * Downloads the site at `base` (https, ends with a slash) into `staging`. Returns the files written: { path, bytes }[].
 * `get` is injectable for tests: (url) => Promise<{ status, bytes: Uint8Array }>.
 */
export async function mirrorSite(base, staging, get = defaultGet) {
  if (!/^https:\/\/[^/]+\/.*\/$|^https:\/\/[^/]+\/$/.test(base)) throw new Error(`the Pages address must be https and end with a slash: ${base}`);
  const seen = new Set();
  const queue = [{ url: base, required: true }];
  const written = [];
  let total = 0;
  const wasmNamed = new Set();
  while (queue.length) {
    const { url, required } = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (seen.size > MAX_FILES) throw new Error(`more than ${MAX_FILES} files: this is not a small web app, refusing to mirror it`);
    const path = localPath(url, base);
    if (!path) continue;
    const res = await get(url);
    if (res.status !== 200) {
      if (required || /\.wasm$/.test(url)) throw new Error(`${url} answered ${res.status}`);
      continue;
    }
    total += res.bytes.length;
    if (total > MAX_BYTES) throw new Error(`more than ${MAX_BYTES / 1048576} MB: refusing to mirror ${base}`);
    const target = resolve(staging, path);
    if (!target.startsWith(resolve(staging) + sep)) throw new Error(`unsafe path: ${path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, res.bytes);
    written.push({ path, bytes: res.bytes.length });
    const ext = path.split('.').pop().toLowerCase();
    const kind = ext === 'html' ? 'html' : ext === 'js' || ext === 'mjs' ? 'js' : ext === 'css' ? 'css' : null;
    if (kind) {
      const text = new TextDecoder().decode(res.bytes);
      for (const ref of extractRefs(text, kind === 'css' ? 'js' : kind)) {
        const u = resolveRef(ref, url, base);
        if (u && !seen.has(u)) {
          if (/\.wasm$/.test(u)) wasmNamed.add(u);
          queue.push({ url: u, required: false });
        }
      }
    }
  }
  if (!written.some((w) => w.path === 'index.html')) throw new Error('no index.html: not a web app');
  for (const u of wasmNamed) if (!written.some((w) => w.path === localPath(u, base))) throw new Error(`the WebAssembly file ${u} named by a script did not come`);
  return written;
}

async function defaultGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'workcraft-mirror-pages' }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  // A redirect inside the same site (a folder address gaining its slash) is fine; one to another host is not followed to its end
  if (new URL(res.url).origin !== new URL(url).origin) return { status: 0, bytes: new Uint8Array() };
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}
