// Light and dark mode per app: the capability data of the catalog, the rules that turn it into a look, the embedded map of
// public/craft-theme.js and the CSS bridge. The guide is docs/THEMING.md.
//   npx tsx --test tests/server/theme.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPS } from '../../src/ecosystems/catalog.js';
import { FOLLOWING, appLook, describeTheme, followsWorkspace, kindOf, lookIn, scriptMap, themeOf, type AppTheme } from '../../src/ecosystems/theme.js';
import { block, current } from '../../scripts/sync-themes.mjs';

const read = (p: string) => readFileSync(p, 'utf8');

test('Every app of the catalog declares what it does with the theme, with evidence', () => {
  for (const a of APPS) {
    const t = a.theme as AppTheme | undefined;
    assert.ok(t, `${a.id} has a theme`);
    assert.ok(['both', 'light', 'dark'].includes(t!.modes), `${a.id} modes`);
    assert.ok(['media', 'switch', 'css', 'own', 'fixed'].includes(t!.via), `${a.id} via`);
    assert.ok(t!.evidence && t!.evidence.length > 8, `${a.id} says where the fact comes from`);
    if (t!.via === 'own') assert.ok(t!.look === 'light' || t!.look === 'dark', `${a.id}: an app with its own setting says which look it shows`);
    if (t!.via === 'fixed') assert.ok(t!.modes !== 'both', `${a.id}: a fixed app has one look`);
    if (followsWorkspace(t!)) assert.equal(t!.modes, 'both', `${a.id}: only an app with both looks can follow`);
  }
});

test('The four office apps and the measured followers follow the workspace switch', () => {
  for (const id of ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft', 'figcraft', 'mailcraft', 'paintrs', 'pixelcraft', 'notecraft', 'oxiguitar', 'transit', 'align']) {
    assert.ok(followsWorkspace(themeOf(APPS.find((a) => a.id === id))), id);
  }
  assert.equal(themeOf(APPS.find((a) => a.id === 'wordcraft')).via, 'switch');
  assert.equal(themeOf(APPS.find((a) => a.id === 'deckcraft')).via, 'switch');
  assert.equal(themeOf(APPS.find((a) => a.id === 'align')).via, 'css');
});

test('Rules: a follower has the look of the workspace, a dark-only app stays dark in a light workspace, an own app keeps its default look', () => {
  assert.equal(appLook('gridcraft', 'light'), 'light');
  assert.equal(appLook('gridcraft', 'dark'), 'dark');
  assert.equal(appLook('anicraft', 'light'), 'dark', 'dark only');
  assert.equal(appLook('matcraft', 'dark'), 'light', 'light only');
  assert.equal(appLook('soundcraft', 'light'), 'dark', 'own setting, ships dark');
  assert.equal(appLook('photocraft', 'light'), 'light', 'its button is pressed to Auto: it follows the switch');
  assert.equal(appLook('tracedraw', 'dark'), 'light', 'own setting, ships light');
  assert.equal(appLook('does-not-exist', 'light'), 'dark', 'an unknown app is treated as dark only');
  assert.equal(lookIn({ modes: 'both', via: 'media' }, 'dark'), 'dark');
});

test('Kinds and sentences: what the settings page and the tooltips say', () => {
  assert.equal(kindOf({ modes: 'both', via: 'switch' }), 'follows');
  assert.equal(kindOf({ modes: 'both', via: 'own', look: 'dark' }), 'own');
  assert.equal(kindOf({ modes: 'dark', via: 'fixed' }), 'always-dark');
  assert.equal(kindOf({ modes: 'light', via: 'fixed' }), 'always-light');
  assert.match(describeTheme({ modes: 'both', via: 'own', look: 'dark' }), /own light and dark setting, shows dark/);
  assert.deepEqual([...FOLLOWING], ['media', 'switch', 'css']);
});

test('public/craft-theme.js embeds the catalog (run npm run themes:sync when this fails)', () => {
  const src = read('public/craft-theme.js').replace(/\r\n/g, '\n');
  assert.equal(current(src), block(), 'the THEMES block equals what the catalog says');
  const map = scriptMap(APPS);
  assert.equal(Object.keys(map).length, APPS.length);
  for (const a of APPS) assert.ok(src.includes(`"${a.id}": ${JSON.stringify(map[a.id])}`), a.id);
});

test('public/craft-theme.js: a one-look app is forced to its look, the CSS bridge rewrites color scheme media rules, the workspace is told apart from the OS', () => {
  const s = read('public/craft-theme.js');
  assert.match(s, /FORCED = spec && spec\[1\] === 'fixed'/, 'a fixed app always sees its own look');
  assert.match(s, /if \(FORCED\) return FORCED;/);
  assert.match(s, /prefers-color-scheme/);
  assert.match(s, /\(min-width: 0px\)[\s\S]*\(max-width: 0px\)/, 'the clause becomes always true or always false');
  assert.match(s, /MutationObserver/, 'stylesheets that arrive later are bridged too');
  assert.match(s, /CraftTheme = \{[\s\S]*spec:/, 'the page reports what the catalog says about it');
});

test('The panel paints the frame for the look the app keeps, and the settings page lists every app', () => {
  const panel = read('src/workspace/panels/craftapp.ts');
  assert.match(panel, /bindPanelLook\(root, ctx\.tool\)/);
  assert.match(panel, /unbindLook\(\)/, 'the watcher is removed with the panel');
  const css = read('src/styles/ecosystems.css');
  assert.match(css, /\.ca\[data-differs="true"\]\[data-look="dark"\]/);
  assert.match(css, /\.ca\[data-differs="true"\]\[data-look="light"\]/);
  const settings = read('src/workspace/panels/settings.ts');
  assert.match(settings, /function themeTable\(\)/);
  assert.match(settings, /APPS\.map\(\(a\) => h\('div\.sp-row\.theme-row'/);
});

test('Adding an app needs its theme: the guide says how, and the fetch scripts do not guess', () => {
  const guide = read('docs/THEMING.md');
  for (const need of ['via', 'themes:sync', 'apps:audit', 'catalog.json', 'own', 'fixed', 'css']) assert.ok(guide.includes(need), `THEMING.md mentions ${need}`);
});
