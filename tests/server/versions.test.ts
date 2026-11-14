// The version tooling and the MCP reliability rules added with the 2026-11-12 apps:
//   scripts/check-versions.mjs (what versions/ holds, newer than what is registered),
//   scripts/fetch-apps.mjs (per-app asset pattern, the flat versions/ folder),
//   src/server/mcp.ts (retry back-off, lost-connection detection).
//   npx tsx --test tests/server/versions.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain .mjs without types
import { scanVersions } from '../../scripts/check-versions.mjs';
// @ts-expect-error plain .mjs without types
import { pickRelease, pickLocalBuilds, localFiles } from '../../scripts/fetch-apps.mjs';
import { retryDelay, shouldRetry, isConnectionLost } from '../../src/server/mcp.js';
import { APPS } from '../../src/ecosystems/catalog.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'wc-versions-'));

test('scanVersions: source trees and web builds by folder name, the newest of each, unrelated folders ignored', () => {
  const dir = tmp();
  try {
    for (const n of ['mailcraft-0.12.0', 'mailcraft-web-0.12.0', 'photocraft-0.22.0', 'photocraft-0.23.1', 'photocraft-web-0.23.1', 'craft-anything-web-0.6.1', 'zip', 'notes', 'lemon-studio-web-0.0.1-web.26']) mkdirSync(join(dir, n));
    writeFileSync(join(dir, 'readme.txt'), 'x');
    const s = scanVersions(dir);
    assert.deepEqual(s.mailcraft, { web: '0.12.0', source: '0.12.0' });
    assert.deepEqual(s.photocraft, { web: '0.23.1', source: '0.23.1' }, 'the newest source tree wins');
    assert.deepEqual(s['craft-anything'], { web: '0.6.1', source: null }, 'a hyphenated id is read whole');
    assert.equal(s.zip, undefined);
    assert.equal(s.notes, undefined);
    assert.deepEqual(scanVersions(join(dir, 'missing')), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fetch-apps: an app can name its own release asset, the default is the -web zip', () => {
  const releases = [
    { tag_name: 'v0.0.1-web.26', draft: false, prerelease: true, assets: [{ name: 'lemon-studio-web.zip', browser_download_url: 'https://example.test/l.zip', size: 10 }, { name: 'source.zip', browser_download_url: 'x', size: 1 }] },
    { tag_name: 'v0.9.0', draft: false, prerelease: false, assets: [{ name: 'tool-0.9.0-windows-x64.zip', browser_download_url: 'x', size: 1 }, { name: 'tool-web-0.9.0.zip', browser_download_url: 'https://example.test/t.zip', size: 5 }] },
  ];
  const lemon = pickRelease(releases, /^lemon-studio-web\.zip$/);
  assert.equal(lemon.asset.name, 'lemon-studio-web.zip');
  assert.equal(lemon.version, '0.0.1-web.26', 'no version in the asset name: the tag gives it');
  assert.equal(lemon.prerelease, true);
  const def = pickRelease(releases);
  assert.equal(def.version, '0.9.0', 'default asset pattern, stable release first');
  assert.equal(pickRelease(releases, /^nothing$/), null);
});

test('fetch-apps: the flat versions/ folder gives one build per catalog app and skips the launcher', () => {
  const ids = APPS.map((a) => a.id);
  const names = ['mailcraft-web-0.12.0', 'craft-anything-web-0.6.1', 'artcraft-launcher-web-0.19.2', 'photocraft-web-0.20.2', 'photocraft-web-0.23.1', 'wordcraft-web-0.18.1', 'mailcraft-0.12.0', 'zip'];
  const got = pickLocalBuilds(names, ids.filter((i) => !['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft'].includes(i)));
  assert.deepEqual(got.map((b: { app: string; version: string }) => `${b.app}@${b.version}`).sort(), ['craft-anything@0.6.1', 'mailcraft@0.12.0', 'photocraft@0.23.1']);
  const dir = tmp();
  try {
    mkdirSync(join(dir, 'brand'));
    writeFileSync(join(dir, 'brand', 'logo.svg'), '<svg/>');
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, '.htaccess'), 'x');
    assert.deepEqual(localFiles(dir), ['index.html'], 'brand/ and host files are not copied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catalog.json and web-builds.json: every recorded build is a catalog app, none is an office app', () => {
  const builds = JSON.parse(readFileSync('public/web-builds.json', 'utf8')).builds as { app: string; version: string; dir: string }[];
  const ids = new Set(APPS.map((a) => a.id));
  for (const b of builds) {
    assert.ok(ids.has(b.app as never), `${b.app} is in the catalog`);
    assert.ok(!['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft'].includes(b.app), `${b.app} comes from releases.json`);
    assert.equal(b.dir, `${b.app}-web-${b.version}`);
  }
  assert.equal(new Set(builds.map((b) => b.app)).size, builds.length);
});

test('MCP: a server that failed to start is tried again after a growing delay, never before', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(retryDelay), [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  const failed = { status: 'error' as const, attempts: 2, lastTry: 1_000 };
  assert.equal(shouldRetry(failed, 1_000 + 29_999), false);
  assert.equal(shouldRetry(failed, 1_000 + 30_000), true);
  assert.equal(shouldRetry({ ...failed, status: 'connected' as never }, 10_000_000), false, 'a working server is left alone');
  assert.equal(shouldRetry({ status: 'error', attempts: 0, lastTry: 0 }, 15_000), true, 'a lost connection reconnects at once (lastTry 0)');
});

test('MCP: a closed pipe is a lost connection, a failing tool is not', () => {
  for (const m of ['Connection closed', 'write EPIPE', 'read ECONNRESET', 'connect ECONNREFUSED 127.0.0.1:7991', 'socket hang up', 'spawn mailcraft-cli ENOENT']) assert.equal(isConnectionLost(new Error(m)), true, m);
  for (const m of ['The file does not exist', 'Invalid arguments: path', 'Request timed out']) assert.equal(isConnectionLost(new Error(m)), false, m);
  assert.equal(isConnectionLost(undefined), false);
});
