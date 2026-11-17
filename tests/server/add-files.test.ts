// The "+" menu helpers: which entry a device gets, where the files go, and what a scan is called.
//   npx tsx --test tests/server/add-files.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addKindFor, folderFor, scanName } from '../../src/project/add-files-rules.js';

test('An iPad gets the scan, every other device the upload', () => {
  assert.equal(addKindFor({ ipad: true }), 'scan');
  assert.equal(addKindFor({ ipad: false }), 'upload');
});

test('Scans and uploads go to their own folders', () => {
  assert.equal(folderFor('scan'), '/Scans');
  assert.equal(folderFor('upload'), '/Uploads');
});

test('A picture without a useful name becomes "Scan <date time>", a named file keeps its name', () => {
  const now = new Date(2026, 10, 18, 14, 5);
  assert.equal(scanName('image.jpg', now, 0), 'Scan 2026-11-18 14-05.jpg');
  assert.equal(scanName('image (2).jpeg', now, 1), 'Scan 2026-11-18 14-05 2.jpeg');
  assert.equal(scanName('IMG_0042.heic', now, 0), 'Scan 2026-11-18 14-05.heic');
  assert.equal(scanName('Invoice March.pdf', now, 0), 'Invoice March.pdf');
});
