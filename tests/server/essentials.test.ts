// The simpler interface: which personas the menu offers, and the order of the app icons in the tool rail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedPersonas } from '../../src/chat/essentials.js';
import { dropIndex, moveApp, orderApps, sanitizeRailOrder, stepApp } from '../../src/ecosystems/rail-order.js';
import { readFileSync } from 'node:fs';

test('Persona menu: Standard, the personas that suit the workspace, and the one in use; nothing else', () => {
  const personas = [
    { id: 'default' },
    { id: 'finance', apps: ['gridcraft'] },
    { id: 'writer', apps: ['wordcraft'] },
    { id: 'retoucher', apps: ['photocraft'] },
    { id: 'cad', apps: ['cadcraft'] },
  ];
  assert.deepEqual(suggestedPersonas(personas, ['gridcraft', 'wordcraft'], 'default').map((p) => p.id), ['default', 'finance', 'writer']);
  assert.deepEqual(suggestedPersonas(personas, ['gridcraft'], 'cad').map((p) => p.id), ['default', 'finance', 'cad'], 'the one in use stays visible so its check shows');
  assert.deepEqual(suggestedPersonas(personas, ['earthcraft'], 'default').map((p) => p.id), ['default']);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, apps: ['gridcraft'] }));
  assert.equal(suggestedPersonas([{ id: 'default' }, ...many], ['gridcraft'], 'default').length, 6, 'Standard plus five');
});

test('Rail order: the saved order first, new apps at the end, stale ids ignored', () => {
  const apps = ['a', 'b', 'c', 'd'];
  assert.deepEqual(orderApps(apps, undefined), apps);
  assert.deepEqual(orderApps(apps, ['c', 'a']), ['c', 'a', 'b', 'd']);
  assert.deepEqual(orderApps(apps, ['x', 'd', 'd', 'b']), ['d', 'b', 'a', 'c'], 'unknown and repeated ids change nothing');
});

test('Rail order: move to a place, one step, and where a dragged icon lands', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveApp(list, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveApp(list, 'a', 99), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveApp(list, 'zz', 1), list);
  assert.deepEqual(stepApp(list, 'b', -1), ['b', 'a', 'c', 'd']);
  assert.deepEqual(stepApp(list, 'a', -1), list, 'the first stays first');
  assert.deepEqual(stepApp(list, 'd', 1), list, 'the last stays last');
  // the other three icons sit at y 100, 140, 180
  assert.equal(dropIndex(50, [100, 140, 180]), 0);
  assert.equal(dropIndex(120, [100, 140, 180]), 1);
  assert.equal(dropIndex(500, [100, 140, 180]), 3);
});

test('Rail order: damaged pref data becomes an empty order', () => {
  assert.deepEqual(sanitizeRailOrder(null), {});
  assert.deepEqual(sanitizeRailOrder([1, 2]), {});
  assert.deepEqual(sanitizeRailOrder({ office: ['a', 5, 'b'], bad: 'x' }), { office: ['a', 'b'] });
});

test('The panel header has two buttons: Maximize and X (source check)', () => {
  const src = readFileSync(new URL('../../src/workspace/layout.ts', import.meta.url), 'utf8');
  const head = src.slice(src.indexOf("'header.panel-head'"), src.indexOf("head.addEventListener('dblclick'"));
  assert.match(head, /btn\.max,\s*btn\.close\s*\)/, 'the header ends with Maximize and X');
  assert.doesNotMatch(head, /btn\.hide|\bmore\b/, 'no Hide eye and no More button in the header');
});
