// The shared data folder: ~/workcraft for the workspace and the desktop chat (which keeps its data in ~/workcraft/chat).
//   npx tsx --test tests/server/datahome.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { chooseHome, DATA_FOLDER, FORMER_FOLDERS } from '../../src/server/home.js';
// @ts-expect-error plain .mjs without types
import { dataHome } from '../../scripts/data-home.mjs';

const P = nodePath.posix;
const fakeFs = (have: string[]) => {
  const set = new Set(have);
  const moves: [string, string][] = [];
  return {
    fs: { exists: (p: string) => set.has(p), rename: (a: string, b: string) => void moves.push([a, b]) },
    moves,
  };
};

test('The data folder is named workcraft, and an environment variable wins', () => {
  assert.equal(DATA_FOLDER, 'workcraft');
  const { fs, moves } = fakeFs(['/h/workcraft', '/h/Workspace']);
  assert.equal(chooseHome('/h', { WORKCRAFT_HOME: '/data/wc' }, fs, P), '/data/wc');
  assert.equal(chooseHome('/h', { OPENCRAFT_HOME: '/data/old' }, fs, P), '/data/old');
  assert.equal(chooseHome('/h', {}, fs, P), '/h/workcraft');
  assert.deepEqual(moves, [], 'nothing is renamed when the new folder is there');
});

test('An earlier folder is renamed once, newest name first, and never copied', () => {
  const a = fakeFs(['/h/Workspace', '/h/OpenCraft']);
  assert.equal(chooseHome('/h', {}, a.fs, P), '/h/workcraft');
  assert.deepEqual(a.moves, [['/h/Workspace', '/h/workcraft']], 'only the newest earlier folder moves');
  const b = fakeFs(['/h/OpenCraft']);
  assert.equal(chooseHome('/h', {}, b.fs, P), '/h/workcraft');
  assert.deepEqual(b.moves, [['/h/OpenCraft', '/h/workcraft']]);
  assert.deepEqual([...FORMER_FOLDERS], ['Workspace', 'WorkCraft', 'OpenCraft']);
  assert.equal(chooseHome('/h', {}, fakeFs([]).fs, P), '/h/workcraft', 'a new installation');
});

test('A folder that cannot be renamed is used where it is (another program holds it open)', () => {
  const fs = { exists: (p: string) => p === '/h/Workspace', rename: () => { throw new Error('EBUSY'); } };
  assert.equal(chooseHome('/h', {}, fs, P), '/h/Workspace');
});

test('Scripts that only look for the folder never move it and agree with the server', () => {
  const have = (...names: string[]) => (p: string) => names.map((n) => nodePath.join('/h', n)).includes(p);
  assert.equal(dataHome({ WORKCRAFT_HOME: '/x' }, '/h', have()), nodePath.resolve('/x'));
  assert.equal(dataHome({}, '/h', have('workcraft', 'Workspace')), nodePath.resolve('/h', 'workcraft'));
  assert.equal(dataHome({}, '/h', have('Workspace')), nodePath.resolve('/h', 'Workspace'), 'an unmoved earlier folder is found');
  assert.equal(dataHome({}, '/h', have()), nodePath.resolve('/h', 'workcraft'));
});

test('No source file still names ~/Workspace as the data folder', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const bad: string[] = [];
  // These three name it on purpose: as the former name that is migrated
  const former = new Set(['src/server/home.ts', 'src/server/paths.ts', 'scripts/data-home.mjs', 'tests/server/datahome.test.ts']);
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = nodePath.join(dir, n);
      const key = p.split(nodePath.sep).join('/'); // the same name on Windows and Linux
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mjs|js|md)$/.test(n) && !former.has(key) && readFileSync(p, 'utf8').includes('~/Workspace')) bad.push(key);
    }
  };
  for (const d of ['src', 'docs', 'scripts', 'tests']) walk(d);
  assert.deepEqual(bad, [], '~/Workspace appears in: ' + bad.join(', '));
});