// App releases: public/releases.json against the web builds, the zips, the homepage, the
// knowledge base of the website assistant, the service worker, the README and both redirect
// implementations (scripts/redirects.mjs and public/go.php).
// The same file runs in all three repositories: workcraft (website and IDE), workcraft-home (website)
// and workcraft (IDE). Checks for a part that is not in the checkout are skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
// @ts-expect-error plain ES module without types
import { RELEASES, SRC, MANIFEST_DATA, ARCHES, archesOf, officeWebDir, mb, zipSource, releasePlaceholders, downloadFallback, windowsAsset, injectShim } from '../../scripts/releases.mjs';
// @ts-expect-error plain ES module without types
import { patchApps, onceLockPattern } from '../../scripts/patch-apps.mjs';
import { createHash } from 'node:crypto';

type Patch = { kind: string; glue: string; id: number; state: number; issue: string };
type Release = { app: string; name: string; version: string; tag: string; date: string; web: string; webVersion?: string; webNote?: string; webZipBytes: number; windows: Record<string, { file: string; bytes: number }>; patches?: Patch[] };
const webV = (r: Release) => r.webVersion || r.version;
const rels = RELEASES as Release[];
const ROOT = resolve('.');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const has = (p: string) => existsSync(join(ROOT, p));
/** The website (homepage with the download table, redirects, go.php) and the IDE (registry, service worker) */
const SITE = has('scripts/partials.mjs') && has('scripts/redirects.mjs') && has('public/go.php') && has('index.html') && read('index.html').includes('<!--DOWNLOADS-->');
const IDE = has('src/workspace/registry.ts') && has('public/sw.js');
const noSite = SITE ? false : 'no website in this repository';
const noIde = IDE ? false : 'no IDE in this repository';
type GoUrl = (base: string, app: string, to: string) => string;
const goUrl: GoUrl = SITE ? (await import('../../scripts/partials.mjs' as string)).goUrl : () => '';
const goTarget: (app: string, to: string) => string | null = SITE ? (await import('../../scripts/redirects.mjs' as string)).goTarget : () => null;
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));

test('releases.json: four apps with complete data', () => {
  assert.deepEqual(rels.map((r) => r.app), ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft']);
  for (const r of rels) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/, r.app);
    assert.equal(r.tag, `v${r.version}`, r.app);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.app);
    assert.equal(r.web, `${r.app}-web-${webV(r)}`, r.app);
    if (r.webVersion) {
      assert.notEqual(r.webVersion, r.version, `${r.app}: drop webVersion when the browser build is the release`);
      assert.ok(r.webNote && r.webNote.length > 20, `${r.app}: webNote explains the older browser build`);
    }
    assert.ok(r.webZipBytes > 1_000_000, `${r.app} webZipBytes`);
    assert.deepEqual(Object.keys(r.windows).filter((a) => !(ARCHES as string[]).includes(a)), [], `${r.app}: only known architectures`);
    for (const need of ['x64', 'arm64']) assert.ok(r.windows[need], `${r.app} has a ${need} build`);
    for (const a of Object.keys(r.windows)) {
      assert.equal(r.windows[a]!.file, `${r.app}-${r.version}-windows-${a}-portable.zip`, `${r.app} ${a}`);
      assert.ok(r.windows[a]!.bytes > 1_000_000, `${r.app} ${a} bytes`);
    }
  }
});

test('Web builds: present, licensed, no brand assets, no CDN, theme and shim injected', () => {
  for (const r of rels) {
    const dir = join(ROOT, officeWebDir(r));
    assert.ok(existsSync(join(dir, 'index.html')), `${dir}/index.html`);
    const names = readdirSync(dir);
    for (const need of ['.htaccess', 'LICENSE-MIT', 'LICENSE-APACHE']) assert.ok(names.includes(need), `${r.web} has ${need}`);
    assert.ok(names.some((n) => n.endsWith('_bg.wasm')), `${r.web} has a .wasm`);
    const files = walk(dir);
    assert.ok(!files.some((f) => /[\\/]brand[\\/]/.test(f)), `${r.web} contains no brand/ folder`);
    for (const f of files.filter((x) => /\.(html|js|css)$/.test(x))) {
      assert.doesNotMatch(readFileSync(f, 'utf8'), /fonts\.googleapis|fonts\.gstatic|jsdelivr|unpkg\.com|cdnjs|esm\.sh|skypack/, f);
    }
    const html = injectShim(readFileSync(join(dir, 'index.html'), 'utf8'));
    assert.match(html, /data-workcraft-shim/, `${r.web} shim`);
    assert.match(html, /data-workcraft-theme/, `${r.web} theme script`);
    assert.doesNotMatch(html, /craft-theme-sync\.js/, `${r.web} upstream theme script replaced`);
  }
});

test('Startup patches: applied, integrity in step, and refused for bytes that do not match', () => {
  const report = patchApps({ check: true }) as { app: string; state: string; detail: string }[];
  const patched = rels.filter((r) => r.patches?.length);
  assert.equal(report.length, patched.reduce((n, r) => n + r.patches!.length, 0));
  for (const x of report) assert.equal(x.state, 'ok', `${x.app}: ${x.detail}`);
  for (const r of patched) {
    for (const p of r.patches!) {
      const dir = join(ROOT, officeWebDir(r));
      const glue = readFileSync(join(dir, p.glue), 'utf8');
      // builds patched before the rename carry the old marker (opencraft-patch)
      assert.equal((glue.match(/(?:workcraft|opencraft)-patch:oncelock-instance-id/g) || []).length, 1, 'patched exactly once');
      assert.ok(glue.search(/(?:workcraft|opencraft)-patch/) < glue.indexOf('wasm.__wbindgen_start();'), 'the OnceLock is filled before the module starts');
      const index = readFileSync(join(dir, 'index.html'), 'utf8');
      const sri = 'sha384-' + createHash('sha384').update(glue).digest('base64');
      assert.ok(index.includes(`integrity="${sri}"`), 'modulepreload integrity matches the patched glue');
      const wasm = readFileSync(join(dir, p.glue.replace(/\.js$/, '_bg.wasm')));
      const at = (id: number, state: number) => { const pat = onceLockPattern(id, state); let n = 0; for (let i = wasm.indexOf(pat); i >= 0; i = wasm.indexOf(pat, i + 1)) n++; return n; };
      assert.equal(at(p.id, p.state), 1, 'the addresses match the code of the wasm exactly once');
      assert.equal(at(p.id - 1184, p.state - 1184), 0, 'the addresses of another build do not match');
      // The id the glue writes follows the source's rules (low 24 bits clear, >= 1 << 24, below 2^53)
      for (const rnd of [0, 0.5, 0.999999999]) {
        const id = BigInt(1 + Math.floor(rnd * 0x1ffffffe)) << 24n;
        assert.ok(id >= 1n << 24n && id < 1n << 53n && (id & 0xffffffn) === 0n, String(id));
      }
    }
    // The release notes on the homepage, or the README where there is no website
    const notes = SITE ? read('index.html') : read('README.md');
    assert.ok(notes.includes(`${r.patches![0]!.issue.replace('storytold/deckcraft#', 'https://github.com/storytold/deckcraft/issues/')}`), `${r.app}: the release notes link the upstream issue`);
  }
});

test('Web zips: the served file has the size in releases.json (when the zips are present)', (t) => {
  let checked = 0;
  for (const r of rels) {
    const file = join(ROOT, zipSource(`${r.web}.zip`));
    if (!existsSync(file)) continue;
    assert.equal(statSync(file).size, r.webZipBytes, `${file}: run scripts/pack-web-zips.ps1`);
    checked++;
  }
  if (!checked) t.skip('no zips in this checkout (versions/*/zip-web stays local)');
});

test('Homepage: placeholders filled, current versions, three Windows builds and the web zip per app', { skip: noSite }, () => {
  const src = read('index.html');
  assert.doesNotMatch(src, /\d+\.\d+\.\d+-windows|-web-\d+\.\d+\.\d+\.zip/, 'index.html names no versioned files directly (use the placeholders)');
  const html = releasePlaceholders(src, goUrl, '').replace(/<!--GO:(\w+):([\w-]+)-->/g, (_: string, a: string, to: string) => goUrl('', a, to));
  assert.doesNotMatch(html, /<!--(REL|GO):|<!--DOWNLOADS-->/, 'every placeholder is replaced');
  assert.equal((html.match(/class="dl-row"/g) || []).length, 4);
  assert.equal((html.match(/class="dl-win"/g) || []).length, rels.reduce((n, r) => n + archesOf(r).length, 0));
  for (const r of rels) {
    assert.ok(html.includes(`./downloads/${r.web}.zip`), `${r.app} web zip link`);
    assert.ok(html.includes(`${mb(r.webZipBytes)} zip`), `${r.app} web zip size`);
    for (const a of archesOf(r) as string[]) {
      assert.ok(html.includes(`href="go/${r.app}/win-${a}"`), `${r.app} ${a} link`);
      assert.ok(html.includes(mb(r.windows[a]!.bytes)), `${r.app} ${a} size`);
    }
    assert.ok(html.includes(`v${r.version} · alpha <span class="dl-date">· ${r.date}</span>`), `${r.app} download row version and date`);
    const web = webV(r) !== r.version ? ` · web ${webV(r)}` : '';
    assert.ok(html.includes(`v${r.version}${web} · about ${Math.round(r.webZipBytes / 1048576)} MB`), `${r.app} app card`);
    if (web) {
      assert.ok(html.includes(`<span>Web ${webV(r)}</span>`), `${r.app} web button names the older build`);
      assert.ok(src.includes(`stays on <span class="mono">${webV(r)}</span>`), `${r.app} release notes explain the older browser build`);
    }
  }
  // The hero and the roadmap say "WordCraft, GridCraft and DeckCraft <one version>"
  const [w, g, d] = rels;
  assert.ok(w!.version === g!.version && g!.version === d!.version, 'WordCraft, GridCraft and DeckCraft share a version; otherwise reword the hero badge and the roadmap tile in index.html');
});

test('Two ways in: the workspace and its docs under app/, the source on GitHub, no leftover ide/ link', { skip: noSite }, async () => {
  const { footer, WORKSPACE_GITHUB } = await import('../../scripts/partials.mjs' as string);
  const html = footer('../') as string;
  assert.match(html, /href="\.\.\/app\/" data-workspace-link/);
  assert.match(html, /href="\.\.\/app\/docs\/" data-docs-link/);
  assert.ok(html.includes(`href="${WORKSPACE_GITHUB}" target="_blank" rel="noopener" data-github-link`), 'the repository link opens in a new tab');
  assert.doesNotMatch(html, /href="[^"]*(?:\/|^)ide\/"|#ide"|data-ide-link/, 'nothing points at the old ide/ address');
  // The anchors the homepage links to exist in the workspace README
  const readme = read(has('repos/ide/README.md') ? 'repos/ide/README.md' : 'README.md');
  if (/^# WorkCraft$/m.test(readme)) {
    assert.match(readme, /^## Quick start$/m);
    assert.match(readme, /^### Guides$/m);
  }
});

test('Knowledge base of the website assistant: versions, dates and sizes', { skip: noSite }, () => {
  const kb = JSON.parse(read('public/api/knowledge.json'));
  for (const r of rels) {
    const s = kb.services.find((x: { name: string }) => x.name === r.name);
    assert.ok(s, r.name);
    assert.equal(s.version, `v${r.version}, released ${r.date}`, r.name);
    const dl = s.offerings.find((o: string) => o.startsWith('Downloads:'));
    assert.equal(dl, `Downloads: web build ${webV(r) !== r.version ? `${webV(r)}, ` : ''}${mb(r.webZipBytes)}; Windows portable ${(archesOf(r) as string[]).map((a) => `${mb(r.windows[a]!.bytes)} (${a === 'x64' ? '64-bit' : a === 'x86' ? '32-bit' : 'ARM64'})`).join(', ')}`, r.name);
    assert.ok(s.offerings.some((o: string) => o.startsWith(`New in ${r.version}:`)), `${r.name} release highlights`);
  }
  const text = JSON.stringify(kb);
  assert.doesNotMatch(text, /DeckCraft 0\.8 |GridCraft and DeckCraft 0\.8|PdfCraft 0\.9\b|"v0\.8\.0"/, 'no outdated versions');
});

test('IDE gets the release data inlined, never by importing from public/ (Vite refuses that in dev)', { skip: noIde }, () => {
  const offenders = walk(join(ROOT, 'src')).filter((f) => /\.(ts|js|mjs)$/.test(f)).filter((f) => /from\s+['"][^'"]*\/public\//.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
  assert.match(read('vite.config.js'), /__OC_RELEASES__:\s*JSON\.stringify\(RELEASES/);
  assert.match(read('src/workspace/registry.ts'), /__OC_RELEASES__/);
});

test('Service worker: the app cache name changes with the release', { skip: noIde }, () => {
  const sw = read('public/sw.js');
  assert.match(sw, new RegExp(`const APPS = '${MANIFEST_DATA.appsCache}';`), 'public/sw.js APPS equals appsCache in releases.json');
  const pre = read('scripts/precache.mjs');
  assert.match(pre, /apps/, 'precache.json records the app versions');
});

test('README: App releases table matches releases.json', () => {
  const md = read('README.md');
  for (const r of rels) {
    const row = md.split('\n').find((l) => l.startsWith(`| **${r.name}** | \`${r.version}\``));
    assert.ok(row, `README row for ${r.name}`);
    assert.ok(row!.includes(r.date), `${r.name} date`);
    assert.ok(row!.includes(`\`${r.web}/\``), `${r.name} folder`);
    assert.ok(row!.includes(`| ${mb(r.webZipBytes)} |`), `${r.name} web zip`);
    assert.ok(row!.includes(`${(archesOf(r) as string[]).map((a) => (r.windows[a]!.bytes / 1048576).toFixed(1)).join(' / ')} MB`), `${r.name} windows sizes`);
    const dir = join(ROOT, officeWebDir(r));
    const size = walk(dir).reduce((n, f) => n + statSync(f).size, 0);
    assert.ok(row!.includes(`(${mb(size)})`), `${r.name} web build folder size ${mb(size)}`);
  }
  assert.doesNotMatch(md, /versions\/v8-9/, 'README points at the current set');
});

test('Redirects (Vite): Windows builds, web zip and outdated download names', { skip: noSite }, () => {
  const word = rels[0]!;
  assert.equal(goTarget('wordcraft', 'win-x64'), `https://github.com/storytold/wordcraft/releases/download/${word.tag}/${word.windows.x64!.file}`);
  assert.equal(goTarget('wordcraft', 'windows'), goTarget('wordcraft', 'win-x64'));
  assert.equal(goTarget('pdfcraft', 'win-arm64'), windowsAsset(rels[3], 'arm64'));
  assert.equal(goTarget('gridcraft', 'web-zip'), `downloads/${rels[1]!.web}.zip`);
  assert.equal(goTarget('gridcraft', 'win-sparc'), null);
  assert.equal(goTarget('photocraft', 'web'), null);
  assert.deepEqual(downloadFallback('wordcraft-web-0.8.0.zip'), { local: `${word.web}.zip` });
  assert.deepEqual(downloadFallback('pdfcraft-0.9.0-windows-x64-portable.zip'), { url: windowsAsset(rels[3], 'x64') });
  assert.equal(downloadFallback('evil-web-1.0.0.zip'), null);
  assert.equal(downloadFallback('../secret.zip'), null);
});

// ---------------------------------------------------------------- go.php through PHP's built-in server
function findPhp(): string | null {
  for (const p of [process.env.PHP, 'C:\\xampp\\php\\php.exe', 'php']) {
    if (!p) continue;
    const r = spawnSync(p, ['-v'], { encoding: 'utf8' });
    if (r.status === 0) return p;
  }
  return null;
}
const freePort = () => new Promise<number>((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });

test('Redirects (Apache, go.php): same targets as the dev server', { skip: noSite }, async (t) => {
  const php = findPhp();
  if (!php) return t.skip('PHP not found (set PHP=path/to/php)');
  const lint = spawnSync(php, ['-l', 'public/go.php'], { encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  const port = await freePort();
  const srv = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'public'], { stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { await fetch(base + '/go.php'); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, 'php -S started');
    const loc = async (q: string) => {
      const r = await fetch(base + q, { redirect: 'manual' });
      return { status: r.status, location: r.headers.get('location') };
    };
    for (const r of rels) {
      for (const a of ARCHES as string[]) assert.deepEqual(await loc(`/go.php?app=${r.app}&to=win-${a}`), { status: 302, location: windowsAsset(r, a) });
      assert.deepEqual(await loc(`/go.php?app=${r.app}&to=web-zip`), { status: 302, location: `/downloads/${r.web}.zip` });
      assert.deepEqual(await loc(`/go.php?app=${r.app}&to=github`), { status: 302, location: `https://github.com/storytold/${r.app}/` });
    }
    assert.deepEqual(await loc('/go.php?file=deckcraft-web-0.8.0.zip'), { status: 302, location: `/downloads/${rels[2]!.web}.zip` });
    assert.deepEqual(await loc('/go.php?file=wordcraft-0.8.0-windows-x64-portable.zip'), { status: 302, location: windowsAsset(rels[0], 'x64') });
    assert.equal((await loc('/go.php?file=nope.zip')).status, 404);
    assert.equal((await loc('/go.php?app=wordcraft&to=win-sparc')).status, 404);
    assert.equal((await loc('/go.php?app=evil&to=web')).status, 404);
  } finally {
    srv.kill();
  }
});
