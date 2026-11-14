// What the stage shows when a workspace is entered (src/ecosystems/stage-plan.ts): the "No panels open" bug came from deciding this in
// three places. The planner is pure, so the rules are tested without a browser.
//   npx tsx --test tests/server/stage-plan.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECOSYSTEMS } from '../../src/ecosystems/catalog.js';
import { MIN_APP_WIDTH, planLeave, planStage, stageIsBlank, stageSlots, tabBelongs, type PlanInput, type PlanPanel } from '../../src/ecosystems/stage-plan.js';

const panel = (id: string, tool: string, mode: PlanPanel['mode'] = 'normal', app = true): PlanPanel => ({ id, tool, mode, app });
const base = (over: Partial<PlanInput> = {}): PlanInput => ({ apps: ['a', 'b', 'c'], runs: () => true, weightOf: () => 'medium', panels: [], ipad: false, compact: false, ...over });

test('Two apps side by side on a desktop, one in a compact window', () => {
  const two = planStage(base());
  assert.deepEqual(two.show, ['a', 'b']);
  assert.equal(two.layout, 'columns');
  const one = planStage(base({ compact: true }));
  assert.deepEqual(one.show, ['a']);
  assert.equal(one.layout, 'grid');
});

test('A stage too narrow for two apps opens one (the project tree and the chat leave about 300 px at 800 px)', () => {
  assert.equal(stageSlots(false, 0), 2);
  assert.equal(stageSlots(false, MIN_APP_WIDTH * 2), 2);
  assert.equal(stageSlots(false, MIN_APP_WIDTH * 2 - 1), 1);
  assert.equal(stageSlots(true, 5000), 1);
  assert.deepEqual(planStage(base({ stageWidth: 300 })).show, ['a']);
});

test('Only apps with a web build open; the others stay one click away', () => {
  const p = planStage(base({ runs: (id) => id !== 'a' }));
  assert.deepEqual(p.show, ['b', 'c']);
});

test('The panels of another workspace give way, the ones of this workspace stay', () => {
  const p = planStage(base({ panels: [panel('p1', 'a'), panel('p2', 'old'), panel('p3', 'older', 'hidden'), panel('p4', 'code', 'normal', false)] }));
  assert.deepEqual(p.hide, ['p2']);
  assert.equal(p.reason, 'ok');
});

test('A workspace with nothing that can run changes nothing: the old panels stay and the stage is never emptied', () => {
  const p = planStage(base({ runs: () => false, panels: [panel('p1', 'old')] }));
  assert.deepEqual(p.show, []);
  assert.deepEqual(p.hide, []);
  assert.equal(p.layout, null);
  assert.equal(p.reason, 'no-builds');
});

test('A heavy pair is cut down on an iPad and kept on a desktop', () => {
  const heavy = (over: Partial<PlanInput> = {}) => base({ weightOf: () => 'heavy', ...over });
  assert.equal(planStage(heavy({ ipad: true })).show.length, 1);
  assert.equal(planStage(heavy()).show.length, 2);
});

test('Every built-in workspace plans a non-empty stage on a desktop when its apps run', () => {
  for (const e of ECOSYSTEMS) {
    const p = planStage({ apps: e.apps, runs: () => true, weightOf: () => 'medium', panels: [], ipad: false, compact: false });
    assert.ok(p.show.length >= 1, `${e.id} shows at least one app`);
    assert.ok(p.show.every((id) => e.apps.includes(id as never)), `${e.id} shows only its own apps`);
  }
});

test('A blank stage is one without a visible panel', () => {
  assert.equal(stageIsBlank([]), true);
  assert.equal(stageIsBlank([{ mode: 'hidden' }, { mode: 'minimized' }]), true);
  assert.equal(stageIsBlank([{ mode: 'hidden' }, { mode: 'normal' }]), false);
});

test('The tab strip keeps what is visible, the tools, this workspace and anything loaded', () => {
  const mine = new Set(['a']);
  assert.equal(tabBelongs({ app: true, tool: 'x', mode: 'normal', live: false }, mine), true);
  assert.equal(tabBelongs({ app: true, tool: 'x', mode: 'minimized', live: false }, mine), true);
  assert.equal(tabBelongs({ app: false, tool: 'code', mode: 'hidden', live: false }, mine), true);
  assert.equal(tabBelongs({ app: true, tool: 'a', mode: 'hidden', live: false }, mine), true);
  assert.equal(tabBelongs({ app: true, tool: 'x', mode: 'hidden', live: true }, mine), true);
  assert.equal(tabBelongs({ app: true, tool: 'x', mode: 'hidden', live: false }, mine), false);
});

test('Entering a workspace opens nothing: only the visible apps of other workspaces give way', () => {
  const panels = [panel('p1', 'a'), panel('p2', 'old'), panel('p3', 'older', 'hidden'), panel('p4', 'code', 'normal', false), panel('p5', 'older2', 'minimized')];
  assert.deepEqual(planLeave(['a', 'b'], panels), ['p2']);
  assert.deepEqual(planLeave(['a'], []), []);
});
