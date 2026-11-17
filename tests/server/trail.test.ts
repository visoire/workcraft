// The pencil trail: samples that sit on top of each other are dropped, the true end of the stroke is kept.
//   npx tsx --test tests/server/trail.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thin } from '../../src/workspace/trail.js';

test('Samples closer than a step are dropped and the last one stays', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0.2, y: 0.1 }, { x: 5, y: 0 }, { x: 5.3, y: 0 }, { x: 10, y: 0 }, { x: 10.1, y: 0.1 }];
  const out = thin(pts);
  assert.deepEqual(out.map((p) => p.x), [0, 5, 10.1]);
  assert.equal(out[out.length - 1], pts[pts.length - 1], 'the line reaches the tip');
});

test('One sample is one dot, nothing is invented', () => {
  assert.deepEqual(thin([{ x: 3, y: 4 }]), [{ x: 3, y: 4 }]);
  assert.deepEqual(thin([]), []);
});
