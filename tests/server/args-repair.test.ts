// Tool arguments that arrive as text: an array written into a string, with or without a bracket missing.
// The case comes from a real chat (qwen3.5:4b, create-slide): the slides were one string and the third slide's
// object was never closed, so validation failed with two confusing messages and cost a model round.
//   npx tsx --test tests/server/args-repair.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArgs } from '../../src/mcp/schemas.js';
import { repairJson } from '../../src/core/json-repair.js';

// The third slide misses the "}" after its bullets
const BROKEN =
  '[{"title": "The Iron Beasts", "bullets": ["1886 - First cars in France (Emile & Lioré)", "1889 - Benz Patent-Motorwagen completed"]}, {"title": "Mass Production Era", "bullets": ["Assembly lines begin 1913"]}, {"title": "From Petrol to Electric", "bullets": ["Late 1800s - Gasoline engines dominate", "Modern EVs promise clean cities again"], {"title": "Today\'s World", "bullets": ["Hybrid and electric vehicles rising"]}]';

test('an object left open before the next one is closed by the repair pass', () => {
  const r = repairJson(BROKEN);
  assert.ok(r, 'repaired');
  const slides = r.value as { title: string; bullets: string[] }[];
  assert.deepEqual(slides.map((s) => s.title), ['The Iron Beasts', 'Mass Production Era', 'From Petrol to Electric', "Today's World"]);
  assert.equal(slides[2]!.bullets.length, 2);
  assert.ok(r.notes.includes('closed an object that was left open'));
});

test('valid JSON is not touched by the new rule', () => {
  const ok = '[{"a":1,"list":[1,2]},{"a":2}]';
  assert.deepEqual(repairJson(ok), { value: [{ a: 1, list: [1, 2] }, { a: 2 }], repaired: false, notes: [] });
  assert.deepEqual(repairJson('{"a":{"b":1},"c":[{"d":2}]}')?.value, { a: { b: 1 }, c: [{ d: 2 }] });
});

test('create-slide accepts slides sent as text, also a broken one', () => {
  const args = { path: '/presentations/start.pptx', title: 'Cars', slides: BROKEN, mode: 'append' };
  const r = validateArgs('create-slide', args);
  assert.ok(r.ok, JSON.stringify(r));
  if (r.ok) {
    assert.equal((r.data.slides as unknown[]).length, 4);
    assert.equal((r.data.slides as { title: string }[])[3]!.title, "Today's World");
  }
  const clean = validateArgs('create-slide', { path: '/p.pptx', slides: JSON.stringify([{ title: 'A', bullets: ['x'] }]) });
  assert.ok(clean.ok);
});

test('text that cannot be repaired gives one clear message, not two', () => {
  const r = validateArgs('create-slide', { path: '/p.pptx', slides: 'one slide about cars' });
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.equal(r.issues.length, 1);
    assert.match(r.issues[0]!, /^slides: expected an array, got text that is not valid JSON/);
  }
});

test('other validation errors keep their messages', () => {
  const r = validateArgs('create-slide', { path: '/p.pptx', slides: [] });
  assert.ok(!r.ok);
  const bad = validateArgs('read-sheet', {});
  assert.ok(!bad.ok);
});
