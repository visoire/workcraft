// The WorkCraft brand files: icon sizes, manifests, the traced SVG brand, and (website only) the email logo.
// The same file runs in the website and the workspace repository; checks for a part that is not there are skipped.
// The icons come from assets/workcraft/build/make-icons.mjs (see its README); this test only guards what ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { markSvg, logoSvg, wordmarkSvg } from '../../src/app/icons.js';

const ROOT = resolve('.');
const at = (p: string) => join(ROOT, p);
const read = (p: string) => readFileSync(at(p), 'utf8');

/** Width and height from the PNG header (IHDR). */
function pngSize(p: string): [number, number] {
  const b = readFileSync(at(p));
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${p} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('Icons: every touch and app icon has the size its name promises', () => {
  const want: Record<string, [number, number]> = {
    'public/apple-touch-icon.png': [180, 180],
    'public/assets/icons/favicon-32.png': [32, 32],
    'public/assets/icons/icon-192.png': [192, 192],
    'public/assets/icons/icon-512.png': [512, 512],
    'public/assets/icons/icon-maskable-512.png': [512, 512],
  };
  for (const [p, size] of Object.entries(want)) assert.deepEqual(pngSize(p), size, p);
});

test('favicon.ico holds 16, 32 and 48 pixel images', () => {
  const b = readFileSync(at('public/favicon.ico'));
  assert.equal(b.readUInt16LE(0), 0, 'reserved');
  assert.equal(b.readUInt16LE(2), 1, 'type: icon');
  const n = b.readUInt16LE(4);
  const sizes = Array.from({ length: n }, (_, i) => b[6 + i * 16]).map((s) => s || 256).sort((x, y) => x - y);
  assert.deepEqual(sizes, [16, 32, 48]);
  for (let i = 0; i < n; i++) {
    const len = b.readUInt32LE(6 + i * 16 + 8);
    const off = b.readUInt32LE(6 + i * 16 + 12);
    assert.equal(b.subarray(off + 1, off + 4).toString(), 'PNG', 'entry is a PNG');
    assert.ok(off + len <= b.length);
  }
});

test('favicon.svg: a small, self-contained drawing of the new mark', () => {
  const svg = read('public/favicon.svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[-\d. ]+">/);
  assert.ok(svg.length < 6000, `${svg.length} bytes`);
  assert.doesNotMatch(svg, /<script|<image|href=|<style|url\(/i, 'nothing external, nothing active');
  assert.doesNotMatch(svg, /#0D0D12|rx="8\.5"/i, 'not the old ink tile with the ring');
  assert.match(svg, /fill="#[0-9A-F]{6}"/);
});

test('Manifests: every icon exists and has the size it declares', () => {
  for (const m of ['public/site.webmanifest', 'public/workspace.webmanifest']) {
    if (!existsSync(at(m))) continue;
    const j = JSON.parse(read(m)) as { icons: { src: string; sizes: string }[] };
    assert.ok(j.icons.length >= 3, m);
    for (const i of j.icons) {
      const [w, h] = i.sizes.split('x').map(Number);
      assert.deepEqual(pngSize(join('public', i.src)), [w, h], `${m}: ${i.src}`);
    }
  }
});

test('Page heads link icon files that exist', () => {
  const heads = ['scripts/partials.mjs', 'scripts/error-pages.mjs', 'index.html', 'docs/index.html'].filter((p) => existsSync(at(p)));
  assert.ok(heads.length > 0);
  for (const p of heads) {
    const refs = [...read(p).matchAll(/rel="(?:icon|apple-touch-icon)"[^>]*href="[^"]*?(favicon\.(?:ico|svg)|apple-touch-icon\.png)[^"]*"/g)].map((m) => m[1]!);
    assert.ok(refs.length >= 1, `${p} links an icon`);
    for (const f of refs) assert.ok(existsSync(at(join('public', f))), `${p}: public/${f}`);
  }
});

test('Brand SVG: the mark and the wordmark are drawn in currentColor from the traced paths', async () => {
  const brand = (await import(pathToFileURL(at('src/app/brand.js')).href)) as { MARK: { w: number; h: number; d: string }; WORDMARK: { w: number; h: number; d: string } };
  for (const g of [brand.MARK, brand.WORDMARK]) {
    assert.ok(g.w > 100 && g.h > 50 && g.d.startsWith('M') && g.d.length > 200);
    assert.ok(g.d.length < 6000, 'a few KB at most: it is inlined into pages');
  }
  const mark = markSvg(30);
  assert.match(mark, /^<svg class="mark" width="39" height="[\d.]+" viewBox="0 0 \d+ \d+"/);
  assert.ok(mark.includes('fill="currentColor"') && mark.includes('fill-rule="evenodd"'));
  assert.match(logoSvg(26), /class="logo-mark"/);
  const wm = wordmarkSvg(22, 'wordmark-svg', 'WorkCraft');
  assert.match(wm, /height="22"/);
  assert.match(wm, /role="img" aria-label="WorkCraft"/);
  assert.match(wordmarkSvg(22), /aria-hidden="true"/, 'decorative unless it gets a label');
  const ratio = Number(/width="([\d.]+)"/.exec(wm)![1]) / 22;
  assert.ok(Math.abs(ratio - brand.WORDMARK.w / brand.WORDMARK.h) < 0.02, 'the wordmark keeps its proportions');
  assert.doesNotMatch(read('src/app/icons.js'), /M23\.6 16a7\.6|x="18\.6" y="7\.4"/, 'the old ring-and-block mark is gone');
});

test('Email logo: a PNG at twice the size of the image the template shows', { skip: !existsSync(at('public/assets/logo/email-logo.png')) }, () => {
  const [w, h] = pngSize('public/assets/logo/email-logo.png');
  const tpl = read('public/api/_mail_templates.php');
  assert.match(tpl, /assets\/logo\/email-logo\.png/);
  const m = /<img src="\{\$logo\}" width="(\d+)" height="(\d+)"/.exec(tpl);
  assert.ok(m, 'the layout has the logo image with explicit width and height');
  assert.ok(Math.abs(w / 2 - Number(m![1])) <= 1 && Math.abs(h / 2 - Number(m![2])) <= 1, `${w}x${h} shown at ${m![1]}x${m![2]}`);
  assert.match(tpl, /alt="WorkCraft"/, 'readable when images are blocked');
  assert.ok(statSync(at('public/assets/logo/email-logo.png')).size < 60_000, 'light enough for mail');
});
