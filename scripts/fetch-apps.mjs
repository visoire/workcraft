// npm run apps:fetch: adds the official web builds of the other Craft apps (everything in
// src/ecosystems/catalog.json except the four office apps, which come from public/releases.json).
//
//   npm run apps:fetch                 list what is available and what is installed (reads GitHub, downloads nothing)
//   npm run apps:fetch -- --yes        download and install the newest build of every app that has one
//   npm run apps:fetch -- --yes --app photocraft,filmcraft     only these
//   npm run apps:fetch -- --yes --force                        install again even when the version is current
//   npm run apps:fetch -- --yes --max-mb 2000                  also take a build larger than 300 MB (Honeydew's web zip is 1.36 GB)
//
// Three channels (catalog.json "channel"): release = a web zip in the repository's GitHub release; pages = the app is deployed on GitHub
// Pages and scripts/mirror-pages.mjs copies that site (TraceDraw, SubCraft), versioned by the repository's newest release tag; source =
// nothing to fetch (the upstream collection builds it), only apps:import of a folder you provide.
//
//   npm run apps:import                list the builds in a LOCAL folder (default versions/, or --from <dir>)
//   npm run apps:import -- --yes       copy them in (no network): <dir>/<app>-web-<version>/ folders, as the ArtCraft releases' web
//                                      builds are laid out. Same checks, same manifest, same result as apps:fetch.
//
// Each app's repository (catalog.json "repo") publishes a release asset named <app>-web-<version>.zip, the same asset
// the upstream collection builds on (the upstream collection scripts/fetch.mjs, see SOURCES.md; the convention is followed, the code is written for this project). The zip is unpacked into
// versions/web-builds/<app>-web-<version>/ and recorded in public/web-builds.json:
//   - the manifest is tracked, the folder is not (it can be large, and one file may exceed GitHub's 100 MB limit),
//     so a fresh clone runs this command once;
//   - the build, the dev server and the service worker take the app from the manifest, nothing else changes;
//   - a new upstream version later is the same command again. No code, no catalog entry and no version number
//     in the workspace has to change.
//
// Safety: only repositories named in catalog.json are asked; every zip entry is checked for path traversal; a brand/
// folder (trademark assets) is never unpacked; the sha256 GitHub reports for the asset is verified when present; an
// install replaces the app's folder only after the new one is complete.
// GITHUB_TOKEN (optional) raises the API rate limit; it is only sent to api.github.com.

import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { mirrorSite } from './mirror-pages.mjs';
import { patchApps } from './patch-apps.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/ecosystems/catalog.json'), 'utf8'));
const MANIFEST = join(ROOT, 'public/web-builds.json');
const OUT = join(ROOT, 'versions/web-builds');
const OFFICE = new Set(['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft']);
const ASSET = /-web-.*\.zip$/;

function originFolderOf(id) {
  const app = CATALOG.apps.find((a) => a.id === id);
  if (!app) return 'independent';
  return app.origin === 'independent' ? 'independent' : app.origin;
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = value('app')?.split(',').map((s) => s.trim()).filter(Boolean);

const maxMb = Number(value('max-mb') ?? 300);
const MANIFEST_NOTE = 'Written by scripts/fetch-apps.mjs (npm run apps:fetch or apps:import). The folders under versions/web-builds/ are not tracked; a fresh clone runs one of the commands once.';
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

export const readManifest = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { builds: [] });

async function github(path) {
  const headers = { 'User-Agent': 'workcraft-fetch-apps', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return res.json();
}

/** The newest release of a repository that has a web zip: stable first, else the newest pre-release. */
export function pickRelease(releases, assetRe = ASSET) {
  const withAsset = releases.filter((r) => !r.draft && r.assets?.some((a) => assetRe.test(a.name)));
  const rel = withAsset.find((r) => !r.prerelease) ?? withAsset[0];
  if (!rel) return null;
  const asset = rel.assets.find((a) => assetRe.test(a.name));
  const version = asset.name.match(/-web-(.+)\.zip$/)?.[1] ?? rel.tag_name.replace(/^v/, '');
  return { tag: rel.tag_name, version, prerelease: !!rel.prerelease, asset: { name: asset.name, url: asset.browser_download_url, size: asset.size, digest: asset.digest ?? null } };
}

/** Files that belong to the host an upstream zip was made for, not to the app: Apache and Netlify header rules (XAMPP would
 *  apply a .htaccess to our whole build) and precompressed copies (.br, .gz) of a file that is also there uncompressed. */
export function isHostFile(rel, all) {
  const base = rel.split('/').pop();
  if (base === '.htaccess' || base === '_headers') return true;
  const m = rel.match(/^(.*)\.(br|gz)$/);
  return !!m && all.includes(m[1]);
}

/**
 * Layout fix: a split build (PhotoCraft) ships `app/<name>.js`, which imports `./snippets/...`, but the zip has `snippets/` only
 * at the root, so the import is a 404 and the app never starts (checked on the 0.20.2 zip itself). The snippet files are
 * copied to `app/snippets/` as well. Idempotent; returns what it did, so it can be recorded in the manifest ("fixes").
 */
export function layoutFixes(files) {
  const fixes = [];
  const set = new Set(files);
  const hasApp = files.some((f) => /^app\/[^/]+\.js$/.test(f));
  const root = files.filter((f) => f.startsWith('snippets/') && !set.has(`app/${f}`));
  if (hasApp && root.length) {
    for (const f of root) fixes.push({ from: f, to: `app/${f}` });
  }
  return fixes;
}

/**
 * Layout fix: an index.html that names its own files from the site root ("/app-web-1.js", "/app_bg.wasm") only works when the build is
 * served at the root. In a workspace panel it lives under apps/<app>/, so the same names would hit the workspace itself (checked on
 * FireCraft 0.2.5: the app never started). Root-absolute references to files that exist at the root of the build become relative
 * ("./app-web-1.js"). Pure: returns the new html, or the same string when nothing needs to change.
 */
export function relativizeRootPaths(html, files) {
  const roots = new Set(files.filter((f) => !f.includes('/')));
  return html.replace(/(["'(])\/([\w.-]+\.(?:js|mjs|wasm|css|png|jpg|webp|svg|ico|json|webmanifest))(?=["')?#])/g, (m, q, name) => (roots.has(name) ? `${q}./${name}` : m));
}

/** Zip entries to files: refuses path traversal and absolute paths, drops brand/ folders, strips one wrapping folder. */
export function safeEntries(files) {
  const names = Object.keys(files).filter((n) => !n.endsWith('/'));
  for (const n of names) {
    if (n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').includes('..') || n.includes('\\')) throw new Error(`unsafe path in the zip: ${n}`);
  }
  const top = new Set(names.map((n) => n.split('/')[0]));
  const strip = top.size === 1 && names.every((n) => n.includes('/')) && !names.includes('index.html') ? `${[...top][0]}/` : '';
  const out = [];
  for (const n of names) {
    const rel = strip ? n.slice(strip.length) : n;
    if (!rel || rel.split('/').some((p) => p.toLowerCase() === 'brand')) continue;
    out.push({ name: n, rel });
  }
  const all = out.map((e) => e.rel);
  for (let i = out.length - 1; i >= 0; i--) if (isHostFile(out[i].rel, all)) out.splice(i, 1);
  if (!out.some((e) => e.rel === 'index.html')) throw new Error('the zip has no index.html: it is not a web build');
  return out;
}

/** Moves a folder into place. Windows can refuse the rename for a moment while antivirus or the indexer scans the new files
 *  (EPERM, EBUSY): retry, and as a last resort copy and remove. */
async function moveDir(from, to) {
  for (let i = 0; i < 12; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
/** Version compare for 1.2.3 style strings (pre-release suffixes sort lower). */
export function cmpVersion(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return String(a).includes('-') === String(b).includes('-') ? 0 : String(a).includes('-') ? -1 : 1;
}

/** Folder names like photocraft-web-0.20.2 to the newest build per catalog app (office apps and unknown names are left out). */
export function pickLocalBuilds(names, ids) {
  const best = new Map();
  for (const name of names) {
    const m = name.match(/^([a-z][a-z-]*?)-web-(\d+\.\d+\.\d+(?:-[\w.]+)?)$/);
    if (!m || !ids.includes(m[1])) continue;
    const cur = best.get(m[1]);
    if (!cur || cmpVersion(m[2], cur.version) > 0) best.set(m[1], { app: m[1], version: m[2], dir: name });
  }
  return [...best.values()];
}

/** Files of a local build to copy: everything except brand/ folders and links. Refuses a folder without index.html. */
export function localFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.toLowerCase() !== 'brand') walk(join(dir, e.name), r);
      } else if (e.isFile()) out.push(r);
    }
  };
  walk(root, '');
  if (!out.includes('index.html')) throw new Error(`${root} has no index.html: it is not a web build`);
  return out.filter((f) => !isHostFile(f, out));
}

/** Applies layoutFixes() inside a staging folder; returns the fix names for the manifest. */
function applyFixes(staging, files) {
  const fixes = layoutFixes(files);
  for (const f of fixes) {
    mkdirSync(dirname(resolve(staging, f.to)), { recursive: true });
    copyFileSync(resolve(staging, f.from), resolve(staging, f.to));
  }
  const names = fixes.length ? ['app-snippets'] : [];
  const indexPath = resolve(staging, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf8');
    const fixed = relativizeRootPaths(html, files);
    if (fixed !== html) {
      writeFileSync(indexPath, fixed);
      names.push('relative-paths');
    }
  }
  return names;
}

async function importLocal(from) {
  const src = resolve(ROOT, from);
  if (!existsSync(src)) throw new Error(`folder not found: ${src}`);
  const searchRoots = [
    src,
    join(src, 'artcraft'),
    join(src, 'community'),
    join(src, 'independent'),
    join(src, 'web-builds')
  ].filter((d, idx, arr) => existsSync(d) && arr.indexOf(d) === idx);

  const dirEntries = [];
  const dirLocation = new Map();
  for (const rootDir of searchRoots) {
    for (const d of readdirSync(rootDir, { withFileTypes: true })) {
      if (d.isDirectory() && !dirLocation.has(d.name)) {
        dirEntries.push(d.name);
        dirLocation.set(d.name, join(rootDir, d.name));
      }
    }
  }

  const wantedIds = CATALOG.apps.filter((a) => !OFFICE.has(a.id) && (!only || only.includes(a.id))).map((a) => a.id);
  const apps = pickLocalBuilds(dirEntries, wantedIds);
  const manifest = readManifest();
  const have = new Map(manifest.builds.map((b) => [b.app, b]));
  console.log(flag('yes') ? `Importing web builds from ${src}\n` : `Web builds found in ${src} (nothing is copied without --yes)\n`);
  const plan = [];
  for (const b of apps) {
    const srcFolder = dirLocation.get(b.dir) || join(src, b.dir);
    const files = localFiles(srcFolder);
    const bytes = files.reduce((s, f) => s + statSync(join(srcFolder, f)).size, 0);
    const cur = have.get(b.app);
    const present = cur && existsSync(join(OUT, cur.dir, 'index.html'));
    const state = present && cur.version === b.version ? 'installed' : present ? `installed ${cur.version}, newer ${b.version}` : 'not installed';
    console.log(`${b.app.padEnd(18)} ${b.version.padEnd(12)} ${mb(bytes).padStart(9)}  ${files.length} files  [${state}]`);
    if (!(present && cur.version === b.version) || flag('force')) plan.push({ ...b, srcFolder, files, bytes });
  }
  for (const a of CATALOG.apps) if (!OFFICE.has(a.id) && (!only || only.includes(a.id)) && !apps.some((b) => b.app === a.id)) console.log(`${a.id.padEnd(18)} no folder ${a.id}-web-<version> here${a.channel === 'source' ? ' (built from source only)' : ''}`);
  const known = new Set(CATALOG.apps.map((a) => a.id));
  for (const name of dirEntries) {
    const m = name.match(/^([a-z][a-z-]*?)-web-\d+\.\d+\.\d+/);
    if (m && !known.has(m[1])) console.log(`${m[1].padEnd(18)} ${name}: not in the catalog, skipped`);
  }
  console.log(`\n${plan.length} to import, ${mb(plan.reduce((s, p) => s + p.bytes, 0))}.`);
  if (!flag('yes')) {
    if (plan.length) console.log('Run again with --yes to copy them.');
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const p of plan) {
    process.stdout.write(`${p.app}: importing ... `);
    const final = join(OUT, p.dir);
    let fixes = [];
    if (resolve(p.srcFolder) !== resolve(final)) {
      const staging = join(OUT, `.${p.dir}.tmp`);
      rmSync(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      for (const f of p.files) {
        const to = resolve(staging, f);
        if (!to.startsWith(resolve(staging) + sep)) throw new Error(`unsafe path: ${f}`);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(join(p.srcFolder, f), to);
      }
      fixes = applyFixes(staging, p.files);
      rmSync(final, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      await moveDir(staging, final);
    } else {
      fixes = applyFixes(final, p.files);
    }
    const originDest = join(ROOT, 'versions', originFolderOf(p.app), p.dir);
    if (resolve(originDest) !== resolve(final) && !existsSync(join(originDest, 'index.html'))) {
      mkdirSync(dirname(originDest), { recursive: true });
      cpSync(final, originDest, { recursive: true });
    }
    for (const d of readdirSync(OUT)) if (d.startsWith(`${p.app}-web-`) && d !== p.dir) rmSync(join(OUT, d), { recursive: true, force: true });
    const originTag = originFolderOf(p.app);
    have.set(p.app, { app: p.app, version: p.version, dir: p.dir, bytes: p.bytes, source: `local: versions/${originTag}`, fetched: new Date().toISOString().slice(0, 10), ...(fixes.length ? { fixes } : {}) });
    writeFileSync(MANIFEST, JSON.stringify({ _comment: MANIFEST_NOTE, builds: [...have.values()].sort((a, b) => a.app.localeCompare(b.app)) }, null, 2) + '\n');
    console.log(`${p.files.length} files, ${mb(p.bytes)}`);
  }
  patchApps();
  if (plan.length) console.log('\nDone. Restart the dev server, or run npm run build.');
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'workcraft-fetch-apps' } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const from = value('from');
  if (from || flag('local')) return importLocal(from || process.env.WORKCRAFT_APPS_WEB || 'versions');
  const apps = CATALOG.apps.filter((a) => !OFFICE.has(a.id) && (!only || only.includes(a.id)));
  const manifest = readManifest();
  const have = new Map(manifest.builds.map((b) => [b.app, b]));
  const plan = [];
  console.log(flag('yes') ? 'Installing web builds from the GitHub releases named in src/ecosystems/catalog.json\n' : 'Web builds available upstream (nothing is downloaded without --yes)\n');
  for (const a of apps.filter((x) => x.channel === 'release')) {
    try {
      let pick = pickRelease(await github(`/repos/${a.repo}/releases?per_page=10`), a.asset ? new RegExp(a.asset) : ASSET);
      if (!pick) {
        console.log(`${a.id.padEnd(18)} no release with a web build in ${a.repo}`);
        continue;
      }
      const cur = have.get(a.id);
      const present = cur && existsSync(join(OUT, cur.dir, 'index.html'));
      const state = present && cur.version === pick.version ? 'installed' : present ? `installed ${cur.version}, newer ${pick.version}` : cur ? 'recorded, folder missing' : 'not installed';
      console.log(`${a.id.padEnd(18)} ${pick.version.padEnd(12)} ${mb(pick.asset.size).padStart(9)}  ${pick.asset.name}  [${state}]${pick.prerelease ? ' (pre-release)' : ''}  ${a.license}`);
      if (pick.asset.size > maxMb * 1048576 && !(present && cur.version === pick.version)) {
        console.log(`${''.padEnd(18)} skipped: ${mb(pick.asset.size)} is above --max-mb ${maxMb}; run again with --max-mb ${Math.ceil(pick.asset.size / 1048576) + 100} to take it`);
        continue;
      }
      if (!(present && cur.version === pick.version) || flag('force')) plan.push({ app: a, pick });
    } catch (e) {
      console.log(`${a.id.padEnd(18)} ${e.message}`);
    }
  }
  for (const a of apps.filter((x) => x.channel === 'source')) {
    console.log(`${a.id.padEnd(18)} built from source only (${a.repo}): put a build in versions/${a.id}-web-<version>/ and run npm run apps:import -- --yes --app ${a.id}`);
  }
  // channel pages: the deployed app is mirrored; its version is the newest release tag of the repository
  const pagesPlan = [];
  for (const a of apps.filter((x) => x.channel === 'pages')) {
    try {
      const tag = ((await github(`/repos/${a.repo}/releases?per_page=5`)).find((r) => !r.draft && !r.prerelease) ?? {}).tag_name;
      const version = (tag || '').replace(/^v/, '') || '0.0.0';
      const cur = have.get(a.id);
      const present = cur && existsSync(join(OUT, cur.dir, 'index.html'));
      const state = present && cur.version === version ? 'installed' : present ? `installed ${cur.version}, newer ${version}` : 'not installed';
      console.log(`${a.id.padEnd(15)} ${version.padEnd(8)} ${'pages'.padStart(9)}  ${a.pages}  [${state}]  ${a.license}`);
      if (!(present && cur.version === version) || flag('force')) pagesPlan.push({ app: a, version });
    } catch (e) {
      console.log(`${a.id.padEnd(15)} ${e.message}`);
    }
  }
  const total = plan.reduce((s, p) => s + p.pick.asset.size, 0);
  console.log(`\n${plan.length + pagesPlan.length} to install (${pagesPlan.length} mirrored from GitHub Pages), ${mb(total)} to download as zips.`);
  if (!flag('yes')) {
    if (plan.length + pagesPlan.length) console.log('Run again with --yes to install them.');
    return;
  }

  mkdirSync(OUT, { recursive: true });
  for (const { app, pick } of plan) {
    process.stdout.write(`${app.id}: downloading ${pick.asset.name} ... `);
    const bytes = await download(pick.asset.url);
    if (pick.asset.digest?.startsWith('sha256:')) {
      const got = createHash('sha256').update(bytes).digest('hex');
      if (got !== pick.asset.digest.slice(7)) throw new Error(`${app.id}: checksum differs from the one GitHub reports`);
    }
    const files = unzipSync(bytes);
    const entries = safeEntries(files);
    const dir = `${app.id}-web-${pick.version}`;
    const staging = join(OUT, `.${dir}.tmp`);
    rmSync(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    for (const e of entries) {
      const target = resolve(staging, e.rel);
      if (!target.startsWith(resolve(staging) + sep)) throw new Error(`unsafe path: ${e.rel}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, files[e.name]);
    }
    const fixes = applyFixes(staging, entries.map((e) => e.rel));
    // Swap in the new folder, then remove the app's older folders
    const final = join(OUT, dir);
    rmSync(final, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await moveDir(staging, final);
    for (const d of readdirSync(OUT)) if (d.startsWith(`${app.id}-web-`) && d !== dir) rmSync(join(OUT, d), { recursive: true, force: true });
    have.set(app.id, { app: app.id, version: pick.version, dir, bytes: pick.asset.size, source: `https://github.com/${app.repo}/releases/tag/${pick.tag}`, fetched: new Date().toISOString().slice(0, 10), ...(fixes.length ? { fixes } : {}) });
    writeFileSync(MANIFEST, JSON.stringify({ _comment: 'Written by scripts/fetch-apps.mjs (npm run apps:fetch or apps:import). The folders under versions/web-builds/ are not tracked; a fresh clone runs one of the commands once.', builds: [...have.values()].sort((a, b) => a.app.localeCompare(b.app)) }, null, 2) + '\n');
    console.log(`${entries.length} files, ${mb(pick.asset.size)}`);
  }
  for (const { app, version } of pagesPlan) {
    process.stdout.write(`${app.id}: mirroring ${app.pages} ... `);
    const dir = `${app.id}-web-${version}`;
    const staging = join(OUT, `.${dir}.tmp`);
    rmSync(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    const written = await mirrorSite(app.pages, staging);
    const fixes = applyFixes(staging, written.map((w) => w.path));
    const final = join(OUT, dir);
    rmSync(final, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await moveDir(staging, final);
    for (const d of readdirSync(OUT)) if (d.startsWith(`${app.id}-web-`) && d !== dir) rmSync(join(OUT, d), { recursive: true, force: true });
    const bytes = written.reduce((n, w) => n + w.bytes, 0);
    have.set(app.id, { app: app.id, version, dir, bytes, source: app.pages, fetched: new Date().toISOString().slice(0, 10), ...(fixes.length ? { fixes } : {}) });
    writeFileSync(MANIFEST, JSON.stringify({ _comment: MANIFEST_NOTE, builds: [...have.values()].sort((a, b) => a.app.localeCompare(b.app)) }, null, 2) + '\n');
    console.log(`${written.length} files, ${mb(bytes)}`);
  }
  // Nothing else to bump: the service worker keeps hashed engine files and checks the rest against the network first
  if (plan.length + pagesPlan.length) console.log('\nDone. Restart the dev server, or run npm run build.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
