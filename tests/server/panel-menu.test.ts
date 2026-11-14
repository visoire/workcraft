// The panel context menu (src/workspace/panel-menu.ts) and the long press that opens it on a touch screen (src/app/long-press.ts).
//   npx tsx --test tests/server/panel-menu.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelActions, infoRows, type PanelFacts } from '../../src/workspace/panel-menu.js';
import { movedTooFar, LONG_PRESS_MS, LONG_PRESS_SLOP } from '../../src/app/long-press.js';
import { DE } from '../../src/app/i18n-de.js';

const base: PanelFacts = { shown: true, app: true, side: false, status: 'active', hasPath: true, popped: false, canPopOut: true, canMinimize: true, hasDesktopApp: true, canLocate: true };
const plan = (o: Partial<PanelFacts> = {}) => panelActions({ ...base, ...o });
const clean = (list: (string)[]) => list.filter((x) => x !== '-');

test('an app with a file offers every action of the roadmap, grouped, in order', () => {
  assert.deepEqual(plan(), ['maximize', 'fullscreen', 'minimize', 'pip', 'popout', '-', 'desktop', 'tree', 'reveal', 'copy-path', '-', 'reload', 'unload', 'info', '-', 'close']);
});

test('no group is empty, no separator is first, last or doubled, for every combination of facts', () => {
  const flags = ['shown', 'app', 'side', 'hasPath', 'popped', 'canPopOut', 'canMinimize', 'hasDesktopApp', 'canLocate'] as const;
  for (let mask = 0; mask < 1 << flags.length; mask++) {
    for (const status of ['idle', 'queued', 'loading', 'active', 'unloaded', 'error']) {
      const f = { ...base, status, ...Object.fromEntries(flags.map((k, i) => [k, !!(mask & (1 << i))])) } as PanelFacts;
      const list = panelActions(f);
      assert.notEqual(list[0], '-', JSON.stringify(f));
      assert.notEqual(list[list.length - 1], '-', JSON.stringify(f));
      assert.ok(list.every((x, i) => !(x === '-' && list[i - 1] === '-')), JSON.stringify(f));
      assert.equal(new Set(clean(list)).size, clean(list).length, 'no action twice');
      assert.ok(list.includes('info'), 'info is always there');
    }
  }
});

test('file actions need a file; the desktop app and the file manager need those to exist', () => {
  assert.deepEqual(clean(plan({ hasPath: false })).filter((a) => ['desktop', 'tree', 'reveal', 'copy-path'].includes(a)), []);
  assert.ok(!plan({ hasDesktopApp: false }).includes('desktop'));
  assert.ok(plan({ hasDesktopApp: false }).includes('tree'));
  const remote = plan({ canLocate: false });
  assert.ok(!remote.includes('reveal') && remote.includes('copy-path'), 'over the home network or in browser mode there is no file manager, but the project path can be copied');
});

test('a hidden or minimized panel is shown first; window actions that act on something nobody sees are not offered', () => {
  const list = plan({ shown: false });
  assert.equal(list[0], 'show');
  for (const a of ['maximize', 'fullscreen', 'minimize', 'pip']) assert.ok(!list.includes(a as never), a);
  assert.ok(list.includes('popout'), 'it can still go to a window of its own');
});

test('reload and unload belong to apps that are running or can be started again', () => {
  assert.ok(plan({ status: 'active' }).includes('reload') && plan({ status: 'active' }).includes('unload'));
  assert.ok(plan({ status: 'unloaded' }).includes('reload') && !plan({ status: 'unloaded' }).includes('unload'), 'unloaded: nothing to free, but it can be started');
  assert.ok(plan({ status: 'error' }).includes('reload'));
  for (const status of ['idle', 'queued', 'loading']) assert.ok(!plan({ status }).includes('reload'), `${status}: wait`);
  assert.ok(!plan({ app: false }).includes('reload') && !plan({ app: false }).includes('unload'), 'the code editor, the terminal and the settings keep their state: no reload');
  assert.ok(!plan({ popped: true }).includes('reload'), 'the engine of a panel in its own window is reached from that window');
});

test('side panels are hidden, the others closed', () => {
  assert.equal(plan({ side: true }).at(-1), 'hide');
  assert.equal(plan({ side: false }).at(-1), 'close');
});

test('the info card lists app, state and window first, the file when there is one, then memory and what the engine reports (flat values only)', () => {
  const L = { app: 'App', status: 'State', window: 'Window', file: 'File', start: 'Start', wasm: 'Wasm', gpu: 'GPU', heap: 'Heap', error: 'Error' };
  const rows = infoRows({ name: 'GridCraft', version: '0.19.1', status: 'active', mode: 'on the stage', path: '/sheets/a.xlsx', loadMs: 2400, paused: true, memory: { wasm: 64 * 1048576, gpu: 0, heap: 12 * 1048576 }, report: { app: 'GridCraft', version: '0.19.1', renderer: 'webgl2', canvas_width: 1200, nested: { a: 1 }, empty: '', nothing: null }, error: undefined }, L);
  assert.deepEqual(rows.slice(0, 5), [['App', 'GridCraft 0.19.1'], ['State', 'active · paused'], ['Window', 'on the stage'], ['File', '/sheets/a.xlsx'], ['Start', '2.4 s']]);
  assert.deepEqual(rows.slice(5, 7), [['Wasm', '64 MB'], ['Heap', '12 MB']]);
  assert.deepEqual(rows.slice(7), [['renderer', 'webgl2'], ['canvas width', '1200']]);
  assert.equal(infoRows({ name: 'X', status: 'error', mode: 'hidden', path: null, loadMs: 0, paused: false, memory: null, report: null, error: 'boom' }, L).at(-1)?.[1], 'boom');
});

test('a finger that moves farther than the slop is scrolling, not pressing', () => {
  assert.equal(movedTooFar(100, 100, 103, 104), false);
  assert.equal(movedTooFar(100, 100, 100 + LONG_PRESS_SLOP + 1, 100), true);
  assert.ok(LONG_PRESS_MS >= 400 && LONG_PRESS_MS <= 700, 'long enough not to fire on a tap, short enough to feel like a menu');
});

test('every new menu text has a German entry', () => {
  for (const k of ['Show in the project tree', 'Panel info', 'Reload anyway', 'Start time', 'WebAssembly memory', 'JS heap', 'separate window', 'on the stage']) assert.ok(DE[k], k);
});
