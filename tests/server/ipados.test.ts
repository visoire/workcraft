// iPadOS support layer (src/ipados): capability plan, compatibility register, pen calibration, memory
// governor, OPFS offload rule, engine sharpness check. Pure logic, no browser needed.
//   npx tsx --test tests/server/ipados.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { COMPAT, COMPAT_IDS, parseManifest, readManifest } from '../../src/ipados/compat.js';
import { probeCapabilities, planFor, runtimeMode, type ProbeEnv } from '../../src/ipados/capabilities.js';
import { PenCalibrator } from '../../src/ipados/pen-calibration.js';
import { budgetFor, levelOf, planRelief, MemoryGovernor, LagMonitor, lagLevel, escalate, reasonText, type GovernorHost, type GovernorPanel, type HealthEvent, type LagLevel, type MemoryAction, type PanelMem } from '../../src/ipados/memory.js';
import { shouldOffload, newBlobId, OFFLOAD_MIN_BYTES } from '../../src/ipados/opfs.js';
import { judgeSharpness } from '../../src/ipados/adapter.js';
import { pickStageApps, stageCapacity, startTimeoutMs, START_BASE_MS, type Weight } from '../../src/ipados/stage.js';
import { beginSession, endSession, resumeSession, scaleBudget, RECENT_MS, RECOVERY_BUDGET_SCALE, type SessionStore } from '../../src/ipados/session.js';
import { cacheFit, neededBytes } from '../../src/ecosystems/storage-fit.js';

const MB = 1024 * 1024;
const read = (p: string) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------- register

test('Every compatibility measure is documented in docs/IPADOS-COMPAT.md', () => {
  const doc = read('docs/IPADOS-COMPAT.md');
  for (const m of COMPAT) assert.ok(doc.includes('`' + m.id + '`'), `docs/IPADOS-COMPAT.md does not mention ${m.id}`);
  // and the other way round: a documented id that no longer exists is a stale doc
  const documented = [...doc.matchAll(/^\| `([a-z0-9-]+)` \| (?:frame|host|workspace) \|/gm)].map((x) => x[1]!);
  for (const id of documented) assert.ok(COMPAT_IDS.includes(id), `docs/IPADOS-COMPAT.md documents ${id}, which is not in src/ipados/compat.ts`);
});

test('The register has unique ids and every implementation file exists', () => {
  assert.equal(new Set(COMPAT_IDS).size, COMPAT_IDS.length);
  for (const m of COMPAT) {
    for (const file of m.where.split(/,\s*/).map((w) => w.replace(/\s*\(.*\)$/, ''))) assert.ok(existsSync(file), `${m.id}: ${file} does not exist`);
  }
});

test('Every frame layer measure is applied by public/craft-frame.js under its own id', () => {
  const frame = read('public/craft-frame.js');
  for (const m of COMPAT.filter((x) => x.layer === 'frame')) assert.ok(frame.includes(`applied('${m.id}')`), `${m.id} is in the register but craft-frame.js never reports it`);
});

test('The frame layer and the workspace read the same engine manifest tokens', () => {
  const frame = read('public/craft-frame.js');
  for (const m of COMPAT) if (m.optOut && m.layer === 'frame') assert.ok(frame.includes(`'${m.optOut}'`) || frame.includes(`.${m.optOut}`), `craft-frame.js ignores the token ${m.optOut}`);
});

test('No measure depends on an engine version number', () => {
  for (const file of ['src/ipados/adapter.ts', 'src/ipados/compat.ts', 'public/craft-frame.js']) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\b(version|\.web|webVersion)\s*(===?|!==?|[<>]=?)/.test(code), `${file} compares a version`);
    assert.ok(!/\b0\.1[5-8]\.\d/.test(code), `${file} names an engine version`);
  }
});

// ---------------------------------------------------------------- manifest

test('Engine manifest: text, array and object forms, unknown tokens kept', () => {
  assert.deepEqual([...parseManifest('native-pen, Native-Touch;threads  future-token')].sort(), ['future-token', 'native-pen', 'native-touch', 'threads']);
  assert.deepEqual([...parseManifest(['gesture-lock', 7, null])], ['gesture-lock']);
  assert.deepEqual([...parseManifest({ 'native-retina': true, 'native-pen': 0 })], ['native-retina']);
  assert.equal(parseManifest(undefined).size, 0);
  const win = { __craftCapabilities: { threads: true }, document: { querySelector: () => ({ getAttribute: () => 'native-pen' }) } };
  assert.deepEqual([...readManifest(win)].sort(), ['native-pen', 'threads']);
  // a window that throws (another origin) is an empty manifest
  const hostile = { get __craftCapabilities(): unknown { throw new Error('cross origin'); } };
  assert.equal(readManifest(hostile).size, 0);
  assert.equal(readManifest(null).size, 0);
});

// ---------------------------------------------------------------- capabilities and plan

const IPAD_HTTPS: ProbeEnv = {
  isSecureContext: true,
  devicePixelRatio: 2,
  navigator: { gpu: {}, serviceWorker: {}, storage: { getDirectory: () => {}, persist: () => {} }, maxTouchPoints: 5 },
  matchMedia: (q) => ({ matches: /any-hover|any-pointer: (coarse|fine)/.test(q) }),
  PointerEvent: { prototype: { getCoalescedEvents: () => [] } },
  WebGL2RenderingContext: function () {},
  Worker: function () {},
  SharedArrayBuffer: undefined,
};
const IPAD_HTTP: ProbeEnv = { ...IPAD_HTTPS, isSecureContext: false, navigator: { maxTouchPoints: 5 } };

test('Probe: HTTPS iPad has WebGPU, service worker, OPFS and persistence; HTTP iPad has none of them', () => {
  const s = probeCapabilities(IPAD_HTTPS);
  assert.ok(s.secure && s.webgpu && s.serviceWorker && s.opfs && s.persist && s.coalescedEvents && s.hover && s.webgl2 && s.worker);
  assert.equal(s.dpr, 2);
  assert.equal(s.sharedArrayBuffer, false);
  const p = probeCapabilities(IPAD_HTTP);
  assert.ok(!p.secure && !p.webgpu && !p.serviceWorker && !p.opfs && !p.persist);
  assert.ok(p.webgl2, 'WebGL2 stays available over HTTP');
});

test('Probe never throws on an empty environment', () => {
  const c = probeCapabilities({});
  assert.equal(c.secure, false);
  assert.equal(c.dpr, 1);
  assert.equal(c.touchPoints, 0);
});

test('Runtime mode follows the backend: desktop, hybrid (paired iPad) or standalone', () => {
  assert.equal(runtimeMode('desktop', false), 'desktop');
  assert.equal(runtimeMode('desktop', true), 'hybrid');
  assert.equal(runtimeMode('browser', false), 'standalone');
  assert.equal(runtimeMode('browser', true), 'standalone');
});

test('Plan: standalone on HTTPS uses OPFS and WebGPU, and can switch isolation on', () => {
  const plan = planFor(probeCapabilities(IPAD_HTTPS), 'standalone', { ipad: true });
  assert.equal(plan.storage, 'opfs');
  assert.equal(plan.renderer, 'webgpu');
  assert.equal(plan.isolation, 'available');
  assert.ok(plan.offlineCache);
  assert.deepEqual(plan.notes, ['not-installed']);
});

test('Plan: standalone over HTTP degrades to IndexedDB and WebGL2 and says why', () => {
  const plan = planFor(probeCapabilities(IPAD_HTTP), 'standalone', { ipad: true });
  assert.equal(plan.storage, 'indexeddb');
  assert.equal(plan.renderer, 'webgl2');
  assert.equal(plan.isolation, 'unavailable');
  assert.ok(!plan.offlineCache);
  for (const n of ['insecure-context', 'no-offline-cache', 'no-opfs', 'no-webgpu']) assert.ok(plan.notes.includes(n as never), n);
});

test('Plan: hybrid and desktop use the REST backend; a worker that fails the sync handle test falls back', () => {
  assert.equal(planFor(probeCapabilities(IPAD_HTTPS), 'hybrid').storage, 'rest');
  assert.equal(planFor(probeCapabilities(IPAD_HTTPS), 'desktop').storage, 'rest');
  const failed = planFor(probeCapabilities(IPAD_HTTPS), 'standalone', { opfsWorks: false });
  assert.equal(failed.storage, 'indexeddb');
  assert.ok(failed.notes.includes('no-opfs'));
  assert.equal(planFor({ ...probeCapabilities(IPAD_HTTPS), crossOriginIsolated: true }, 'desktop').isolation, 'active');
});

// ---------------------------------------------------------------- pen calibration

const contact = (p: number, i: number, extra: Partial<{ twist: number; x: number }> = {}) => ({ pressure: p, twist: extra.twist ?? 0, contact: true, x: extra.x ?? i * 4, y: 0, t: i * 8 });

test('Pen with real pressure: reported as it is, never simulated', () => {
  const c = new PenCalibrator();
  const out = [0.12, 0.3, 0.55, 0.71, 0.4, 0.2].map((p, i) => c.observe(contact(p, i)));
  assert.deepEqual(out, [0.12, 0.3, 0.55, 0.71, 0.4, 0.2]);
  assert.equal(c.hasPressure, true);
});

test('Pen that always reports 0.5 (Apple Pencil USB-C, Crayon): detected after ten samples, then simulated from speed', () => {
  const c = new PenCalibrator();
  for (let i = 0; i < 9; i++) assert.equal(c.observe(contact(0.5, i)), 0.5);
  assert.equal(c.hasPressure, null, 'not enough evidence yet');
  c.observe(contact(0.5, 9));
  assert.equal(c.hasPressure, false);
  c.endStroke();
  // slow stroke: heavy line; fast stroke: light line
  let slow = 0;
  for (let i = 0; i < 40; i++) slow = c.observe({ pressure: 0.5, twist: 0, contact: true, x: i * 0.2, y: 0, t: 1000 + i * 8 });
  c.endStroke();
  let fast = 0;
  for (let i = 0; i < 40; i++) fast = c.observe({ pressure: 0.5, twist: 0, contact: true, x: i * 40, y: 0, t: 5000 + i * 8 });
  assert.ok(slow > 0.65 && slow <= 0.85, `slow ${slow}`);
  assert.ok(fast >= 0.25 && fast < 0.35, `fast ${fast}`);
  assert.ok(slow > fast);
});

test('One real pressure value is enough to rule out a flat pen for the session', () => {
  const c = new PenCalibrator();
  c.observe(contact(0.37, 0));
  for (let i = 1; i < 30; i++) c.observe(contact(0.5, i));
  assert.equal(c.hasPressure, true, 'a pen that once reported 0.37 has a sensor');
});

test('Reading the same event twice does not count as movement', () => {
  const c = new PenCalibrator();
  for (let i = 0; i < 12; i++) c.observe(contact(0.5, i));
  const a = c.observe({ pressure: 0.5, twist: 0, contact: true, x: 100, y: 0, t: 500 });
  const b = c.observe({ pressure: 0.5, twist: 0, contact: true, x: 100, y: 0, t: 500 });
  assert.equal(a, b);
});

test('Hover and barrel roll are reported only after they were seen', () => {
  const c = new PenCalibrator();
  assert.deepEqual(c.summary(), { pressure: 'unknown', hover: false, twist: false });
  c.observe(contact(0.4, 0));
  assert.equal(c.hasHover, false);
  assert.equal(c.observe({ pressure: 0, twist: 0, contact: false, x: 0, y: 0, t: 99 }), 0);
  assert.equal(c.hasHover, true);
  c.observe(contact(0.4, 1, { twist: 0 }));
  assert.equal(c.hasTwist, false);
  c.observe(contact(0.4, 2, { twist: 37 }));
  assert.equal(c.hasTwist, true);
  c.reset();
  assert.deepEqual(c.summary(), { pressure: 'unknown', hover: false, twist: false });
});

test('A contact event with pressure 0 (first event of a stroke) still draws', () => {
  const c = new PenCalibrator();
  assert.equal(c.observe(contact(0, 0)), 0.5);
});

// ---------------------------------------------------------------- memory

test('Budget: iPad 640 / 800 / 1100 MB, other devices a third of the device memory, override scales', () => {
  assert.deepEqual(budgetFor({ ipad: true }), { warn: 640 * MB, act: 800 * MB, critical: 1100 * MB });
  const desk = budgetFor({ ipad: false, deviceMemoryGB: 8 });
  assert.equal(desk.act, Math.round((8 * 1024 * MB) / 3));
  const o = budgetFor({ ipad: true, overrideMb: 500 });
  assert.equal(o.act, 500 * MB);
  assert.ok(o.warn < o.act && o.act < o.critical);
});

test('Levels', () => {
  const b = budgetFor({ ipad: true });
  assert.equal(levelOf(100 * MB, b), 'ok');
  assert.equal(levelOf(640 * MB, b), 'warn');
  assert.equal(levelOf(800 * MB, b), 'act');
  assert.equal(levelOf(1100 * MB, b), 'critical');
});

const panel = (id: string, mb: number, o: Partial<PanelMem> = {}): PanelMem => ({ id, active: true, visible: false, unsaved: false, bytes: mb * MB, lastShown: 0, ...o });

test('Relief: hidden saved panels go first, least recently shown first, and it stops at the warn line', () => {
  const b = budgetFor({ ipad: true });
  const panels = [panel('shown', 300, { visible: true, lastShown: 900 }), panel('old', 250, { lastShown: 100 }), panel('newer', 200, { lastShown: 500 }), panel('newest', 100, { lastShown: 800 })];
  // 850 MB in use: above act (800), the warn line is 640: free 210 MB at least
  assert.deepEqual(planRelief(panels, 'act', b), [{ id: 'old', action: 'unload' }]);
  // 1150 MB: critical, free until under 640
  const heavy = [...panels, panel('big', 300, { lastShown: 50 })];
  const r = planRelief(heavy, 'critical', b);
  assert.deepEqual(r.map((x) => x.id), ['big', 'old']);
});

test('Relief never touches a visible panel and never discards unsaved work', () => {
  const b = budgetFor({ ipad: true });
  const panels = [panel('shown', 900, { visible: true }), panel('dirty', 300, { unsaved: true, lastShown: 1 })];
  assert.deepEqual(planRelief(panels, 'act', b), [], 'at act level unsaved hidden panels are left alone');
  assert.deepEqual(planRelief(panels, 'critical', b), [{ id: 'dirty', action: 'save-then-unload' }], 'at critical level it saves first');
  assert.deepEqual(planRelief([panel('shown', 1200, { visible: true })], 'critical', b), [], 'nothing to free: the user decides');
  assert.deepEqual(planRelief(panels, 'warn', b), []);
  assert.deepEqual(planRelief([panel('unloaded', 500, { active: false })], 'critical', b), []);
});

function governorWith(list: GovernorPanel[], log: string[], opt: { saves?: boolean } = {}) {
  let now = 0;
  const host: GovernorHost = {
    panels: () => list,
    budget: () => budgetFor({ ipad: true }),
    now: () => now,
    async unload(id) {
      log.push('unload ' + id);
      const p = list.find((x) => x.id === id)!;
      p.status = 'unloaded';
      p.res = null;
      return true;
    },
    async save(id) {
      log.push('save ' + id);
      if (opt.saves === false) return false;
      list.find((x) => x.id === id)!.unsaved = false;
      return true;
    },
    onLevel: (l) => log.push('level ' + l),
    onFreed: (n) => log.push('freed ' + n),
    onStuck: () => log.push('stuck'),
  };
  return { gov: new MemoryGovernor(host), advance: (ms: number) => (now += ms) };
}
const gp = (id: string, mb: number, o: Partial<GovernorPanel> = {}): GovernorPanel => ({ id, name: id.toUpperCase(), status: 'active', visible: false, unsaved: false, res: { wasm: (mb / 2) * MB, gpu: (mb / 2) * MB }, ...o });

test('Governor: needs two rounds above the line before it unloads, then frees the oldest hidden panel', async () => {
  const log: string[] = [];
  const list = [gp('a', 500, { visible: true }), gp('b', 400)];
  const { gov, advance } = governorWith(list, log);
  await gov.tick();
  assert.deepEqual(log, ['level act'], 'first round: only the level is reported');
  advance(2500);
  await gov.tick();
  assert.deepEqual(log, ['level act', 'unload b', 'freed B']);
  advance(2500);
  assert.equal(await gov.tick(), 'ok', '500 MB is below the warn line');
});

test('Governor: critical acts at once, saves a hidden unsaved panel first, and reports when stuck', async () => {
  const log: string[] = [];
  const list = [gp('a', 700, { visible: true }), gp('b', 450, { unsaved: true })];
  const { gov } = governorWith(list, log);
  await gov.tick();
  assert.deepEqual(log, ['level critical', 'save b', 'unload b', 'freed B']);
  // only the visible panel is left and it is still over the warn line: tell the user once
  log.length = 0;
  const only = [gp('a', 1200, { visible: true })];
  const g2 = governorWith(only, log);
  await g2.gov.tick();
  await g2.gov.tick();
  assert.equal(log.filter((l) => l === 'stuck').length, 1, 'stuck is reported once, not every round');
});

test('Governor: a panel whose save fails stays loaded', async () => {
  const log: string[] = [];
  const list = [gp('a', 700, { visible: true }), gp('b', 450, { unsaved: true })];
  const { gov } = governorWith(list, log, { saves: false });
  await gov.tick();
  assert.ok(log.includes('save b'));
  assert.ok(!log.includes('unload b'), 'unsaved work is never discarded');
});

// ---------------------------------------------------------------- lag, modes and unsaved work 

test('Lag: slow needs several late rounds, laggy most of them or one very late, hidden tabs are ignored', () => {
  assert.equal(lagLevel([]), 'ok');
  assert.equal(lagLevel([400, 400]), 'ok', 'too few rounds to judge');
  assert.equal(lagLevel([10, 20, 5, 30, 10, 15]), 'ok');
  assert.equal(lagLevel([10, 150, 130, 140, 10, 10]), 'slow');
  assert.equal(lagLevel([300, 400, 260, 10, 500, 20]), 'laggy');
  assert.equal(lagLevel([5, 5, 5, 5, 5, 2000]), 'laggy', 'one very late round');
  let t = 0;
  let visible = true;
  const m = new LagMonitor(() => t, () => visible, 500);
  m.sample();
  for (let i = 0; i < 4; i++) {
    t += 500 + 300;
    m.sample();
  }
  assert.equal(m.level, 'laggy', 'a timer that fires 300 ms late every time');
  visible = false;
  t += 5000;
  m.sample();
  assert.deepEqual(m.samples, [], 'a hidden tab slows timers by itself: nothing is learned from it');
});

test('Escalation: a slow page acts one step earlier, but lag alone is never critical', () => {
  assert.equal(escalate('ok', 'laggy'), 'warn');
  assert.equal(escalate('warn', 'laggy'), 'act');
  assert.equal(escalate('act', 'laggy'), 'act');
  assert.equal(escalate('critical', 'laggy'), 'critical');
  assert.equal(escalate('warn', 'slow'), 'warn');
  assert.equal(escalate('ok', 'ok'), 'ok');
  const b = budgetFor({ ipad: true });
  assert.match(reasonText('act', 900 * MB, b, 'ok'), /memory use of the apps passed the limit \(900 MB of 800 MB\)/);
  assert.match(reasonText('ok', 100 * MB, b, 'laggy'), /responding slowly/);
  assert.match(reasonText('critical', 1200 * MB, b, 'laggy'), /critical.*page was slow/);
});

test('Relief for slowness: one hidden, saved panel per round, even when memory is low', () => {
  const b = budgetFor({ ipad: true });
  const panels = [panel('shown', 50, { visible: true }), panel('old', 40, { lastShown: 10 }), panel('newer', 40, { lastShown: 90 }), panel('dirty', 40, { lastShown: 1, unsaved: true })];
  assert.deepEqual(planRelief(panels, 'act', b, { lag: true }), [{ id: 'old', action: 'unload' }], 'the least recently shown panel that is not dirty, only one');
  assert.deepEqual(planRelief(panels, 'act', b), [], 'without lag and with low memory nothing is freed');
});

function health(list: GovernorPanel[], o: { mode: MemoryAction; lag?: LagLevel; heap?: number; offers?: boolean }) {
  const log: string[] = [];
  const events: HealthEvent[] = [];
  let now = 0;
  const host: GovernorHost = {
    panels: () => list,
    budget: () => budgetFor({ ipad: true }),
    now: () => now,
    mode: () => o.mode,
    lag: () => o.lag ?? 'ok',
    heap: () => o.heap ?? 0,
    async unload(id) {
      log.push('unload ' + id);
      const p = list.find((x) => x.id === id)!;
      p.status = 'unloaded';
      p.res = null;
      return true;
    },
    async save(id) {
      log.push('save ' + id);
      list.find((x) => x.id === id)!.unsaved = false;
      return true;
    },
    onLevel: (l) => log.push('level ' + l),
    onFreed: (n) => log.push('freed ' + n),
    onStuck: () => log.push('stuck'),
    onEvent: (e) => events.push(e),
    ...(o.offers ? { offer: (items: { id: string; name: string; unsaved: boolean }[]) => log.push('offer ' + items.map((i) => i.id + (i.unsaved ? '*' : '')).join(',')) } : {}),
  };
  return { gov: new MemoryGovernor(host), log, events, advance: (ms: number) => (now += ms) };
}

test('Governor, warn mode: tells, never frees anything', async () => {
  const list = [gp('a', 500, { visible: true }), gp('b', 400)];
  const { gov, log, advance } = health(list, { mode: 'warn' });
  await gov.tick();
  advance(2500);
  await gov.tick();
  advance(2500);
  await gov.tick();
  assert.deepEqual(log, ['level act']);
});

test('Governor, ask mode: offers the panel and waits for a click; unsaved work is offered as such and never saved by the governor', async () => {
  const list = [gp('a', 500, { visible: true }), gp('b', 400), gp('c', 100, { unsaved: true })];
  const { gov, log, advance } = health(list, { mode: 'ask', offers: true });
  await gov.tick();
  advance(2500);
  await gov.tick();
  assert.ok(log.some((l) => l.startsWith('offer ')), log.join('|'));
  assert.ok(!log.some((l) => l.startsWith('unload') || l.startsWith('save')), 'nothing is freed or saved without a click');
  assert.ok(gov.events.some((e) => e.kind === 'offered' && /because|could be unloaded/.test(e.text)));
});

test('Governor, auto mode with an offer: saved panels are freed, the one with unsaved changes is offered and stays', async () => {
  const list = [gp('a', 700, { visible: true }), gp('b', 300), gp('c', 200, { unsaved: true })];
  const { gov, log } = health(list, { mode: 'auto', offers: true });
  await gov.tick(); // 1200 MB: critical, acts at once
  assert.ok(log.includes('offer c*'), log.join('|'));
  assert.ok(log.includes('unload b') && log.includes('freed B'));
  assert.ok(!log.includes('save c') && !log.includes('unload c'), 'the unsaved panel is neither saved nor unloaded by the governor');
  const freed = gov.events.find((e) => e.kind === 'freed')!;
  assert.match(freed.text, /^B was unloaded because memory use of the apps is critical/);
});

test('Governor: a laggy page with low memory frees one hidden, saved panel per round after three rounds, with the reason', async () => {
  const list = [gp('a', 100, { visible: true }), gp('b', 80), gp('c', 80)];
  const { gov, log, events, advance } = health(list, { mode: 'auto', lag: 'laggy' });
  for (let i = 0; i < 2; i++) {
    await gov.tick();
    advance(5000);
  }
  assert.ok(!log.some((l) => l.startsWith('unload')), 'two rounds are not enough');
  await gov.tick();
  assert.equal(log.filter((l) => l.startsWith('unload')).length, 1, 'one panel');
  assert.match(events.at(-1)!.text, /responding slowly/);
  advance(5000);
  await gov.tick();
  assert.equal(log.filter((l) => l.startsWith('unload')).length, 2);
  assert.ok(!log.includes('unload a'), 'the visible panel is never touched');
});

test('Governor: the JavaScript heap counts towards memory, and a governor without the new host methods behaves as before', async () => {
  const list = [gp('a', 300, { visible: true }), gp('b', 200)];
  const { gov, log } = health(list, { mode: 'auto', heap: 400 * MB });
  await gov.tick();
  assert.equal(log[0], 'level act', '500 MB of apps plus 400 MB of heap is 900 MB');
});

// ---------------------------------------------------------------- OPFS rule and sharpness

test('OPFS offload: only large files, only when OPFS works', () => {
  assert.equal(shouldOffload(OFFLOAD_MIN_BYTES, true), true);
  assert.equal(shouldOffload(OFFLOAD_MIN_BYTES - 1, true), false);
  assert.equal(shouldOffload(50 * MB, false), false);
});

test('Blob ids are file name safe and unique per call', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newBlobId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,120}$/);
});

test('Sharpness: a Retina buffer at 1 / ratio is sharp, a 1x buffer on a 2x screen is blurry, no data is unknown', () => {
  const canvas = (w: number, pw: number) => ({ width: w, height: 100, pixelWidth: pw, pixelHeight: 200 });
  assert.equal(judgeSharpness({ mode: 'native', canvas: canvas(1000, 2000) }, 2).sharpness, 'native');
  assert.equal(judgeSharpness({ mode: 'retina', canvas: canvas(1000, 2000) }, 2).sharpness, 'retina');
  assert.equal(judgeSharpness({ mode: 'fit', canvas: canvas(1000, 2000) }, 2).sharpness, 'fit');
  const blurry = judgeSharpness({ mode: 'native', canvas: canvas(1000, 1000) }, 2);
  assert.equal(blurry.sharpness, 'blurry');
  assert.equal(blurry.density, 0.5);
  assert.equal(judgeSharpness({ mode: 'native', canvas: canvas(1000, 1000) }, 1).sharpness, 'native', 'a 1x screen is fine with a 1x buffer');
  // seen on WebKit with a newer engine: Retina fix kept although the engine already multiplies by the pixel ratio (4x)
  const dense = judgeSharpness({ mode: 'retina', canvas: canvas(298, 1192) }, 2);
  assert.equal(dense.sharpness, 'oversampled');
  assert.equal(dense.density, 2);
  assert.equal(judgeSharpness(undefined, 2).sharpness, 'unknown');
  assert.equal(judgeSharpness({ canvas: canvas(0, 0) }, 2).sharpness, 'unknown');
});


// ---------------------------------------------------------------- stage by weight

const W: Record<string, Weight> = { a: 'light', b: 'medium', c: 'heavy', d: 'heavy', e: 'light', f: 'medium' };
const weightOf = (id: string) => W[id];

test('Stage: capacity is smaller on an iPad', () => {
  assert.ok(stageCapacity(true) < stageCapacity(false));
});

test('Stage: two heavy apps do not open together on an iPad, a heavy and a light one do', () => {
  assert.deepEqual(pickStageApps(['c', 'd', 'e'], weightOf, { ipad: true }), ['c', 'e']);
  assert.deepEqual(pickStageApps(['c', 'd'], weightOf, { ipad: false }), ['c', 'd']);
});

test('Stage: two medium apps still open side by side on an iPad (the office apps)', () => {
  assert.deepEqual(pickStageApps(['b', 'f'], weightOf, { ipad: true }), ['b', 'f']);
});

test('Stage: keeps the workspace order, never exceeds max, and a lone heavy app always opens', () => {
  assert.deepEqual(pickStageApps(['a', 'b', 'f'], weightOf, { ipad: false }), ['a', 'b']);
  assert.deepEqual(pickStageApps(['a', 'b', 'f'], weightOf, { ipad: false, max: 3 }), ['a', 'b', 'f']);
  assert.deepEqual(pickStageApps(['c'], weightOf, { ipad: true }), ['c']);
  assert.deepEqual(pickStageApps([], weightOf, { ipad: true }), []);
});

test('Stage: an app without a weight counts as medium', () => {
  assert.deepEqual(pickStageApps(['x', 'y', 'c'], () => undefined, { ipad: true }), ['x', 'y']);
});

test('Start timeout: heavy gets longer, light shorter, an iPad longer than a desktop', () => {
  assert.equal(startTimeoutMs('medium', false), START_BASE_MS);
  assert.ok(startTimeoutMs('heavy', false) > startTimeoutMs('medium', false));
  assert.ok(startTimeoutMs('light', false) < startTimeoutMs('medium', false));
  assert.ok(startTimeoutMs('heavy', true) > startTimeoutMs('heavy', false));
  assert.equal(startTimeoutMs(undefined, false), startTimeoutMs('medium', false));
});

// ---------------------------------------------------------------- crash recovery

const memStore = (initial: string | null = null): SessionStore & { value: string | null } => {
  const s = { value: initial, get: () => s.value, set: (v: string) => void (s.value = v) };
  return s;
};

test('Session: the first start recovers nothing', () => {
  const st = memStore();
  assert.deepEqual(beginSession(st, 1000), { recovered: false, previousAt: null });
});

test('Session: a start after a clean end is not a recovery', () => {
  const st = memStore();
  beginSession(st, 1000);
  endSession(st, 2000);
  assert.equal(beginSession(st, 3000).recovered, false);
});

test('Session: a start after a session that never ended is a recovery, with the time it was last seen', () => {
  const st = memStore();
  beginSession(st, 1000);
  assert.deepEqual(beginSession(st, 5000), { recovered: true, previousAt: 1000 });
});

test('Session: hidden then visible again is not a crash, an unmarked end after resume is', () => {
  const st = memStore();
  beginSession(st, 1000);
  endSession(st, 2000); // page hidden
  resumeSession(st, 3000); // page visible again
  assert.equal(beginSession(st, 4000).recovered, true); // killed while visible
  const st2 = memStore();
  beginSession(st2, 1000);
  endSession(st2, 2000);
  assert.equal(beginSession(st2, 9000).recovered, false); // discarded while hidden
});

test('Session: an old mark says nothing about now, a mark from the future is ignored', () => {
  const st = memStore();
  beginSession(st, 1000);
  assert.equal(beginSession(st, 1000 + RECENT_MS + 1).recovered, false);
  const st2 = memStore();
  beginSession(st2, 10_000);
  assert.equal(beginSession(st2, 5000).recovered, false);
});

test('Session: garbage or blocked storage reads as empty and never throws', () => {
  assert.equal(beginSession(memStore('not json'), 1).recovered, false);
  assert.equal(beginSession(memStore('{"at":"x","clean":1}'), 1).recovered, false);
  const blocked: SessionStore = { get: () => null, set: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => beginSession(blocked, 1));
  assert.doesNotThrow(() => endSession(blocked, 2));
});

test('Session: a recovered session lowers every threshold by 20 %', () => {
  const b = { warn: 1000, act: 1500, critical: 2000, other: 'kept' };
  assert.deepEqual(scaleBudget(b, RECOVERY_BUDGET_SCALE), { warn: 800, act: 1200, critical: 1600, other: 'kept' });
});

// ---------------------------------------------------------------- offline quota

test('Offline: bytes needed add up, unknown sizes count as zero', () => {
  const sizes: Record<string, number> = { a: 100, b: 250 };
  assert.equal(neededBytes(['a', 'b', 'zzz'], (id) => sizes[id]), 350);
  assert.equal(neededBytes([], () => 1), 0);
});

test('Offline: it fits when 10 % stays free, and says how much is free', () => {
  assert.deepEqual(cacheFit({ quota: 1000, usage: 0 }, 900), { ok: true, free: 1000 });
  assert.equal(cacheFit({ quota: 1000, usage: 200 }, 750).ok, false); // 825 > 800
  assert.equal(cacheFit({ quota: 1000, usage: 200 }, 700).ok, true);
  assert.equal(cacheFit({ quota: 1000, usage: 1200 }, 1).free, 0);
});

test('Offline: an unknown quota fits (the browser decides)', () => {
  assert.equal(cacheFit(undefined, 1e12).ok, true);
  assert.equal(cacheFit({}, 1e12).ok, true);
  assert.equal(cacheFit({ quota: 0 }, 1).ok, true);
});