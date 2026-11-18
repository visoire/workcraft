#!/usr/bin/env node
// Packs the files of a GitHub release into release-assets/ (after `npm run build`):
//
//   workcraft-web-<version>.zip     the browser version as static files (the four office apps; the other apps are not redistributed
//                                   here: https://workcraft.cc/app/ has all of them). Any static web server can host it.
//   workcraft-local-<version>.zip   run it on your own computer: the built server and browser version, the launchers
//                                   (Start WorkCraft.cmd / .command, start-workcraft.sh), scripts/setup.mjs and SETUP-AI.md.
//                                   No node_modules: the first start runs `npm ci --omit=dev`.
//   SHA256SUMS.txt                  checksums of the two files
//
// The scripts keep their executable bit in the zip (fflate `attrs`), so Start WorkCraft.command opens by double-click on macOS.

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const V = pkg.version;
const OUT = join(ROOT, 'release-assets');
const OFFICE = new Set(['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft']);
const EXEC = 0o100755 << 16;
const FILE = 0o100644 << 16;

for (const need of ['dist/index.html', 'dist-server/server/index.js']) {
  if (!existsSync(join(ROOT, need))) {
    console.error(`${need} is missing: run npm run build first.`);
    process.exit(1);
  }
}

function walk(dir, skip = () => false) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p).split(sep).join('/');
    if (skip(rel, name)) continue;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, skip));
    else out.push({ path: p, rel });
  }
  return out;
}

// dist/apps/<id>/...: only the office apps are packed (the others come from their own repositories and licences)
const skipApps = (rel) => {
  const m = /^dist\/apps\/([^/]+)\//.exec(rel);
  return !!m && !OFFICE.has(m[1]);
};

const entries = (files, base, add) => {
  const z = {};
  for (const f of files) z[`${base}${f.rel}`.replace(/^\//, '')] = [new Uint8Array(readFileSync(f.path)), { level: 6, os: 3, attrs: FILE }];
  for (const [name, data, exec] of add) z[name] = [typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data), { level: 6, os: 3, attrs: exec ? EXEC : FILE }];
  return z;
};

const sha = (b) => createHash('sha256').update(b).digest('hex');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- web
const distFiles = walk(join(ROOT, 'dist'), (rel) => skipApps(rel + '/x'));
const distFilesFiltered = distFiles.filter((f) => !skipApps(f.rel));
const webZ = {};
for (const f of distFilesFiltered) webZ[f.rel.replace(/^dist\//, '')] = [new Uint8Array(readFileSync(f.path)), { level: 6, os: 3, attrs: FILE }];
webZ['HOSTING.txt'] = [
  new TextEncoder().encode(`WorkCraft ${V} as static files (the browser version, the four office apps).

Put this folder on any web server (HTTPS recommended: the service worker, the microphone and the camera need a secure page).
Nothing here talks to a server of ours: projects live in the visitor's browser. The terminal, local models (Ollama) and the
desktop Craft apps need the local version (workcraft-local). The other apps of the catalog: https://workcraft.cc/app/

Docs: https://github.com/visoire/workcraft/blob/main/docs/SELF-HOSTING.md
`),
  { level: 6, os: 3, attrs: FILE },
];
const webName = `workcraft-web-${V}.zip`;
const web = zipSync(webZ);
writeFileSync(join(OUT, webName), web);

// ---------------------------------------------------------------- local
const read = (rel) => readFileSync(join(ROOT, rel));
const serverFiles = walk(join(ROOT, 'dist-server'));
const skillFiles = existsSync(join(ROOT, 'skills')) ? walk(join(ROOT, 'skills')) : [];
const docFiles = walk(join(ROOT, 'docs'), (rel, name) => /\.(png|jpe?g|webp)$/i.test(name));
const launcherFiles = walk(join(ROOT, 'scripts', 'launcher'));
const localZ = {
  ...entries(distFilesFiltered, '', []),
  ...entries(serverFiles, '', []),
  ...entries(skillFiles, '', []),
  ...entries(docFiles, '', []),
  ...entries(launcherFiles, '', []),
};
const extra = [
  ['package.json', read('package.json')],
  ['package-lock.json', read('package-lock.json')],
  ['scripts/setup.mjs', read('scripts/setup.mjs'), true],
  ['Start WorkCraft.cmd', read('Start WorkCraft.cmd')],
  ['Start WorkCraft.command', read('Start WorkCraft.command'), true],
  ['start-workcraft.sh', read('start-workcraft.sh'), true],
  ['SETUP-AI.md', read('SETUP-AI.md')],
  ['README.md', read('README.md')],
  ['CHANGELOG.md', read('CHANGELOG.md')],
  ['LICENSE-MIT', read('LICENSE-MIT')],
  ['LICENSE-APACHE', read('LICENSE-APACHE')],
  ['LICENSE', read('LICENSE')],
  ['START-HERE.txt', `WorkCraft ${V}: run it on your computer

Windows:  double-click  Start WorkCraft.cmd
macOS:    double-click  Start WorkCraft.command   (the first time: right-click, Open)
Linux:    sh start-workcraft.sh

The first start sets everything up (a few minutes, the internet is needed once), starts WorkCraft, opens your browser and asks whether
it should start by itself when you sign in. No administrator rights are needed.

Using an AI assistant (Claude Code, Codex, Cursor, Gemini ...)? Tell it "set up WorkCraft" and point it to SETUP-AI.md.
The browser version with every app, nothing to install: https://workcraft.cc/app/
`],
];
for (const [name, data, exec] of extra) localZ[name] = [new Uint8Array(data), { level: 6, os: 3, attrs: exec ? EXEC : FILE }];
// the launchers inside scripts/launcher are plain files; setup.mjs and the shell scripts are executable
const localName = `workcraft-local-${V}.zip`;
const local = zipSync(localZ);
writeFileSync(join(OUT, localName), local);

writeFileSync(join(OUT, 'SHA256SUMS.txt'), `${sha(web)}  ${webName}\n${sha(local)}  ${localName}\n`);
const mb = (b) => (b.length / 1048576).toFixed(1) + ' MB';
console.log(`${webName}   ${mb(web)}   ${Object.keys(webZ).length} files\n${localName}   ${mb(local)}   ${Object.keys(localZ).length} files\nSHA256SUMS.txt\nin ${OUT}`);
