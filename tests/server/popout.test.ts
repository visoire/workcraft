// Separate windows for panels: the address of the window page and what it accepts.
//   npx tsx --test tests/server/popout.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { popoutParams, popoutUrl } from '../../src/workspace/popout.js';

test('a window page is recognised by ?popout=1 with a tool and an id', () => {
  assert.deepEqual(popoutParams('?popout=1&tool=wordcraft&id=wordcraft-ko6jbdn&path=%2Fdocuments%2Fproposal.docx'), { id: 'wordcraft-ko6jbdn', tool: 'wordcraft', path: '/documents/proposal.docx' });
  assert.deepEqual(popoutParams('?popout=1&tool=code&id=code-1'), { id: 'code-1', tool: 'code', path: null });
});

test('the workspace itself and malformed addresses are not window pages', () => {
  assert.equal(popoutParams(''), null);
  assert.equal(popoutParams('?mode=chat'), null);
  assert.equal(popoutParams('?popout=0&tool=wordcraft&id=a'), null);
  assert.equal(popoutParams('?popout=1&tool=wordcraft'), null, 'no id');
  assert.equal(popoutParams('?popout=1&id=a'), null, 'no tool');
  assert.equal(popoutParams('?popout=1&tool=wordcraft&id=a%20b'), null, 'ids are plain words');
  assert.equal(popoutParams('?popout=1&tool=word%2Fcraft&id=a'), null, 'tools are plain words');
});

test('only project paths are accepted, never an address or a relative path', () => {
  assert.equal(popoutParams('?popout=1&tool=wordcraft&id=a&path=https%3A%2F%2Fevil.example%2Fx')?.path, null);
  assert.equal(popoutParams('?popout=1&tool=wordcraft&id=a&path=documents%2Fx.docx')?.path, null);
});

test('the window address round-trips', () => {
  (globalThis as { location?: unknown }).location = { origin: 'http://127.0.0.1:5176', search: '' };
  const url = popoutUrl({ id: 'wordcraft-1', tool: 'wordcraft', path: '/documents/a b.docx' });
  assert.match(url, /^http:\/\/127\.0\.0\.1:5176\/\?popout=1/);
  assert.deepEqual(popoutParams(new URL(url).search), { id: 'wordcraft-1', tool: 'wordcraft', path: '/documents/a b.docx' });
});
