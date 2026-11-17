// The Model and Base URL dropdowns: every preset's own model and address is offered, a saved value is never lost, nothing is listed twice.
//   npx tsx --test tests/server/model-choices.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../../src/chat/providers.js';
import { MODEL_SUGGESTIONS, baseChoices, mergeChoices, modelChoices, ENDPOINT_PRESETS } from '../../src/chat/model-choices.js';

test('Every preset has its own model first among the suggestions', () => {
  for (const p of PRESETS) assert.equal(MODEL_SUGGESTIONS[p.id]?.[0], p.model, `${p.id}: the preset's model leads the suggestions`);
});

test('The address of a provider is always offered, a known alternative after it', () => {
  for (const p of PRESETS) {
    const c = baseChoices(p.id, p.baseUrl);
    assert.equal(c[0]!.value, p.baseUrl, p.id);
    assert.equal(new Set(c.map((x) => x.value)).size, c.length, `${p.id}: no address twice`);
  }
  assert.ok(baseChoices('custom', '').length >= 6, 'an own endpoint gets the known servers');
  assert.ok(ENDPOINT_PRESETS.every((e) => /^https?:\/\//.test(e.value)));
});

test('A saved value that is not a suggestion stays in the list, live models are added once', () => {
  const m = mergeChoices('my-finetune', modelChoices('openai'), ['gpt-5', 'gpt-5-mini']);
  assert.equal(m[0]!.value, 'my-finetune');
  assert.deepEqual(m.map((x) => x.value), ['my-finetune', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-5-mini']);
  assert.deepEqual(mergeChoices('', [], []), []);
});
