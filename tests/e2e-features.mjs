// End-to-end check of the 1.1 features with Playwright (Chromium):
// local-only mode in the chat and the top bar, audit log, personas, project memory in the
// prompt, undo across all tools, project search (Ctrl/Cmd+Shift+K), settings pages (health check,
// memory and GPU monitor with emergency stop, trash, snapshots, share, plugins, logs),
// export formats and the documentation with its assistant.
//
//   npm run test:e2e:features
//
// Own backend and Vite on ports 5196/5195, an empty data folder and an OpenAI-compatible test
// endpoint on port 5309 that writes one file per answer.

import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UI_PORT = 5195;
const API_PORT = 5196;
const MOCK_PORT = 5309;
const BASE = `http://127.0.0.1:${UI_PORT}`;
const SHOTS = process.env.SHOTS || 'test-results/features';
mkdirSync(SHOTS, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright'));
  } catch {
    console.error('Playwright is missing. Install it with: npm i -D playwright');
    process.exit(2);
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

// ---------------------------------------------------------------- Test model: writes welcome.md, then answers
const seen = [];
const mock = createServer((req, res) => {
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'mock-1' }] }));
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const j = JSON.parse(body);
    const sys = j.messages[0]?.role === 'system' ? String(j.messages[0].content) : '';
    seen.push({ memory: sys.includes('<project_memory>'), persona: /Strict reviewer/.test(sys), context: /design studio/.test(sys) });
    const last = j.messages.at(-1);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (last.role !== 'tool' && (j.tools || []).length) {
      send({ choices: [{ delta: { content: 'Rewriting. ' } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write-document', arguments: JSON.stringify({ path: '/documents/welcome.md', markdown: '# Rewritten by the test model' }) } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      send({ choices: [{ delta: { content: 'Done: /documents/welcome.md was rewritten.' } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    }
    res.end('data: [DONE]\n\n');
  });
}).listen(MOCK_PORT, '127.0.0.1');

const HOME = mkdtempSync(join(tmpdir(), 'workcraft-e2e-features-'));
const stack = spawn(process.execPath, ['scripts/dev.mjs'], { env: { ...process.env, WORKCRAFT_FIRST_PROJECT: 'sample', WORKCRAFT_HOME: HOME, WORKCRAFT_PORT: String(API_PORT), WORKCRAFT_UI_PORT: String(UI_PORT), WORKCRAFT_SHARE_PORT: '5199' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
stack.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(d));
stack.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
for (let i = 0; i < 150; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    /* starting */
  }
  await new Promise((r) => setTimeout(r, 200));
}
const api = async (path, init) => {
  const r = await fetch(BASE + path, init);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/405|integrity|favicon/.test(m.text()) && errors.push(m.text()));
await page.addInitScript(() => localStorage.setItem('workcraft.prefs', JSON.stringify({ renderer: 'webgl' })));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const settings = async (section) => {
  await page.evaluate((s) => {
    const ws = window.__workcraftWorkspace;
    const id = ws.openPanel('settings');
    ws.focus(id);
  }, section);
  await page.locator(`.sp-tab[data-section="${section}"]`).click();
  await page.waitForTimeout(900);
};

try {
  const { id: mockId } = await api('/api/config/custom', json('POST', { name: 'Test model', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-1' }));
  const { id: cloudId } = await api('/api/config/custom', json('POST', { name: 'Cloud test', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-0000000000', model: 'x' }));
  await api('/api/config/active', json('PUT', { active: mockId }));
  await api('/api/config/personal', json('PUT', { context: 'I run a small design studio.' }));
  await api('/api/memory', json('POST', { text: 'Prices in proposals are net' }));

  await page.goto(`${BASE}/?mode=chat`);
  await page.waitForSelector('html.is-ready', { timeout: 40000 });
  await page.waitForSelector('.chat-persona option', { state: 'attached', timeout: 15000 });

  // ---------- Personas, personal context, project memory
  await page.selectOption('.chat-persona', 'reviewer');
  await page.waitForTimeout(400);
  await page.fill('.chat-input', 'Rewrite the welcome document');
  await page.keyboard.press('Enter');
  const undo = await page.waitForSelector('[data-action="undo-answer"]', { timeout: 25000 }).catch(() => null);
  const s0 = seen[0] || {};
  check('A1: persona and personal context reach the system prompt', s0.persona && s0.context, JSON.stringify(s0));
  check('A2: project memory block in the prompt (notes, passages)', s0.memory);
  check('A3: the answer shows persona and memory', (await page.locator('.msg-persona').count()) > 0 && (await page.locator('.msg-memory').count()) > 0);
  await shot('01-chat');

  // ---------- Undo across all tools
  const changed = await (await fetch(`${BASE}/api/files/raw?path=/documents/welcome.md`)).text();
  await undo?.click();
  await page.locator('dialog .btn.primary').click();
  await page.waitForSelector('.msg-undone', { timeout: 10000 }).catch(() => {});
  const back = await (await fetch(`${BASE}/api/files/raw?path=/documents/welcome.md`)).text();
  check('B1: undo restores the file the AI changed', /Rewritten/.test(changed) && !/Rewritten/.test(back), back.slice(0, 30));

  // ---------- Audit log
  const audit = await api('/api/audit');
  const a = audit.find((e) => e.kind === 'ai');
  check('C1: audit log entry with destination, model and file names, no content', a && a.destination === `127.0.0.1:${MOCK_PORT}` && a.local === true && !JSON.stringify(audit).includes('Rewrite the welcome'), a ? `${a.destination} ${a.model} files=${a.files.length}` : 'none');

  // ---------- Local-only mode
  await page.evaluate(() => window.__workcraftWorkspace.setFullChat(false));
  await settings('privacy');
  // The checkbox is drawn as a switch (.lo-track with a thumb on top): the click goes to the input itself
  await page.locator('[data-local-only]').check({ force: true });
  await page.waitForTimeout(1200);
  const badge = await page.locator('[data-act="local-only"]').isVisible();
  const blockedOpt = await page.locator(`.chat-provider option[value="${cloudId}"]`).getAttribute('disabled');
  const csp = await page.locator('meta[data-workcraft-local-only]').count();
  check('D1: local-only mode shows the badge and locks the browser (CSP)', badge && csp === 1, `badge=${badge} csp=${csp}`);
  check('D2: cloud endpoints are disabled in the chat', blockedOpt !== null);
  const r = await fetch(`${BASE}/api/ai/chat`, json('POST', { provider: cloudId, system: 's', turns: [{ role: 'user', content: 'x' }] }));
  check('D3: backend blocks the cloud request', /LOCAL_ONLY/.test(await r.text()));
  await shot('02-privacy');
  await page.locator('[data-local-only]').uncheck();
  await page.waitForTimeout(600);

  // ---------- Search
  await page.locator('[data-act="project-search"]').click();
  await page.fill('.gs-input', 'Umsatz');
  const hit = await page.waitForSelector('.gs .search-hit', { timeout: 10000 }).catch(() => null);
  const hits = await page.locator('.gs .search-hit').evaluateAll((els) => els.map((e) => e.getAttribute('data-source')));
  check('E1: project search finds sheets and slides for a German word', hit && hits.some((h) => h.endsWith('.xlsx')) && hits.some((h) => h.endsWith('.pptx')), hits.slice(0, 4).join(', '));
  await shot('03-search');
  await page.keyboard.press('Escape');

  // ---------- Settings pages
  await settings('health');
  await page.waitForSelector('.hc-tile[data-check="mcp"]', { timeout: 15000 });
  check('F1: health check shows backend, MCP, WebAssembly, WebGPU, service worker, Ollama', (await page.locator('.hc-tile').count()) >= 10 && (await page.locator('.hc-tile[data-check="mcp"][data-state="on"]').count()) === 1);
  await shot('04-health');

  await page.evaluate(() => {
    const ws = window.__workcraftWorkspace;
    const g = ws.panels().find((p) => p.tool === 'gridcraft');
    if (g) ws.show(g.id);
  });
  const loaded = await page.waitForFunction(() => window.__workcraftWorkspace.resources().some((r) => r.tool === 'gridcraft' && r.status === 'active' && r.res && r.res.wasm > 0), null, { timeout: 90000 }).catch(() => null);
  await settings('monitor');
  const wasmCell = await page.locator('.mon-row[data-status="active"]', { hasText: 'GridCraft' }).first().textContent().catch(() => '');
  check('F2: monitor measures the WebAssembly memory of a running app', !!loaded && /MB/.test(wasmCell || ''), (wasmCell || '').slice(0, 60));
  await page.locator('[data-action="kill-all"]').click();
  await page.locator('dialog .btn.danger').click();
  await page.waitForTimeout(800);
  const stillActive = await page.evaluate(() => window.__workcraftWorkspace.resources().filter((r) => ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft'].includes(r.tool) && r.status === 'active').length);
  check('F3: emergency stop unloads all apps', stillActive === 0, `active=${stillActive}`);
  await shot('05-monitor');

  await fetch(`${BASE}/api/files/raw?path=/notes/drop.md`, { method: 'PUT', body: 'x' });
  await fetch(`${BASE}/api/files?path=/notes/drop.md`, { method: 'DELETE' });
  await settings('trash');
  check('F4: trash lists the deleted file with restore', (await page.locator('.trash-row [data-action="restore"]').count()) >= 1);
  await page.locator('.trash-row [data-action="restore"]').first().click();
  await page.waitForTimeout(800);
  check('F5: restore from the trash brings the file back', (await fetch(`${BASE}/api/files/raw?path=/notes/drop.md`)).ok);

  await settings('history');
  check('F6: snapshots list the automatic snapshot of the AI answer', (await page.locator('.snap-row').count()) >= 1);
  check('F7: project graph lists every file with versions', (await page.locator('[data-field="graph-file"] option').count()) >= 5);
  await shot('06-history');

  await settings('share');
  await page.locator('[data-action="create-share"]').click();
  const link = await page.waitForSelector('.share-row code', { timeout: 8000 }).catch(() => null);
  check('F8: read-only link created', !!link, link ? await link.textContent() : '');
  await page.locator('[data-action="revoke-share"]').first().click().catch(() => {});

  for (const s of ['audit', 'personal', 'search', 'plugins', 'logs']) {
    await settings(s);
    const ok = (await page.locator('.sp-body .sp-section').count()) === 1 && (await page.locator('.sp-body .sp-err').count()) === 0;
    check(`F9: settings page ${s} renders`, ok);
  }
  await shot('07-logs');

  // ---------- Export formats
  const { active } = await api('/api/projects');
  for (const f of ['html', 'pdf', 'markdown']) {
    const res = await fetch(`${BASE}/api/projects/${active.id}/export/${f}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    check(`G1: export ${f}`, res.ok && bytes.byteLength > 2000 && (f === 'pdf' ? String.fromCharCode(...bytes.slice(0, 4)) === '%PDF' : bytes[0] === 0x50), `${bytes.byteLength} bytes`);
  }

  // ---------- Documentation and its assistant
  await page.goto(`${BASE}/docs/#local-only`);
  await page.waitForSelector('.d-article h1');
  check('H1: documentation page with navigation and contents', (await page.locator('.d-nav-link').count()) >= 20 && (await page.locator('.d-callout').count()) >= 1);
  await page.click('[data-act="ask"]');
  await page.fill('.d-assist textarea', 'Where are my API keys stored?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.d-msg.is-ai .d-sources', { timeout: 15000 }).catch(() => null);
  check('H2: docs assistant answers with sources', (await page.locator('.d-sources a').count()) >= 1);
  await shot('08-docs');

  check('No unhandled errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('Test run', false, e.stack || e.message);
  await shot('99-error').catch(() => {});
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
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${SHOTS}/`);
process.exit(failed.length ? 1 : 0);
