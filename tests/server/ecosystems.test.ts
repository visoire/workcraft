// Ecosystems, shared storage and web builds: the catalog, file routing, custom ecosystems, recent files, the
// playgroundFiles bridge, launch relief, the fetch script's rules and the new MCP tools. Pure logic, no browser.
//   npx tsx --test tests/server/ecosystems.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { APPS, CRAFT_IDS, ECOSYSTEMS, OFFICE_IDS, appOfGroup, appsFor, availabilityOf, appById, defaultAppFor, ecosystemsOf, groupKey, isCraftId, lookupApp, makeCustomEcosystem, nativeAppsOf, sanitizeCustom } from '../../src/ecosystems/catalog.js';
import { listApps, noBuildMessage } from '../../src/ecosystems/describe.js';
import { RECENT_MAX, pushRecent, recentFor, renameRecent, sanitizeRecent, type RecentEntry } from '../../src/storage/recent.js';
import { SCHEME, fromAppPath, normalize, toAppPath, uniqueName, validName, withType } from '../../src/storage/paths.js';
import { createBridge, type BridgeHost } from '../../src/storage/app-files-bridge.js';
import { planLaunchRelief, type Budget, type PanelMem } from '../../src/ipados/memory.js';
import { TOOL_DEFS, TOOL_BY_NAME, validateArgs } from '../../src/mcp/schemas.js';
// @ts-expect-error plain .mjs without types
import { pickRelease, safeEntries, pickLocalBuilds, cmpVersion, isHostFile, layoutFixes, localFiles } from '../../scripts/fetch-apps.mjs';
// @ts-expect-error plain .mjs without types
import { injectShim, FILES_TAG, SHIM_TAG, TYPES } from '../../scripts/releases.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
const MB = 1024 * 1024;

// ---------------------------------------------------------------- catalog

test('Catalog: ids in code and data agree, every ecosystem app exists, every app is in an ecosystem', () => {
  const data = JSON.parse(read('src/ecosystems/catalog.json')) as { apps: { id: string }[]; ecosystems: { id: string; apps: string[] }[] };
  assert.deepEqual(data.apps.map((a) => a.id), [...CRAFT_IDS], 'CRAFT_IDS lists the same apps as catalog.json, in the same order');
  assert.equal(new Set(CRAFT_IDS).size, 44);
  for (const e of ECOSYSTEMS) for (const id of e.apps) assert.ok(isCraftId(id), `${e.id} names unknown app ${id}`);
  for (const a of APPS) assert.ok(ecosystemsOf(a.id).length >= 1, `${a.id} is in no ecosystem`);
  assert.deepEqual(ECOSYSTEMS.find((e) => e.id === 'office')!.apps.slice(0, 4), [...OFFICE_IDS], 'the four office apps lead the Office workspace');
  assert.deepEqual(ECOSYSTEMS.map((e) => e.id).slice(0, 1), ['office']);
  // ids that saved workspaces refer to stay
  for (const id of ['office', 'imaging', 'motion', 'design', 'cad']) assert.ok(ECOSYSTEMS.some((e) => e.id === id), `ecosystem ${id} kept`);
  assert.equal(new Set(ECOSYSTEMS.map((e) => e.id)).size, ECOSYSTEMS.length);
});

test('Catalog: origin, licence and channel are set, community apps are marked, every app has an icon', () => {
  const origins = new Set(['artcraft', 'community', 'independent']);
  for (const a of APPS) {
    assert.ok(origins.has(a.origin), `${a.id} origin`);
    assert.match(a.license, /^(MIT|Apache-2\.0|GPL-3\.0-or-later|GPL-3\.0-only|MIT OR Apache-2\.0)$/, `${a.id} licence is an SPDX id the project has checked`);
    assert.ok(['release', 'pages', 'source'].includes(a.channel), `${a.id} channel`);
    if (a.channel === 'pages') assert.match(a.pages ?? '', /^https:\/\/[\w.-]+\/[\w./-]*\/$/, `${a.id} pages URL`);
    else assert.equal(a.pages, undefined, `${a.id}: pages only with channel pages`);
    const office = (OFFICE_IDS as readonly string[]).includes(a.id);
    assert.ok(existsSync(join('public', 'assets', office ? 'logos' : 'craft', `${a.id}.${office ? 'webp' : 'png'}`)), `${a.id} has an icon`);
    if (a.asset) assert.doesNotThrow(() => new RegExp(a.asset!), `${a.id} asset is a regex`);
  }
  // the independent apps' third-party apps are exactly the ones that are not made by the ArtCraft team or listed by its launcher
  assert.equal(APPS.filter((a) => a.origin === 'independent').length, 25);
  assert.deepEqual(APPS.filter((a) => a.origin === 'community').map((a) => a.id), ['solidcraft', 'mailcraft']);
  assert.ok(appById('paintrs')!.license.startsWith('GPL'), 'a GPL app says so');
  // an app that is only built from source says it cannot be fetched
  assert.ok(APPS.filter((a) => a.channel === 'source').every((a) => a.origin === 'independent'));
  assert.deepEqual(APPS.filter((a) => a.channel === 'pages').map((a) => a.id), ['tracedraw', 'subcraft'], 'the two apps deployed on GitHub Pages');
  assert.equal(appById('lightcraft-classic')!.repo, 'emmertex/chromaforge', 'LightCraft Classic moved to its new repository');
  assert.match(appById('lightcraft-classic')!.asset!, /chromaforge-web/);
  assert.equal(APPS.filter((a) => a.channel === 'source').length, 18, '25 community apps: 5 with a release zip, 2 on GitHub Pages, 18 only built from source');
});

test('Catalog: lookupApp reads names with spaces and dots, and never guesses between two apps', () => {
  assert.equal(lookupApp('Craft Anything')?.id, 'craft-anything');
  assert.equal(lookupApp('craft-anything')?.id, 'craft-anything');
  assert.equal(lookupApp('Pro Wave')?.id, 'prowave');
  assert.equal(lookupApp('Paint.RS')?.id, 'paintrs');
  assert.equal(lookupApp('Picasso Suite')?.id, 'picasso-suite');
  assert.equal(lookupApp('LightCraft Classic')?.id, 'lightcraft-classic');
  assert.equal(lookupApp('lightcraft')?.id, 'lightcraft', 'the exact id beats a longer one');
  assert.equal(lookupApp('mail')?.id, 'mailcraft');
  assert.equal(lookupApp('text')?.id, 'textcraft');
  assert.equal(lookupApp('light')?.id, 'lightcraft');
  assert.equal(groupKey('craft-anything'), 'craftanything');
  assert.equal(appOfGroup('craftanything')?.id, 'craft-anything');
  assert.equal(appOfGroup('nothing'), undefined);
  assert.deepEqual(nativeAppsOf('eml').map((a) => a.id), ['mailcraft']);
  assert.ok(nativeAppsOf('mid').map((a) => a.id).includes('soundcraft') && nativeAppsOf('mid').map((a) => a.id).includes('honeydew'));
});

test('Catalog: the new ecosystems hold the community apps and no app is claimed twice for one type by accident', () => {
  const eco = (id: string) => ECOSYSTEMS.find((e) => e.id === id)!;
  assert.ok(eco('music').apps.includes('lemon-studio') && eco('music').apps.includes('soundcraft'));
  assert.ok(eco('paint').apps.includes('paintrs'));
  assert.ok(eco('explore').apps.includes('earthcraft') && eco('explore').apps.includes('craft-anything'));
  assert.ok(eco('office').apps.includes('mailcraft'));
  // every community app is reachable from some built-in workspace, so the picker never hides one
  for (const a of APPS.filter((x) => x.origin === 'independent')) assert.ok(ecosystemsOf(a.id).length >= 1, a.id);
  // a text file is still opened by WordCraft in the notes workspace, not by TextCraft, and a .json stays in the code editor
  assert.equal(defaultAppFor('a.txt', { available: () => true, prefer: eco('notes').apps, nativeOnly: true })?.id, 'wordcraft');
  assert.equal(defaultAppFor('a.json', { available: () => true, prefer: eco('notes').apps, nativeOnly: true }), undefined);
});

test('describe: list-craft-apps filters, hides the long type lists unless asked, and says how to get a missing build', () => {
  const has = availabilityOf([{ app: 'wordcraft', version: '0.18.1' }], [{ app: 'mailcraft', version: '0.12.0', dir: 'mailcraft-web-0.12.0' }]);
  const all = listApps({}, has, []).rows;
  assert.equal(all.length, 44);
  assert.ok(all.every((r) => r.opens === undefined && r.imports === undefined), 'the plain list is short');
  assert.equal(all.find((r) => r.id === 'mailcraft')!.version, '0.12.0');
  assert.equal(listApps({ available: true }, has, []).rows.map((r) => r.id).join(), 'wordcraft,mailcraft');
  assert.equal(listApps({ origin: 'community' }, has, []).rows.map((r) => r.id).join(), 'solidcraft,mailcraft');
  assert.equal(listApps({ ecosystem: 'music' }, has, []).rows.length, 9);
  assert.ok(listApps({ type: '.EML' }, has, []).rows[0]!.opens!.includes('eml'));
  const one = listApps({ app: 'Pro Wave' }, has, []).rows;
  assert.equal(one.length, 1);
  assert.match(one[0]!.how_to_get!, /prowave-web-<version> folder into versions\//, 'a source-only app names the folder to drop a build into');
  assert.match(listApps({ app: 'firecraft' }, has, []).rows[0]!.how_to_get!, /apps:fetch -- --yes --app firecraft/);
  assert.match(listApps({ app: 'tracedraw' }, has, []).rows[0]!.how_to_get!, /mirrors the deployed app at https:\/\/tracedraw\.github\.io\/tracedraw\//);
  assert.equal(listApps({ app: 'nope' }, has, []).unknown, 'nope');
  assert.equal(listApps({ ecosystem: 'nope' }, has, []).unknown, 'nope');
  const custom = [{ id: 'custom-mine', name: 'Mine', blurb: '', apps: ['mailcraft' as const], accent: '#335CFF', custom: true }];
  assert.deepEqual(listApps({ ecosystem: 'custom-mine' }, has, custom).rows.map((r) => r.id), ['mailcraft']);
  assert.match(noBuildMessage(appById('earthcraft')!, ['wordcraft']), /EarthCraft \(Independent\) has no web build/);
});

test('Catalog: no version numbers (releases.json and web-builds.json own them) and sane data', () => {
  const raw = read('src/ecosystems/catalog.json');
  assert.ok(!/\b\d+\.\d+\.\d+\b/.test(raw.replace(/#[0-9A-Fa-f]{6}/g, '')), 'catalog.json must not contain version numbers');
  for (const a of APPS) {
    assert.match(a.accent, /^#[0-9A-F]{6}$/i, a.id);
    assert.ok(a.folder.startsWith('/'), a.id);
    assert.match(a.repo, /^[\w-]+\/[\w.-]+$/, a.id);
    for (const e of [...a.opens, ...a.imports]) assert.equal(e, e.toLowerCase(), `${a.id}: ${e}`);
    assert.equal(new Set(a.opens).size, a.opens.length, `${a.id} opens has duplicates`);
    assert.ok(!a.opens.some((e) => a.imports.includes(e)), `${a.id}: a type is either opened or imported`);
  }
});

test('Catalog: the four office apps keep every type of the earlier registry', () => {
  const must: Record<string, string[]> = {
    wordcraft: ['docx', 'doc', 'odt', 'rtf', 'md', 'markdown', 'txt', 'html', 'htm', 'tex'],
    gridcraft: ['xlsx', 'xls', 'xlsb', 'ods', 'csv', 'tsv'],
    deckcraft: ['pptx', 'deckcraft'],
    pdfcraft: ['pdf'],
  };
  for (const [id, exts] of Object.entries(must)) for (const e of exts) assert.ok(appById(id)!.opens.includes(e), `${id} lost .${e}`);
});

test('Routing: an office type always goes to its office app, other types follow the ecosystem', () => {
  const all = () => true;
  assert.equal(defaultAppFor('a.docx', { available: all, prefer: ['photocraft'], nativeOnly: true })?.id, 'wordcraft');
  assert.equal(defaultAppFor('a.png', { available: all, prefer: ['photocraft', 'lightcraft', 'vectorcraft'], nativeOnly: true })?.id, 'photocraft');
  // an .svg: VectorCraft opens it natively, PhotoCraft only imports it
  assert.equal(defaultAppFor('a.svg', { available: all, prefer: ['photocraft', 'vectorcraft'], nativeOnly: true })?.id, 'vectorcraft');
  // a PDF in the imaging ecosystem still opens in PdfCraft (native beats import)
  assert.equal(defaultAppFor('a.pdf', { available: all, prefer: ['photocraft', 'vectorcraft'], nativeOnly: true })?.id, 'pdfcraft');
  // no web build: the app is skipped (other apps open a .png natively too since the community apps came, but the workspace
  // only takes an app of the ecosystem in use, see toolForPath in the registry)
  const noPhoto = defaultAppFor('a.png', { available: (id) => id !== 'photocraft', prefer: ['photocraft'], nativeOnly: true });
  assert.ok(!noPhoto || noPhoto.id !== 'photocraft', 'PhotoCraft without a build is skipped');
  assert.equal(defaultAppFor('a.png', { available: (id) => id === 'photocraft', prefer: ['photocraft'], nativeOnly: true })?.id, 'photocraft');
  assert.equal(defaultAppFor('a.png', { available: (id) => id === 'paintrs', prefer: ['paintrs'], nativeOnly: true })?.id, 'paintrs', 'the Paint workspace opens a PNG in its own app');
  const importer = defaultAppFor('a.png', { available: (id) => id !== 'photocraft', prefer: ['photocraft'] });
  assert.ok(importer && importer.id !== 'photocraft' && (importer.opens.includes('png') || importer.imports.includes('png')), 'without nativeOnly another app can take it');
  assert.equal(defaultAppFor('noextension', { available: all }), undefined);
  assert.equal(defaultAppFor('.hidden', { available: all }), undefined);
});

test('Open with: the active ecosystem comes first, then native apps, then importers', () => {
  const order = appsFor('x.png', { prefer: ['filmcraft'] }).map((a) => a.id);
  assert.equal(order[0], 'filmcraft', 'preferred importer first');
  const plain = appsFor('x.png').map((a) => a.id);
  assert.ok(plain.indexOf('photocraft') < plain.indexOf('filmcraft'), 'a native app before an importer');
  assert.ok(appsFor('report.docx').some((a) => a.id === 'designcraft'), 'DesignCraft imports .docx');
  assert.equal(appsFor('x.docx', { available: () => false }).length, 0);
});

test('lookupApp takes ids, names and short names', () => {
  assert.equal(lookupApp('PhotoCraft')?.id, 'photocraft');
  assert.equal(lookupApp('photo')?.id, 'photocraft');
  assert.equal(lookupApp('Craft Anything')?.id, 'craft-anything');
  assert.equal(lookupApp('nothing'), undefined);
  assert.equal(lookupApp(''), undefined);
});

// ---------------------------------------------------------------- custom ecosystems

test('Custom ecosystem: name and apps are checked, the id is unique, the order follows the catalog', () => {
  const ok = makeCustomEcosystem('  My   Studio ', ['soundcraft', 'photocraft', 'nope', 'photocraft']);
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.ecosystem.name, 'My Studio');
  assert.equal(ok.ecosystem.id, 'custom-my-studio');
  assert.deepEqual(ok.ecosystem.apps, ['photocraft', 'soundcraft']);
  assert.equal(ok.ecosystem.custom, true);
  assert.deepEqual(makeCustomEcosystem('', ['photocraft']), { ok: false, error: 'name' });
  assert.deepEqual(makeCustomEcosystem('!!!', ['photocraft']), { ok: false, error: 'name' });
  assert.deepEqual(makeCustomEcosystem('X', ['nope']), { ok: false, error: 'apps' });
  assert.deepEqual(makeCustomEcosystem('Office & Documents', ['wordcraft']), { ok: false, error: 'duplicate' });
  assert.deepEqual(makeCustomEcosystem('my studio', ['wordcraft'], [ok.ecosystem]), { ok: false, error: 'duplicate' });
  const second = makeCustomEcosystem('My-Studio', ['wordcraft'], [ok.ecosystem]);
  assert.ok(second.ok && second.ecosystem.id === 'custom-my-studio-2', 'same slug, other name: id gets a number');
});

test('Custom ecosystems read from storage: damaged entries are dropped, unknown apps removed', () => {
  const list = sanitizeCustom([
    { id: 'custom-a', name: 'A', apps: ['photocraft', 'ghost'] },
    { id: 'custom-a', name: 'Dup', apps: ['photocraft'] },
    { id: 'office', name: 'Hijack', apps: ['photocraft'] },
    { id: 'custom-b', name: 'B', apps: ['ghost'] },
    { id: 'custom-c', name: 5, apps: ['photocraft'] },
    null,
    'x',
  ]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0]!.apps, ['photocraft']);
  assert.deepEqual(sanitizeCustom('not an array'), []);
});

test('Availability: office releases and fetched builds, the web version wins over the release version', () => {
  const av = availabilityOf([{ app: 'wordcraft', version: '0.15.2' }, { app: 'pdfcraft', version: '0.18.2', webVersion: '0.18.0' }], [{ app: 'photocraft', version: '0.20.2', dir: 'photocraft-web-0.20.2' }, { app: 'bogus', version: '1', dir: 'x' }]);
  assert.equal(av.has('wordcraft'), true);
  assert.equal(av.version('pdfcraft'), '0.18.0');
  assert.equal(av.has('photocraft'), true);
  assert.equal(av.has('filmcraft'), false);
  assert.equal(av.has('bogus'), false, 'an entry that is not in the catalog is ignored');
  assert.equal(av.version('filmcraft'), null);
});

// ---------------------------------------------------------------- recent files

const e = (path: string, at: number, tool = 'wordcraft', project = 'p1'): RecentEntry => ({ path, tool, project, at });

test('Recent files: newest first, no repeats, bounded', () => {
  let list: RecentEntry[] = [];
  list = pushRecent(list, e('/a.docx', 1));
  list = pushRecent(list, e('/b.docx', 2));
  list = pushRecent(list, e('/a.docx', 3));
  assert.deepEqual(list.map((x) => x.path), ['/a.docx', '/b.docx']);
  assert.equal(list[0]!.at, 3);
  // the same file in another app is a separate entry; another project too
  list = pushRecent(list, e('/a.docx', 4, 'pdfcraft'));
  list = pushRecent(list, e('/a.docx', 5, 'wordcraft', 'p2'));
  assert.equal(list.length, 4);
  let many: RecentEntry[] = [];
  for (let i = 0; i < RECENT_MAX + 10; i++) many = pushRecent(many, e(`/f${i}.docx`, i));
  assert.equal(many.length, RECENT_MAX);
  assert.equal(many[0]!.path, `/f${RECENT_MAX + 9}.docx`);
});

test('Recent files of a project: sorted by time, missing files and other projects left out', () => {
  const list = [e('/old.docx', 1), e('/gone.docx', 9), e('/new.docx', 5), e('/other.docx', 7, 'wordcraft', 'p2'), e('/new.docx', 4, 'pdfcraft')];
  const shown = recentFor(list, 'p1', (p) => p !== '/gone.docx', 10);
  assert.deepEqual(shown.map((x) => `${x.path}:${x.tool}`), ['/new.docx:wordcraft', '/new.docx:pdfcraft', '/old.docx:wordcraft']);
  assert.equal(recentFor(list, 'p1', () => true, 1).length, 1);
});

test('Recent files follow a rename and survive damaged storage', () => {
  const moved = renameRecent([e('/docs/a.docx', 1), e('/docs/sub/b.docx', 2), e('/x.docx', 3), e('/docs/a.docx', 4, 'wordcraft', 'p2')], 'p1', '/docs', '/papers');
  assert.deepEqual(moved.map((x) => x.path), ['/papers/a.docx', '/papers/sub/b.docx', '/x.docx', '/docs/a.docx']);
  assert.deepEqual(sanitizeRecent('x'), []);
  assert.deepEqual(sanitizeRecent([{ path: 1 }, null, { path: '/a', tool: 'code', project: 'p', at: 5 }]), [{ path: '/a', tool: 'code', project: 'p', at: 5 }]);
});

// ---------------------------------------------------------------- paths

test('Paths: the browser: scheme maps to project paths, no way out of the project', () => {
  assert.equal(SCHEME, 'browser:');
  assert.equal(normalize('/a//b/./c/'), '/a/b/c');
  assert.equal(normalize('../../etc/passwd'), '/etc/passwd');
  assert.equal(toAppPath('/documents/a.docx'), 'browser:/documents/a.docx');
  assert.equal(fromAppPath('browser:/documents/a.docx'), '/documents/a.docx');
  assert.equal(fromAppPath('browser:/../x'), '/x');
  assert.equal(fromAppPath('/documents/a.docx'), null);
  assert.equal(fromAppPath(42), null);
  assert.equal(validName('Budget 2026.xlsx'), true);
  assert.equal(validName('a/b'), false);
  assert.equal(validName('..'), false);
  assert.equal(validName('  '), false);
  assert.equal(withType('Budget', ['xlsx', 'csv']), 'Budget.xlsx');
  assert.equal(withType('Budget.csv', ['xlsx', 'csv']), 'Budget.csv');
  assert.equal(uniqueName('Report.docx', new Set(['Report.docx', 'Report (2).docx'])), 'Report (3).docx');
  assert.equal(uniqueName('Report', new Set(['Report'])), 'Report (2)');
});

// ---------------------------------------------------------------- playgroundFiles bridge

function fakeHost(initial: Record<string, string> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  const log: string[] = [];
  const failures: string[] = [];
  let unsaved: boolean | null = null;
  let answer: { path: string } | { download: true } | null = { path: '/documents/new.docx' };
  let picked: { path: string } | { file: { name: string; bytes: Uint8Array } } | null = null;
  let failNext = false;
  const host: BridgeHost = {
    files: () => [...files.keys()],
    exists: (p) => files.has(p),
    read: async (p) => {
      if (!files.has(p)) throw new Error(`missing ${p}`);
      return files.get(p)!;
    },
    write: async (p, bytes) => {
      // a slow first write must still land before the second
      if (p === '/slow.txt' && log.filter((l) => l.startsWith('write /slow.txt')).length === 0) await new Promise((r) => setTimeout(r, 15));
      if (failNext) {
        failNext = false;
        throw new Error('quota');
      }
      files.set(p, bytes);
      log.push(`write ${p} ${new TextDecoder().decode(bytes)}`);
    },
    remove: async (p) => void files.delete(p),
    pick: async () => picked,
    ask: async () => answer,
    download: (name) => void log.push(`download ${name}`),
    unsaved: (f) => void (unsaved = f),
    failed: (p, err) => void failures.push(`${p}: ${err.message}`),
  };
  return {
    host,
    files,
    log,
    failures,
    get unsaved() {
      return unsaved;
    },
    answer: (a: typeof answer) => void (answer = a),
    pick: (p: typeof picked) => void (picked = p),
    failNext: () => void (failNext = true),
  };
}

test('Bridge: writes to one path land in order and a read after a write sees it', async () => {
  const f = fakeHost();
  const b = createBridge(f.host);
  const first = b.api.write('browser:/slow.txt', new TextEncoder().encode('one'));
  const second = b.api.write('browser:/slow.txt', new TextEncoder().encode('two'));
  assert.equal(b.pending(), 2);
  assert.equal(new TextDecoder().decode(await b.api.read('browser:/slow.txt')), 'two');
  await Promise.all([first, second]);
  assert.deepEqual(f.log.filter((l) => l.startsWith('write')), ['write /slow.txt one', 'write /slow.txt two']);
  assert.equal(b.pending(), 0);
});

test('Bridge: a failed write is reported with the bytes so the user can download instead', async () => {
  const f = fakeHost();
  const b = createBridge(f.host);
  f.failNext();
  await assert.rejects(b.api.write('browser:/x.txt', new Uint8Array([1])), /quota/);
  assert.deepEqual(f.failures, ['/x.txt: quota']);
  assert.equal(b.pending(), 0);
  await b.api.write('browser:/x.txt', new Uint8Array([2])); // the queue is not stuck
  assert.ok(f.files.has('/x.txt'));
});

test('Bridge: open, saveAs, files and remove follow independent apps file contract', async () => {
  const f = fakeHost({ '/documents/a.docx': 'A', '/documents/sub/b.docx': 'B', '/sheets/c.xlsx': 'C' });
  const b = createBridge(f.host);
  f.pick({ path: '/documents/a.docx' });
  const opened = await b.api.open({ types: ['docx'] });
  assert.equal(opened![0]!.path, 'browser:/documents/a.docx');
  assert.equal(opened![0]!.name, 'a.docx');
  assert.equal(new TextDecoder().decode(opened![0]!.bytes), 'A');
  f.pick({ file: { name: 'from-device.docx', bytes: new Uint8Array([1]) } });
  assert.equal((await b.api.open())![0]!.path, null, 'a file from the device has no path');
  f.pick(null);
  assert.equal(await b.api.open(), null);

  f.answer({ path: '/documents/new' });
  assert.deepEqual(await b.api.saveAs({ name: 'Untitled', types: ['docx'] }), { path: 'browser:/documents/new.docx' }, 'the first type is added');
  f.answer({ download: true });
  assert.deepEqual(await b.api.saveAs({ name: 'Report', types: ['docx'], bytes: new Uint8Array([1]) }), { download: true });
  assert.ok(f.log.includes('download Report.docx'));
  f.answer(null);
  assert.equal(await b.api.saveAs({ name: 'x' }), null);

  assert.deepEqual((await b.api.files('browser:/documents')).sort(), ['browser:/documents/a.docx', 'browser:/documents/sub/b.docx']);
  assert.deepEqual(await b.api.files('/nothing'), []);
  await b.api.remove('browser:/documents/a.docx');
  await b.api.remove('browser:/documents/a.docx'); // missing is fine
  assert.ok(!f.files.has('/documents/a.docx'));
  b.api.setUnsaved(true);
  assert.equal(f.unsaved, true);
  await assert.rejects(b.api.read(''), /path is required/);
});

test('Bridge: the workspace hands a file to the engine through onOpen, and says so when there is none', async () => {
  const f = fakeHost({ '/documents/a.docx': 'A' });
  const b = createBridge(f.host);
  assert.equal(await b.deliver('/documents/a.docx'), false, 'no handler yet: the panel falls back to a drop');
  assert.equal(b.hasHandler(), false);
  const got: string[] = [];
  b.api.onOpen((file) => void got.push(`${file.path}|${file.name}`));
  assert.equal(await b.deliver('/documents/a.docx'), true);
  assert.deepEqual(got, ['browser:/documents/a.docx|a.docx']);
});

// ---------------------------------------------------------------- launch relief

const budget: Budget = { warn: 640 * MB, act: 800 * MB, critical: 1100 * MB };
const mem = (id: string, o: Partial<PanelMem> = {}): PanelMem => ({ id, active: true, visible: false, unsaved: false, bytes: 100 * MB, lastShown: 0, ...o });

test('Launch relief: heavy apps always make room, medium only under pressure, light never; unsaved and visible stay', () => {
  const panels = [mem('a', { lastShown: 5 }), mem('b', { lastShown: 1 }), mem('c', { unsaved: true }), mem('d', { visible: true }), mem('e', { active: false })];
  assert.deepEqual(planLaunchRelief(panels, 'heavy', budget).map((r) => r.id), ['b', 'a'], 'hidden and saved, least recently shown first');
  assert.deepEqual(planLaunchRelief(panels, 'light', budget), []);
  assert.deepEqual(planLaunchRelief(panels, 'medium', budget), [], 'well below the warn line');
  const tight = panels.map((p) => (p.id === 'd' ? { ...p, bytes: 600 * MB } : p));
  assert.deepEqual(planLaunchRelief(tight, 'medium', budget).map((r) => r.id), ['b', 'a']);
});

// ---------------------------------------------------------------- fetch script rules

test('fetch-apps: picks the newest stable release that has a web zip, else a pre-release', () => {
  const rel = (tag: string, o: Record<string, unknown> = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: `x-web-${tag.slice(1)}.zip`, browser_download_url: `https://example.invalid/${tag}`, size: 10 }], ...o });
  const pick = pickRelease([rel('v2.0.0', { prerelease: true }), rel('v1.5.0', { assets: [] }), rel('v1.4.0'), rel('v1.3.0')]);
  assert.equal(pick.tag, 'v1.4.0', 'skips the pre-release and the release without a zip');
  assert.equal(pick.version, '1.4.0');
  assert.equal(pickRelease([rel('v2.0.0', { prerelease: true })]).tag, 'v2.0.0');
  assert.equal(pickRelease([rel('v1.0.0', { draft: true })]), null);
  assert.equal(pickRelease([{ tag_name: 'v1', draft: false, prerelease: false, assets: [{ name: 'x-windows.zip' }] }]), null);
});

test('fetch-apps: a zip is refused when it could write outside its folder, brand folders are dropped', () => {
  const file = (n: string) => ({ [n]: new Uint8Array([1]) });
  assert.throws(() => safeEntries({ ...file('index.html'), ...file('../evil.js') }), /unsafe/);
  assert.throws(() => safeEntries({ ...file('index.html'), ...file('/abs.js') }), /unsafe/);
  assert.throws(() => safeEntries({ ...file('index.html'), ...file('C:/x.js') }), /unsafe/);
  assert.throws(() => safeEntries({ ...file('a\\b.js'), ...file('index.html') }), /unsafe/);
  assert.throws(() => safeEntries(file('app.js')), /no index.html/);
  const ok = safeEntries({ ...file('index.html'), ...file('app_bg.wasm'), ...file('docs/brand/logo.png'), ...file('assets/Brand/x.png') }) as { rel: string }[];
  assert.deepEqual(ok.map((x) => x.rel).sort(), ['app_bg.wasm', 'index.html']);
  const wrapped = safeEntries({ ...file('photocraft-web/index.html'), ...file('photocraft-web/a.js') }) as { rel: string }[];
  assert.deepEqual(wrapped.map((x) => x.rel).sort(), ['a.js', 'index.html'], 'one wrapping folder is stripped');
});

// ---------------------------------------------------------------- engine page scripts

test('Engine pages get the frame shim and the files script, once', () => {
  const html = '<html><head><meta name="viewport" content="x"></head><body></body></html>';
  const once = injectShim(html) as string;
  assert.ok(once.includes(SHIM_TAG) && once.includes(FILES_TAG));
  assert.equal(injectShim(once), once, 'idempotent');
  const oldPage = once.replace(FILES_TAG, '');
  const upgraded = injectShim(oldPage) as string;
  assert.equal(upgraded.split('craft-files.js').length - 1, 1, 'a page that has only the shim gets the files script');
});

test('public/craft-files.js only exists inside a workspace and covers the whole contract', () => {
  const js = read('public/craft-files.js');
  for (const name of ['open', 'saveAs', 'write', 'read', 'files', 'remove', 'download', 'setUnsaved', 'onOpen']) assert.ok(js.includes(`${name}:`), `playgroundFiles.${name}`);
  assert.ok(js.includes('w.parent === w'), 'no facade on a page opened on its own');
  assert.ok(js.includes('w.playgroundFiles'), 'an engine or host that brought its own wins');
  assert.ok(read('src/workspace/panels/craftapp.ts').includes('__workcraftFiles'), 'the panel registers the bridge registry');
});

// ---------------------------------------------------------------- MCP tools

test('MCP: the ecosystem tools exist, are workspace tools of the browser, and validate', () => {
  for (const name of ['list-craft-apps', 'open-in-app', 'recent-files']) {
    const d = TOOL_BY_NAME.get(name);
    assert.ok(d, name);
    assert.equal(d!.side, 'client');
    assert.equal(d!.app, 'workspace');
    assert.ok(d!.description.length <= 300, `${name} description is short`);
  }
  assert.equal(new Set(TOOL_DEFS.map((t) => t.name)).size, TOOL_DEFS.length, 'tool names are unique');
  assert.equal(validateArgs('open-in-app', { app: 'photocraft', path: '/images/a.png' }).ok, true);
  assert.equal(validateArgs('open-in-app', { path: '/a.png' }).ok, false);
  assert.equal(validateArgs('recent-files', {}).ok, true);
  assert.equal(validateArgs('recent-files', { limit: 99 }).ok, false);
  // the existing tools did not move: the first and the last of the earlier list are where they were
  assert.equal(TOOL_DEFS[0]!.name, 'read-sheet');
  assert.ok(TOOL_DEFS.findIndex((t) => t.name === 'cloud-export') < TOOL_DEFS.findIndex((t) => t.name === 'list-craft-apps'), 'new tools are appended');
});

test('The panel server has a handler for every client tool', () => {
  const src = read('src/mcp/panel-server.ts');
  for (const d of TOOL_DEFS.filter((t) => t.side === 'client')) assert.ok(src.includes(`'${d.name}'`), `${d.name} has no handler in panel-server.ts`);
});

// ---------------------------------------------------------------- local import and install rules

test('Local import: the newest build per catalog app, office apps and strangers left out', () => {
  const ids = APPS.filter((a) => !(OFFICE_IDS as readonly string[]).includes(a.id)).map((a) => a.id);
  const found = pickLocalBuilds(['photocraft-web-0.20.1', 'photocraft-web-0.20.10', 'photocraft-web-0.20.2', 'wordcraft-web-0.15.2', 'soundcraft-web-0.17.1', 'zip', 'ghost-web-1.0.0', 'cadcraft-web-0.17.1-rc.1', 'cadcraft-web-0.17.0'], ids) as { app: string; version: string; dir: string }[];
  const by = Object.fromEntries(found.map((b) => [b.app, b.version]));
  assert.equal(by.photocraft, '0.20.10', 'numeric, not alphabetical');
  assert.equal(by.soundcraft, '0.17.1');
  assert.equal(by.cadcraft, '0.17.1-rc.1');
  assert.ok(!('wordcraft' in by) && !('ghost' in by));
  assert.ok(cmpVersion('1.2.0', '1.10.0') < 0);
  assert.ok(cmpVersion('1.0.0-alpha.2', '1.0.0') < 0, 'a pre-release is lower');
  assert.equal(cmpVersion('2.0.0', '2.0.0'), 0);
});

test('Install rules: host files are dropped, a split build gets its snippets where the app script looks for them', () => {
  const all = ['index.html', '.htaccess', '_headers', 'app.wasm', 'app.wasm.br', 'app.wasm.gz', 'lonely.js.gz', 'app/x.part-aa', 'LICENSE-MIT'];
  assert.deepEqual(all.filter((f) => !isHostFile(f, all)), ['index.html', 'app.wasm', 'lonely.js.gz', 'app/x.part-aa', 'LICENSE-MIT'], 'a .gz with no uncompressed twin is kept');
  const split = ['index.html', 'app/photocraft-web.js', 'app/parts.txt', 'snippets/eframe-1/inline0.js'];
  assert.deepEqual(layoutFixes(split), [{ from: 'snippets/eframe-1/inline0.js', to: 'app/snippets/eframe-1/inline0.js' }]);
  assert.deepEqual(layoutFixes([...split, 'app/snippets/eframe-1/inline0.js']), [], 'idempotent');
  assert.deepEqual(layoutFixes(['index.html', 'x.js', 'snippets/a.js']), [], 'only builds that have an app/ loader');
});

test('A local build is read without brand folders, links or host files, and must have an index.html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wc-build-'));
  try {
    for (const f of ['index.html', 'a_bg.wasm', 'a_bg.wasm.gz', '.htaccess', 'brand/logo.png', 'docs/Brand/x.png', 'fonts/f.otf']) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), 'x');
    }
    assert.deepEqual((localFiles(dir) as string[]).sort(), ['a_bg.wasm', 'fonts/f.otf', 'index.html'].sort());
    const empty = mkdtempSync(join(tmpdir(), 'wc-empty-'));
    writeFileSync(join(empty, 'a.js'), 'x');
    assert.throws(() => localFiles(empty), /no index.html/);
    rmSync(empty, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('The dev server knows the types an engine build contains (nosniff refuses a stylesheet served as octet-stream)', () => {
  for (const [ext, type] of [['.css', 'text/css'], ['.wasm', 'application/wasm'], ['.svg', 'image/svg+xml'], ['.otf', 'font/otf'], ['.ttf', 'font/ttf'], ['.webmanifest', 'application/manifest+json'], ['.woff2', 'font/woff2']]) {
    assert.ok(String((TYPES as Record<string, string>)[ext]).startsWith(type), ext);
  }
});

// ---------------------------------------------------------------- offline cache scanner (public/sw.js)

test('Offline cache: the scanner finds what the builds load, in every way they load it', () => {
  const sw = read('public/sw.js');
  const block = sw.slice(sw.indexOf('// <scan>'), sw.indexOf('// </scan>'));
  assert.ok(block.includes('function assetPaths'), 'the marked block holds the scanner');
  const assetPaths = new Function(`${block}\nreturn assetPaths;`)() as (text: string, url: string, root: string) => string[];
  const root = 'https://h.test/apps/film/';
  const html = `<link rel="stylesheet" href="./loading-1.css"><script type="module">
    import init from "./film_web.js"; const { default: i } = await import("./film_web.js" + v);
    await init({ module_or_path: new URL("film_web_bg.wasm" + v, location.href) });
    fetch("https://cdn.example/x.js"); fetch("/api/files/raw.json"); fetch("../other/y.js"); const t = "text/javascript";
  </script><img src="icons/32x32/a.png"><link rel="manifest" href="manifest.webmanifest">`;
  const found = assetPaths(html, root + 'index.html', root).sort();
  assert.deepEqual(found, ['film_web.js', 'film_web_bg.wasm', 'icons/32x32/a.png', 'loading-1.css', 'manifest.webmanifest'].map((f) => root + f).sort(), 'own files only: no CDN, no absolute path, nothing above the folder');
  // a split build: its loader lists the parts, the app script names snippets relative to its own folder
  assert.deepEqual(assetPaths('photocraft-parts 1\nphotocraft-web-73603522f62e7d1f.part-aa\n', root + 'app/parts.txt', root), [root + 'app/photocraft-web-73603522f62e7d1f.part-aa']);
  assert.deepEqual(assetPaths("import { a } from './snippets/e/inline0.js'", root + 'app/glue.js', root), [root + 'app/snippets/e/inline0.js']);
});

test('The shim refuses a nested service worker inside a panel and says so in the register', () => {
  const js = read('public/craft-frame.js');
  assert.ok(js.includes("applied('nested-service-worker')") && js.includes("'native-sw'") && js.includes('w.parent !== w'));
});