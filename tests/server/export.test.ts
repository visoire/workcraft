// Exports follow the color scheme: a white page in light mode, a black one in dark mode (HTML gallery and PDF).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';

process.env.WORKCRAFT_HOME = mkdtempSync(join(tmpdir(), 'wc-export-'));
const P = await import('../../src/server/projects.ts');
const { exportHtml, exportPdf, exportTheme } = await import('../../src/server/export.ts');
const { blankXlsx } = await import('../../src/core/blank.ts');

const meta = await P.createProject('Theme test', 'empty');
const { PROJECTS_DIR } = await import('../../src/server/paths.ts');
const root = join(PROJECTS_DIR, meta.id);
await P.writeProjectFile(root, '/documents/note.md', '# Hello\n\nA note with `code`.\n');
await P.writeProjectFile(root, '/sheets/new.xlsx', blankXlsx());

test('the theme query is normalized', () => {
  assert.equal(exportTheme('dark'), 'dark');
  assert.equal(exportTheme('light'), 'light');
  assert.equal(exportTheme('anything'), 'light');
  assert.equal(exportTheme(undefined), 'light');
});

test('HTML gallery: light is white, dark is black, every page carries its scheme', async () => {
  for (const [theme, bg] of [['light', '--bg:#ffffff'], ['dark', '--bg:#0b0b0b']] as const) {
    const files = unzipSync((await exportHtml(meta.id, false, theme)).bytes);
    const names = Object.keys(files);
    assert.ok(names.includes('index.html') && names.some((n) => n.startsWith('pages/')), 'index and pages exist');
    for (const n of names.filter((x) => x.endsWith('.html'))) {
      const html = strFromU8(files[n]!);
      assert.ok(html.includes(bg) && html.includes(`data-theme="${theme}"`) && html.includes(`color-scheme:${theme}`), `${theme}: ${n}`);
      assert.ok(!html.includes('prefers-color-scheme'), 'the page does not switch on its own');
    }
  }
});

test('PDF portfolio: dark pages are painted black, light pages stay plain, both open', async () => {
  const dark = await exportPdf(meta.id, false, 'dark');
  const light = await exportPdf(meta.id, false, 'light');
  assert.ok((await PDFDocument.load(dark.bytes)).getPageCount() >= 3);
  assert.ok(dark.bytes.byteLength > light.bytes.byteLength, 'the black background adds drawing operations');
  assert.equal((await PDFDocument.load(light.bytes)).getPageCount(), (await PDFDocument.load(dark.bytes)).getPageCount());
});
