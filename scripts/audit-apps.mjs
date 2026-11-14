#!/usr/bin/env node
// Audits every app of the catalog in a real browser: does it start, does it follow the workspace theme.
//
//   npm run apps:audit -- [--base http://127.0.0.1:5186] [--app wordcraft,photocraft] [--out test-results/apps-audit] [--wait 12]
//
// For each app (served from <base>/apps/<id>/, the production build or the dev server) two fresh browser contexts open the page,
// one with the WorkCraft theme "light" and one with "dark" (localStorage oc-home-theme, the choice the standalone page reads), wait for
// the app to draw, and record: errors, canvases, whether the page is not blank, the mean brightness of the picture and what
// data-theme says. The brightness of the two pictures tells what the app does with the theme:
//   follows   the picture gets clearly darker in dark mode    -> theme "both"
//   light     both pictures are light                         -> theme "light" (forced light)
//   dark      both pictures are dark                          -> theme "dark" (forced dark)
// The result is the measured side of src/ecosystems/catalog.json "theme" (docs/THEMING.md explains how to use it).
// Playwright is not a project dependency: set PLAYWRIGHT_MODULE (a playwright-core folder) and CHROMIUM (a Chrome or Edge executable).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://127.0.0.1:5186').replace(/\/$/, '');
const OUT = arg('out', 'test-results/apps-audit');
const WAIT = Number(arg('wait', '12')) * 1000;
const ONLY = arg('app', '')?.split(',').filter(Boolean);
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

/** Mean brightness 0..1 of a PNG buffer and how much of the picture is not one flat color (blank pages are flat). */
const pix = await (await browser.newContext()).newPage();
async function brightness(png) {
  return pix.evaluate(async (b64) => {
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
    return { mean: sum / (d.length / 4), colors: seen.size };
  }, png.toString('base64'));
}

async function visit(app, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme === 'dark' ? 'light' : 'dark' });
  // The OS preference is set to the opposite on purpose: only the WorkCraft choice may decide
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('oc-home-theme', t);
      localStorage.setItem('oc-home-theme-at', String(Date.now()));
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  const t0 = Date.now();
  let status = 'ok';
  try {
    const r = await page.goto(`${BASE}/apps/${app.id}/`, { waitUntil: 'load', timeout: 60000 });
    if (!r || !r.ok()) status = `http ${r?.status()}`;
  } catch (e) {
    status = 'load failed: ' + String(e.message).slice(0, 80);
  }
  await page.waitForTimeout(WAIT);
  const info = await page.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    colorScheme: document.documentElement.style.colorScheme,
    canvases: [...document.querySelectorAll('canvas')].filter((c) => c.width > 100 && c.height > 100).length,
    loading: !![...document.querySelectorAll('#loading, .loading, [id*=loading]')].find((e) => e.offsetParent),
    mediaDark: matchMedia('(prefers-color-scheme: dark)').matches,
    title: document.title,
    bodyText: (document.body.innerText || '').trim().slice(0, 60),
  })).catch(() => ({}));
  const shot = await page.screenshot({ type: 'png' }).catch(() => null);
  const b = shot ? await brightness(shot) : { mean: -1, colors: 0 };
  if (shot) writeFileSync(join(OUT, `${app.id}-${theme}.png`), shot);
  await ctx.close();
  return { theme, status, ms: Date.now() - t0, ...info, mean: Number(b.mean.toFixed(3)), colors: b.colors, errors: [...new Set(errors)].slice(0, 4) };
}

const results = [];
for (const app of apps) {
  const [light, dark] = await Promise.all([visit(app, 'light'), visit(app, 'dark')]);
  const alive = light.mean >= 0 && light.colors > 12 && dark.colors > 12;
  const delta = light.mean - dark.mean;
  // follows: the dark picture is clearly darker; otherwise both pictures show what the app forces
  const verdict = !alive ? 'no picture' : delta > 0.12 ? 'follows' : light.mean < 0.4 && dark.mean < 0.4 ? 'dark only' : light.mean >= 0.4 && dark.mean >= 0.4 ? 'light only' : 'unclear';
  // What the catalog declares, as the verdict it should produce: an app that follows -> follows; an own or fixed app keeps its look
  const t = app.theme || {};
  const expected = ['media', 'switch', 'css'].includes(t.via) ? 'follows' : `${t.via === 'fixed' ? t.modes : t.look || 'dark'} only`;
  const ok = alive && verdict === expected;
  const row = { app: app.id, declared: t.via ? `${t.modes}/${t.via}` : null, expected, verdict, match: ok, delta: Number(delta.toFixed(3)), light, dark };
  results.push(row);
  console.log(`${app.id.padEnd(20)} ${verdict.padEnd(11)} light ${light.mean} dark ${dark.mean} canvases ${light.canvases}/${dark.canvases} errors ${light.errors.length + dark.errors.length} declared ${row.declared || '-'} ${ok ? 'OK' : 'MISMATCH (expected ' + expected + ')'}`);
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(results, null, 2));
}
await browser.close();
console.log(`\nAudited ${results.length} apps. Details and pictures: ${OUT}`);
