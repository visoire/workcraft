// Touch keys (src/ipados/touch-keys.ts): the key tables, the key events they make, the rule for when the bar shows.
//   npx tsx --test tests/server/touch-keys.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPS } from '../../src/ecosystems/catalog.js';
import { DE } from '../../src/app/i18n-de.js';
import { PROFILES, barShows, isApple, keyCodeOf, keyInit, profileOf, type TouchKey } from '../../src/ipados/touch-keys.js';

const keys = (name: keyof typeof PROFILES) => PROFILES[name].filter((i): i is TouchKey => i !== 'sep');

test('Every key of every table is a complete key with a classic key code', () => {
  for (const [name, items] of Object.entries(PROFILES)) {
    for (const k of items) {
      if (k === 'sep') continue;
      assert.ok(k.label && k.key && k.code, `${name}: ${k.label} has a label, a key and a code`);
      assert.notEqual(keyCodeOf(k.code), 0, `${name}: ${k.label} (${k.code}) has a key code`);
    }
    assert.notEqual(items[0], 'sep', `${name}: starts with a key`);
    assert.notEqual(items[items.length - 1], 'sep', `${name}: ends with a key`);
    assert.ok(!items.some((v, i) => v === 'sep' && items[i + 1] === 'sep'), `${name}: no two separators in a row`);
  }
});

test('The labels the bar shows have a German text', () => {
  for (const [name] of Object.entries(PROFILES)) {
    for (const k of keys(name as keyof typeof PROFILES)) {
      for (const text of [k.label, k.hint]) if (text) assert.ok(text in DE || /^[^a-zA-Z]+$/.test(text) || /^(Ripple|Zoom [+−]|Clip)$/.test(text), `${name}: "${text}" is translated`);
    }
  }
});

test('The catalog names a table for FilmCraft and ProCraft and for no app that has none', () => {
  const withKeys = APPS.filter((a) => a.traits.keys);
  assert.deepEqual(withKeys.map((a) => `${a.id}:${a.traits.keys}`).sort(), ['filmcraft:video', 'procraft:paint']);
  for (const a of APPS) assert.equal(profileOf(a.traits.keys) !== null, !!a.traits.keys, `${a.id}: the named table exists`);
  assert.equal(profileOf(undefined), null);
  assert.equal(profileOf('nonsense'), null);
});

test('FilmCraft: the editing keys of the video table (from the community iPad build and FilmCraft shortcuts)', () => {
  const by = (label: string) => keys('video').find((k) => k.label === label)!;
  assert.deepEqual([by('Split').key, by('Split').mods], ['k', ['cmd']]);
  assert.deepEqual([by('Ripple').key, by('Ripple').mods], ['Delete', ['shift']]);
  assert.equal(by('Play').key, ' ');
  assert.equal(by('Delete').kind, 'hot');
  assert.deepEqual([by('In').key, by('Out').key], ['i', 'o']);
});

test('ProCraft: the paint table follows the shortcut map of ProCraft (keys.rs)', () => {
  const by = (label: string) => keys('paint').find((k) => k.label === label)!;
  assert.deepEqual([by('Brush').key, by('Eraser').key, by('Pick').key, by('Select').key, by('Transform').key], ['b', 'e', 'm', 's', 'v']);
  assert.deepEqual([by('Size −').key, by('Size +').key], ['[', ']']);
  assert.deepEqual([by('Undo').mods, by('Redo').mods], [['cmd'], ['cmd', 'shift']]);
  assert.deepEqual([by('Layers').key, by('Colors').key, by('Swap').key, by('Menu').key], ['l', 'c', 'x', ' ']);
});

test('The command key is Meta on Apple platforms and Ctrl elsewhere; the Shift latch adds Shift once', () => {
  const undo = keys('paint').find((k) => k.label === 'Undo')!;
  const mac = keyInit(undo, { apple: true });
  assert.deepEqual([mac.metaKey, mac.ctrlKey, mac.shiftKey, mac.key, mac.code, mac.keyCode], [true, false, false, 'z', 'KeyZ', 90]);
  const pc = keyInit(undo, { apple: false });
  assert.deepEqual([pc.metaKey, pc.ctrlKey], [false, true]);
  const redo = keyInit(keys('paint').find((k) => k.label === 'Redo')!, { apple: true });
  assert.equal(redo.shiftKey, true);
  const brush = keys('paint').find((k) => k.label === 'Brush')!;
  assert.equal(keyInit(brush, { apple: true }).shiftKey, false);
  assert.equal(keyInit(brush, { apple: true, shiftHeld: true }).shiftKey, true);
  assert.deepEqual([mac.bubbles, mac.cancelable, mac.composed], [true, true, true]);
});

test('An iPad counts as Apple even when it reports itself as a Mac', () => {
  assert.equal(isApple('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), true);
  assert.equal(isApple('iPad', ''), true);
  assert.equal(isApple('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
});

test('Key codes of the keys the tables use', () => {
  assert.deepEqual(['Space', 'Delete', 'ArrowLeft', 'Equal', 'Minus', 'BracketLeft', 'BracketRight', 'Digit0', 'KeyK'].map(keyCodeOf), [32, 46, 37, 187, 189, 219, 221, 48, 75]);
  assert.equal(keyCodeOf('Unknown'), 0);
});

test('The bar shows for an app with a table: always on, never off, and in Auto on a touch screen until a hardware keyboard is used', () => {
  const on = { hasProfile: true, touchUi: false, hardwareKeyboard: false };
  assert.equal(barShows({ ...on, pref: 'on' }), true);
  assert.equal(barShows({ ...on, pref: 'on', hardwareKeyboard: true }), true);
  assert.equal(barShows({ ...on, pref: 'off', touchUi: true }), false);
  assert.equal(barShows({ ...on, pref: 'auto' }), false);
  assert.equal(barShows({ ...on, pref: 'auto', touchUi: true }), true);
  assert.equal(barShows({ ...on, pref: 'auto', touchUi: true, hardwareKeyboard: true }), false);
  assert.equal(barShows({ pref: 'on', hasProfile: false, touchUi: true, hardwareKeyboard: false }), false);
});
