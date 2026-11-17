// The document scanner: finding the paper, straightening it, cleaning it up, the PDF. No camera here: synthetic pictures.
//   npx tsx --test tests/server/scan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyH, buildPdf, enhance, findPaper, homography, insetQuad, otsu, pageSize, quadArea, warp, type Quad } from '../../src/core/scan.js';

/** A dark table with a bright sheet: a rectangle from (x0,y0) to (x1,y1). */
function sheet(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const g = new Uint8Array(w * h).fill(40);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = 215;
  return g;
}

test('Otsu puts the threshold between the dark and the bright', () => {
  const t = otsu(sheet(40, 40, 10, 10, 30, 30));
  assert.ok(t >= 40 && t < 215, String(t)); // pixels above it are the sheet
});

test('The paper is found: its four corners are close to the sheet', () => {
  const q = findPaper(sheet(120, 90, 20, 15, 100, 75), 120, 90);
  const want = [[20, 15], [99, 15], [99, 74], [20, 74]];
  q.forEach((p, i) => assert.ok(Math.hypot(p.x - want[i]![0]!, p.y - want[i]![1]!) < 6, `corner ${i}: ${p.x},${p.y}`));
});

test('A picture without a clear sheet gives the inset start quad (a page to drag, never nothing)', () => {
  const flat = new Uint8Array(100 * 80).fill(128);
  const q = findPaper(flat, 100, 80);
  assert.deepEqual(q, insetQuad(100, 80));
  assert.ok(quadArea(q) > 100 * 80 * 0.5);
});

test('The homography maps the corners to the corners and the middle to the middle', () => {
  const src: Quad = [{ x: 10, y: 5 }, { x: 90, y: 12 }, { x: 95, y: 80 }, { x: 4, y: 70 }];
  const dst: Quad = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 280 }, { x: 0, y: 280 }];
  const m = homography(src, dst);
  src.forEach((p, i) => {
    const r = applyH(m, p);
    assert.ok(Math.hypot(r.x - dst[i]!.x, r.y - dst[i]!.y) < 1e-6, `corner ${i}`);
  });
});

test('The page keeps the proportions of the paper and stays under the size limit', () => {
  const q: Quad = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4200 }, { x: 0, y: 4200 }];
  const s = pageSize(q, 2200);
  assert.equal(s.h, 2200);
  assert.ok(Math.abs(s.w / s.h - 3000 / 4200) < 0.01);
});

test('Straightening a rectangle that fills the picture gives the picture back', () => {
  const w = 12, h = 8;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = i * 3; px[i * 4 + 1] = 100; px[i * 4 + 2] = 50; px[i * 4 + 3] = 255; }
  const out = warp(px, w, h, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], { w, h });
  for (let i = 0; i < px.length; i++) assert.ok(Math.abs(out[i]! - px[i]!) <= 1, `byte ${i}`);
});

test('Black and white has only two values, grey keeps the middle', () => {
  const mk = () => { const a = new Uint8ClampedArray(16 * 4); for (let i = 0; i < 16; i++) { const v = i * 16; a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = v; a[i * 4 + 3] = 255; } return a; };
  const bw = mk(); enhance(bw, 'bw');
  assert.deepEqual([...new Set([...bw].filter((_, i) => i % 4 === 0))].sort((a, b) => a - b), [0, 255]);
  const gray = mk(); enhance(gray, 'gray');
  assert.ok(new Set([...gray].filter((_, i) => i % 4 === 0)).size > 4);
});

test('The PDF has its structure: header, one page per picture, an xref whose offsets point at the objects', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildPdf([{ jpeg, w: 150, h: 200 }, { jpeg, w: 300, h: 300 }]);
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Count 2/);
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.match(text, /\/MediaBox \[0 0 72\.00 96\.00\]/, 'a 150 x 200 picture is 72 x 96 points at 150 dpi');
  const xref = Number(text.match(/startxref\n(\d+)/)![1]);
  assert.ok(text.slice(xref).startsWith('xref'));
  const rows = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  assert.equal(rows.length, 8);
  rows.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} at ${off}`));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});
