// The first start: who sees the onboarding, its steps, what is remembered, and that it runs before the workspace loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { next, needsOnboarding, position, prev, readRemembered, remember, sanitizeRemembered, STEPS, type StartFacts } from '../../src/app/onboarding-state.js';
import { DE } from '../../src/app/i18n-de.js';

const base: StartFacts = { chosen: false, linked: false, popout: false, automated: false, forced: false };

test('A new user in a normal window sees the onboarding; everyone else does not', () => {
  assert.equal(needsOnboarding(base), true);
  assert.equal(needsOnboarding({ ...base, chosen: true }), false, 'a returning user');
  assert.equal(needsOnboarding({ ...base, linked: true }), false, 'a link chose the workspace');
  assert.equal(needsOnboarding({ ...base, automated: true }), false, 'automated browsers (the test runs)');
  assert.equal(needsOnboarding({ ...base, popout: true }), false, 'a separate window of one panel');
});

test('?onboarding=1 forces the page, but never inside a pop-out window', () => {
  assert.equal(needsOnboarding({ ...base, chosen: true, automated: true, forced: true }), true);
  assert.equal(needsOnboarding({ ...base, forced: true, popout: true }), false);
});

test('Three steps in order: welcome, workspace, files', () => {
  assert.deepEqual([...STEPS], ['welcome', 'workspace', 'files']);
  assert.equal(next('welcome'), 'workspace');
  assert.equal(next('files'), null);
  assert.equal(prev('welcome'), null);
  assert.equal(prev('files'), 'workspace');
  assert.deepEqual(position('workspace'), { n: 2, of: 3 });
});

test('The answer about the files is remembered in the browser and read back; damaged data counts as not asked', () => {
  const store: Record<string, string> = {};
  const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) };
  assert.equal(readRemembered(storage), null);
  remember('local', storage, 1234);
  assert.deepEqual(readRemembered(storage), { files: 'local', at: 1234 });
  remember('connect', storage, 5);
  assert.equal(readRemembered(storage)?.files, 'connect');
  assert.equal(sanitizeRemembered({ files: 'bank' }), null);
  assert.equal(sanitizeRemembered('x'), null);
  assert.deepEqual(sanitizeRemembered({ files: 'skipped' }), { files: 'skipped', at: 0 });
  store['workcraft.onboarding'] = '{not json';
  assert.equal(readRemembered(storage), null);
});

test('main.ts runs the onboarding before it builds the top bar, the rail and loads the project (source check)', () => {
  const src = readFileSync(new URL('../../src/app/main.ts', import.meta.url), 'utf8');
  const boot = src.slice(src.indexOf('async function boot()'));
  const at = (s: string) => boot.indexOf(s);
  assert.ok(at('runOnboarding()') > 0, 'boot runs the onboarding');
  assert.ok(at('runOnboarding()') < at('buildTopbar()'), 'before the top bar');
  assert.ok(at('runOnboarding()') < at('buildActivity()'), 'before the tool rail');
  assert.ok(at('runOnboarding()') < at('await loadProject()'), 'before the project, its tree and the chat');
  assert.ok(at('runOnboarding()') < at('live.connect()'), 'before the live connection');
});

test('Settings is at the top right, not at the bottom of the rail (source check)', () => {
  const src = readFileSync(new URL('../../src/app/main.ts', import.meta.url), 'utf8');
  assert.match(src, /top-actions[^)]*settingsBtn/);
  const rail = src.slice(src.indexOf('function buildActivity()'), src.indexOf('function toggleSide'));
  assert.doesNotMatch(rail, /openPanel\('settings'\)/, 'the rail no longer ends with the settings button');
});

test('Every text of the onboarding has a German version', () => {
  const src = readFileSync(new URL('../../src/app/onboarding.ts', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
  assert.ok(keys.length > 10);
  const known = new Set(['Back', 'Welcome', 'Buy me a coffee']);
  for (const k of keys) assert.ok(DE[k] || known.has(k) || DE[k.trim()], `German text for "${k}"`);
});
