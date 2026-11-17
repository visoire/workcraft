// The cloud guide: which services are offered, the simplest way to each on every device, the steps, the folder finder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { ALL_STEPS, PROVIDERS, providerById, routesFor, stepsFor, zipName, type Ctx } from '../../src/app/cloud-providers.js';
import { detectSyncFolders, type DetectDeps } from '../../src/server/cloud-detect.js';
import { DE } from '../../src/app/i18n-de.js';

const base: Ctx = { noFolder: false, browserMode: false, canPick: false, detected: false };
const dropbox = providerById('dropbox')!;

test('The guide offers Google Drive, iCloud Drive, OneDrive, Dropbox, MEGA, Proton Drive and any other service', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ['gdrive', 'icloud', 'onedrive', 'dropbox', 'mega', 'proton', 'other']);
  for (const p of PROVIDERS.filter((x) => x.id !== 'other')) assert.match(p.site, /^https:\/\//, `${p.name} has a page to get the app`);
});

test('Every service with an icon has a clean local SVG file (no script, no link), and another service has none', () => {
  for (const p of PROVIDERS) {
    if (p.id === 'other') {
      assert.equal(p.logo, undefined);
      continue;
    }
    assert.ok(p.logo, `${p.name} has an icon`);
    const svg = readFileSync(new URL(`../../public/assets/cloud/${p.logo}`, import.meta.url), 'utf8');
    assert.match(svg, /^<svg /, p.logo);
    assert.doesNotMatch(svg, /<script|\son\w+=|javascript:|href=|<image|<style/i, `${p.logo} is a plain vector`);
    assert.match(svg, /fill="#[0-9A-Fa-f]{6}"/, `${p.logo} carries its brand color`);
  }
  assert.ok(readFileSync(new URL('../../public/assets/cloud/ATTRIBUTION.txt', import.meta.url), 'utf8').includes('CC0'));
});

test('On a computer with the desktop backend: one button when the folder was found, else the folder path; the ZIP is always the last way', () => {
  assert.deepEqual(routesFor(dropbox, { ...base, detected: true }), ['folder-found', 'zip']);
  assert.deepEqual(routesFor(dropbox, base), ['folder-path', 'zip']);
  assert.deepEqual(routesFor(providerById('other')!, { ...base, detected: true }), ['folder-path', 'zip'], 'another service has no finder');
});

test('In the browser alone: the folder picker where it exists (Chrome, Edge), else the ZIP (Safari, Firefox)', () => {
  assert.deepEqual(routesFor(dropbox, { ...base, browserMode: true, canPick: true }), ['folder-pick', 'zip']);
  assert.deepEqual(routesFor(dropbox, { ...base, browserMode: true, canPick: false, noFolder: true }), ['zip']);
});

test('iPad and every device without folder access: only the ZIP, through the share sheet', () => {
  for (const p of PROVIDERS) assert.deepEqual(routesFor(p, { ...base, noFolder: true, detected: true, canPick: true }), ['zip'], p.name);
});

test('Every route has three steps; the ZIP steps say Files, the folder steps say folder; iCloud on a device has nothing to install', () => {
  for (const p of PROVIDERS) for (const r of ['folder-found', 'folder-path', 'folder-pick', 'zip'] as const) assert.equal(stepsFor(p, r).length, 3, `${p.id} ${r}`);
  assert.ok(stepsFor(dropbox, 'zip').some((s) => /Files/.test(s)));
  assert.ok(stepsFor(dropbox, 'folder-pick').some((s) => /folder/.test(s)));
  assert.match(stepsFor(providerById('icloud')!, 'zip')[0]!, /Nothing to install/);
});

test('The ZIP gets a clean name with the date', () => {
  assert.equal(zipName('Fahrschule Müller / 2026', new Date('2026-11-17T10:00:00Z')), 'Fahrschule-Müller-2026-2026-11-17.zip');
  assert.equal(zipName('***', new Date('2026-01-02T00:00:00Z')), 'project-2026-01-02.zip');
});

test('Every step text of the guide has a German version', () => {
  for (const s of ALL_STEPS) assert.ok(DE[s], `German text for "${s}"`);
  const src = readFileSync(new URL('../../src/app/cloud-guide.ts', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
    const k = m[1]!.replace(/\\'/g, "'");
    assert.ok(DE[k] || ['Close', 'Back', 'Folder', 'Check again'].includes(k), `German text for "${k}"`);
  }
});

// ---------------------------------------------------------------- the folder finder (pure, with a fake disk)

function fake(paths: string[], platform: NodeJS.Platform = 'win32', env: Record<string, string> = {}): DetectDeps {
  const set = new Set(paths);
  return {
    home: platform === 'win32' ? 'C:\\Users\\you' : '/home/you',
    env,
    platform,
    exists: (p) => set.has(p),
    list: (p) => [...set].filter((x) => x.startsWith(p + (platform === 'win32' ? '\\' : '/')) && !x.slice(p.length + 1).includes(platform === 'win32' ? '\\' : '/')).map((x) => x.slice(p.length + 1)),
    join: (...parts) => parts.join(platform === 'win32' ? '\\' : '/'),
  };
}

test('Finder: Dropbox, OneDrive, Google Drive for desktop, MEGA and Proton Drive in their usual places', () => {
  const found = detectSyncFolders(fake(['C:\\Users\\you\\Dropbox', 'C:\\Users\\you\\OneDrive', 'G:\\My Drive', 'C:\\Users\\you\\MEGA', 'C:\\Users\\you\\Proton Drive']));
  assert.deepEqual(found.map((f) => f.id), ['dropbox', 'onedrive', 'gdrive', 'mega', 'proton']);
  assert.equal(found.find((f) => f.id === 'gdrive')!.path, 'G:\\My Drive');
});

test('Finder: a company OneDrive folder and the environment of Windows are found; nothing found means an empty list', () => {
  const biz = detectSyncFolders(fake(['C:\\Users\\you\\OneDrive - Studio GmbH']));
  assert.equal(biz[0]!.id, 'onedrive');
  assert.match(biz[0]!.path, /OneDrive - Studio GmbH/);
  const env = detectSyncFolders(fake(['D:\\Cloud\\OneDrive'], 'win32', { OneDrive: 'D:\\Cloud\\OneDrive' }));
  assert.equal(env[0]!.path, 'D:\\Cloud\\OneDrive');
  assert.deepEqual(detectSyncFolders(fake([])), []);
});

test('Finder: macOS keeps the cloud folders in Library/CloudStorage', () => {
  const found = detectSyncFolders(fake(['/home/you/Library/CloudStorage/GoogleDrive-me@example.com', '/home/you/Library/CloudStorage/OneDrive-Personal', '/home/you/Dropbox'], 'darwin'));
  assert.deepEqual(found.map((f) => f.id).sort(), ['dropbox', 'gdrive', 'onedrive']);
  void join;
  void sep;
});

test('Wiring: the route, the browser answer, the menu and the settings card exist (source check)', () => {
  const routes = readFileSync(new URL('../../src/server/cloud-routes.ts', import.meta.url), 'utf8');
  assert.match(routes, /api\.get\('\/cloud\/detect'/);
  const browser = readFileSync(new URL('../../src/app/cloud-browser.ts', import.meta.url), 'utf8');
  assert.match(browser, /sub === '\/detect'/);
  const main = readFileSync(new URL('../../src/app/main.ts', import.meta.url), 'utf8');
  assert.match(main, /openCloudGuide/);
  const settings = readFileSync(new URL('../../src/workspace/panels/settings-connect.ts', import.meta.url), 'utf8');
  assert.match(settings, /openCloudGuide/);
});
