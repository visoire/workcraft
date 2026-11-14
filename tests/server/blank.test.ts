// New files are valid packages: the assistant tools read them and the apps can open them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { blankFor, needsBlank, blankXlsx, blankDocx, blankPptx, blankPdf } from '../../src/core/blank.ts';
import { readSheet } from '../../src/server/office/sheets.ts';
import { readDocument } from '../../src/server/office/docs.ts';
import { readPptxText } from '../../src/server/office/slides.ts';
import { readPdf } from '../../src/server/office/pdf.ts';

const wellFormed = (xml: string) => {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[\s\S]*?\?>/g, '').matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], 'closing tag matches');
    else stack.push(m[2]!);
  }
  assert.equal(stack.length, 0, 'every tag is closed');
};

test('every new office file is a zip package with well-formed parts and the right content types', () => {
  for (const [name, make] of [['xlsx', blankXlsx], ['docx', blankDocx], ['pptx', blankPptx]] as const) {
    const files = unzipSync(make());
    assert.ok(files['[Content_Types].xml'] && files['_rels/.rels'], `${name}: package parts`);
    const ct = strFromU8(files['[Content_Types].xml']!);
    for (const [path, data] of Object.entries(files)) {
      wellFormed(strFromU8(data));
      if (!path.startsWith('[') && !path.includes('_rels/') && path.endsWith('.xml') && !path.includes('theme') ) assert.ok(ct.includes(`/${path}`), `${name}: content type for ${path}`);
    }
  }
});

test('the assistant tools read new files without errors', async () => {
  const sheet = await readSheet(blankXlsx(), 'xlsx', {});
  assert.equal(sheet.sheet, 'Sheet1');
  assert.equal((await readDocument(blankDocx(), 'docx')).trim(), '');
  assert.deepEqual(readPptxText(blankPptx()).map((s) => s.texts.length), [0]);
  const pdf = await readPdf(blankPdf());
  assert.equal(pdf.pages, 1);
});

test('files that already exist with 0 bytes read as empty instead of failing', async () => {
  const empty = new Uint8Array(0);
  assert.equal((await readSheet(empty, 'xlsx', {})).sheet, 'Sheet1');
  assert.equal((await readDocument(empty, 'docx')).trim(), '');
  assert.deepEqual(readPptxText(empty), []);
  assert.equal((await readPdf(empty)).pages, 0);
});

test('blankFor: packages for office files and PDFs, empty text for the rest', () => {
  assert.ok(needsBlank('XLSX') && needsBlank('pdf') && !needsBlank('md'));
  assert.ok((blankFor('docx') as Uint8Array).byteLength > 200);
  assert.equal(blankFor('md'), '');
  assert.equal(strFromU8(blankPdf()).slice(0, 8), '%PDF-1.4');
});
