// The guard that ends an answer when the same tool call keeps failing.
//   npx tsx --test tests/server/loop-guard.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FailureGuard, MAX_SAME_FAILURES } from '../../src/chat/loop-guard.js';

test('the third failure of the same call stops the answer, the fourth call is not run', () => {
  const g = new FailureGuard();
  assert.equal(MAX_SAME_FAILURES, 3);
  const args = { path: '/sheets/a.xlsx', range: 'A1' };
  for (let i = 0; i < 2; i++) {
    assert.equal(g.blocked('read-sheet', args), false);
    g.failed('read-sheet', args);
    assert.equal(g.stuck, null, `not yet after ${i + 1} failures`);
  }
  assert.equal(g.blocked('read-sheet', args), false);
  g.failed('read-sheet', args);
  assert.equal(g.stuck, 'read-sheet');
  assert.equal(g.blocked('read-sheet', { range: 'A1', path: '/sheets/a.xlsx' }) || g.blocked('read-sheet', args), true, 'the same arguments are blocked');
});

test('other arguments or another tool start counting again', () => {
  const g = new FailureGuard();
  g.failed('write-sheet', { path: '/a' });
  g.failed('write-sheet', { path: '/a' });
  g.failed('write-sheet', { path: '/b' });
  g.failed('read-sheet', { path: '/a' });
  assert.equal(g.stuck, null);
  assert.equal(g.blocked('write-sheet', { path: '/b' }), false);
});

test('a new answer starts clean', () => {
  const g = new FailureGuard();
  for (let i = 0; i < 3; i++) g.failed('run-command', { command: 'x' });
  assert.equal(g.stuck, 'run-command');
  g.reset();
  assert.equal(g.stuck, null);
  assert.equal(g.blocked('run-command', { command: 'x' }), false);
});
