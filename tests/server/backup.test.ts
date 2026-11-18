import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { BACKUP_FORMAT, MANIFEST_NAME, backupFileName, makeManifest, parseManifest, planRestore, restoreSummary, projectEntryName } from '../../src/core/backup.ts';

test('The backup has a dated name and a numbered file per project', () => {
  assert.equal(backupFileName(new Date('2026-11-18T10:00:00Z')), 'workcraft-backup-2026-11-18.zip');
  assert.equal(projectEntryName(0, 'My project'), 'projects/01-My-project.zip');
  assert.equal(projectEntryName(11, '../../evil'), 'projects/12-evil.zip');
  assert.equal(projectEntryName(0, '***'), 'projects/01-project.zip');
});

test('Manifest: written, read back, and a foreign file is refused', () => {
  const m = makeManifest('0.1.0-alpha.5', [{ id: 'a', name: 'One' }, { id: 'b', name: 'Two', updated: '2026-11-01T00:00:00Z' }], new Date('2026-11-18T10:00:00Z'));
  assert.equal(m.format, BACKUP_FORMAT);
  assert.equal(m.projects[1]!.file, 'projects/02-Two.zip');
  const back = parseManifest(JSON.stringify(m))!;
  assert.deepEqual(back.projects.map((p) => p.name), ['One', 'Two']);
  assert.equal(back.version, '0.1.0-alpha.5');
  assert.equal(parseManifest('{"format":"other"}'), null);
  assert.equal(parseManifest('not json'), null);
});

test('Manifest: entries that point outside projects/ are dropped', () => {
  const evil = JSON.stringify({ format: BACKUP_FORMAT, version: '1', created: 'x', projects: [{ id: '1', name: 'ok', file: 'projects/01-ok.zip' }, { id: '2', name: 'bad', file: '../outside.zip' }, { id: '3', name: 'bad2', file: 'projects/../x.zip' }, { id: '4', name: 'bad3', file: '/etc/passwd' }] });
  assert.deepEqual(parseManifest(evil)!.projects.map((p) => p.id), ['1']);
});

test('Restore only adds: a taken name comes back as a copy, nothing is overwritten', () => {
  const projects = [{ id: '1', name: 'Budget', file: 'projects/01-Budget.zip' }, { id: '2', name: 'Trip', file: 'projects/02-Trip.zip' }, { id: '3', name: 'budget', file: 'projects/03-budget.zip' }];
  const steps = planRestore(projects, ['Budget', 'Other'], new Date('2026-11-18T00:00:00Z'));
  assert.deepEqual(steps.map((s) => [s.name, s.copy]), [['Budget (restored 2026-11-18)', true], ['Trip', false], ['budget (restored 2026-11-18 2)', true]]);
  assert.match(restoreSummary(steps, 0), /3 projects restored, 2 as a copy/);
  assert.match(restoreSummary(steps, 1), /2 projects restored.*1 could not be restored/);
  assert.equal(restoreSummary([steps[1]!], 0), '1 project restored.');
});

test('A backup ZIP round trips with fflate: manifest plus nested project ZIPs', () => {
  const inner = zipSync({ 'a.md': strToU8('# a') });
  const m = makeManifest('0.1.0-alpha.5', [{ id: 'a', name: 'One' }]);
  const zip = zipSync({ [MANIFEST_NAME]: strToU8(JSON.stringify(m)), [m.projects[0]!.file]: [inner, { level: 0 }] }, { level: 0 });
  const entries = unzipSync(zip);
  const read = parseManifest(strFromU8(entries[MANIFEST_NAME]!))!;
  assert.deepEqual(Object.keys(unzipSync(entries[read.projects[0]!.file]!)), ['a.md']);
});
