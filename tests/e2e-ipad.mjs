// iPadOS check with Playwright in a WebKit profile (Safari engine) at the resolutions of the iPad Pro
// 13 inch: 1024 × 1366 (portrait) and 1366 × 1024 (landscape), pixel ratio 2.
//
//   npm run test:ipad
//
// Simulates finger touches (pointerType touch) and the Apple Pencil (pointerType pen with
// pressure, tilt, twist and hover) on the dividers, in the @ and / menu of the chat, in the
// four WebAssembly apps, in the PdfCraft pencil view and on the website (homepage, portal,
// contact, panel, dashboard). Also checks the on-screen keyboard, window modes without reloading,
// browser mode with IndexedDB and the Retina fix of the apps.
//
// Browser: WebKit (npx playwright install webkit). OC_IPAD_BROWSER=chromium uses Chromium
// with the same iPad parameters instead; the result is then clearly marked as Chromium.
// Playwright is not a project dependency: `npm i -D playwright` or set PLAYWRIGHT_MODULE.

import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UI_PORT = 5189;
const API_PORT = 5190;
const MOCK_PORT = 5291;
const BASE = `http://127.0.0.1:${UI_PORT}`;
const SHOTS = process.env.SHOTS || 'test-results/ipad';
mkdirSync(SHOTS, { recursive: true });

const PORTRAIT = { width: 1024, height: 1366 };
const LANDSCAPE = { width: 1366, height: 1024 };
// Safari on the iPad reports itself as a Mac (desktop class). The IDE detects the iPad by its hardware.
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';

let pw;
try {
  pw = await import('playwright');
} catch {
  try {
    pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
  } catch {
    console.error('Playwright is missing. Install it with: npm i -D playwright && npx playwright install webkit');
    process.exit(2);
  }
}

const wanted = (process.env.OC_IPAD_BROWSER || 'webkit').toLowerCase();
let browser;
let engine = wanted;
try {
  if (wanted === 'chromium') browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  else browser = await pw.webkit.launch();
} catch (e) {
  console.error(`${wanted} does not start: ${e.message.split('\n')[0]}`);
  console.error('Install WebKit: npx playwright install webkit (or OC_IPAD_BROWSER=chromium for a substitute run)');
  process.exit(2);
}
console.log(`Engine: ${engine}${engine === 'webkit' ? ' (Safari)' : ' (substitute run, not WebKit)'}\n`);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

// ---------------------------------------------------------------- Test model (CORS for browser mode)
const mock = createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    return res.end(JSON.stringify({ data: [{ id: 'mock-ipad' }] }));
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream', ...cors });
    for (const part of ['Hello ', 'from ', 'iPad']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
}).listen(MOCK_PORT, '127.0.0.1');

// ---------------------------------------------------------------- Start the stack
const HOME = mkdtempSync(join(tmpdir(), 'workcraft-ipad-'));
const stack = spawn(process.execPath, ['scripts/dev.mjs'], { env: { ...process.env, WORKCRAFT_FIRST_PROJECT: 'sample', WORKCRAFT_HOME: HOME, WORKCRAFT_PORT: String(API_PORT), WORKCRAFT_UI_PORT: String(UI_PORT) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
// Always drain both pipes: a full pipe would block the backend
stack.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(d));
stack.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
for (let i = 0; i < 150; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    /* still starting */
  }
  await new Promise((r) => setTimeout(r, 200));
}

/** iPad context: pixel ratio 2, touch, Safari reporting as a Mac, multi-touch hardware. */
async function ipadContext(viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, userAgent: IPAD_UA, acceptDownloads: true });
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 });
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
    // On-screen keyboard: window.__ocKb shrinks the visible area like on iPadOS
    window.__ocKb = 0;
    try { localStorage.setItem('workcraft.installTip', JSON.stringify({ until: 'never' })); } catch { /* ignore */ }
    const fake = new EventTarget();
    Object.defineProperties(fake, {
      width: { get: () => innerWidth },
      height: { get: () => innerHeight - (window.__ocKb || 0) },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      pageTop: { get: () => 0 },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    // The share sheet only exists on real devices
    try {
      Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined });
    } catch {
      /* not available */
    }
  });
  if (opt.webgl !== false) await ctx.addInitScript(() => localStorage.getItem('workcraft.prefs') || localStorage.setItem('workcraft.prefs', JSON.stringify({ renderer: 'webgl' })));
  return ctx;
}

const waitFor = async (page, fn, ms = 20000, step = 200) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(step);
  }
};

/**
 * Fires a pointer sequence in the document (or in an iframe). Each point: [type, x, y, extras].
 * type: down, move, up, hover. pointerType touch, pen or mouse; pen with pressure and tilt.
 */
async function gesture(target, points, base) {
  return target.evaluate(
    async ([pts, b]) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let el = null;
      for (const [kind, x, y, extra = {}] of pts) {
        if (kind === 'wait') {
          await sleep(x);
          continue;
        }
        const o = { ...b, ...extra };
        const type = kind === 'down' ? 'pointerdown' : kind === 'up' ? 'pointerup' : 'pointermove';
        const contact = kind === 'down' || kind === 'move';
        if (kind === 'down' || !el || o.retarget) el = (o.sel && document.querySelector(o.sel)) || document.elementFromPoint(x, y);
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          pointerId: o.id ?? (o.pointerType === 'pen' ? 21 : o.pointerType === 'touch' ? 11 : 1),
          pointerType: o.pointerType,
          isPrimary: o.primary ?? true,
          button: kind === 'down' || kind === 'up' ? 0 : -1,
          buttons: contact ? 1 : 0,
          pressure: kind === 'hover' ? 0 : contact ? (o.pressure ?? 0.5) : 0,
          tiltX: o.tiltX ?? 0,
          tiltY: o.tiltY ?? 0,
          twist: o.twist ?? 0,
          width: o.pointerType === 'touch' ? 20 : 1,
          height: o.pointerType === 'touch' ? 20 : 1,
        };
        el.dispatchEvent(new PointerEvent(type, init));
        if (o.gap) await sleep(o.gap);
      }
      return true;
    },
    [points, base]
  );
}

const rectOf = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s)?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null;
}, sel);

const panels = (page) => page.evaluate(() => window.__workcraftWorkspace.panels());
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

try {
  // ================================================================ IDE in landscape
  const ctx = await ipadContext(LANDSCAPE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  await page.goto(`${BASE}/`);
  await page.waitForSelector('html.is-ready', { timeout: 40000 });
  // A new project starts on the welcome page: no app is created or loaded by itself
  const welcome = await page.evaluate(() => ({ page: !!document.querySelector('.empty-stage'), apps: window.__workcraftWorkspace.panels().filter((p) => !['tree', 'chat'].includes(p.tool)).length }));
  check('0a: iPad: a new project shows the welcome page and creates no app panel', welcome.page && welcome.apps === 0, JSON.stringify(welcome));
  // The checks below need the sample apps: open them as a user would
  await page.evaluate(() => {
    const w = window.__workcraftWorkspace;
    const word = w.openPanel('wordcraft', { path: '/documents/proposal.docx', silent: true });
    w.openPanel('gridcraft', { path: '/sheets/finances.xlsx', silent: true, target: word, side: 'right', focus: false });
    w.openPanel('deckcraft', { path: '/presentations/start.pptx', mode: 'hidden', silent: true });
    w.openPanel('pdfcraft', { path: '/pdf/contract.pdf', mode: 'hidden', silent: true });
    w.focus(word, false);
    w.applyPreset('columns');
  });
  await waitFor(page, async () => (await panels(page)).filter((p) => ['wordcraft', 'gridcraft'].includes(p.tool)).every((p) => p.status === 'active'), 60000);
  await page.waitForTimeout(3000);

  // ---------- Package 1: detection and Retina ----------
  const dev = await page.evaluate(() => ({ ...window.__workcraftDevice.info, cls: document.documentElement.className }));
  check('1a: iPadOS detected by hardware (Mac user agent, maxTouchPoints 5)', dev.ipad && /is-ipad/.test(dev.cls) && /is-touch/.test(dev.cls), `${dev.windowMode}, ${dev.orientation}`);
  check('1b: pixel ratio 2 passed to the apps', dev.dpr === 2 && dev.renderDpr === 2 && (await page.evaluate(() => window.__workcraftDpr)) === 2);
  const frameInfo = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.ca-frame')].map((f) => {
        const r = f.getBoundingClientRect();
        const c = f.contentDocument?.querySelector('canvas');
        const cr = c?.getBoundingClientRect();
        const box = f.closest('.ca').getBoundingClientRect();
        return { app: f.closest('.panel').dataset.tool, info: f.contentWindow.__ocFrameInfo, frame: [Math.round(r.width), Math.round(r.height)], box: [Math.round(box.width), Math.round(box.height)], canvasCss: cr ? [Math.round(cr.width * (r.width / f.contentWindow.innerWidth)), Math.round(cr.height * (r.height / f.contentWindow.innerHeight))] : null, pixels: c ? [c.width, c.height] : null };
      })
    );
  let fi = await frameInfo();
  const retinaOk = (list) => list.length > 0 && list.every((f) => ['retina', 'native'].includes(f.info?.mode) && Math.abs(f.canvasCss[0] - f.box[0]) <= 2 && Math.abs(f.canvasCss[1] - f.box[1]) <= 2 && Math.abs(f.pixels[0] - f.box[0] * 2) <= 4);
  check('1c: Retina fix: apps exactly panel-sized, drawing buffer at double resolution', retinaOk(fi), fi.map((f) => `${f.app} css ${f.canvasCss} px ${f.pixels} ${f.info?.mode}`).join(' | '));
  await shot(page, '01-landscape');

  // All four apps side by side (grid), check the scaling of every app
  await page.evaluate(() => {
    for (const id of ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft']) {
      const p = window.__workcraftWorkspace.panels().find((x) => x.tool === id);
      if (p && p.mode !== 'normal') window.__workcraftWorkspace.show(p.id);
    }
    window.__workcraftWorkspace.applyPreset('grid');
  });
  await waitFor(page, async () => (await panels(page)).filter((p) => ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft'].includes(p.tool)).every((p) => p.status === 'active'), 120000, 500);
  await page.waitForTimeout(4000);
  fi = await frameInfo();
  check('1d: all four WebAssembly apps scaled correctly in the grid', fi.length === 4 && retinaOk(fi), fi.map((f) => `${f.app} ${f.canvasCss}/${f.box}`).join(' | '));
  // Marker: proves that no app reloads
  await page.evaluate(() => document.querySelectorAll('.ca-frame').forEach((f, i) => (f.contentWindow.__marker = 'm' + i)));
  await shot(page, '02-four-apps');

  // ---------- Package 3: dividers with finger and pencil ----------
  const gutterSel = '.stage-layout .split[data-dir="row"] > .gutter';
  const g = await rectOf(page, gutterSel);
  const hit = await page.evaluate(([s, r]) => {
    const g = document.querySelector(s);
    const at = (dx) => {
      const el = document.elementFromPoint(r.cx + dx, r.cy);
      return el === g || g.contains(el);
    };
    return { left: at(-7.5), right: at(7.5), outside: at(-10), w: getComputedStyle(g).width, touch: getComputedStyle(g).touchAction, select: getComputedStyle(g).webkitUserSelect || getComputedStyle(g).userSelect };
  }, [gutterSel, g]);
  check('3a: divider: 16 px hit area, 6 px visible', hit.left && hit.right && !hit.outside && hit.w === '6px', JSON.stringify(hit));
  check('3b: touch-action none and user-select none on the divider', hit.touch === 'none' && hit.select === 'none');
  const ratio = () => page.evaluate((s) => {
    const gg = document.querySelector(s);
    const cells = [...gg.parentElement.children].filter((c) => c.classList.contains('split-cell'));
    const i = [...gg.parentElement.children].indexOf(gg);
    const a = gg.parentElement.children[i - 1].getBoundingClientRect().width;
    const b = gg.parentElement.children[i + 1].getBoundingClientRect().width;
    return cells.length ? a / (a + b) : 0;
  }, gutterSel);
  const r0 = await ratio();
  const total = (await page.evaluate((s) => document.querySelector(s).parentElement.getBoundingClientRect().width, gutterSel));
  await gesture(page, [['down', g.cx, g.cy], ['move', g.cx - 40, g.cy], ['move', g.cx - 90, g.cy], ['up', g.cx - 90, g.cy]], { pointerType: 'touch', sel: gutterSel });
  const r1 = await ratio();
  check('3c: finger drags the divider', r1 < r0 - 0.05, `${r0.toFixed(3)} → ${r1.toFixed(3)}`);
  // Pencil with pressure and tilt: snaps at 70 to 30
  const g2 = await rectOf(page, gutterSel);
  const targetX = (await page.evaluate((s) => document.querySelector(s).parentElement.getBoundingClientRect().x, gutterSel)) + total * 0.705;
  await gesture(page, [['down', g2.cx, g2.cy], ['move', (g2.cx + targetX) / 2, g2.cy, { pressure: 0.4 }], ['move', targetX, g2.cy, { pressure: 0.8 }], ['up', targetX, g2.cy]], { pointerType: 'pen', tiltX: 32, tiltY: -12, twist: 45, sel: gutterSel });
  const r2 = await ratio();
  check('3d: Apple Pencil drags and snaps at 70 : 30', Math.abs(r2 - 0.7) < 0.012, r2.toFixed(3));
  // Double tap with the pencil: 70:30 → 30:70 → full screen
  const dbl = async (kind) => {
    const r = await rectOf(page, gutterSel);
    await gesture(page, [['down', r.cx, r.cy], ['up', r.cx, r.cy, { gap: 60 }], ['down', r.cx, r.cy], ['up', r.cx, r.cy]], { pointerType: kind, sel: gutterSel, pressure: 0.3 });
    await page.waitForTimeout(450);
  };
  await dbl('pen');
  const r3 = await ratio();
  check('3e: double tap with the pencil: next snap point 30 : 70', Math.abs(r3 - 0.3) < 0.012, r3.toFixed(3));
  // Palm: a finger right after the pencil is ignored
  const palmBefore = await ratio();
  const gp = await rectOf(page, gutterSel);
  // The pencil rests above the divider (hover), then a finger drags it: palm. (Right after a double tap the pencil is 450 ms away, the edge of the
  // rule, so the hover keeps the test about the rule and not about the clock.)
  await gesture(page, [['hover', gp.cx + 20, gp.cy]], { pointerType: 'pen', sel: gutterSel });
  await gesture(page, [['down', gp.cx, gp.cy], ['move', gp.cx + 120, gp.cy], ['up', gp.cx + 120, gp.cy]], { pointerType: 'touch', sel: gutterSel });
  check('2j: palm rejection: a touch while the pencil is active has no effect', Math.abs((await ratio()) - palmBefore) < 0.005);
  await page.waitForTimeout(700);
  await dbl('touch');
  const maxed = await page.evaluate(() => document.querySelector('.panel.is-max')?.dataset.tool || null);
  check('3f: double tap with a finger: full screen', !!maxed, maxed || '');
  await page.evaluate(() => {
    const id = document.querySelector('.panel.is-max')?.dataset.id;
    if (id) window.__workcraftWorkspace.toggleMaximize(id);
  });
  await page.waitForTimeout(1500);
  // Apps stay exactly scaled after dragging and are not reloaded
  // The apps adjust their drawing buffer in the next drawn frame (software rendering in the test is slow)
  fi = (await waitFor(page, async () => {
    const l = await frameInfo();
    return retinaOk(l) && l;
  }, 15000, 300)) || (await frameInfo());
  const markers = await page.evaluate(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow.__marker || null).join(','));
  check('3g: apps follow the new size without reloading', retinaOk(fi) && markers.split(',').filter(Boolean).length === 4, `${markers} · ${fi.map((f) => `${f.app} ${f.canvasCss}/${f.box} px ${f.pixels}`).join(' | ')}`);

  // ---------- Touch targets 44 × 44 ----------
  const sizes = await page.evaluate(() => {
    const vis = (e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden';
    const list = [...document.querySelectorAll('.panel-head .icon-btn, .act-btn, .tab-eye, .chat-mini')].filter(vis).map((b) => b.getBoundingClientRect());
    return { n: list.length, min: Math.min(...list.map((r) => Math.min(r.width, r.height))) };
  });
  check('3h: headers, activity bar and quick buttons at least 44 × 44 px', sizes.min >= 44, `${sizes.n} buttons, smallest ${sizes.min} px`);
  const deck = (await panels(page)).find((p) => p.tool === 'deckcraft');
  await page.evaluate((id) => window.__workcraftWorkspace.minimize(id), deck.id);
  await page.waitForSelector('.dock:not([hidden]) .dock-chip');
  const chip = await rectOf(page, '.dock-chip');
  check('3i: dock: chips at least 44 px high', chip.h >= 44 && chip.w >= 44, `${chip.w}×${chip.h}`);
  await page.locator('.dock-chip').first().tap();
  await page.waitForTimeout(500);

  // ---------- Scribble: tool surfaces blocked, inputs open ----------
  const scribble = await page.evaluate(() => {
    const ta = document.querySelector('.chat-input');
    const head = document.querySelector('.stage-panels .panel-head');
    return { chat: ta.dataset.scribble, chatTouch: getComputedStyle(ta).touchAction, chatSelect: getComputedStyle(ta).webkitUserSelect || getComputedStyle(ta).userSelect, head: head.hasAttribute('data-pencil-surface'), headTouch: getComputedStyle(head).touchAction };
  });
  check('2a: Scribble off on handles, on in the chat input', scribble.chat === 'on' && scribble.chatTouch !== 'none' && scribble.chatSelect !== 'none' && scribble.head && scribble.headTouch === 'none', JSON.stringify(scribble));

  // ---------- Package 2: pencil and finger in the apps ----------
  const grid = page.frames().find((f) => /apps\/gridcraft/.test(f.url()));
  await grid.evaluate(() => {
    window.__seen = { mousemove: 0, wheel: 0, down: 0, ctrlWheel: 0 };
    addEventListener('mousemove', (e) => e.__ocBridged && window.__seen.mousemove++, true);
    addEventListener('wheel', (e) => (e.__ocBridged ? (e.ctrlKey ? window.__seen.ctrlWheel++ : window.__seen.wheel++) : 0), true);
    addEventListener('pointerdown', (e) => e.__ocBridged && window.__seen.down++, true);
  });
  const gv = await grid.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const cx = Math.round(gv.w / 2);
  const cy = Math.round(gv.h / 2);
  // Hover before touching down
  await gesture(grid, [['hover', cx, cy], ['hover', cx + 6, cy + 4]], { pointerType: 'pen', tiltX: 40, tiltY: 10 });
  const hover = await page.evaluate(() => {
    const el = document.querySelector('.panel[data-tool="gridcraft"] .ca-hover');
    return el && !el.hidden ? getComputedStyle(el).borderTopColor : null;
  });
  check('2b: Apple Pencil hover preview in GridCraft green #10B981', hover === 'rgb(16, 185, 129)', String(hover));
  // Select a cell range with the pencil tip: precise mouse movement in the app
  await gesture(grid, [['down', cx - 60, cy - 30], ['move', cx - 20, cy, { pressure: 0.35 }], ['move', cx + 40, cy + 30, { pressure: 0.7 }], ['up', cx + 40, cy + 30]], { pointerType: 'pen', tiltX: 20, tiltY: 35, twist: 90 });
  // WebKit 27 builds a synthetic pen event with tiltX 90 whatever the init says (no tilt or altitude in the constructor),
  // so the expected value is what this browser reports for the same init, not a fixed 20
  const expectedTilt = await page.evaluate(() => new PointerEvent('pointermove', { pointerType: 'pen', tiltX: 20, tiltY: 35 }).tiltX);
  const seen1 = await grid.evaluate(() => ({ ...window.__seen }));
  const penStatus = await page.evaluate(() => {
    const p = window.__workcraftWorkspace.panels().find((x) => x.tool === 'gridcraft');
    return window.__workcraftWorkspace.instance(p.id).status();
  });
  check('2c: the pencil works like a precise mouse in GridCraft (pressure, tilt, twist recorded)', seen1.mousemove >= 3 && penStatus.last_pen?.tilt_x === expectedTilt && penStatus.last_pen?.twist === 90, `mousemove ${seen1.mousemove}, ${JSON.stringify(penStatus.last_pen)}`);
  // The finger pans the sheet (the pencil of the step before is past the palm window by now)
  await page.waitForTimeout(800);
  await gesture(grid, [['down', cx, cy], ['move', cx, cy - 30], ['move', cx - 10, cy - 90], ['move', cx - 20, cy - 160], ['up', cx - 20, cy - 160]], { pointerType: 'touch', gap: 16 });
  await page.waitForTimeout(400);
  const seen2 = await grid.evaluate(() => ({ ...window.__seen }));
  const gest = (await page.evaluate(() => {
    const p = window.__workcraftWorkspace.panels().find((x) => x.tool === 'gridcraft');
    return window.__workcraftWorkspace.instance(p.id).status().last_gestures;
  })) || [];
  check('2d: finger movement pans the sheet (scroll events instead of selection)', seen2.wheel > seen1.wheel && gest.includes('pan'), `wheel ${seen2.wheel}, gestures ${gest.join(',')}`);
  // A short finger tap stays a click, two fingers zoom
  await gesture(grid, [['down', cx, cy], ['up', cx, cy]], { pointerType: 'touch' });
  await gesture(grid, [['down', cx - 40, cy, { id: 31 }], ['down', cx + 40, cy, { id: 32, primary: false }], ['move', cx - 80, cy, { id: 31 }], ['move', cx + 80, cy, { id: 32, primary: false }], ['up', cx - 80, cy, { id: 31 }], ['up', cx + 80, cy, { id: 32, primary: false }]], { pointerType: 'touch', retarget: false });
  const seen3 = await grid.evaluate(() => ({ ...window.__seen }));
  check('2e: finger tap becomes a click, two-finger gesture zooms', seen3.down > seen2.down && seen3.ctrlWheel > 0, JSON.stringify(seen3));
  // Color codes of the pencil modes
  const modes = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.panel[data-tool$="craft"]')].map((p) => {
        p.querySelector('.ca-pen-ic')?.click();
        return [p.dataset.tool, [...p.querySelectorAll('.ca-pen-mode')].map((b) => b.getAttribute('style'))];
      })
    )
  );
  const want = { wordcraft: ['#3B82F6', '#F97316'], deckcraft: ['#F97316', '#3B82F6'], gridcraft: ['#10B981'], pdfcraft: ['#14B8A6'] };
  check('2f: pencil modes in the color codes 3B82F6, F97316, 10B981, 14B8A6', Object.entries(want).every(([app, cols]) => cols.every((c) => (modes[app] || []).join(' ').includes(c))), JSON.stringify(modes));
  await shot(page, '03-pencil');

  // ---------- PdfCraft: sign and redact with the pencil ----------
  const pdfId = (await panels(page)).find((p) => p.tool === 'pdfcraft').id;
  await page.evaluate((id) => window.__workcraftWorkspace.openFile('/pdf/contract.pdf', 'pdfcraft'), pdfId);
  await page.waitForTimeout(1500);
  const before = await page.evaluate(async () => (await (await fetch('/api/files/raw?path=/pdf/contract.pdf')).arrayBuffer()).byteLength);
  await page.evaluate((id) => void window.__workcraftWorkspace.instance(id).pen('sign'), pdfId);
  await page.waitForSelector('dialog.pp-dialog[open] .pp-ink', { timeout: 20000 }).catch(async (e) => {
    const why = await page.evaluate(() => ({ notes: [...document.querySelectorAll('.toast, [role=status], dialog[open]')].map((n) => (n.textContent || '').trim().slice(0, 140)), pdf: window.__workcraftWorkspace.panels().filter((p) => p.tool === 'pdfcraft').map((p) => ({ mode: p.mode, status: p.status, path: p.path })) }));
    throw new Error(`${e.message.split('\n')[0]} · ${JSON.stringify(why)}`);
  });
  await page.waitForTimeout(1500);
  const ink = await rectOf(page, '.pp-ink');
  const sig = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    sig.push(['move', ink.x + ink.w * (0.55 + t * 0.3), ink.y + ink.h * (0.78 + Math.sin(t * 9) * 0.02), { pressure: 0.2 + 0.7 * Math.sin(t * Math.PI), tiltX: 30, tiltY: 10 }]);
  }
  await gesture(page, [['hover', ink.x + ink.w * 0.55, ink.y + ink.h * 0.78], ['down', ink.x + ink.w * 0.55, ink.y + ink.h * 0.78], ...sig, ['up', ink.x + ink.w * 0.85, ink.y + ink.h * 0.78]], { pointerType: 'pen', sel: '.pp-ink' });
  const strokes = await page.evaluate(() => window.__workcraftPdfPen.layer.strokes.map((s) => ({ n: s.points.length, p: Math.max(...s.points.map((x) => x.p)) })));
  check('2g: signature recorded with pressure curve', strokes.length === 1 && strokes[0].n > 20 && strokes[0].p > 0.8, JSON.stringify(strokes));
  check('2k: pencil view shows the PDF page (not blank)', await waitFor(page, () => page.evaluate(() => !window.__workcraftPdfPen.pageBlank()), 10000));
  await page.locator('.pp-tool[data-tool="redact"]').tap();
  const ink2 = await rectOf(page, '.pp-ink');
  check('2m: switching tools does not move the page', Math.abs(ink2.y - ink.y) < 1 && Math.abs(ink2.x - ink.x) < 1, `${ink.y} → ${ink2.y}`);
  await gesture(page, [['down', ink.x + ink.w * 0.1, ink.y + ink.h * 0.08], ['move', ink.x + ink.w * 0.5, ink.y + ink.h * 0.1], ['move', ink.x + ink.w * 0.6, ink.y + ink.h * 0.14], ['up', ink.x + ink.w * 0.6, ink.y + ink.h * 0.14]], { pointerType: 'pen', sel: '.pp-ink' });
  await shot(page, '04-pdf-pencil');
  await page.locator('.pp-apply').tap();
  await page.waitForSelector('dialog.pp-dialog', { state: 'detached', timeout: 30000 });
  const after = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch('/api/files/raw?path=/pdf/contract.pdf')).arrayBuffer())));
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(new Uint8Array(after));
  const { extractText, getDocumentProxy } = await import('unpdf');
  const text = (await extractText(await getDocumentProxy(new Uint8Array(after)), { mergePages: true })).text;
  check('2h: PDF signed and redacted, covered text removed', doc.getPageCount() === 1 && after.length !== before && !/Sample contract/.test(text), `${before} → ${after.length} bytes, text: "${text.slice(0, 40)}"`);
  const synced = await waitFor(page, async () => (await page.evaluate((id) => window.__workcraftWorkspace.instance(id).status().last_synced, pdfId)), 15000);
  check('2i: PdfCraft shows the new version without reloading', !!synced, String(synced));
  // After redacting: only the marked area is black, the rest of the content stays as an image
  await page.evaluate((id) => void window.__workcraftWorkspace.instance(id).pen('ink'), pdfId);
  await page.waitForSelector('dialog.pp-dialog[open] .pp-ink', { timeout: 20000 });
  const kept = await waitFor(page, () => page.evaluate(() => {
    if (window.__workcraftPdfPen.pageBlank()) return null;
    const c = document.querySelector('.pp-page');
    const ctx = c.getContext('2d');
    const px = (fx, fy) => [...ctx.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3);
    const box = px(0.35, 0.11);
    const below = ctx.getImageData(0, Math.round(c.height * 0.16), Math.round(c.width * 0.6), Math.round(c.height * 0.12)).data;
    let dark = 0;
    for (let i = 0; i < below.length; i += 4) if (below[i] < 128) dark++;
    return { box, darkBelow: dark };
  }), 10000);
  check('2l: redaction only at the marked area, the remaining text stays visible', kept && kept.box.every((v) => v < 40) && kept.darkBelow > 50, JSON.stringify(kept));
  await page.evaluate(() => window.__workcraftPdfPen.cancel());
  await page.waitForSelector('dialog.pp-dialog', { state: 'detached', timeout: 10000 });

  // ---------- @ and / in the chat by finger and pencil ----------
  await page.evaluate(() => window.__workcraftWorkspace.show('chat'));
  await page.waitForTimeout(400);
  // On an iPad the composer has no @ and / buttons and the + menu no mention entries: they are typed
  await page.locator('.chat-composer [data-action="plus"]').tap();
  const plusItems = await page.locator('.ctx-item').allInnerTexts();
  check('3q: iPad composer: no @ or / button, no mention entries in the + menu', (await page.locator('.chat-composer [data-quick="at"], .chat-composer [data-quick="slash"]').count()) === 0 && !plusItems.some((t) => /Mention a file or app|Use a tool or command/.test(t)), plusItems.join(' | ').replace(/\s+/g, ' '));
  await page.keyboard.press('Escape');
  await page.locator('.chat-input').tap();
  await page.locator('.chat-input').pressSequentially('@financ', { delay: 15 });
  await page.waitForSelector('.mention-pop:not([hidden]) .mention-item');
  await page.waitForTimeout(300);
  const item = await rectOf(page, '.mention-pop:not([hidden]) .mention-item.is-active');
  const popBox = await rectOf(page, '.mention-pop:not([hidden])');
  const compBox = await rectOf(page, '.chat-composer');
  check('3o: @ menu visible right above the input', popBox && popBox.y >= 0 && Math.abs(popBox.y + popBox.h - compBox.y) < 12, JSON.stringify({ pop: popBox && [Math.round(popBox.y), Math.round(popBox.h)], comp: Math.round(compBox.y) }));
  await gesture(page, [['down', item.cx, item.cy], ['up', item.cx, item.cy]], { pointerType: 'pen', pressure: 0.4 });
  await page.evaluate(() => {
    const b = document.querySelector('.mention-pop:not([hidden]) .mention-item.is-active');
    b?.click();
  });
  const atVal = await page.locator('.chat-input').inputValue();
  check('3j: @ menu opened by finger tap, entry picked with the pencil', /@sheets\/finances\.xlsx /.test(atVal), atVal);
  await page.locator('.chat-input').fill('');
  await page.locator('.chat-input').pressSequentially('/', { delay: 15 });
  await page.waitForSelector('.mention-pop:not([hidden]) .mention-item');
  const slash = (await page.locator('.mention-item').allInnerTexts()).join(' ');
  // Magic Keyboard: arrow keys and Enter in the / menu
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const slashVal = await page.locator('.chat-input').inputValue();
  check('3k: / menu from the header, choice with arrow keys (Magic Keyboard)', /\/read-sheet/.test(slash) && /^\/[\w-]+ $/.test(slashVal), slashVal);
  await page.locator('.chat-input').fill('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  const pal = await page.waitForSelector('dialog.pal-dialog[open]', { timeout: 5000 }).catch(() => null);
  check('3l: Cmd+K opens the command palette', !!pal);
  await page.keyboard.press('Escape');
  await page.locator('.top-actions [data-act="search"]').tap();
  check('3m: quick button opens the command palette without a keyboard', !!(await page.waitForSelector('dialog.pal-dialog[open]', { timeout: 5000 }).catch(() => null)));
  await page.keyboard.press('Escape');

  // ---------- On-screen keyboard ----------
  await page.locator('.chat-input').tap();
  await page.evaluate(() => {
    window.__ocKb = 420;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(400);
  await page.locator('.chat-input').pressSequentially('@', { delay: 10 });
  await page.waitForTimeout(300);
  const kb = await page.evaluate(() => {
    const visibleBottom = innerHeight - window.__ocKb;
    const comp = document.querySelector('.chat-composer').getBoundingClientRect();
    const pop = document.querySelector('.mention-pop:not([hidden])')?.getBoundingClientRect();
    return { open: document.documentElement.classList.contains('kb-open'), comp: Math.round(comp.bottom), pop: pop ? [Math.round(pop.top), Math.round(pop.bottom)] : null, limit: visibleBottom };
  });
  check('3n: on-screen keyboard: chat and @ menu stay above the keyboard', kb.open && kb.comp <= kb.limit && kb.pop && kb.pop[0] >= 0 && kb.pop[1] <= kb.limit, JSON.stringify(kb));
  await shot(page, '05-keyboard');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__ocKb = 0;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(300);

  // ---------- Window modes and rotation without reloading ----------
  const modesSeen = [];
  for (const vp of [{ width: 683, height: 1024 }, { width: 375, height: 1024 }, PORTRAIT, LANDSCAPE]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(900);
    modesSeen.push(await page.evaluate(() => `${innerWidth}:${window.__workcraftDevice.info.windowMode}:${document.querySelector('.ws').classList.contains('is-compact') ? 'compact' : 'full'}`));
  }
  const markers2 = await page.evaluate(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow.__marker || null).join(','));
  check('1e: Split View, Slide Over and rotation without reloading the apps', markers2 === markers && modesSeen[1].includes('compact'), `${modesSeen.join(' ')} · ${markers2}`);
  fi = (await waitFor(page, async () => {
    const l = await frameInfo();
    return retinaOk(l) && l;
  }, 15000, 300)) || (await frameInfo());
  check('1f: exactly scaled after rotation', retinaOk(fi), fi.map((f) => `${f.app} ${f.canvasCss}/${f.box}`).join(' | '));
  // ---------- Picture in picture by finger and Apple Pencil ----------
  const gridP = (await panels(page)).find((p) => p.tool === 'gridcraft');
  // The header keeps Maximize and X; Picture in picture is in the panel menu (a long press on the header opens it, a finger taps the entry)
  await page.evaluate((id) => {
    const r = document.querySelector(`.panel[data-id="${id}"] .panel-name`).getBoundingClientRect();
    window.__workcraftWorkspace.panelMenu(id, r.left + 8, r.bottom + 4);
  }, gridP.id);
  await page.locator('[role^="menuitem"]', { hasText: /Picture in picture/ }).first().tap();
  await page.waitForTimeout(500);
  const pipBox = () => page.evaluate((id) => {
    const el = document.querySelector(`.panel[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    const se = el.querySelector('.pip-h[data-dir="se"]');
    return { pip: el.classList.contains('is-pip'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), touch: getComputedStyle(se).touchAction, select: getComputedStyle(se).webkitUserSelect || getComputedStyle(se).userSelect, seW: Math.round(se.getBoundingClientRect().width), btn: Math.round(el.querySelector('[data-btn="max"]').getBoundingClientRect().width) };
  }, gridP.id);
  const q0 = await pipBox();
  check('4a: picture in picture by finger tap, handles without Scribble and touch scrolling, 44 px buttons', q0.pip && q0.touch === 'none' && q0.select === 'none' && q0.seW >= 32 && q0.btn >= 44, JSON.stringify(q0));
  const headName = await rectOf(page, `.panel[data-id="${gridP.id}"] .panel-name`);
  await gesture(page, [['down', headName.cx, headName.cy], ['move', headName.cx - 80, headName.cy - 60], ['move', headName.cx - 200, headName.cy - 120], ['up', headName.cx - 200, headName.cy - 120]], { pointerType: 'touch', gap: 16 });
  const q1 = await pipBox();
  check('4b: finger drags the floating window', q1.x < q0.x - 150 && q1.y < q0.y - 90, JSON.stringify({ q0, q1 }));
  const seR = await rectOf(page, `.panel[data-id="${gridP.id}"] .pip-h[data-dir="se"]`);
  await gesture(page, [['hover', seR.cx, seR.cy], ['down', seR.cx, seR.cy], ['move', seR.cx + 40, seR.cy + 30, { pressure: 0.4 }], ['move', seR.cx + 90, seR.cy + 50, { pressure: 0.7 }], ['up', seR.cx + 90, seR.cy + 50]], { pointerType: 'pen', tiltX: 25, tiltY: 10, gap: 16 });
  const q2 = await pipBox();
  check('4c: Apple Pencil resizes the floating window at its corner', Math.abs(q2.w - q1.w - 90) <= 3 && Math.abs(q2.h - q1.h - 50) <= 3, JSON.stringify({ q1, q2 }));
  // Full Chat Mode in portrait with the floating window above it, chat input above the keyboard
  await page.setViewportSize(PORTRAIT);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__workcraftWorkspace.setFullChat(true));
  await page.waitForTimeout(500);
  const q3 = await pipBox();
  const onTop = await page.evaluate((id) => {
    const el = document.querySelector(`.panel[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 20)) && r.right <= innerWidth && r.bottom <= innerHeight;
  }, gridP.id);
  check('4d: after rotation to portrait the window stays inside the screen and above Full Chat Mode', q3.pip && onTop, JSON.stringify(q3));
  await page.locator('.chat-input').tap();
  await page.evaluate(() => {
    window.__ocKb = 420;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(500);
  const kbFull = await page.evaluate((id) => {
    const limit = innerHeight - window.__ocKb;
    const comp = document.querySelector('.chat-composer').getBoundingClientRect();
    const pip = document.querySelector(`.panel[data-id="${id}"]`).getBoundingClientRect();
    return { comp: Math.round(comp.bottom), pip: Math.round(pip.bottom), limit };
  }, gridP.id);
  check('4e: on-screen keyboard: Full Chat input and the floating window stay above it', kbFull.comp <= kbFull.limit && kbFull.pip <= kbFull.limit, JSON.stringify(kbFull));
  await page.evaluate(() => {
    window.__ocKb = 0;
    window.visualViewport.dispatchEvent(new Event('resize'));
    window.__workcraftWorkspace.setFullChat(false);
  });
  await page.evaluate((id) => window.__workcraftWorkspace.togglePip(id, false), gridP.id);
  await page.setViewportSize(LANDSCAPE);
  await page.waitForTimeout(900);
  const markers3 = await page.evaluate(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow.__marker || null).join(','));
  check('4f: picture in picture, Full Chat and rotation without reloading the apps', markers3 === markers, markers3);

  check('IDE without unhandled errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ================================================================ Package 6: workspaces and the apps beyond Office
  {
    const xctx = await ipadContext(PORTRAIT);
    // a project that was never arranged: the layout the earlier pages saved would come back (a saved layout is yours)
    await xctx.request.put(`${BASE}/api/meta/layout`, { data: '{}', headers: { 'content-type': 'application/json' } });
    const xp = await xctx.newPage();
    const xerrors = [];
    xp.on('pageerror', (e) => xerrors.push(e.message));
    await xp.goto(`${BASE}/?ecosystem=office`);
    await xp.waitForSelector('html.is-ready', { timeout: 40000 });
    await xp.waitForTimeout(2500);
    // 6a: the stage of the Office workspace on an iPad: the two medium apps side by side
    const stageTools = () => xp.evaluate(() => window.__workcraftWorkspace.panels().filter((p) => p.mode === 'normal' && ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft', 'filmcraft', 'effectcraft', 'soundcraft', 'photocraft', 'lightcraft', 'vectorcraft', 'cadcraft', 'solidcraft'].includes(p.tool)).map((p) => p.tool));
    const before = await stageTools();
    check('6a: Office workspace on an iPad: nothing opens by itself (welcome page)', before.length === 0 && (await xp.locator('.empty-stage').count()) === 1, before.join(','));
    await xp.locator('.empty-stage [data-act="open-first"]').tap();
    await xp.waitForTimeout(1500);
    const office = await stageTools();
    // Portrait: the project tree and the chat leave the stage about 300 px, too narrow for two apps (2 x 320 px), so the first app opens alone;
    // the two-app case (a wide stage, weights on an iPad) is covered by tests/server/stage-plan.test.ts and ipados.test.ts
    check('6a2: Open the first apps on an iPad in portrait: one app, because two would be 150 px wide each', office.length === 1 && office[0] === 'wordcraft', office.join(','));
    // 6b: a workspace with heavy apps opens ONE heavy app on an iPad (the others are one click away)
    const filmBuild = await xp.evaluate(async () => (await fetch('/apps/filmcraft/index.html', { method: 'HEAD' })).ok);
    if (filmBuild) {
      await xp.goto(`${BASE}/?ecosystem=motion`);
      await xp.waitForSelector('html.is-ready', { timeout: 40000 });
      await xp.waitForTimeout(2500);
      const motionBefore = (await stageTools()).filter((t) => ['filmcraft', 'effectcraft', 'soundcraft'].includes(t));
      check('6b0: Video, Motion & Audio opens nothing by itself', motionBefore.length === 0, motionBefore.join(','));
      await xp.locator('.empty-stage [data-act="open-first"]').tap();
      await xp.waitForTimeout(1500);
      const motion = (await stageTools()).filter((t) => ['filmcraft', 'effectcraft', 'soundcraft'].includes(t));
      check('6b: Video, Motion & Audio on an iPad opens one heavy app, not two', motion.length === 1 && motion[0] === 'filmcraft', motion.join(','));
      await xp.goto(`${BASE}/?ecosystem=office`);
      await xp.waitForSelector('html.is-ready', { timeout: 40000 });
      await xp.waitForTimeout(1500);
    } else check('6b: Video, Motion & Audio opens one heavy app on an iPad (no FilmCraft build in this checkout: skipped)', true, 'skipped');
    // 6c: the workspace picker: equal cards, 44 px targets, no sideways scroll, at iPad, Split View and Slide Over widths
    const pickerFacts = async (viaMenu) => {
      // the apps of this page start first (software rendering keeps the page busy and the tap never finds a stable button)
      await waitFor(xp, async () => (await panels(xp)).every((p) => p.status !== 'queued' && p.status !== 'loading'), 90000, 500);
      await xp.waitForTimeout(1500);
      if (viaMenu) {
        // Slide Over (520 px and below) hides the rail with the launcher button: the main menu has the workspace entries
        await xp.locator('button[data-act="menu"]').tap();
        await xp.locator('[role^="menuitem"]', { hasText: 'Switch workspace' }).first().tap();
      } else {
        await xp.locator('button[aria-label="Apps, recent files and workspaces"]').tap();
        // inside the launcher dialog: the welcome page has a Switch workspace button of its own, under the dialog
        await xp.locator('dialog[open] button', { hasText: 'Switch workspace' }).first().tap();
      }
      await xp.waitForSelector('.eco-card', { timeout: 10000 });
      const r = await xp.evaluate(() => {
        const cards = [...document.querySelectorAll('.eco-card')];
        const dlg = document.querySelector('dialog[open]');
        const rows = new Map();
        for (const c of cards) {
          const b = c.getBoundingClientRect();
          const k = Math.round(b.top);
          rows.set(k, [...(rows.get(k) || []), Math.round(b.height)]);
        }
        const cs = getComputedStyle(cards[0]);
        return { n: cards.length, minH: Math.min(...cards.map((c) => c.getBoundingClientRect().height)), equal: [...rows.values()].every((h) => new Set(h).size === 1), overflowX: dlg ? dlg.scrollWidth > dlg.clientWidth + 1 : null, bg: cs.backgroundImage, border: cs.borderTopColor, tiles: Math.min(...[...document.querySelectorAll('.eco-tile')].map((t) => t.getBoundingClientRect().height)) };
      });
      await xp.keyboard.press('Escape');
      await xp.waitForTimeout(300);
      return r;
    };
    for (const [label, vp] of [['iPad portrait', PORTRAIT], ['Split View', { width: 683, height: 1024 }], ['Slide Over', { width: 375, height: 1024 }]]) {
      await xp.setViewportSize(vp);
      await xp.waitForTimeout(900);
      const r = await pickerFacts(vp.width <= 520);
      check(`6c: workspace picker at ${label} (${vp.width} px): ${r.n} cards of equal height per row, 44 px targets, no gradient, no sideways scroll`, r.n >= 10 && r.minH >= 44 && r.equal && r.bg === 'none' && r.overflowX === false && r.tiles >= 36, JSON.stringify(r));
    }
    await xp.setViewportSize(PORTRAIT);
    await xp.waitForTimeout(600);
    // 6d: sound is blocked: the frame says so, the panel tells the user what to do, and it goes away when the sound runs
    // (the page was reloaded on the welcome page in 6b: open WordCraft the way a user would, and wait for its frame)
    await xp.evaluate(() => {
      const w = window.__workcraftWorkspace;
      const p = w.panels().find((x) => x.tool === 'wordcraft');
      if (!p) w.openPanel('wordcraft', { silent: true });
      else if (p.mode !== 'normal') w.show(p.id);
    });
    await waitFor(xp, async () => (await panels(xp)).some((p) => p.tool === 'wordcraft' && p.status === 'active'), 90000, 500);
    await xp.waitForTimeout(1500);
    const hint = await xp.evaluate(async () => {
      const frame = document.querySelector('.panel[data-tool="wordcraft"] .ca-frame');
      const el = document.querySelector('.panel[data-tool="wordcraft"] .ca-audio-hint');
      if (!frame || !el) return null;
      const w = frame.contentWindow;
      // sent from inside the frame, as the frame layer does (the adapter only trusts messages whose source is the engine window)
      w.eval("parent.postMessage({ type: 'workcraft:audio-state', detail: { blocked: true } }, location.origin)");
      await new Promise((r) => setTimeout(r, 100));
      const shown = !el.hidden;
      w.eval("parent.postMessage({ type: 'workcraft:audio-state', detail: { blocked: false } }, location.origin)");
      await new Promise((r) => setTimeout(r, 100));
      return { shown, hiddenAfter: el.hidden, text: el.textContent };
    });
    check('6d: "Sound is off" hint appears while a Web Audio context is suspended and goes when it runs', !!hint && hint.shown && hint.hiddenAfter, JSON.stringify(hint) + ' ' + JSON.stringify(await panels(xp)).slice(0, 300));
    // 6g: the measures run in apps beyond Office too (frame layer, pointer bridge, Retina): SoundCraft (audio) and PhotoCraft (pressure brush), when their builds are here
    for (const tool of ['soundcraft', 'photocraft']) {
      const has = await xp.evaluate(async (t) => (await fetch(`/apps/${t}/index.html`, { method: 'HEAD' })).ok, tool);
      if (!has) {
        check(`6g: iPad measures reach ${tool} (no build in this checkout: skipped)`, true, 'skipped');
        continue;
      }
      // SoundCraft panics at startup (cpal: HostUnavailable) in a WebKit without Web Audio: Playwright's WebKit on Windows has none, Safari on an iPad has it
      if (tool === 'soundcraft' && (await xp.evaluate(() => typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined'))) {
        check('6g: iPad measures reach soundcraft (this WebKit build has no Web Audio, the app cannot start in it: skipped, not a pass)', true, 'skipped');
        continue;
      }
      await xp.evaluate((t) => window.__workcraftWorkspace.openPanel(t), tool);
      const up = await waitFor(xp, async () => (await panels(xp)).some((p) => p.tool === tool && p.status === 'active'), 90000, 500);
      if (!up) {
        check(`6g: iPad measures reach ${tool} (it did not start in this WebKit within 90 s: skipped, not a pass)`, true, 'skipped');
        continue;
      }
      await xp.waitForTimeout(3000);
      const rep = await xp.evaluate((t) => {
        const id = window.__workcraftWorkspace.panels().find((p) => p.tool === t).id;
        const r = window.__workcraftIpad.ipados.engines.get(id);
        const f = document.querySelector(`.panel[data-id="${id}"] .ca-frame`);
        return r ? { measures: Object.fromEntries(r.measures.map((m) => [m.id, m.state])), sharp: r.sharpness, touch: f ? getComputedStyle(f.contentDocument.documentElement).touchAction : null } : null;
      }, tool);
      const need = ['viewport-meta', 'pixel-ratio', 'gesture-lock', 'pointer-bridge', 'audio-unlock'];
      const ok = !!rep && need.filter((m) => m !== 'audio-unlock' || tool === 'soundcraft').every((m) => rep.measures[m] === 'applied') && rep.sharp !== 'blurry' && rep.touch === 'none';
      check(`6g: iPad measures reach ${tool}: viewport, pixel ratio, gesture lock, pointer bridge${tool === 'soundcraft' ? ', audio unlock' : ''}, sharp, touch-action none`, ok, JSON.stringify(rep));
    }
    check('6e: no unhandled errors in the workspaces package', xerrors.length === 0, xerrors.slice(0, 3).join(' | '));
    // after the error check: an app that cannot start in this WebKit (no WebGPU) must not fail it, the bar is measured regardless
    // 6h: touch keys: the apps worked with shortcuts (ProCraft, FilmCraft) get a bar on a touch screen without a setting; its buttons are
    // 44 px tall and send the key press to the app (Cmd on Apple platforms); an app without a table (WordCraft) gets none.
    // A page of its own per app: a hardware key pressed earlier in the run would (correctly) fold the bar away in Auto, and a heavy app
    // waits for the one before it to finish starting. After the error check: an app that cannot start in this WebKit (no WebGPU) must not fail it.
    for (const [tool, label, key, code] of [['procraft', 'Undo', 'z', 'KeyZ'], ['filmcraft', 'Split', 'k', 'KeyK']]) {
      const has = await xp.evaluate(async (t) => (await fetch(`/apps/${t}/index.html`, { method: 'HEAD' })).ok, tool);
      if (!has) {
        check(`6h: touch keys in ${tool} (no build in this checkout: skipped)`, true, 'skipped');
        continue;
      }
      const kctx = await ipadContext(PORTRAIT);
      const kp = await kctx.newPage();
      await kp.goto(`${BASE}/?ecosystem=office`);
      await kp.waitForSelector('html.is-ready', { timeout: 40000 });
      await kp.waitForTimeout(1500);
      await kp.evaluate((t) => window.__workcraftWorkspace.openPanel(t), tool);
      await kp.waitForSelector(`.panel[data-tool="${tool}"] .ca-keys:not([hidden])`, { timeout: 60000 });
      await waitFor(kp, () => kp.evaluate((t) => [...document.querySelectorAll(`.panel[data-tool="${t}"]`)].some((x) => x.querySelector('.ca-keys:not([hidden])') && (() => { const w = x.querySelector('.ca-frame')?.contentWindow; return !!w && w.location.pathname.includes(`/apps/${t}/`) && w.document.readyState === 'complete'; })()), tool), 60000, 300);
      const tk = await kp.evaluate(
        async ([t, lbl]) => {
          const panel = [...document.querySelectorAll(`.panel[data-tool="${t}"]`)].find((x) => x.querySelector('.ca-keys:not([hidden])'));
          const bar = panel.querySelector('.ca-keys');
          const btns = [...bar.querySelectorAll('.ca-key')];
          const doc = panel.querySelector('.ca-frame').contentDocument;
          const got = [];
          // on the window, capture phase: FilmCraft's own listeners consume the key before it reaches the document
          doc.defaultView.addEventListener('keydown', (e) => got.push({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey }), true);
          const b = btns.find((x) => x.querySelector('span').textContent === lbl);
          b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
          await new Promise((r) => setTimeout(r, 150));
          const rect = bar.getBoundingClientRect();
          const pr = panel.getBoundingClientRect();
          return { n: btns.length, minH: Math.min(...btns.map((x) => x.getBoundingClientRect().height)), got, inside: rect.left >= pr.left - 1 && rect.right <= pr.right + 1, wordBar: !!document.querySelector('.panel[data-tool="wordcraft"] .ca-keys') };
        },
        [tool, label]
      );
      check(`6h: touch keys in ${tool}: bar with ${tk.n} buttons at least 44 px, "${label}" sends ${key} with Cmd to the app, inside the panel, none in WordCraft`, tk.n >= 10 && tk.minH >= 44 && tk.got.length === 1 && tk.got[0].key === key && tk.got[0].code === code && tk.got[0].meta === !tk.got[0].ctrl && tk.inside && !tk.wordBar, JSON.stringify(tk));
      // Auto steps aside once a hardware keyboard is used (a trusted key press with no on-screen keyboard up)
      if (tool === 'procraft') {
        // the key goes to the page itself (this headless WebKit does not hand keys to a focused canvas inside an iframe)
        await kp.evaluate(() => { document.activeElement?.blur?.(); window.focus(); document.body.tabIndex = -1; document.body.focus(); });
        await kp.keyboard.press('a');
        await kp.waitForTimeout(300);
        check('6i: touch keys step aside in Auto after a hardware keyboard key', await kp.evaluate(() => !document.querySelector('.ca-keys:not([hidden])')));
      }
      await kctx.close();
    }
    await xctx.close();
    // 6f: crash recovery: a session that never marked itself clean is reported once and runs with a lower memory budget
    for (const [clean, want] of [[false, true], [true, false]]) {
      const rctx = await ipadContext(PORTRAIT);
      await rctx.addInitScript((c) => {
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem('workcraft.session', JSON.stringify({ at: Date.now() - 5000, clean: c }));
          sessionStorage.setItem('seeded', '1');
        }
      }, clean);
      const rp = await rctx.newPage();
      await rp.goto(`${BASE}/`);
      await rp.waitForSelector('html.is-ready', { timeout: 40000 });
      await rp.waitForTimeout(3000);
      const rec = await rp.evaluate(() => ({ recovered: window.__workcraftIpad.ipados.state.recovered, notice: /The page was reloaded/.test(document.body.innerText) }));
      check(`6f: crash recovery, previous session ${clean ? 'clean' : 'not clean'}: ${want ? 'reported' : 'quiet'}`, rec.recovered === want && rec.notice === want, JSON.stringify(rec));
      await rctx.close();
    }
  }

  // ================================================================ Alpha.4: Add to Home Screen notice and the first-start page on an iPad
  {
    const nctx = await ipadContext(PORTRAIT);
    await nctx.addInitScript(() => {
      try {
        localStorage.removeItem('workcraft.installTip');
      } catch {
        /* ignore */
      }
    });
    const np = await nctx.newPage();
    await np.goto(`${BASE}/`);
    await np.waitForSelector('html.is-ready', { timeout: 40000 });
    const noteBtn = np.locator('.notes .note [data-act], .notes .note button', { hasText: 'Show me how' }).first();
    await noteBtn.waitFor({ timeout: 10000 }).catch(() => {});
    check('7a: an iPad in Safari is offered Add to Home Screen once', (await noteBtn.count()) === 1);
    if (await noteBtn.count()) {
      await noteBtn.tap();
      const steps = await np.waitForSelector('dialog[open] .it-steps li', { timeout: 5000 }).then(() => np.locator('dialog[open] .it-steps li').count()).catch(() => 0);
      check('7b: the guide shows the four steps (Share, Add to Home Screen, Add, open it)', steps === 4, String(steps));
      await np.keyboard.press('Escape');
    }
    await np.goto(`${BASE}/?onboarding=1`);
    await np.waitForSelector('.onb', { timeout: 40000 });
    await np.locator('[data-action="onb-continue"]').tap();
    await np.waitForTimeout(800);
    const onb = await np.evaluate(() => {
      const c = document.querySelector('.onb-card').getBoundingClientRect();
      return { top: Math.round(c.top), bottom: Math.round(c.bottom), vh: innerHeight, vpTop: Math.round(window.visualViewport?.offsetTop || 0) };
    });
    check('7c: first-start page, second step: the card starts at the top like the first and fits the screen', onb.top >= 0 && onb.top <= 24 && onb.bottom <= onb.vh, JSON.stringify(onb));
    await nctx.close();
  }

  // ================================================================ Browser mode (portrait, without the desktop)
  const bctx = await ipadContext(PORTRAIT);
  await bctx.route('**/api/**', (r) => r.abort());
  await bctx.route('**/mcp', (r) => r.abort());
  const bp = await bctx.newPage();
  await bp.goto(`${BASE}/`);
  await bp.waitForSelector('html.is-ready', { timeout: 40000 });
  await bp.waitForTimeout(1500);
  const bstate = await bp.evaluate(() => ({ mode: document.documentElement.dataset.backend, chip: document.querySelector('.sb-backend').textContent, dialogs: document.querySelectorAll('.boot-down, .boot-error').length }));
  check('5a: without the desktop, browser mode starts by itself without an error message', bstate.mode === 'browser' && /Browser mode/.test(bstate.chip) && bstate.dialogs === 0, JSON.stringify(bstate));
  // A new browser starts with an empty project of its own; "Load sample data" opens the sample project
  const empty = await bp.evaluate(() => ({ rows: document.querySelectorAll('.tree-row').length, name: document.querySelector('.tree-project-name')?.textContent, button: !!document.querySelector('[data-load-sample]') }));
  check('5b: a new browser starts with an empty project of its own and offers sample data', empty.rows === 0 && empty.name === 'My project' && empty.button, JSON.stringify(empty));
  await bp.locator('[data-load-sample]').tap();
  await waitFor(bp, async () => (await bp.locator('.tree-project-name').innerText()) === 'Sample project' && (await bp.locator('.tree-row').count()) > 0, 10000);
  const tree = await bp.locator('.tree-row').allInnerTexts();
  check('5b2: Load sample data opens the sample project from the IndexedDB', tree.some((t) => /documents/.test(t)), tree.slice(0, 6).join(', '));
  // Import files through the file dialog
  await bp.evaluate(() => window.dispatchEvent(new Event('noop')));
  await bp.evaluate(() => void window.__workcraftWorkspace.openPanel('settings'));
  await bp.waitForSelector('.sp-tab');
  // iPad and network sits behind Developer options
  if ((await bp.locator('.sp-dev-toggle').getAttribute('aria-expanded')) !== 'true') await bp.locator('.sp-dev-toggle').tap();
  await bp.locator('.sp-tab', { hasText: 'iPad and network' }).tap();
  await bp.waitForSelector('[data-card="files"]');
  const [chooser] = await Promise.all([bp.waitForEvent('filechooser'), bp.locator('[data-action="import-files"]').tap()]);
  await chooser.setFiles({ name: 'ipad-note.md', mimeType: 'text/markdown', buffer: Buffer.from('# From the iPad\n\nImported through the file dialog.\n') });
  await waitFor(bp, async () => (await bp.evaluate(() => [...document.querySelectorAll('.tree-row')].some((r) => /imported/.test(r.textContent)))), 10000);
  await bp.reload();
  await bp.waitForSelector('html.is-ready', { timeout: 40000 });
  await bp.waitForTimeout(1200);
  const persisted = await bp.evaluate(async () => {
    const r = await new Promise((res) => {
      const o = indexedDB.open('opencraft-browser');
      o.onsuccess = () => {
        const t = o.result.transaction('files').objectStore('files').getAllKeys();
        t.onsuccess = () => res(t.result.map(String));
      };
    });
    return r.some((k) => k.endsWith('/imported/ipad-note.md'));
  });
  check('5c: import by file dialog, in the IndexedDB after reloading', persisted);
  // API keys: permanent storage only after a clear notice
  await bp.evaluate(() => void window.__workcraftWorkspace.openPanel('settings'));
  if ((await bp.locator('.sp-dev-toggle').getAttribute('aria-expanded')) !== 'true') await bp.locator('.sp-dev-toggle').tap();
  await bp.locator('.sp-tab', { hasText: 'iPad and network' }).tap();
  await bp.waitForSelector('[data-keys-persist]');
  const warn = await bp.locator('[data-card="keys"] .sp-notice').innerText();
  await bp.locator('[data-keys-persist]').check();
  await bp.waitForSelector('dialog.modal[open]');
  const dlgText = await bp.locator('dialog.modal[open]').innerText();
  await bp.locator('dialog.modal[open] button[type="submit"]').tap();
  const flag = await waitFor(bp, () => bp.evaluate(() => localStorage.getItem('workcraft.browser.persistKeys')), 5000);
  check('5d: local key storage with a clear notice', /Local storage/.test(warn) && /unencrypted/.test(dlgText) && flag === '1');
  // Export as a project ZIP
  const [dl] = await Promise.all([bp.waitForEvent('download'), bp.locator('[data-action="export-zip"]').tap()]);
  const zip = readFileSync(await dl.path());
  check('5e: export as a project ZIP', zip[0] === 0x50 && zip[1] === 0x4b, `${dl.suggestedFilename()} ${zip.length} bytes`);
  // The terminal points to the desktop
  await bp.evaluate(() => void window.__workcraftWorkspace.openPanel('terminal'));
  const desk = await bp.waitForSelector('.desk-only', { timeout: 10000 }).catch(() => null);
  check('5f: terminal in browser mode points to the desktop', !!desk);
  // AI straight from the browser (own endpoint)
  await bp.evaluate(() => void window.__workcraftWorkspace.openPanel('settings'));
  await bp.locator('.sp-tab', { hasText: 'AI models' }).tap();
  const nc = bp.locator('.sp-card[data-provider="custom-new"]');
  await nc.locator('input').nth(0).fill('Mock iPad');
  await nc.locator('.sp-choice select').nth(0).selectOption('__other__');
  await nc.locator('.sp-choice input').nth(0).fill(`http://127.0.0.1:${MOCK_PORT}/v1`);
  await nc.locator('input[type="password"]').fill('sk-ipad-test');
  await nc.locator('.sp-choice select').nth(1).selectOption('__other__');
  await nc.locator('.sp-choice input').nth(1).fill('mock-ipad');
  await nc.getByRole('button', { name: 'Test connection' }).tap();
  await bp.waitForSelector('.sp-card[data-provider="custom-new"] .sp-test[data-state="ok"]', { timeout: 15000 });
  await nc.getByRole('button', { name: 'Add' }).tap();
  const cc = bp.locator('.sp-card[data-provider^="custom-"]:not([data-provider="custom-new"])');
  await cc.waitFor({ timeout: 10000 });
  await cc.getByRole('button', { name: 'Make default' }).tap();
  await bp.evaluate(() => window.__workcraftWorkspace.show('chat'));
  await bp.locator('.chat-input').fill('Hello');
  await bp.locator('.chat-input').press('Enter');
  const answer = await waitFor(bp, async () => {
    const t = await bp.locator('.msg[data-role="assistant"]').last().innerText();
    return /Hello from iPad/.test(t) && t;
  }, 20000);
  check('5g: AI chat in browser mode goes straight to the provider', !!answer);
  await shot(bp, '06-browser-mode');
  await bctx.close();

  // ================================================================ Website (portrait and landscape)
  // Only where the website is part of the checkout (workcraft, workcraft-home), not in workcraft
  const withSite = existsSync('contact/index.html') && existsSync('portal/index.html');
  for (const [label, vp] of withSite ? [['portrait', PORTRAIT], ['landscape', LANDSCAPE]] : []) {
    const wctx = await ipadContext(vp, { webgl: false });
    const wp = await wctx.newPage();
    await wp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const home = await wp.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      touch: document.documentElement.classList.contains('touch'),
      capable: !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]'),
      status: !!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
      icon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
      manifest: !!document.querySelector('link[rel="manifest"]'),
      theme: Math.min(...[...document.querySelectorAll('.theme-toggle')].filter((e) => e.offsetParent).map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height))),
      rail: Math.min(...[...document.querySelectorAll('.x-rb')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)),
    }));
    check(`W1 ${label}: homepage without horizontal scrolling, web app metadata, touch targets`, home.overflow <= 0 && home.touch && home.capable && home.status && /apple-touch-icon\.png/.test(home.icon || '') && home.manifest && home.theme >= 44 && home.rail >= 44, JSON.stringify(home));
    // Tabs of the app gallery with finger and pencil
    await wp.locator('[role="tab"][data-app="grid"]').scrollIntoViewIfNeeded();
    await wp.locator('[role="tab"][data-app="grid"]').tap();
    const picked = await wp.locator('[role="tab"][data-app="grid"]').getAttribute('aria-selected');
    check(`W2 ${label}: gallery works by finger tap`, picked === 'true');
    // Portal: code from the keyboard bar
    await wp.goto(`${BASE}/portal/`, { waitUntil: 'networkidle' });
    const otp = await wp.evaluate(() => {
      document.querySelectorAll('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== 'code'));
      const boxes = [...document.querySelectorAll('[data-view="code"] .otp input')];
      const first = boxes[0];
      const attrs = { mode: first.inputMode, ac: first.autocomplete, max: first.maxLength, font: parseFloat(getComputedStyle(first).fontSize) };
      first.focus();
      first.value = '482913';
      first.dispatchEvent(new Event('input', { bubbles: true }));
      return { ...attrs, value: boxes.map((b) => b.value).join(''), allNumeric: boxes.every((b) => b.inputMode === 'numeric') };
    });
    check(`W3 ${label}: portal takes the 6-digit code from the iPad keyboard bar`, otp.value === '482913' && otp.mode === 'numeric' && otp.ac === 'one-time-code' && otp.allNumeric && otp.font >= 16, JSON.stringify(otp));
    // Contact: topic chips
    await wp.goto(`${BASE}/contact/`, { waitUntil: 'networkidle' });
    const chipH = await wp.evaluate(() => Math.min(...[...document.querySelectorAll('.c-chip-row span')].map((s) => s.getBoundingClientRect().height)));
    await wp.locator('.c-chip-row label', { hasText: 'Bug report' }).tap();
    const chosen = await wp.evaluate(() => document.querySelector('input[name="topic"]:checked')?.value);
    check(`W4 ${label}: contact chips 44 px and selectable by tap`, chipH >= 44 && chosen === 'bug', `${chipH} px, ${chosen}`);
    // Panel and dashboard: drawer
    for (const path of ['/panel/', '/dashboard/']) {
      await wp.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      const btn = wp.locator('.d-drawer-btn');
      const visible = await btn.isVisible();
      let opened = false;
      let closed = false;
      if (visible) {
        await btn.tap();
        await wp.waitForTimeout(350);
        opened = await wp.evaluate(() => document.querySelector('[data-app]').classList.contains('is-drawer-open') && getComputedStyle(document.querySelector('.d-nav span')).display !== 'none');
        const side = await rectOf(wp, '.d-side');
        await gesture(wp, [['down', side.x + side.w - 30, side.cy], ['move', side.x + side.w - 90, side.cy], ['up', side.x + 20, side.cy]], { pointerType: 'touch', sel: '.d-side' });
        await wp.waitForTimeout(300);
        closed = await wp.evaluate(() => !document.querySelector('[data-app]').classList.contains('is-drawer-open'));
      }
      const wide = vp.width >= 1180;
      check(`W5 ${label}: ${path} side bar as a drawer`, wide ? !visible : visible && opened && closed, wide ? 'full side bar from 1180 px' : `open ${opened}, swipe closes ${closed}`);
    }
    await shot(wp, `07-site-${label}`);
    await wctx.close();
  }
} catch (e) {
  check('Test run', false, e.stack || e.message);
} finally {
  await browser.close();
  mock.close();
  try {
    process.kill(-stack.pid);
  } catch {
    stack.kill();
  }
  rmSync(HOME, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed (${engine}). Screenshots: ${SHOTS}/`);
process.exit(failed.length ? 1 : 0);
