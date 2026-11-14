// The app releases the site serves, shared by the build (copy-apps.mjs), the Vite dev server,
// the homepage placeholders (vite.config.js) and the clean redirects (redirects.mjs).
//   apps/<app>/          the hosted web build (Open buttons, workspace)
//   downloads/<zip>      the web build zip (Download section)
// The data lives in public/releases.json (also read by go.php and the workspace registry).
// Source folder: <set>/web/<app>-web-<ver>/ and <set>/zip-web/<app>-web-<ver>.zip, the web zip
// repacked by scripts/pack-web-zips.ps1 with a one-click launcher, because the original zip only
// works behind a web server and opens to a blank "Loading…" page when index.html is double-clicked.
// The Windows portable builds (x64, x86, ARM64, about 17 to 96 MB each) are linked from the
// GitHub release of each app instead of being hosted here.
// When a new version lands: add its folder under versions/, update releases.json, run the pack
// script, then `npm run build`.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = fileURLToPath(new URL('../public/releases.json', import.meta.url));

/** @type {{ set: string, appsCache: string, apps: { app: string, name: string, version: string, tag: string, date: string, web: string, webVersion?: string, webNote?: string, webZipBytes: number, windows: Record<'x64'|'x86'|'arm64', { file: string, bytes: number }> }[] }} */
export const MANIFEST_DATA = JSON.parse(readFileSync(MANIFEST, 'utf8'));

export const SRC = MANIFEST_DATA.set;
export const RELEASES = MANIFEST_DATA.apps;

/**
 * Folder of an office app's web build. Two layouts exist: the flat one of today (versions/<app>-web-<ver>/, next to the
 * Rust source trees and versions/zip/) and the older <set>/web/<app>-web-<ver>/. The flat one wins when both are there.
 */
export function officeWebDir(r) {
  const flat = join(SRC, r.web);
  if (existsSync(join(flat, 'index.html'))) return flat;
  const grouped = join(SRC, 'artcraft', r.web);
  if (existsSync(join(grouped, 'index.html'))) return grouped;
  return existsSync(join(SRC, 'web', r.web)) ? join(SRC, 'web', r.web) : flat;
}

// The other Craft apps (src/ecosystems/catalog.json) have no release table of their own: scripts/fetch-apps.mjs
// downloads the official web build of each from its GitHub release into versions/web-builds/<dir>/ (and origin folders
// versions/artcraft/, versions/community/, versions/independent/) and records it in public/web-builds.json.
const BUILDS_FILE = fileURLToPath(new URL('../public/web-builds.json', import.meta.url));
export const WEB_BUILDS_DIR = 'versions/web-builds';
export function resolveWebBuildDir(dir) {
  for (const sub of ['web-builds', 'artcraft', 'community', 'independent', '']) {
    const cand = sub ? join(SRC, sub, dir) : join(SRC, dir);
    if (existsSync(join(cand, 'index.html'))) return cand;
  }
  return join(WEB_BUILDS_DIR, dir);
}
/** @type {{ app: string, version: string, dir: string, bytes?: number, source?: string, fetched?: string }[]} */
export const WEB_BUILDS = existsSync(BUILDS_FILE) ? (JSON.parse(readFileSync(BUILDS_FILE, 'utf8')).builds ?? []) : [];
/** The recorded builds whose folder exists on this machine: only these count as available (a fresh clone has the
 *  manifest but not the files until `npm run apps:fetch` ran). */
export const PRESENT_BUILDS = WEB_BUILDS.filter((b) => existsSync(join(resolveWebBuildDir(b.dir), 'index.html')));
/** Folder that holds the web build of an app: the office release set, or a fetched build. Null when there is none. */
export function webDirOf(app) {
  const r = RELEASES.find((x) => x.app === app);
  if (r) return officeWebDir(r);
  const b = WEB_BUILDS.find((x) => x.app === app);
  return b ? resolveWebBuildDir(b.dir) : null;
}
export const ARCHES = /** @type {const} */ (['x64', 'x86', 'arm64']);
export const ARCH_LABEL = { x64: '64-bit', x86: '32-bit', arm64: 'ARM64' };
/** The Windows builds a release has, in the order of ARCHES. Since 2026-11 the releases carry x64 and ARM64 only; older ones also had x86. */
export const archesOf = (r) => ARCHES.filter((a) => r.windows?.[a]);

/** The version that runs in the browser (apps/<app>/, workspace panel, web zip). Usually the release itself. */
export const webVersion = (r) => r.webVersion || r.version;

/** Size as shown on the site: MiB with one decimal, like GitHub's release page ("95.5 MB"). */
export const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/** Where a download file comes from: the repacked web zip when it exists, else the original. */
export function zipSource(name) {
  for (const sub of ['zip-web', 'zip', 'zip/artcraft', 'zip/community', 'zip/independent']) {
    const cand = join(SRC, sub, name);
    if (existsSync(cand)) return cand;
  }
  return join(SRC, 'zip', name);
}

export const downloadNames = (r) => [`${r.web}.zip`];

/** Direct link to a Windows portable build on the app's GitHub release. */
export const windowsAsset = (r, arch) => `https://github.com/storytold/${r.app}/releases/download/${r.tag}/${r.windows[arch].file}`;

/**
 * Where an outdated or unknown download name should go instead (old links, bookmarks):
 *   <app>-web-<any version>.zip                       -> the current web zip
 *   <app>-<any version>-windows-<arch>-portable.zip   -> the current Windows build on GitHub
 * Returns { local: file name } or { url: absolute URL }, or null.
 */
export function downloadFallback(name) {
  const web = name.match(/^([a-z]+)-web-[\d.]+\.zip$/);
  const win = name.match(/^([a-z]+)-[\d.]+-windows-(x64|x86|arm64)-portable\.zip$/);
  const r = RELEASES.find((x) => x.app === (web || win)?.[1]);
  if (!r) return null;
  if (web) return { local: `${r.web}.zip` };
  return { url: windowsAsset(r, win[2]) };
}

/**
 * Homepage placeholders, filled at build time (vite.config.js):
 *   <!--REL:<app>:version-->   0.9.0
 *   <!--REL:<app>:meta-->      v0.9.0 · about 16 MB   (app card; "v0.9.0 · web 0.8.0 · …" when the
 *                              browser build is older than the release)
 *   <!--REL:<app>:date-->      2026-10-21
 *   <!--DOWNLOADS-->           the rows of the download table
 */
export function releasePlaceholders(html, goUrl, base = '') {
  const find = (id) => RELEASES.find((r) => r.app === id);
  return html
    .replace(/<!--REL:(\w+):(\w+)-->/g, (m, id, field) => {
      const r = find(id);
      if (!r) return m;
      if (field === 'meta') return `v${r.version}${webVersion(r) !== r.version ? ` · web ${webVersion(r)}` : ''} · about ${Math.round(r.webZipBytes / 1048576)} MB`;
      if (field === 'webzip') return `${r.web}.zip`;
      return String(r[field] ?? m);
    })
    .replace(/<!--DOWNLOADS-->/g, () => RELEASES.map((r) => downloadRow(r, goUrl, base)).join('\n'));
}

function downloadRow(r, goUrl, base) {
  const win = archesOf(r).map((a) => `<a class="dl-win" href="${goUrl(base, r.app, `win-${a}`)}" rel="noopener" data-size="${r.windows[a].bytes}"><span>${ARCH_LABEL[a]}</span><em>${mb(r.windows[a].bytes)}</em></a>`).join('');
  return `        <div class="dl-row">
          <span class="dl-app"><img src="./assets/logos/${r.app}.webp" width="28" height="28" alt="" loading="lazy" decoding="async"><b>${r.name}</b><em>v${r.version} · alpha <span class="dl-date">· ${r.date}</span></em></span>
          <div class="dl-wins" role="group" aria-label="${r.name} for Windows, portable zip">${win}</div>
          <a class="dl-file" href="./downloads/${r.web}.zip" download data-size="${r.webZipBytes}"${r.webNote ? ` title="${r.webNote.replace(/"/g, '&quot;')}"` : ''}><span>${webVersion(r) !== r.version ? `Web ${webVersion(r)}` : 'Web'}</span><em>${mb(r.webZipBytes)} zip</em></a>
          <a class="dl-more" href="${goUrl(base, r.app, 'releases')}" target="_blank" rel="noopener">Installers, macOS, Linux <span aria-hidden="true">↗</span></a>
        </div>`;
}

/** Script for iPadOS, Retina and embedded panels (public/craft-frame.js). It runs before the wasm module. */
export const SHIM_TAG = '<script src="../../craft-frame.js" data-workcraft-shim></script>';

/** playgroundFiles for independent-app style builds inside a workspace panel (public/craft-files.js). */
export const FILES_TAG = '<script src="../../craft-files.js" data-workcraft-files></script>';

/** Light and dark mode for the apps (public/craft-theme.js). Replaces the release's craft-theme-sync.js. */
export const THEME_TAG = '<script src="../../craft-theme.js" data-workcraft-theme></script>';

/**
 * Adds the shim to an app's index.html once: after the viewport meta (which it rewrites), else after <head>.
 * Also swaps the release's theme script for WorkCraft's, which never writes the theme back.
 * Releases from 0.9 on ship without craft-theme-sync.js; the theme script then goes before </head>.
 */
export function injectShim(html) {
  if (!html.includes('data-workcraft-theme')) {
    const sync = /<script[^>]+src=["']\.?\/?craft-theme-sync\.js["'][^>]*><\/script>/i;
    html = sync.test(html) ? html.replace(sync, THEME_TAG) : html.replace(/<\/head>/i, `  ${THEME_TAG}\n</head>`);
  }
  // A page that already has the shim (an older build of this folder) still gets the files script
  if (html.includes('data-workcraft-shim')) return html.includes('data-workcraft-files') ? html : html.replace(SHIM_TAG, `${SHIM_TAG}\n  ${FILES_TAG}`);
  const both = `${SHIM_TAG}\n  ${FILES_TAG}`;
  const vp = /<meta[^>]+name=["']viewport["'][^>]*>/i;
  if (vp.test(html)) return html.replace(vp, (m) => `${m}\n  ${both}`);
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n  ${both}`);
}

// Every type an engine build can contain. The dev server sends nosniff, so a missing entry is not a cosmetic problem: the browser
// refuses a stylesheet or a font served as octet-stream (SolidCraft's canvas lost its sizing rules that way).
export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.zip': 'application/zip', '.map': 'application/json',
  '.otf': 'font/otf', '.ttf': 'font/ttf', '.ttc': 'font/collection', '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml',
};

/** Vite plugin: serves apps/<app>/ and downloads/<zip> straight from versions/ during `npm run dev`. */
export function releaseFiles() {
  const root = resolve('.');
  const handle = (req, res, next) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = null;
    const app = path.match(/\/apps\/([a-z-]+)(\/.*)?$/);
    const dl = path.match(/\/downloads\/([\w.-]+\.zip)$/);
    if (app) {
      const dir = webDirOf(app[1]);
      if (!dir) return next();
      if (!app[2]) { res.statusCode = 301; res.setHeader('Location', req.url.replace(/(\?|$)/, '/$1')); return res.end(); }
      const base = resolve(dir);
      file = normalize(join(base, app[2] === '/' ? 'index.html' : app[2]));
      if (!file.startsWith(base)) file = null;
    } else if (dl) {
      const r = RELEASES.find((x) => downloadNames(x).includes(dl[1]));
      if (r) file = resolve(root, zipSource(dl[1]));
      else {
        // Outdated name (an old version): same redirect as the Apache rule in .htaccess
        const to = downloadFallback(dl[1]);
        if (!to) return next();
        res.statusCode = 302;
        res.setHeader('Location', to.url || path.replace(/[^/]+$/, to.local));
        return res.end();
      }
    } else return next();
    if (!file || !existsSync(file) || !statSync(file).isFile()) return next();
    if (app && file.endsWith('index.html')) {
      const html = injectShim(readFileSync(file, 'utf8'));
      res.setHeader('Content-Type', TYPES['.html']);
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(html);
    }
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', statSync(file).size);
    if (dl) res.setHeader('Content-Disposition', `attachment; filename="${dl[1]}"`);
    createReadStream(file).pipe(res);
  };
  return {
    name: 'workcraft-release-files',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
