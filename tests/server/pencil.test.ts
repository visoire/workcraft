// Apple Pencil rules (src/ipados/pen-input.ts): palm rejection, finger and keyboard, tool switching,
// scratch-out, eraser hit testing, hover circle. Pure logic, no browser needed.
//   npx tsx --test tests/server/pencil.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPalm, PALM, blockFingerKeyboard, PENCIL_SESSION_MS, PenToolState, isScratchOut, reversals, strokeHitBy, strokesHitBy, ringSpec, type PenContext, type PenTool, type Pt, type HitStroke } from '../../src/ipados/pen-input.js';

const idle: PenContext = { down: false, sinceLiftMs: Infinity, hover: null };

// ---------------------------------------------------------------- palm rejection

test('A fingertip with no pencil around is a finger, a large contact is a palm', () => {
  assert.equal(isPalm({ x: 10, y: 10 }, idle), false);
  assert.equal(isPalm({ x: 10, y: 10, radius: 14 }, idle), false);
  assert.equal(isPalm({ x: 10, y: 10, radius: PALM.radius }, idle), true);
});

test('Every touch is a palm while the pencil writes and for a short time after it lifts', () => {
  assert.equal(isPalm({ x: 900, y: 900 }, { down: true, sinceLiftMs: 0, hover: null }), true);
  assert.equal(isPalm({ x: 900, y: 900 }, { down: false, sinceLiftMs: PALM.liftMs - 1, hover: null }), true);
  assert.equal(isPalm({ x: 900, y: 900 }, { down: false, sinceLiftMs: PALM.liftMs + 1, hover: null }), false);
});

test('A hovering pencil shields only the area around its tip: the other hand can still pan', () => {
  const hover = { x: 500, y: 400, ageMs: 50 };
  const ctx: PenContext = { down: false, sinceLiftMs: Infinity, hover };
  assert.equal(isPalm({ x: 540, y: 460 }, ctx), true, 'next to the tip is the writing hand');
  assert.equal(isPalm({ x: 80, y: 700 }, ctx), false, 'far away is the other hand');
  assert.equal(isPalm({ x: 540, y: 460 }, { ...ctx, hover: { ...hover, ageMs: PALM.hoverMs + 1 } }), false, 'a stale hover protects nothing');
});

// ---------------------------------------------------------------- finger and keyboard

test('Finger and keyboard: auto follows the pencil, never and always are fixed', () => {
  assert.equal(blockFingerKeyboard('auto', false, Infinity), false, 'no pencil yet: the finger types');
  assert.equal(blockFingerKeyboard('auto', true, 1000), true, 'pencil in use: the finger does not open the keyboard');
  assert.equal(blockFingerKeyboard('auto', true, PENCIL_SESSION_MS + 1), false, 'the pencil was put away a long time ago');
  assert.equal(blockFingerKeyboard('never', false, Infinity), true);
  assert.equal(blockFingerKeyboard('always', true, 0), false);
});

// ---------------------------------------------------------------- tools

test('The eraser end switches to the eraser for one stroke and back', () => {
  const log: [PenTool, string][] = [];
  const s = new PenToolState((t, why) => log.push([t, why]));
  s.down(32);
  assert.equal(s.tool, 'eraser');
  assert.equal(s.temporary, true);
  s.up();
  assert.equal(s.tool, 'pen');
  assert.deepEqual(log, [['eraser', 'eraser-end'], ['pen', 'release']]);
  s.down(1, 5);
  assert.equal(s.tool, 'eraser', 'button 5 is the eraser too');
});

test('The barrel button follows its setting', () => {
  const eraser = new PenToolState(() => {}, 'eraser');
  eraser.down(2);
  assert.equal(eraser.tool, 'eraser');
  eraser.up();
  assert.equal(eraser.tool, 'pen');

  const toggle = new PenToolState(() => {}, 'toggle');
  toggle.down(2);
  toggle.up();
  assert.equal(toggle.tool, 'eraser', 'toggle stays after the button is released');
  toggle.down(2);
  assert.equal(toggle.tool, 'pen');

  const off = new PenToolState(() => {}, 'off');
  off.down(2);
  assert.equal(off.tool, 'pen');
});

test('A chosen tool is what a held button returns to', () => {
  const s = new PenToolState();
  s.set('eraser');
  s.down(2);
  s.up();
  assert.equal(s.tool, 'eraser');
  s.toggle();
  assert.equal(s.tool, 'pen');
});

// ---------------------------------------------------------------- scratch-out

const zigzag = (n: number, w = 90, h = 6, step = 4): Pt[] => {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: (i % 2 ? w : 0) + (i * step) / 4, y: i * h });
  return pts;
};

test('A tight zig-zag is a scratch-out, a straight line, a circle and a signature are not', () => {
  assert.equal(isScratchOut(zigzag(14)), true);
  const line: Pt[] = Array.from({ length: 40 }, (_, i) => ({ x: i * 6, y: 10 }));
  assert.equal(isScratchOut(line), false);
  const circle: Pt[] = Array.from({ length: 60 }, (_, i) => ({ x: 100 + 60 * Math.cos(i / 9.5), y: 100 + 60 * Math.sin(i / 9.5) }));
  assert.equal(isScratchOut(circle), false, 'a round stroke has no sharp turns back');
  const wave: Pt[] = Array.from({ length: 120 }, (_, i) => ({ x: i * 12, y: 30 * Math.sin(i / 4) }));
  assert.equal(isScratchOut(wave), false, 'a long wave is far too wide to be a scratch');
});

test('Too few points or a tiny wiggle are no scratch-out', () => {
  assert.equal(isScratchOut(zigzag(5)), false);
  assert.equal(isScratchOut(Array.from({ length: 30 }, (_, i) => ({ x: i % 2, y: 0 }))), false);
});

test('reversals counts turns with a minimum swing', () => {
  assert.equal(reversals([0, 10, 0, 10, 0], 5), 3);
  assert.equal(reversals([0, 2, 0, 2, 0], 5), 0);
  assert.equal(reversals([], 5), 0);
});

// ---------------------------------------------------------------- eraser hit testing

const ink = (pts: Pt[], width = 2): HitStroke => ({ style: 'ink', width, points: pts });

test('The eraser hits a stroke it crosses and misses one it does not reach', () => {
  const stroke = ink([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  assert.equal(strokeHitBy(stroke, [{ x: 50, y: 52 }], 6), true, 'on the line');
  assert.equal(strokeHitBy(stroke, [{ x: 50, y: 70 }], 6), false, 'beside the line');
  assert.equal(strokeHitBy(stroke, [{ x: 140, y: 50 }], 6), false, 'past the end');
  assert.equal(strokeHitBy(ink([{ x: 5, y: 5 }]), [{ x: 8, y: 6 }], 4), true, 'a dot');
});

test('Frames and redactions are hit inside their rectangle', () => {
  const rect: HitStroke = { style: 'rect', width: 0, points: [{ x: 10, y: 10 }, { x: 60, y: 40 }] };
  assert.equal(strokeHitBy(rect, [{ x: 30, y: 20 }], 2), true);
  assert.equal(strokeHitBy(rect, [{ x: 200, y: 200 }], 2), false);
});

test('strokesHitBy returns the indices in order', () => {
  const list = [ink([{ x: 0, y: 0 }, { x: 50, y: 0 }]), ink([{ x: 0, y: 100 }, { x: 50, y: 100 }]), ink([{ x: 0, y: 200 }, { x: 50, y: 200 }])];
  assert.deepEqual(strokesHitBy(list, [{ x: 20, y: 98 }, { x: 20, y: 0 }], 5), [0, 1]);
});

// ---------------------------------------------------------------- hover circle

test('The hover circle shows the tool: line width for the pen, a larger dashed circle for the eraser', () => {
  const pen = ringSpec('pen', 2.4);
  const eraser = ringSpec('eraser', 4);
  assert.equal(pen.dashed, false);
  assert.equal(eraser.dashed, true);
  assert.ok(eraser.size > pen.size);
  assert.ok(pen.size >= 8, 'thin lines still get a visible circle');
  assert.equal(pen.stretch, 1, 'upright pencil: round');
});

test('A tilted pencil stretches the circle, zoom scales the pen but stays bounded', () => {
  const flat = ringSpec('pen', 2, 1, 0.2, Math.PI / 2);
  assert.ok(flat.stretch > 1.4);
  assert.equal(Math.round(flat.rotate), 90);
  assert.ok(ringSpec('pen', 2, 4).size > ringSpec('pen', 2, 1).size);
  assert.ok(ringSpec('pen', 20, 10).size <= 40);
  assert.ok(ringSpec('eraser', 4, 10).size <= 72);
});
