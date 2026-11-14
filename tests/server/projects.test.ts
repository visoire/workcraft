// First start and "Load sample data": every user starts with an empty project of their own, and the
// sample files open as a separate project. Also: the version the IDE reports.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORKCRAFT_HOME = mkdtempSync(join(tmpdir(), 'workcraft-projects-'));
delete process.env.WORKCRAFT_FIRST_PROJECT;
const P = await import('../../src/server/projects.ts');
const { seedProject } = await import('../../src/server/seed.ts');
P.setSeed(seedProject);

const ownFiles = (id: string) => readdirSync(P.projectRoot(id)).filter((f) => f !== '.workcraft');

test('A new installation starts with an empty project of its own', async () => {
  const { meta } = await P.activeProject();
  assert.equal(meta.name, 'My project');
  assert.deepEqual(ownFiles(meta.id), []);
  assert.equal(P.listProjects().length, 1);
});

test('Load sample data opens a separate sample project, created once', async () => {
  const mine = (await P.activeProject()).meta;
  const first = await P.openSample();
  assert.equal(first.created, true);
  assert.equal(first.meta.name, P.SAMPLE_NAME);
  assert.notEqual(first.meta.id, mine.id);
  assert.ok(existsSync(join(P.projectRoot(first.meta.id), 'sheets', 'finances.xlsx')), 'sample spreadsheet');
  assert.ok(existsSync(join(P.projectRoot(first.meta.id), 'pdf', 'contract.pdf')), 'sample PDF');
  assert.equal((await P.activeProject()).meta.id, first.meta.id, 'the sample project is active');

  const again = await P.openSample();
  assert.equal(again.created, false);
  assert.equal(again.meta.id, first.meta.id);
  assert.equal(P.listProjects().length, 2);
  assert.deepEqual(ownFiles(mine.id), [], 'the own project stays untouched');
});

test('The IDE reports the release version of workcraft', async () => {
  const { VERSION } = await import('../../src/core/version.ts');
  // The monorepo keeps the IDE's package.json in repos/ide/; in workcraft it is the root one
  const pkgFile = existsSync('repos/ide/package.json') ? 'repos/ide/package.json' : 'package.json';
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { name: string; version: string };
  assert.equal(pkg.name, 'workcraft');
  assert.equal(VERSION, pkg.version);
  const changelog = readFileSync(existsSync('repos/ide/CHANGELOG.md') ? 'repos/ide/CHANGELOG.md' : 'CHANGELOG.md', 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${VERSION.replace(/\./g, '\\.')}\\]`, 'm'), 'the version has a CHANGELOG entry');
});

test.after(() => {
  for (const p of P.listProjects()) P.releaseProject(p.id);
  rmSync(process.env.WORKCRAFT_HOME!, { recursive: true, force: true });
});
