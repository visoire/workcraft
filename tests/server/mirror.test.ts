// scripts/mirror-pages.mjs (apps deployed on GitHub Pages) and the relative-paths install fix of scripts/fetch-apps.mjs.
//   npx tsx --test tests/server/mirror.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain .mjs without types
import { extractRefs, resolveRef, localPath, mirrorSite, MAX_FILES } from '../../scripts/mirror-pages.mjs';
// @ts-expect-error plain .mjs without types
import { relativizeRootPaths } from '../../scripts/fetch-apps.mjs';

const BASE = 'https://example.github.io/app/';

test('extractRefs: attributes, imports, new URL and file-like strings; data URLs and templates are left out', () => {
  const html = '<link href="./style.css"><script type="module">import init from "./app.js"; fetch("data/x.json")</script><img src="icon.png"><a href="#top"><img src="data:image/png;base64,AAAA">';
  const refs = extractRefs(html, 'html');
  for (const r of ['./style.css', './app.js', 'data/x.json', 'icon.png']) assert.ok(refs.includes(r), r);
  assert.ok(!refs.some((r: string) => r.startsWith('data:') || r.startsWith('#')));
  const js = 'const u = new URL("app_bg.wasm", import.meta.url); const t = `${base}/x.js`; import("./chunk-1.js")';
  assert.deepEqual(extractRefs(js, 'js').sort(), ['./chunk-1.js', 'app_bg.wasm']);
});

test('resolveRef and localPath: only the site\'s own folder tree, nothing unsafe', () => {
  assert.equal(resolveRef('./app.js', BASE, BASE), 'https://example.github.io/app/app.js');
  assert.equal(resolveRef('sub/a.wasm?v=2#x', BASE + 'index.html', BASE), 'https://example.github.io/app/sub/a.wasm');
  assert.equal(resolveRef('../other/x.js', BASE, BASE), null, 'leaves the folder');
  assert.equal(resolveRef('https://cdn.example.com/x.js', BASE, BASE), null, 'another host');
  assert.equal(localPath(BASE, BASE), 'index.html');
  assert.equal(localPath(BASE + 'a/b.js', BASE), 'a/b.js');
  assert.equal(localPath(BASE + 'brand/logo.svg', BASE), null, 'brand/ is never written');
  assert.equal(localPath(BASE + '.htaccess', BASE), null);
  assert.equal(localPath(BASE + '_headers', BASE), null);
});

function site(files: Record<string, string>) {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    const rel = url.slice(BASE.length) || 'index.html';
    const body = files[rel];
    return body === undefined ? { status: 404, bytes: new Uint8Array() } : { status: 200, bytes: new TextEncoder().encode(body) };
  };
  return { get, calls };
}

test('mirrorSite: follows the page to its script and wasm, skips a guess that is no file, writes only inside the staging folder', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'wc-mirror-'));
  try {
    const { get, calls } = site({
      'index.html': '<script type="module">import init from "./app.js"; init();</script><link rel="icon" href="icon.png">',
      'app.js': 'new URL("app_bg.wasm", import.meta.url); const maybe = "does-not-exist.json";',
      'app_bg.wasm': 'WASM',
      'icon.png': 'PNG',
    });
    const written = await mirrorSite(BASE, staging, get);
    assert.deepEqual(written.map((w: { path: string }) => w.path).sort(), ['app.js', 'app_bg.wasm', 'icon.png', 'index.html']);
    assert.equal(readFileSync(join(staging, 'app_bg.wasm'), 'utf8'), 'WASM');
    assert.ok(calls.includes(BASE + 'does-not-exist.json'), 'the guess was tried, and its 404 is not an error');
    assert.ok(!existsSync(join(staging, 'does-not-exist.json')));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});

test('mirrorSite: refuses what it should: no index.html, a missing wasm, a wrong address, too many files', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'wc-mirror-'));
  try {
    await assert.rejects(mirrorSite(BASE, staging, site({}).get), /answered 404/);
    await assert.rejects(mirrorSite(BASE, staging, site({ 'index.html': '<script type="module">import "./app.js"</script>', 'app.js': 'new URL("gone_bg.wasm", import.meta.url)' }).get), /gone_bg\.wasm answered 404/);
    await assert.rejects(mirrorSite('http://example.com/app/', staging, site({}).get), /https/);
    await assert.rejects(mirrorSite('https://example.com/app', staging, site({}).get), /slash/);
    const many: Record<string, string> = { 'index.html': Array.from({ length: MAX_FILES + 5 }, (_, i) => `<img src="i${i}.png">`).join('') };
    for (let i = 0; i < MAX_FILES + 5; i++) many[`i${i}.png`] = 'x';
    await assert.rejects(mirrorSite(BASE, staging, site(many).get), /refusing to mirror/);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});

test('relativizeRootPaths: root-absolute names of the build\'s own root files become relative, everything else stays', () => {
  const html = `<script type="module">import init, * as b from '/firecraft-web-ab12.js'; await init({ module_or_path: '/firecraft-web-ab12_bg.wasm' });</script><link rel="modulepreload" href="/firecraft-web-ab12.js" integrity="sha384-x"><link href="/other/x.css"><a href="/docs/readme">r</a><img src="/missing.png">`;
  const out = relativizeRootPaths(html, ['index.html', 'firecraft-web-ab12.js', 'firecraft-web-ab12_bg.wasm', 'other/x.css']);
  assert.ok(out.includes("'./firecraft-web-ab12.js'") && out.includes("'./firecraft-web-ab12_bg.wasm'") && out.includes('href="./firecraft-web-ab12.js"'));
  assert.ok(out.includes('href="/other/x.css"'), 'a file in a folder is left');
  assert.ok(out.includes('href="/docs/readme"') && out.includes('src="/missing.png"'), 'not a file of the build: left');
  assert.equal(relativizeRootPaths('<script src="./a.js"></script>', ['a.js']), '<script src="./a.js"></script>', 'already relative: unchanged');
  assert.ok(out.includes('integrity="sha384-x"'), 'integrity is untouched (only the URL changes)');
});
