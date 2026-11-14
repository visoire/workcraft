#!/usr/bin/env node
// Audits every app INSIDE the workspace on a desktop screen: does its panel start, does the app follow the workspace switch, does the
// frame around it match the look it keeps. Complements scripts/audit-apps.mjs (which loads each app on its own).
//
//   npm run apps:audit-panels -- [--base http://127.0.0.1:5185] [--app photocraft,align] [--out test-results/panels-audit]
//
// Needs the dev server (npm run dev, or a test stack on other ports with a temporary WORKCRAFT_HOME: never your real data), because the
// script reaches the workspace through its source modules (/src/workspace/layout.ts). Playwright is not a dependency: set
// PLAYWRIGHT_MODULE (a playwright-core folder) and CHROMIUM (a Chrome or Edge executable).
//
// Per app: open one panel in a 1440 x 900 window with the workspace in light, wait for the app to start, take a picture, switch the
// workspace to dark, wait, take a second picture, and record: start time, the status of the panel, errors, the brightness of both
// pictures, the data of the frame (data-look, data-theme-kind, data-differs) and what the app itself reports (CraftTheme.spec).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://127.0.0.1:5185').replace(/\/$/, '');
const OUT = arg('out', 'test-results/panels-audit');
const ONLY = (arg('app', '') || '').split(',').filter(Boolean);
const START_MS = Number(arg('start', '60')) * 1000;
mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright'));
  } catch {
    console.error('Playwright is missing. Set PLAYWRIGHT_MODULE to a playwright-core folder.');
    process.exit(2);
  }
}

const catalog = JSON.parse(readFileSync('src/ecosystems/catalog.json', 'utf8'));
const apps = catalog.apps.filter((a) => !ONLY.length || ONLY.includes(a.id));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const pixPage = await (await browser.newContext()).newPage();
const brightness = (png) =>
  pixPage.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 100;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 160, 100);
    const d = g.getImageData(0, 0, 160, 100).data;
    let sum = 0;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    }
    return { mean: Number((sum / (d.length / 4)).toFixed(3)), colors: seen.size };
  }, png.toString('base64'));

const results = [];
for (const app of apps) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  // The workspace in light, set before the page starts; the operating system says dark, so only the switch may decide
  await ctx.addInitScript(() => {
    try {
      const k = 'workcraft.prefs';
      const cur = JSON.parse(localStorage.getItem(k) || '{}');
      localStorage.setItem(k, JSON.stringify({ ...cur, theme: 'light', ecosystemChosen: true }));
      localStorage.setItem('oc-ide-theme', 'light');
      localStorage.setItem('oc-ide-theme-at', String(Date.now()));
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 160)));
  const row = { app: app.id, declared: app.theme ? `${app.theme.modes}/${app.theme.via}` : null, started: false, startMs: null, status: null, errors: [] };
  try {
    // Start from the default layout each time: the saved layout of an earlier app would open its panels again and slow the start down
    await ctx.request.put(`${BASE}/api/meta/layout`, { data: '{}', headers: { 'content-type': 'application/json' } }).catch(() => {});
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
    // The workspace is ready when its stage exists and the default panels are drawn
    await page.waitForFunction(() => !!document.querySelector('.stage-layout') && document.querySelectorAll('.ca').length > 0, null, { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const t0 = Date.now();
    // Some engines need cross-origin isolation: the workspace then reloads itself once (service worker), which destroys the page context. Try again after it.
    const open = (args) =>
      page.evaluate(async ({ id, limit }) => {
      const url = (p) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(p)) || p;
      const { workspace } = await import(url('/src/workspace/layout.ts'));
      const { instance, id: panelId } = await workspace.instanceForTool(id);
      const done = await Promise.race([instance.ready?.then(() => true, () => false) ?? Promise.resolve(true), new Promise((r) => setTimeout(() => r(false), limit))]);
      // A desktop user gives an app the whole stage: give the panel the full screen (Alt+Enter), so the app is judged at the size it is used at
      workspace.show(panelId);
      workspace.setFullscreen(panelId);
      return { panelId, ready: done };
      }, args);
    let opened;
    try {
      opened = await open({ id: app.id, limit: START_MS });
    } catch (e) {
      if (!/context was destroyed|Target closed|navigat|reading 'layer'/i.test(String(e.message))) throw e;
      row.reloaded = true;
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(4000);
      opened = await open({ id: app.id, limit: START_MS });
    }
    row.startMs = Date.now() - t0;
    row.started = !!opened.ready;
    await page.waitForTimeout(2500);
    const handle = () => page.evaluateHandle((name) => [...document.querySelectorAll('iframe.ca-frame')].find((f) => (f.title || '').startsWith(name))?.closest('.ca') ?? null, app.name).then((h) => h.asElement());
    const look = () =>
      page.evaluate((name) => {
        const frame = [...document.querySelectorAll('iframe.ca-frame')].find((f) => (f.title || '').startsWith(name));
        const root = frame?.closest('.ca');
        let inner = null;
        try {
          const w = frame?.contentWindow;
          inner = { dataTheme: w.document.documentElement.getAttribute('data-theme'), spec: w.CraftTheme?.spec ?? null, dark: w.matchMedia('(prefers-color-scheme: dark)').matches };
        } catch (e) {
          inner = { error: String(e.message || e).slice(0, 80) };
        }
        const rect = (frame || root)?.getBoundingClientRect();
        return { look: root?.dataset.look, kind: root?.dataset.themeKind, differs: root?.dataset.differs, ws: document.documentElement.dataset.theme, inner, rect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null, status: [...document.querySelectorAll('.pane-status, .tab-status')].map((e) => e.textContent.trim()).slice(0, 2) };
      }, app.name);
    row.light = { ...(await look()) };
    const shotLight = await (await handle())?.screenshot({ type: 'png' }).catch(() => null);
    if (shotLight) {
      writeFileSync(join(OUT, `${app.id}-ws-light.png`), shotLight);
      Object.assign(row.light, await brightness(shotLight));
    }
    // the workspace switch to dark: the OS stays dark too, so also try the opposite below
    await page.evaluate(async () => {
      const url = (p) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(p)) || p;
      const { prefs } = await import(url('/src/app/settings.ts'));
      prefs.set('theme', 'dark');
    });
    // An app that presses a switch of its own (DeckCraft) needs a few seconds: wait until the picture has changed, at most 12 s
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000);
      const probe = await (await handle())?.screenshot({ type: 'png' }).catch(() => null);
      if (probe && (row.light.mean ?? 0) - (await brightness(probe)).mean > 0.05) break;
    }
    row.dark = { ...(await look()) };
    const shotDark = await (await handle())?.screenshot({ type: 'png' }).catch(() => null);
    if (shotDark) {
      writeFileSync(join(OUT, `${app.id}-ws-dark.png`), shotDark);
      Object.assign(row.dark, await brightness(shotDark));
    }
    // Back to light: an app that follows must come back, and the frame must not keep the dark one
    await page.evaluate(async () => {
      const url = (p) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(p)) || p;
      const { prefs } = await import(url('/src/app/settings.ts'));
      prefs.set('theme', 'light');
    });
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000);
      const probe = await (await handle())?.screenshot({ type: 'png' }).catch(() => null);
      if (probe && Math.abs((await brightness(probe)).mean - (row.light.mean ?? -1)) < 0.1) break;
    }
    row.back = { ...(await look()) };
    const shotBack = await (await handle())?.screenshot({ type: 'png' }).catch(() => null);
    if (shotBack) Object.assign(row.back, await brightness(shotBack));
  } catch (e) {
    row.errors.push('audit: ' + String(e.message || e).slice(0, 200));
  }
  row.errors.push(...[...new Set(errors)].slice(0, 3));
  // Verdict: a follower gets clearly darker in the dark workspace and comes back; every other app keeps its look
  const dl = (row.light?.mean ?? -1) - (row.dark?.mean ?? -1);
  const back = Math.abs((row.back?.mean ?? -1) - (row.light?.mean ?? -2)) < 0.1;
  const follows = ['media', 'switch', 'css'].includes(app.theme?.via);
  row.followed = dl > 0.05; // FigCraft keeps a light design canvas inside a dark interface: a smaller step still counts
  row.ok = row.started && (follows ? row.followed && back : !row.followed);
  results.push(row);
  console.log(`${app.id.padEnd(20)} ${row.started ? 'started ' + String(row.startMs).padStart(5) + ' ms' : 'NOT STARTED       '}  light ${row.light?.mean} dark ${row.dark?.mean} back ${row.back?.mean}  ${row.declared}  look=${row.light?.look}/${row.dark?.look} ${row.ok ? 'OK' : 'CHECK'}${row.errors.length ? '  errors: ' + row.errors[0].slice(0, 70) : ''}`);
  writeFileSync(join(OUT, 'panels.json'), JSON.stringify(results, null, 2));
  await ctx.close();
}
await browser.close();
console.log(`\nAudited ${results.length} apps in panels: ${results.filter((r) => r.ok).length} ok. Details and pictures: ${OUT}`);
