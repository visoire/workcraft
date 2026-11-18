import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, placeholderTarget, isTransient, tooManyDeletes, holdDeletes, runSync, type SyncFile, type SyncAdapter } from '../../src/core/sync.ts';

const f = (path: string, hash: string): SyncFile => ({ path, size: 1, mtime: 1, hash });

test('iCloud placeholders: ".name.icloud" stands for "name", unfinished uploads are transient', () => {
  assert.equal(placeholderTarget('/docs/.report.docx.icloud'), '/docs/report.docx');
  assert.equal(placeholderTarget('.a.icloud'), 'a');
  assert.equal(placeholderTarget('/docs/report.docx'), null);
  assert.ok(isTransient('/x/.y.icloud'));
  assert.ok(isTransient('/x/big.zip.uploading'));
  assert.ok(isTransient('/x/file.crdownload'));
  assert.ok(!isTransient('/x/file.md'));
});

test('A file that is still arriving from iCloud is neither copied nor deleted', () => {
  // The base knew report.docx; on the cloud side only the placeholder is there now. Without the rule this planned "delete-local".
  const local = [f('/report.docx', 'h1'), f('/keep.md', 'k')];
  const remote = [f('/.report.docx.icloud', 'x'), f('/keep.md', 'k')];
  assert.deepEqual(planSync(local, remote, { '/report.docx': 'h1', '/keep.md': 'k' }), []);
  // and the placeholder itself is never pulled as a file
  assert.deepEqual(planSync([], [f('/.a.icloud', 'x')], null), []);
});

test('Many deletions at once are held back; a few go through', () => {
  assert.ok(!tooManyDeletes(3, 10));
  assert.ok(!tooManyDeletes(4, 100));
  assert.ok(tooManyDeletes(5, 8));
  assert.ok(tooManyDeletes(21, 1000));
  const dels = Array.from({ length: 6 }, (_, i) => ({ op: 'delete-remote' as const, path: `/f${i}` }));
  const all = [...dels, { op: 'push' as const, path: '/new' }];
  const { run, held } = holdDeletes(all, 10);
  assert.equal(held.length, 6);
  assert.deepEqual(run.map((a) => a.path), ['/new']);
  assert.equal(holdDeletes(all, 10, true).held.length, 0);
});

function memory(name: string, init: Record<string, string>): SyncAdapter & { files: Map<string, string> } {
  const files = new Map(Object.entries(init));
  return {
    name,
    files,
    manifest: async () => [...files].map(([p, c]) => f(p, c)),
    read: async (p) => new TextEncoder().encode(files.get(p) || ''),
    write: async (p, d) => void files.set(p, new TextDecoder().decode(d)),
    remove: async (p) => void files.delete(p),
  };
}

test('runSync with the guard: a mass delete on one side is held, then let through on request', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const base = Object.fromEntries(names.map((n) => [`/${n}`, n]));
  const hash = async (d: Uint8Array) => new TextDecoder().decode(d);
  // this computer still has all six, the cloud lost them all: that would delete six local files
  const local = memory('this computer', base2(names));
  const remote = memory('cloud', {});
  const r1 = await runSync(local, remote, base, { hash, guardDeletes: true });
  assert.equal(r1.held, 6);
  assert.equal(r1.deleted, 0);
  assert.equal(local.files.size, 6);
  assert.equal(Object.keys(r1.base).length, 6, 'the base is kept so the next pass plans the same deletions');
  const r2 = await runSync(local, remote, base, { hash, guardDeletes: true, letDeletesGo: true });
  assert.equal(r2.held, 0);
  assert.equal(r2.deleted, 6);
  assert.equal(local.files.size, 0);
});

function base2(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [`/${n}`, n]));
}
