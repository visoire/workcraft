// End-to-end check of the five success criteria with Playwright (Chromium).
//
//   npm run test:e2e
//
// The test starts its own backend and Vite (ports 5186/5185) with an empty data folder plus
// an OpenAI-compatible test endpoint (port 5299) that returns scripted tool calls.
// Your real configuration under ~/workcraft stays untouched.
// The apps run with WebGL2 in the test, because headless Chromium does not render WebGPU canvases.
//
// Playwright is not a project dependency: `npm i -D playwright` or set PLAYWRIGHT_MODULE.

import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UI_PORT = 5185;
const API_PORT = 5186;
const MOCK_PORT = 5299;
const BASE = `http://127.0.0.1:${UI_PORT}`;
const SHOTS = process.env.SHOTS || 'test-results';
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

// ---------------------------------------------------------------- Test model (OpenAI-compatible)
const mockCalls = [];
/** Team Mode requests with their timing: role, start, end of the response */
const teamCalls = [];
const TEAM_ROLE = [
  ['Data & Sheet Specialist', 'grid'],
  ['Document & Copy Specialist', 'word'],
  ['Presentation Specialist', 'deck'],
  ['PDF & Compliance Specialist', 'pdf'],
  ['Code & System Specialist', 'dev'],
];
/**
 * Team Mode script: the role comes from the system prompt. The leader plans a DAG (grid, pdf and dev
 * at once; word and deck after grid), reviews every result and writes the summary; the specialists
 * call their tool once, then report. Word and deck answer slowly so their overlap is measurable.
 */
function teamScript(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = String(lastUser?.content || '');
  const after = messages.slice(messages.lastIndexOf(lastUser) + 1);
  const done = after.filter((m) => m.role === 'assistant').flatMap((m) => (m.tool_calls || []).map((c) => c.function.name));
  const slow = /SLOWTEAM/.test(text);
  if (/You break the request into tasks/.test(system)) {
    if (slow) return { role: 'leader-plan', say: JSON.stringify({ goal: 'Slow run', tasks: [{ id: 't1', title: 'Slow sheet', assignedAgent: 'grid-agent', dependencies: [], targetFiles: ['/sheets/finanzen.xlsx'], instructions: 'Read slowly' }, { id: 't2', title: 'Slow report', assignedAgent: 'word-agent', dependencies: [], targetFiles: ['/documents/bericht.docx'], instructions: 'Write slowly' }] }) };
    const plan = {
      goal: 'Quarterly package from finanzen.xlsx',
      tasks: [
        { id: 't1', title: 'Extract the Q3 figures', assignedAgent: 'grid-agent', dependencies: [], targetFiles: ['/sheets/finanzen.xlsx'], instructions: 'Read the quarterly figures of /sheets/finanzen.xlsx.' },
        { id: 't2', title: 'Update the report', assignedAgent: 'word-agent', dependencies: ['t1'], targetFiles: ['/documents/bericht.docx'], instructions: 'Write the quarterly report with the figures of t1.' },
        { id: 't3', title: 'Update the slides', assignedAgent: 'deck-agent', dependencies: ['t1'], targetFiles: ['/presentations/praesentation.pptx'], instructions: 'Three slides with the figures of t1.' },
        { id: 't4', title: 'Check the contract', assignedAgent: 'pdf-agent', dependencies: [], targetFiles: ['/pdf/contract.pdf'], instructions: 'Extract the contract text.' },
        { id: 't5', title: 'List the project', assignedAgent: 'dev-agent', dependencies: [], targetFiles: [], instructions: 'List the project files.' },
      ],
    };
    return { role: 'leader-plan', say: 'Plan:\n```json\n' + JSON.stringify(plan) + '\n```' };
  }
  if (/reviewing the work of one specialist/.test(system)) return { role: 'leader-review', say: '{"accept": true, "note": "complete"}' };
  if (/Your specialists finished their tasks/.test(system)) return { role: 'leader-synthesis', say: 'Team finished: /documents/bericht.docx and /presentations/praesentation.pptx updated with Q3 revenue 61,250.' };
  const role = TEAM_ROLE.find(([name]) => system.includes(`You are the ${name}`))?.[1];
  if (!role) return null;
  const wait = slow ? 4000 : role === 'word' || role === 'deck' ? 700 : 150;
  const direct = /Zusammenfassung/.test(text);
  const tools = {
    grid: ['read-sheet', { path: '/sheets/finanzen.xlsx', range: 'A1:E6' }],
    word: direct ? ['write-document', { path: '/documents/bericht.docx', mode: 'append', markdown: '## Zusammenfassung\n\nQ3 lag bei 61.250 Euro.' }] : ['write-document', { path: '/documents/bericht.docx', title: 'Quartalsbericht', markdown: '# Quartalsbericht\n\nQ3 revenue: 61,250 euros.\n\n- Margin stable' }],
    deck: ['create-slide', { path: '/presentations/praesentation.pptx', mode: 'replace', slides: [{ title: 'Q3 revenue', bullets: ['61,250 euros'] }, { title: 'Margin', bullets: ['stable'] }, { title: 'Next steps', bullets: ['Q4 plan'] }] }],
    pdf: ['read-pdf', { path: '/pdf/contract.pdf' }],
    dev: ['list-files', { dir: '/' }],
  };
  if (!done.length) return { role, wait, tool: tools[role] };
  return { role, wait: role === 'word' || role === 'deck' ? 300 : 50, say: role === 'grid' ? 'Q3 revenue 61,250 euros.' : `${role} task finished.` };
}

function script(messages) {
  const team = teamScript(messages);
  if (team) return team;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const idx = messages.lastIndexOf(lastUser);
  const after = messages.slice(idx + 1);
  const done = after.filter((m) => m.role === 'assistant').flatMap((m) => (m.tool_calls || []).map((c) => c.function.name));
  const lastTool = [...after].reverse().find((m) => m.role === 'tool');
  // The user's own words: attachments (<context>) and the session block (open panels, project
  // memory with earlier prompts) must not steer the scripted answers
  const text = String(lastUser?.content || '').replace(/\n\n<(context|session)>[\s\S]*?<\/\1>/g, '');
  if (/quarterly figures/.test(text)) {
    if (!done.length) return { tool: ['read-sheet', { path: '/sheets/finances.xlsx', range: 'A1:E6' }], say: 'Reading the quarterly figures. ' };
    if (done.length === 1) return { tool: ['write-document', { path: '/documents/quarterly-report.docx', title: 'Quarterly report', markdown: '# Quarterly report\n\nRevenue rose from 48,200 euros in Q1 to 66,400 euros in Q4.\n\n## Result\n\n- Annual revenue 227,150 euros\n- Result 85,100 euros\n- Margin 37.5 percent' }], say: 'Now the report. ' };
    if (done.length === 2) return { tool: ['create-slide', { path: '/presentations/quarter.pptx', mode: 'replace', slides: [{ title: 'Revenue', bullets: ['Q1 48,200', 'Q4 66,400'] }, { title: 'Result', bullets: ['85,100 euros'] }, { title: 'Outlook', bullets: ['Keep the margin'] }] }], say: 'And three slides. ' };
    return { say: 'Done: report in /documents/quarterly-report.docx and three slides in /presentations/quarter.pptx.' };
  }
  if (/forecast/.test(text)) {
    if (!done.length) return { tool: ['write-sheet', { path: '/sheets/finances.xlsx', sheet: 'Quarters', cells: { G1: 'Forecast', G2: '=B2*1.1' } }] };
    return { say: 'Forecast added in column G.' };
  }
  if (/ERRORTEST/.test(text)) {
    // The model repeats the mistake after the automatic self-correction, so the user has to step in
    if (done.length < 2) return { tool: ['write-sheet', { path: '/sheets/test.xlsx', cells: { Cell1: 5 } }] };
    return { say: lastTool && /Error/.test(lastTool.content) ? 'The call was invalid.' : 'Corrected and saved.' };
  }
  return { say: 'Hello world from the test model.' };
}
const mock = createServer((req, res) => {
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'mock-1' }, { id: 'deepseek-chat' }] }));
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    const j = JSON.parse(body);
    mockCalls.push({ auth: req.headers.authorization, model: j.model, toolChoice: j.tool_choice, tools: (j.tools || []).length, thinking: j.thinking?.type, effort: j.reasoning_effort, systems: j.messages.filter((m) => m.role === 'system').length, toolNames: (j.tools || []).map((t) => t.function.name) });
    const step = script(j.messages);
    const t0 = Date.now();
    if (step.role) mockCalls.at(-1).role = step.role;
    if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    // DeepSeek thinking mode: the chain of thought streams before the answer
    if (j.thinking?.type === 'enabled') {
      for (const part of ['Checking the ', 'request before ', 'I answer.']) {
        send({ choices: [{ delta: { reasoning_content: part } }] });
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    // Stream text in small pieces
    for (const part of (step.say || '').match(/.{1,6}/gs) || []) {
      send({ choices: [{ delta: { content: part } }] });
      await new Promise((r) => setTimeout(r, 8));
    }
    if (step.tool) {
      const args = JSON.stringify(step.tool[1]);
      const id = 'call_' + Math.random().toString(36).slice(2, 8);
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name: step.tool[0], arguments: args.slice(0, 10) } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    // Exact usage in the last chunk, like OpenAI: the IDE must show these numbers, not an estimate
    send({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 42, prompt_tokens_details: { cached_tokens: 100 } } });
    res.end('data: [DONE]\n\n');
    if (step.role) teamCalls.push({ role: step.role, start: t0, end: Date.now(), tool: step.tool?.[0], auth: req.headers.authorization, model: j.model });
  });
}).listen(MOCK_PORT, '127.0.0.1');

// ---------------------------------------------------------------- Start the stack
const HOME = mkdtempSync(join(tmpdir(), 'workcraft-e2e-'));
const stack = spawn(process.execPath, ['scripts/dev.mjs'], { env: { ...process.env, WORKCRAFT_FIRST_PROJECT: 'sample', WORKCRAFT_HOME: HOME, WORKCRAFT_PORT: String(API_PORT), WORKCRAFT_UI_PORT: String(UI_PORT) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
// Always drain both pipes: a full pipe would block the backend
stack.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(d));
stack.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
for (let i = 0; i < 150; i++) {
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (r.ok) break;
  } catch {
    /* still starting */
  }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/405|integrity|favicon/.test(m.text()) && errors.push(m.text()));
// Server errors with their address, so a failing run says which request broke
page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
await page.addInitScript(() => localStorage.setItem('workcraft.prefs', JSON.stringify({ renderer: 'webgl' })));

const ws = (fn, arg) => page.evaluate(fn, arg);
// Model and Base URL are dropdowns (Settings, AI models): choose Other and type into the field that appears. n: 0 = the first dropdown of the card
const fillChoice = async (card, n, value) => {
  await card.locator('.sp-choice select').nth(n).selectOption('__other__');
  await card.locator('.sp-choice input').nth(n).fill(value);
};

const panels = () => ws(() => window.__workcraftWorkspace.panels());
const panelOf = async (tool) => (await panels()).find((p) => p.tool === tool);
const waitFor = async (fn, ms = 20000, step = 200) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(step);
  }
};
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const api = (path, init) => page.evaluate(async ([p, i]) => (await fetch(p, i)).json(), [path, init]);
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const lastAssistant = () => page.locator('.msg[data-role="assistant"]').last();
const sendChat = async (text) => {
  const ta = page.locator('.chat-input');
  await ta.fill(text);
  await page.keyboard.press('Escape');
  await ta.press('Enter');
};
/** Waits until no app is loading (software rendering in the test blocks input otherwise). */
const settleApps = async () => {
  await waitFor(async () => (await panels()).every((p) => p.status !== 'queued' && p.status !== 'loading'), 90000, 500);
  await page.waitForTimeout(2500);
};
const waitIdle = () => waitFor(async () => (await page.locator('.chat-send.is-stop').count()) === 0 && (await page.locator('.msg.is-streaming').count()) === 0, 60000);

try {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('html.is-ready', { timeout: 30000 });
  const startPanels = await panels();
  // A new project starts on the welcome page: no app loads by itself (several engines starting together make the machine laggy)
  check('Start: the welcome page shows and no app is loaded or even created', (await page.locator('.empty-stage').count()) === 1 && startPanels.filter((p) => !['tree', 'chat'].includes(p.tool)).length === 0, startPanels.map((p) => `${p.tool}:${p.status}`).join(' '));
  check('Start: the welcome page lists the apps of the workspace and offers Open the first apps', (await page.locator('.empty-stage .empty-tool').count()) >= 4 && (await page.locator('.empty-stage [data-act="open-first"]').count()) === 1);
  // The rest of the run needs the sample apps: open them the way a user would (from the project, side by side; Deck, PDF, Code and the Terminal stay hidden)
  await ws(() => {
    const w = window.__workcraftWorkspace;
    const word = w.openPanel('wordcraft', { path: '/documents/proposal.docx', silent: true });
    w.openPanel('gridcraft', { path: '/sheets/finances.xlsx', silent: true, target: word, side: 'right', focus: false });
    w.openPanel('deckcraft', { path: '/presentations/start.pptx', mode: 'hidden', silent: true });
    w.openPanel('pdfcraft', { path: '/pdf/contract.pdf', mode: 'hidden', silent: true });
    w.openPanel('code', { path: '/code/main.js', mode: 'hidden', silent: true });
    w.openPanel('terminal', { mode: 'hidden', silent: true });
    w.focus(word, false);
    w.applyPreset('columns');
  });
  const openedPanels = await panels();
  check('Start: only visible apps load (lazy loading)', openedPanels.filter((p) => ['deckcraft', 'pdfcraft'].includes(p.tool)).every((p) => p.status === 'idle'), openedPanels.map((p) => `${p.tool}:${p.status}`).join(' '));
  await waitFor(async () => (await panelOf('gridcraft'))?.status === 'active', 40000);
  await page.waitForTimeout(4000);
  await shot('01-start');

  // ---------------------------------------------------------------- 1. @ and /
  const ta = page.locator('.chat-input');
  await ta.click();
  await ta.pressSequentially('@financ', { delay: 20 });
  await page.waitForSelector('.mention-pop:not([hidden]) .mention-item');
  const atFile = await page.locator('.mention-item').allInnerTexts();
  check('1a: @ suggests files', atFile.some((t) => t.includes('finances.xlsx')), atFile[0]?.replace(/\s+/g, ' '));
  await ta.press('Enter');
  check('1b: Enter inserts the mention', /@sheets\/finances\.xlsx /.test(await ta.inputValue()), await ta.inputValue());
  await ta.pressSequentially('@grid', { delay: 20 });
  await page.waitForSelector('.mention-pop:not([hidden]) .mention-item');
  const atApp = await page.locator('.mention-item').allInnerTexts();
  check('1c: @ suggests app panels', atApp.some((t) => /@gridcraft/.test(t) && /Panel/i.test(t)), atApp[0]?.replace(/\s+/g, ' '));
  await ta.press('ArrowDown');
  await ta.press('ArrowUp');
  await ta.press('Tab');
  await ta.fill('');
  await ta.pressSequentially('@Sample', { delay: 20 });
  await page.waitForSelector('.mention-pop:not([hidden]) .mention-item');
  const atProject = await page.locator('.mention-item').allInnerTexts();
  check('1d: @ suggests projects', atProject.some((t) => /Sample project/.test(t) && /Project/.test(t)));
  await ta.fill('');
  await ta.pressSequentially('/', { delay: 20 });
  await page.waitForSelector('.mention-pop:not([hidden]) .mention-item');
  const slash = (await page.locator('.mention-item').allInnerTexts()).join('\n');
  // The list of a bare "/" is capped at 40 entries (44 apps bring many tools): the system commands are found by typing their name
  const want = ['/read-sheet', '/write-document', '/create-slide', '/sign-pdf'];
  await ta.pressSequentially('clear', { delay: 20 });
  const slashClear = (await page.locator('.mention-item').allInnerTexts()).join('\n');
  await ta.fill('/');
  await ta.pressSequentially('export-c', { delay: 20 });
  const slashExport = (await page.locator('.mention-item').allInnerTexts()).join('\n');
  await ta.fill('/');
  check('1e: / lists MCP tools and system commands', want.every((w) => slash.includes(w)) && slashClear.includes('/clear') && slashExport.includes('/export-chat'), want.filter((w) => !slash.includes(w)).join(', ') || `${(await page.locator('.mention-item').count())} entries`);
  await shot('02-slash-popover');
  await page.keyboard.press('Escape');
  await ta.fill('');

  // ---------------------------------------------------------------- 2. DeepSeek and own endpoint
  await ws(() => document.querySelector('[data-act="settings"]').click());
  await page.waitForSelector('.sp-card[data-provider="deepseek"]', { timeout: 20000 });
  const ds = page.locator('.sp-card[data-provider="deepseek"]');
  await ds.locator('input[type="password"]').fill('sk-deepseek-test');
  // Base URL pointing at the test endpoint, so DeepSeek can be checked without internet
  await fillChoice(ds, 1, `http://127.0.0.1:${MOCK_PORT}/v1`);
  await ds.getByRole('button', { name: 'Test connection' }).click();
  await page.waitForSelector('.sp-card[data-provider="deepseek"] .sp-test[data-state="ok"]', { timeout: 15000 });
  await ds.getByRole('button', { name: 'Save' }).click();
  // The card head shows a status chip (Ready, key saved) instead of the words "set up"
  await page.waitForSelector('.sp-card[data-provider="deepseek"] .status-chip[data-state="ok"]', { timeout: 10000 });
  check('2a: DeepSeek key saved and connection tested', true);

  const nc = page.locator('.sp-card[data-provider="custom-new"]');
  await nc.locator('input').nth(0).fill('Local test model');
  await fillChoice(nc, 0, `http://127.0.0.1:${MOCK_PORT}/v1`);
  await nc.locator('input[type="password"]').fill('sk-custom');
  await fillChoice(nc, 1, 'mock-1');
  await nc.getByRole('button', { name: 'Test connection' }).click();
  await page.waitForSelector('.sp-card[data-provider="custom-new"] .sp-test[data-state="ok"]', { timeout: 15000 });
  await nc.getByRole('button', { name: 'Add' }).click();
  const customCard = page.locator('.sp-card[data-provider^="custom-"]:not([data-provider="custom-new"])');
  await customCard.waitFor({ timeout: 10000 });
  await customCard.getByRole('button', { name: 'Make default' }).click();
  await page.waitForSelector('.sp-card[data-provider^="custom-"].is-active', { timeout: 10000 });
  await shot('03-settings');
  const cfg = await api('/api/config');
  check('2b: own endpoint saved, key only masked in the frontend', cfg.ai.custom.length === 1 && cfg.ai.custom[0].hasKey && !JSON.stringify(cfg).includes('sk-custom'), cfg.ai.custom[0]?.keyHint);

  // Chat with the own endpoint
  await ws(() => window.__workcraftWorkspace.show('chat'));
  await sendChat('Hello');
  await waitIdle();
  const hello = await lastAssistant().innerText();
  check('2c: chat streams through the own endpoint', /Hello world from the test model/.test(hello) && mockCalls.at(-1)?.model === 'mock-1' && mockCalls.at(-1)?.auth === 'Bearer sk-custom', hello.slice(0, 60));
  // Chat with DeepSeek (provider choice in the chat)
  await page.selectOption('select.chat-provider', 'deepseek');
  // Pre-flight: the footer counts the next request with the V4 tokenizer before Send
  await page.locator('.chat-input').fill('Hello DeepSeek');
  const pre = await waitFor(async () => {
    const t = await page.locator('.ctx-next').innerText();
    return /\d/.test(t) && !t.includes('≈') && t;
  }, 20000);
  const prePct = await page.locator('.ctx-text').innerText();
  check('2e: footer shows the exact token count and window share before Send', !!pre && /%\s*·\s*1\.00M/.test(prePct), `${pre} ${prePct}`);
  await sendChat('Hello DeepSeek');
  await waitIdle();
  const dsCall = mockCalls.at(-1);
  check('2d: chat uses DeepSeek after choosing it', dsCall?.auth === 'Bearer sk-deepseek-test' && dsCall?.model === 'deepseek-flash' && dsCall?.thinking === 'enabled' && dsCall?.systems === 2, JSON.stringify(dsCall));
  check('2f: tool schemas in a fixed order (prefix cache)', dsCall?.toolNames.join() === [...dsCall.toolNames].sort().join(), `${dsCall?.toolNames.length} tools`);
  const thought = lastAssistant().locator('details.thought');
  const thoughtHead = await thought.locator('.thought-head').innerText().catch(() => '');
  const thoughtOpen = await thought.evaluate((d) => d.open).catch(() => null);
  check('2g: thought process card with time and tokens, collapsed after the answer', (await thought.count()) === 1 && /\d+\.\d s/.test(thoughtHead) && /\d+ tokens?/.test(thoughtHead) && thoughtOpen === false && (await thought.getAttribute('data-state')) === 'done', thoughtHead.replace(/\s+/g, ' '));
  await shot('03b-thought-process');

  // Reasoning bar in the prompt bar: effort and provider without leaving the chat
  const chip = page.locator('.chat-model-chip');
  const fromChip = async (text) => {
    await chip.click();
    await page.waitForSelector('.ctx-menu .ctx-item');
    await page.locator('.ctx-menu .ctx-item', { hasText: text }).first().click();
    await page.waitForTimeout(150);
  };
  await fromChip('thinking disabled');
  check('2h: the reasoning chip shows the mark of the provider and the effort that was chosen, not the name', (await chip.getAttribute('data-provider')) === 'deepseek' && /^Off$/.test((await chip.innerText()).trim()) && (await chip.getAttribute('data-effort')) === 'off' && (await chip.locator('svg, img').count()) >= 1, (await chip.innerText()).replace(/\s+/g, ' '));
  await sendChat('Effort off');
  await waitIdle();
  const offCall = mockCalls.at(-1);
  await fromChip('effort max');
  await sendChat('Effort max');
  await waitIdle();
  const maxCall = mockCalls.at(-1);
  check('2i: effort Off and Max reach DeepSeek (thinking disabled, reasoning_effort max)', offCall?.thinking === 'disabled' && !offCall?.effort && maxCall?.thinking === 'enabled' && maxCall?.effort === 'max', JSON.stringify([offCall?.thinking, offCall?.effort, maxCall?.thinking, maxCall?.effort]));
  await fromChip('Local test model');
  await sendChat('Hello own endpoint');
  await waitIdle();
  const ownCall = mockCalls.at(-1);
  check('2j: provider switch from the prompt bar (no effort for an own endpoint)', ownCall?.model === 'mock-1' && ownCall?.auth === 'Bearer sk-custom' && (await chip.locator('.chip-effort').count()) === 0 && (await chip.innerText()).trim() === '', (await chip.innerText()).replace(/\s+/g, ' '));
  await shot('03c-reasoning-bar');
  await page.selectOption('select.chat-provider', '');

  // ---------------------------------------------------------------- 3. Chain across apps
  const grid = await panelOf('gridcraft');
  const word = await panelOf('wordcraft');
  // Marker in the iframe: proves later that the apps were not reloaded
  await ws(() => document.querySelectorAll('.ca-frame').forEach((f, i) => (f.contentWindow.__marker = 'm' + i)));
  await sendChat('Read the quarterly figures of @finances.xlsx with @gridcraft, write a text report in @wordcraft and create three presentation slides in @deckcraft');
  await waitIdle();
  const stepsDone = await page.locator('.msg[data-role="assistant"]').last().locator('details.step[data-status="done"]').count();
  const names = await page.locator('.msg[data-role="assistant"]').last().locator('.step-name').allInnerTexts();
  check('3a: chain read-sheet, write-document, create-slide ran', stepsDone === 3 && names.join(',') === 'read-sheet,write-document,create-slide', names.join(','));
  const firstReq = mockCalls.at(-4);
  check('3b: tool definitions passed to the model', firstReq?.tools >= 15, `${firstReq?.tools} tools`);
  const wordNow = await waitFor(async () => {
    const p = (await panels()).find((x) => x.id === word.id);
    return p?.path === '/documents/quarterly-report.docx' && p;
  });
  check('3c: WordCraft shows the new report (panel reused)', !!wordNow, wordNow?.path);
  const deck = await waitFor(async () => {
    const p = await panelOf('deckcraft');
    return p?.status === 'active' && p.path === '/presentations/quarter.pptx' && p;
  }, 40000);
  check('3d: DeckCraft loaded on demand and shows the slides', !!deck, deck ? `${deck.status} ${deck.path}` : '');
  // Live update of the open sheet in GridCraft
  await sendChat('Add a forecast to @finances.xlsx');
  await waitIdle();
  const synced = await waitFor(async () => (await ws((id) => window.__workcraftWorkspace.instance(id)?.status?.(), grid.id))?.last_synced);
  check('3e: GridCraft picks up the change live', !!synced, `synced ${synced}`);
  const marker = await ws(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow?.__marker || null));
  check('3f: live sync without reloading the apps', marker.filter(Boolean).length >= 2, marker.join(','));
  await page.waitForTimeout(2500);
  await shot('04-cross-tool');

  // Error path: Zod check, pause, manual correction
  await sendChat('ERRORTEST');
  await page.waitForSelector('details.step[data-status="waiting"]', { timeout: 20000 });
  const issue = await page.locator('details.step[data-status="waiting"] .step-result').innerText();
  check('3g: Zod check stops an invalid call before it runs', /Cell/.test(issue) && /Invalid arguments/.test(issue), issue.split('\n')[1]);
  await shot('05-step-failed');
  await page.locator('details.step[data-status="waiting"] [data-action="edit"]').click();
  await page.locator('dialog.modal textarea').fill(JSON.stringify({ path: '/sheets/test.xlsx', cells: { A1: 5 } }, null, 2));
  await page.locator('dialog.modal button[type="submit"]').click();
  await waitIdle();
  const fixed = await lastAssistant().innerText();
  const fixedCard = await lastAssistant().locator('details.step').last().getAttribute('data-status');
  check('3h: editing with a correction runs the step again', fixedCard === 'done' && /Corrected/.test(fixed), fixedCard);
  const firstCard = lastAssistant().locator('details.step').first();
  check('3i: the first invalid call went back to the model for a self-correction', (await firstCard.getAttribute('data-corrected')) === '1' && (await lastAssistant().locator('details.step').count()) === 2, await firstCard.locator('.step-state').innerText());

  // One status dot per tool badge: the timeline dot left of the card, none inside it
  const dots = await lastAssistant().evaluate((m) => [...m.querySelectorAll('details.step')].map((d) => ({ inner: d.querySelectorAll('.step-dot, .step-head [class*="dot"]').length, outer: getComputedStyle(d, '::before').width, left: parseFloat(getComputedStyle(d, '::before').left) })));
  check('9a: tool call badges show a single status dot, outside the card', dots.length > 0 && dots.every((d) => d.inner === 0 && d.outer === '8px' && d.left < 0), JSON.stringify(dots));

  // ---------------------------------------------------------------- 4. Minimize, hide, maximize, scroll
  const before = await ws(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow?.__marker || null).join(','));
  await ws((id) => window.__workcraftWorkspace.minimize(id), word.id);
  await page.waitForSelector('.dock:not([hidden]) .dock-chip');
  const wMin = (await panels()).find((p) => p.id === word.id);
  check('4a: minimize puts WordCraft into the dock and pauses the render loop', wMin.mode === 'minimized' && wMin.status === 'active' && wMin.paused, `${wMin.mode} ${wMin.status} paused=${wMin.paused}`);
  await shot('06-dock');
  await page.locator('.dock-chip').first().click();
  await ws((id) => window.__workcraftWorkspace.hide(id), grid.id);
  const gHidden = (await panels()).find((p) => p.id === grid.id);
  check('4b: hide pauses GridCraft, the instance stays', gHidden.mode === 'hidden' && gHidden.status === 'active' && gHidden.paused);
  await ws((id) => window.__workcraftWorkspace.show(id), grid.id);
  await ws((id) => window.__workcraftWorkspace.toggleMaximize(id), word.id);
  const max = await panels();
  check('4c: maximize pauses covered panels', max.find((p) => p.id === grid.id).paused && !max.find((p) => p.id === word.id).paused);
  await shot('07-maximized');
  await ws((id) => window.__workcraftWorkspace.toggleMaximize(id), word.id);
  // Full screen, minimize, restore and scroll the chat
  const msgCount = await page.locator('.msg').count();
  await ws((id) => window.__workcraftWorkspace.setFullscreen(id), word.id);
  check('4d: full screen hides the top bar, the chat and the panel header', await ws(() => document.documentElement.classList.contains('is-panel-full') && getComputedStyle(document.querySelector('.topbar')).display === 'none' && getComputedStyle(document.querySelector('.zone-right')).display === 'none' && getComputedStyle(document.querySelector('.panel.is-fs .panel-head')).display === 'none'));
  await ws(() => window.__workcraftWorkspace.setFullscreen(null));
  check('4d2: full screen ends and the layout returns', await ws(() => !document.documentElement.classList.contains('is-panel-full') && !!document.querySelector('.topbar') && getComputedStyle(document.querySelector('.topbar')).display !== 'none'));
  await ws(() => window.__workcraftWorkspace.minimize('chat'));
  await ws(() => window.__workcraftWorkspace.show('chat'));
  const list = page.locator('.chat-list');
  await list.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(200);
  const top = await list.evaluate((el) => el.scrollTop);
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  check('4e: chat complete and scrollable after minimize', (await page.locator('.msg').count()) === msgCount && top === 0, `${msgCount} messages`);
  const after = await ws(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow?.__marker || null).join(','));
  check('4f: WebAssembly instances unchanged after all actions', before === after && after.includes('m'), after);
  const resumed = await panels();
  check('4g: apps visible again keep running', !resumed.find((p) => p.id === word.id).paused && !resumed.find((p) => p.id === grid.id).paused);
  // Layout persistence
  await ws((id) => window.__workcraftWorkspace.minimize(id), deck.id);
  await ws(() => window.__workcraftWorkspace.save());
  const saved = await api('/api/meta/layout');
  check('4h: layout saved with mode and sizes', saved?.panels?.[deck.id]?.mode === 'minimized' && saved.sides?.right > 0);
  await ws((id) => window.__workcraftWorkspace.show(id), deck.id);

  // ---------------------------------------------------------------- 6. Usage, dock side, Full Chat Mode, picture in picture, attachments
  const usage = await api('/api/usage');
  const mockRow = Object.values(usage.rows).find((r) => r.model === 'mock-1');
  check('6a: usage telemetry: exact tokens per provider and model', !!mockRow && mockRow.requests >= 2 && mockRow.input === mockRow.requests * 1000 && mockRow.output === mockRow.requests * 42 && mockRow.cached === mockRow.requests * 100 && mockRow.estimated === 0, JSON.stringify(mockRow));
  const footText = (await page.locator('.chat-foot').innerText()).replace(/\s+/g, ' ');
  const latency = await page.locator('.chat-badge[data-kind="latency"]').innerText();
  check('6b: chat footer with tokens and context window, latency and MCP badges', /↑ \S+ ↓ \S+/.test(footText) && /%/.test(footText) && /^\d+ ms$/.test(latency) && /^MCP · \d+$/.test((await page.locator('.chat-badge[data-kind="mcp"]').textContent()).trim()), `${footText} | ${latency}`);
  await page.locator('.chat-foot').click();
  await page.waitForSelector('.pop-card .usage-table tbody tr', { timeout: 10000 });
  check('6c: usage card from the chat with the table per model', (await page.locator('.pop-card .usage-table tbody tr').count()) >= 1);
  await page.waitForSelector('.pop-card .usage-compare tbody tr', { timeout: 10000 });
  const compare = await page.locator('.pop-card .usage-compare tbody tr').allInnerTexts();
  const ownRow = compare.find((t) => /Local test model/.test(t)) || '';
  check('6c2: providers side by side with cache hit ratio and MCP tool success', compare.length >= 2 && compare.some((t) => /DeepSeek/.test(t)) && /\d+(\.\d)?%/.test(ownRow) && /\d+\/\d+/.test(ownRow), compare.map((t) => t.replace(/\s+/g, ' ')).join(' | '));
  await page.keyboard.press('Escape');

  // Dock side in the settings, stored per browser
  const settingsId = await ws(() => window.__workcraftWorkspace.openPanel('settings'));
  await page.waitForSelector('.sp-tab[data-section="view"]', { timeout: 15000 });
  await page.locator('.sp-tab[data-section="view"]').click();
  await page.selectOption('select[data-pref="chatSide"]', 'left');
  await page.waitForTimeout(500);
  const sideOf = () => ws(() => ({ chat: Math.round(document.getElementById('zone-right').getBoundingClientRect().x), stage: Math.round(document.getElementById('stage').getBoundingClientRect().x), saved: JSON.parse(localStorage.getItem('workcraft.prefs')).chatSide }));
  const left = await sideOf();
  await page.selectOption('select[data-pref="chatSide"]', 'right');
  await page.waitForTimeout(500);
  const right = await sideOf();
  check('6d: AI chat docks left or right (Settings), the choice is stored', left.chat < left.stage && left.saved === 'left' && right.chat > right.stage && right.saved === 'right', JSON.stringify({ left, right }));

  // One custom dropdown for every select: native element hidden, button plus listbox, keyboard works
  const dd = await ws(() => {
    const sels = [...document.querySelectorAll('.sp select')];
    return { total: sels.length, native: sels.filter((s) => !s.classList.contains('oc-select-native')).length, buttons: document.querySelectorAll('.sp .oc-select').length };
  });
  const ddBtn = page.locator('.oc-select-wrap:has(select[data-pref="appDownloads"]) > .oc-select');
  const ddBefore = await ddBtn.innerText();
  await ddBtn.click();
  const ddList = await page.locator('.oc-listbox[role="listbox"]').evaluate((l) => ({ opts: l.querySelectorAll('[role="option"]').length, selected: l.querySelector('[aria-selected="true"]')?.textContent, inView: l.getBoundingClientRect().bottom <= innerHeight && l.getBoundingClientRect().top >= 0, focused: document.activeElement?.getAttribute('role') }));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const ddAfter = { label: await ddBtn.innerText(), value: await ws(() => document.querySelector('select[data-pref="appDownloads"]').value), saved: await ws(() => JSON.parse(localStorage.getItem('workcraft.prefs')).appDownloads), open: await page.locator('.oc-listbox').count() };
  // Arrow Down on the button opens the list (dispatched on the button: an app may hold the focus)
  await ddBtn.dispatchEvent('keydown', { key: 'ArrowDown', bubbles: true });
  await page.waitForSelector('.oc-listbox');
  await page.keyboard.press('Escape');
  const ddEscaped = (await page.locator('.oc-listbox').count()) === 0;
  await page.selectOption('select[data-pref="appDownloads"]', 'project');
  const ddSynced = (await ddBtn.innerText()) === ddBefore;
  check('9b: settings use the custom dropdown (keyboard, viewport, synced with the native select)', dd.total > 3 && dd.native === 0 && dd.buttons === dd.total && ddList.opts === 2 && ddList.inView && ddList.focused === 'option' && ddAfter.value === 'both' && ddAfter.saved === 'both' && ddAfter.open === 0 && ddAfter.label !== ddBefore && ddEscaped && ddSynced, JSON.stringify({ dd, ddList, ddAfter, ddEscaped, ddSynced }));
  await shot('13-dropdown');
  // Flat checkboxes with a check mark from the icon set
  const box = page.locator('input[data-pref="sounds"]');
  const boxStyle = () => box.evaluate((b) => ({ checked: b.checked, appearance: getComputedStyle(b).appearance, mark: getComputedStyle(b, '::before').transform, mask: getComputedStyle(b, '::before').maskImage || getComputedStyle(b, '::before').webkitMaskImage, bg: getComputedStyle(b).backgroundColor }));
  const off = await boxStyle();
  await box.click();
  await page.waitForTimeout(250);
  const on = await boxStyle();
  await box.click();
  await page.waitForTimeout(250);
  const offAgain = await boxStyle();
  check('9c: custom checkbox toggles with a check mark', off.appearance === 'none' && !off.checked && on.checked && /url\(/.test(on.mask) && on.mark !== off.mark && on.bg === 'rgb(51, 92, 255)' && !offAgain.checked && JSON.parse(await ws(() => localStorage.getItem('workcraft.prefs'))).sounds === false, JSON.stringify({ off, on }));
  await ws((id) => window.__workcraftWorkspace.close(id), settingsId);

  // A draft survives every view change (same panel, no reload)
  await page.locator('.chat-input').fill('draft that must survive');
  const draftOk = async () => (await page.locator('.chat-input').inputValue()) === 'draft that must survive';
  // Full Chat Mode is in the chat's own menu (the top bar has one AI button)
  await page.locator('.chat-bar [data-action="more"]').click();
  await page.locator('[role^="menuitem"]', { hasText: /Full Chat Mode/ }).first().click();
  await page.waitForTimeout(400);
  const full = await ws(() => {
    const z = document.getElementById('zone-right').getBoundingClientRect();
    const w = document.getElementById('ws').getBoundingClientRect();
    return { cls: document.documentElement.classList.contains('is-chat-full'), wide: z.width > w.width * 0.95, history: document.querySelector('.chat')?.dataset.history, current: !!document.querySelector('.hist-item.is-current') };
  });
  check('6e: Full Chat Mode from the top bar: full window, history drawer with the current chat', full.cls && full.wide && full.history === 'open' && full.current && (await draftOk()), JSON.stringify(full));
  // The open chat in the history: a quiet raised surface, no blue line or blue fill
  const histCur = await ws(() => {
    const el = document.querySelector('.hist-item.is-current');
    const cs = el && getComputedStyle(el);
    return cs ? { bg: cs.backgroundColor, shadow: cs.boxShadow, border: cs.borderColor } : null;
  });
  check('9f: subtle active state in the chat history', !!histCur && histCur.shadow === 'none' && !/51, 92, 255/.test(JSON.stringify(histCur)) && histCur.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(histCur));

  // Reasoning bar in Full Chat Mode: DeepSeek with effort Low, then back to the default provider
  const fullChip = page.locator('.chat-model-chip');
  const pickFull = async (text) => {
    await fullChip.click();
    await page.waitForSelector('.ctx-menu .ctx-item');
    await page.locator('.ctx-menu .ctx-item', { hasText: text }).first().click();
    await page.waitForTimeout(150);
  };
  await pickFull('DeepSeek');
  await pickFull('effort low');
  await sendChat('Hello in Full Chat');
  await waitIdle();
  const fullCall = mockCalls.at(-1);
  check('6e2: Full Chat Mode switches provider and effort (DeepSeek, effort low)', fullCall?.model === 'deepseek-flash' && fullCall?.thinking === 'enabled' && fullCall?.effort === 'low' && /DeepSeek/.test((await fullChip.getAttribute('title')) || '') && (await fullChip.getAttribute('data-effort')) === 'low', JSON.stringify({ model: fullCall?.model, thinking: fullCall?.thinking, effort: fullCall?.effort, chip: await fullChip.getAttribute('title'), text: (await fullChip.innerText()).trim() }));
  await pickFull('Automatic');
  await page.locator('.chat-input').fill('draft that must survive');

  // Floating GridCraft above Full Chat Mode, dragged, snapped and resized
  const markers6 = await ws(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow?.__marker || null).join(','));
  await ws((id) => window.__workcraftWorkspace.togglePip(id, true), grid.id);
  await page.waitForTimeout(600);
  const pipInfo = () => ws((id) => {
    const el = document.querySelector(`.panel[data-id="${id}"]`);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 20);
    return { pip: el.classList.contains('is-pip'), fixed: getComputedStyle(el).position === 'fixed', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), onTop: el.contains(hit) };
  }, grid.id);
  const pr0 = await pipInfo();
  check('6f: GridCraft floats above Full Chat Mode', pr0.pip && pr0.fixed && pr0.onTop, JSON.stringify(pr0));
  const nameBox = await page.locator(`.panel[data-id="${grid.id}"] .panel-name`).boundingBox();
  await page.mouse.move(nameBox.x + 5, nameBox.y + 5);
  await page.mouse.down();
  await page.mouse.move(nameBox.x + 5 - (pr0.x - 30), nameBox.y + 5 - (pr0.y - 30), { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const pr1 = await pipInfo();
  check('6g: floating window dragged by its header snaps to the corner', pr1.x === 12 && pr1.y === 12, JSON.stringify(pr1));
  const se = await page.locator(`.panel[data-id="${grid.id}"] .pip-h[data-dir="se"]`).boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2 + 120, se.y + se.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const pr2 = await pipInfo();
  check('6h: resized at the corner handle', Math.abs(pr2.w - pr1.w - 120) <= 2 && Math.abs(pr2.h - pr1.h - 60) <= 2, JSON.stringify({ pr1, pr2 }));
  // Full Chat Mode is in the chat's own menu (the top bar has one AI button)
  await page.locator('.chat-bar [data-action="more"]').click();
  await page.locator('[role^="menuitem"]', { hasText: /Full Chat Mode/ }).first().click();
  await page.waitForTimeout(300);
  await ws((id) => window.__workcraftWorkspace.togglePip(id, false), grid.id);
  await page.waitForTimeout(600);
  const back = (await panels()).find((p) => p.id === grid.id);
  const markers6b = await ws(() => [...document.querySelectorAll('.ca-frame')].map((f) => f.contentWindow?.__marker || null).join(','));
  check('6i: back into the layout, the app was never reloaded', !back.pip && back.visible && markers6 === markers6b && (await draftOk()), `${markers6} -> ${markers6b}`);

  // The chat itself as a floating window
  await ws(() => window.__workcraftWorkspace.togglePip('chat', true));
  await page.waitForTimeout(300);
  const chatPip = await ws(() => {
    const el = document.querySelector('.panel[data-tool="chat"]');
    return { pip: el.classList.contains('is-pip'), fixed: getComputedStyle(el).position === 'fixed', zone: Math.round(document.getElementById('zone-right').getBoundingClientRect().width) };
  });
  check('6j: AI chat as a floating window, draft kept', chatPip.pip && chatPip.fixed && chatPip.zone === 0 && (await draftOk()), JSON.stringify(chatPip));
  await ws(() => window.__workcraftWorkspace.togglePip('chat', false));
  await page.locator('.chat-input').fill('');

  // Attachments: file picker, preview card, saved into the project, mentioned in the message
  await page.locator('.chat-composer input[type=file]').setInputFiles({ name: 'region data.csv', mimeType: 'text/csv', buffer: Buffer.from('Region,Revenue\nNorth,1200\nSouth,900\n') });
  await page.waitForSelector('.att-card', { timeout: 5000 });
  const card = (await page.locator('.att-card').innerText()).replace(/\s+/g, ' ');
  await sendChat('Summarize the attached file');
  // The files are saved first, then the message goes out
  const sentText = (await waitFor(async () => {
    const t = await page.locator('.msg[data-role="user"]').last().innerText();
    return /attachments/.test(t) && t;
  }, 15000)) || '';
  await waitIdle();
  const stored = (await api('/api/files/tree')).entries.some((e) => e.path === '/attachments/region-data.csv');
  check('6k: attachment preview, saved under /attachments and sent as a mention', /CSV/.test(card) && /North/.test(card) && /@attachments\/region-data\.csv/.test(sentText) && stored, card);

  // Standalone route /?mode=chat with the welcome screen
  const p2page = await ctx.newPage();
  await p2page.goto(`${BASE}/?mode=chat`);
  await p2page.waitForSelector('html.is-ready', { timeout: 30000 });
  await p2page.locator('.chat-bar [data-action="new"]').click();
  await p2page.waitForSelector('.chat-welcome', { timeout: 10000 });
  const route = await p2page.evaluate(() => ({ full: document.documentElement.classList.contains('is-chat-full'), view: window.__workcraftWorkspace.instance('chat')?.status?.().view, cards: document.querySelectorAll('.welcome-card').length }));
  // The empty chat is a greeting and one quiet line: no cards, no canned tasks
  const greet = await p2page.evaluate(() => ({ cards: document.querySelectorAll('.welcome-card, .welcome-cards, .chat-example').length, title: document.querySelector('.chat-welcome h2')?.textContent?.trim(), hint: document.querySelector('.chat-welcome .chat-hint')?.textContent?.trim() }));
  check('6l: /?mode=chat opens Full Chat Mode with a short greeting and no option cards', route.full && route.view === 'full' && greet.cards === 0 && /What are you working on\?/.test(greet.title || '') && !!greet.hint, JSON.stringify({ route, greet }));
  await p2page.close();

  // Real terminal in the project folder (node-pty or line mode)
  const termId = await ws(() => window.__workcraftWorkspace.openPanel('terminal'));
  await page.waitForSelector('.tm .xterm-screen', { timeout: 20000 });
  // Maximize, so the whole output stays in the visible rows
  await ws((id) => window.__workcraftWorkspace.toggleMaximize(id), termId);
  await page.waitForTimeout(500);
  // Wait for the prompt (PowerShell, cmd.exe or sh): the machine is busy with four apps
  await waitFor(async () => /[>$#]\s*$/.test((await page.locator('.tm .xterm-rows').innerText()).trim()), 20000);
  await page.locator('.tm .xterm').click();
  // The shell has to compute 42 itself (the typed line does not contain it). Windows: PowerShell.
  if (process.platform === 'win32') {
    await page.keyboard.type('Write-Output ("workcraft-" + (40+2)); Get-ChildItem sheets -Name');
  } else {
    await page.keyboard.type('echo workcraft-$((40+2)) && ls sheets');
  }
  await page.keyboard.press('Enter');
  const termOut = await waitFor(async () => {
    const t = (await page.locator('.tm .xterm-rows').innerText()).replace(/\n/g, '');
    return /workcraft-42/.test(t) && /finances\.xlsx/.test(t) && t;
  }, 15000);
  const termText = termOut || (await page.locator('.tm .xterm-rows').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(-240);
  check('Terminal: real shell in the project folder', !!termOut, termOut ? '' : termText);
  if (!termOut) await shot('09-terminal');
  await ws((id) => window.__workcraftWorkspace.close(id), termId);

  // ---------------------------------------------------------------- 7. Team Mode (multi-agent orchestrator)
  const HEX = { leader: '#335CFF', grid: '#10B981', word: '#3B82F6', deck: '#F97316', pdf: '#14B8A6', dev: '#335CFF' };
  const accentOf = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((el) => [el.dataset.role, getComputedStyle(el).getPropertyValue('--agent').trim().toUpperCase()]), sel);
  // German test files: copies of the sample sheet, document and deck
  for (const [from, to] of [['/sheets/finances.xlsx', '/sheets/finanzen.xlsx'], ['/documents/proposal.docx', '/documents/bericht.docx'], ['/presentations/start.pptx', '/presentations/praesentation.pptx']]) {
    await page.evaluate(async ([a, b]) => {
      const bytes = await (await fetch(`/api/files/raw?path=${encodeURIComponent(a)}`)).arrayBuffer();
      await fetch(`/api/files/raw?path=${encodeURIComponent(b)}`, { method: 'PUT', body: bytes });
    }, [from, to]);
  }
  await waitFor(async () => (await api('/api/files/tree')).entries.some((e) => e.path === '/presentations/praesentation.pptx'));
  // Open the report and the deck, so both panels can update live side by side
  await ws(() => window.__workcraftWorkspace.openFile('/documents/bericht.docx', 'wordcraft'));
  await ws(() => window.__workcraftWorkspace.openFile('/presentations/praesentation.pptx', 'deckcraft'));
  const docPanel = await waitFor(async () => (await panels()).find((p) => p.tool === 'wordcraft' && p.path === '/documents/bericht.docx' && p.status === 'active'), 60000);
  const deckPanel = await waitFor(async () => (await panels()).find((p) => p.tool === 'deckcraft' && p.path === '/presentations/praesentation.pptx' && p.status === 'active'), 60000);
  await settleApps();
  const syncBefore = await ws((ids) => ids.map((id) => window.__workcraftWorkspace.instance(id)?.status?.()?.last_synced || null), [docPanel?.id, deckPanel?.id]);
  // Record every agent badge that appears on a panel (they fade after a few seconds)
  await page.evaluate(() => {
    window.__agentFlashes = [];
    new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target.nodeType === 1 ? m.target.closest?.('.panel') : null;
        const tag = el?.querySelector('.panel-agent');
        if (tag && !tag.hidden) window.__agentFlashes.push({ tool: el.dataset.tool, accent: getComputedStyle(tag).getPropertyValue('--agent').trim().toUpperCase(), state: tag.dataset.state, role: tag.dataset.role });
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-agent', 'data-state', 'hidden'] });
  });

  // @ and / autocomplete know the team
  const input = page.locator('.chat-input');
  const popTexts = async (typed) => {
    await input.fill('');
    await input.click();
    await input.pressSequentially(typed, { delay: 20 });
    await page.waitForSelector('.mention-pop:not([hidden]) .mention-item');
    return page.locator('.mention-item').allInnerTexts();
  };
  const atAgent = await popTexts('@grid-a');
  const atTeam = await popTexts('@te');
  const slashRoster = await popTexts('/ro');
  const slashTeam = await popTexts('/tea');
  await page.keyboard.press('Escape');
  await input.fill('');
  check('7a: @ suggests @team and the specialists, / suggests /team and /roster', atAgent.some((t) => /@grid-agent/.test(t) && /agent/i.test(t)) && atTeam.some((t) => /@team/.test(t)) && slashRoster.some((t) => /\/roster/.test(t)) && slashTeam.some((t) => /\/team/.test(t)), [atAgent[0], atTeam[0], slashRoster[0], slashTeam[0]].map((t) => t?.replace(/\s+/g, ' ')).join(' | '));

  // Switch to Team Mode in the chat header, pick the Team Leader and the specialists in the roster
  await page.locator('[data-action="mode-team"]').click();
  const modeOn = await ws(() => ({ mode: document.querySelector('.chat')?.dataset.mode, pressed: document.querySelector('[data-action="mode-team"]')?.getAttribute('aria-pressed'), roster: !document.querySelector('.chat-roster')?.hidden, saved: JSON.parse(localStorage.getItem('workcraft.prefs')).chatMode }));
  check('7b: Team Mode switch in the chat header', modeOn.mode === 'team' && modeOn.pressed === 'true' && modeOn.roster && modeOn.saved === 'team', JSON.stringify(modeOn));
  // The same switch in Full Chat Mode and in the floating (picture-in-picture) chat
  const switchVisible = () => ws(() => {
    const el = document.querySelector('.chat-mode');
    const r = el?.getBoundingClientRect();
    return !!r && r.width > 0 && r.height > 0 && document.querySelector('[data-action="mode-team"]')?.getAttribute('aria-pressed') === 'true';
  });
  await ws(() => window.__workcraftWorkspace.setFullChat(true));
  await page.waitForTimeout(300);
  const inFull = await switchVisible();
  await ws(() => window.__workcraftWorkspace.setFullChat(false));
  await ws(() => window.__workcraftWorkspace.togglePip('chat', true));
  await page.waitForTimeout(300);
  const inPip = await switchVisible();
  await ws(() => window.__workcraftWorkspace.togglePip('chat', false));
  await page.waitForTimeout(300);
  check('7b2: the mode switch is there in Full Chat Mode and in the floating chat', inFull && inPip, JSON.stringify({ inFull, inPip }));
  await page.locator('.chat-roster').click();
  await page.waitForSelector('.pop-card .team-editor');
  await page.selectOption('.pop-card select[data-field="preset"]', 'studio');
  await page.waitForTimeout(300);
  const customId = (await api('/api/config')).ai.custom[0].id;
  await page.selectOption('.pop-card .team-member[data-role="leader"] select[data-field="provider"]', customId);
  await page.selectOption('.pop-card .team-member[data-role="leader"] select[data-field="effort"]', 'high');
  // Mixed providers: the Presentation Specialist runs on DeepSeek, the rest on the chat model
  await page.selectOption('.pop-card .team-member[data-role="deck"] select[data-field="provider"]', 'deepseek');
  await page.waitForTimeout(700);
  const rosterAccents = await accentOf('.pop-card .team-member');
  await shot('10-team-roster');
  await page.keyboard.press('Escape');
  const teamCfg = (await api('/api/config')).team?.active;
  check('7c: roster: Team Leader and five specialists in their role accents, saved in the backend', rosterAccents.length === 6 && rosterAccents.every(([r, a]) => HEX[r] === a) && teamCfg?.leader.provider === customId && teamCfg?.leader.effort === 'high' && teamCfg?.workers.find((w) => w.role === 'deck')?.provider === 'deepseek' && teamCfg.workers.every((w) => w.enabled), JSON.stringify({ rosterAccents, leader: teamCfg?.leader }));

  // The team run: GridCraft reads @finanzen.xlsx, then WordCraft and DeckCraft write in parallel
  const callsBefore = teamCalls.length;
  await sendChat('Build the quarterly package: read @finanzen.xlsx, update @bericht.docx and @praesentation.pptx');
  await page.waitForSelector('.team-mc', { timeout: 20000 });
  const runningLabel = await waitFor(async () => (await page.locator('.team-mc .team-phase').last().innerText().catch(() => '')).match(/Delegating \(\d+ active\)/)?.[0], 20000, 50);
  await waitFor(async () => (await page.locator('.team-worker[data-status="running"]').count()) >= 2, 20000, 50);
  await shot('11-team-running');
  await waitIdle();
  const calls = teamCalls.slice(callsBefore);
  const span = (role) => {
    const c = calls.filter((x) => x.role === role);
    return c.length ? { start: Math.min(...c.map((x) => x.start)), end: Math.max(...c.map((x) => x.end)), n: c.length } : null;
  };
  const [g, w, d, pdfS, dev] = ['grid', 'word', 'deck', 'pdf', 'dev'].map(span);
  const parallel = !!(g && w && d && pdfS && dev) && w.start >= g.end && d.start >= g.end && w.start < d.end && d.start < w.end && pdfS.start < g.end && g.start < pdfS.end;
  check('7d: task DAG: grid, pdf and dev at once, then word and deck in parallel after grid', parallel && !!runningLabel, JSON.stringify({ g, w, d, pdf: pdfS, dev, runningLabel }));
  const mc = await ws(() => {
    const el = [...document.querySelectorAll('.team-mc')].at(-1);
    return {
      phase: el.dataset.phase,
      label: el.querySelector('.team-phase').textContent,
      lead: getComputedStyle(el.querySelector('.team-lead-badge')).backgroundColor,
      workers: [...el.querySelectorAll('.team-worker')].map((c) => [c.dataset.role, c.dataset.status, getComputedStyle(c).getPropertyValue('--agent').trim().toUpperCase()]),
      nodes: el.querySelectorAll('.team-node').length,
      usage: [...el.querySelectorAll('.team-usage tbody tr')].map((r) => r.dataset.role),
      text: el.closest('.msg').querySelector('.msg-body').innerText,
    };
  });
  check('7e: Mission Control: leader bar in #335CFF, five worker cards in their accents, task graph, completed', mc.phase === 'completed' && mc.label === 'Completed' && mc.lead === 'rgb(51, 92, 255)' && mc.workers.length === 5 && mc.workers.every(([r, st, a]) => st === 'done' && HEX[r] === a) && mc.nodes === 5 && /bericht\.docx/.test(mc.text), JSON.stringify(mc));
  check('7f: telemetry per role (leader and each specialist)', ['leader', 'grid', 'word', 'deck', 'pdf', 'dev'].every((r) => mc.usage.includes(r)), mc.usage.join(','));
  const deckCalls = calls.filter((c) => c.role === 'deck');
  const leadCalls = calls.filter((c) => c.role.startsWith('leader'));
  check('7g: mixed providers: leader on the own endpoint, the Presentation Specialist on DeepSeek', deckCalls.length >= 2 && deckCalls.every((c) => c.auth === 'Bearer sk-deepseek-test' && c.model === 'deepseek-flash') && leadCalls.length >= 1 && leadCalls.every((c) => c.auth === 'Bearer sk-custom'), JSON.stringify({ deck: deckCalls.map((c) => c.model), lead: leadCalls.length }));
  // Live workspace sync: both open panels flashed in the sub-agent's accent and reloaded the file
  const syncAfter = await waitFor(async () => {
    const s2 = await ws((ids) => ids.map((id) => window.__workcraftWorkspace.instance(id)?.status?.()?.last_synced || null), [docPanel?.id, deckPanel?.id]);
    return s2.every((x, i) => x && x !== syncBefore[i]) && s2;
  }, 20000);
  const flashes = await page.evaluate(() => window.__agentFlashes);
  const flashed = (tool, hex) => flashes.some((f) => f.tool === tool && f.accent === hex);
  const writes = await ws((ids) => ids.map((id) => document.querySelector(`.panel[data-id="${id}"]`)?.dataset.agentWrites || '0'), [docPanel?.id, deckPanel?.id]);
  check('7h: open WordCraft and DeckCraft panels flash the agent accent and update live', flashed('wordcraft', HEX.word) && flashed('deckcraft', HEX.deck) && !!syncAfter && writes.every((n) => Number(n) >= 1), JSON.stringify({ flashes: flashes.slice(0, 6), writes, syncAfter }));
  await shot('12-team-done');

  // Sub-thread inspection: the worker card opens into its tool calls and report
  await page.locator('.team-mc').last().locator('.team-worker[data-role="word"] summary').click();
  await page.waitForSelector('.team-worker[data-role="word"][open] .team-steps li');
  const sub = await page.locator('.team-worker[data-role="word"][open] .team-worker-body').last().innerText();
  check('7i: worker card shows the sub-thread (tool calls, report)', /write-document/.test(sub) && /finished/.test(sub), sub.replace(/\s+/g, ' ').slice(0, 160));

  // Direct addressing: @word-agent works alone, without a plan
  const plansBefore = teamCalls.filter((c) => c.role === 'leader-plan').length;
  const cardsBefore = await page.locator('.team-mc').count();
  await sendChat('@word-agent Add a Zusammenfassung to @bericht.docx');
  await waitFor(async () => (await page.locator('.team-mc').count()) > cardsBefore, 20000, 50);
  await waitIdle();
  const directMc = await ws(() => {
    const el = [...document.querySelectorAll('.team-mc')].at(-1);
    return { workers: [...el.querySelectorAll('.team-worker')].map((c) => [c.dataset.role, c.dataset.status]), phase: el.dataset.phase };
  });
  check('7j: @word-agent addresses one specialist directly (no planning)', directMc.phase === 'completed' && directMc.workers.length === 1 && directMc.workers[0][0] === 'word' && directMc.workers[0][1] === 'done' && teamCalls.filter((c) => c.role === 'leader-plan').length === plansBefore && teamCalls.at(-1)?.tool === undefined && teamCalls.some((c) => c.role === 'word' && c.tool === 'write-document' && c.start > (teamCalls.find((x) => x.role === 'leader-synthesis')?.end || 0)), JSON.stringify(directMc));

  // Cancel one worker, then Stop All: the other streams end cleanly
  const cardsBefore2 = await page.locator('.team-mc').count();
  await sendChat('SLOWTEAM run two slow workers');
  await waitFor(async () => (await page.locator('.team-mc').count()) > cardsBefore2, 20000, 50);
  await waitFor(async () => (await page.locator('.team-mc').last().locator('.team-worker[data-status="running"]').count()) === 2, 20000, 50);
  await page.locator('.team-mc').last().locator('.team-worker[data-role="grid"] [data-action="team-cancel"]').click();
  const oneCancelled = await waitFor(async () => (await page.locator('.team-mc').last().locator('.team-worker[data-role="grid"]').getAttribute('data-status')) === 'cancelled', 5000, 50);
  const otherRuns = (await page.locator('.team-mc').last().locator('.team-worker[data-role="word"]').getAttribute('data-status')) === 'running';
  await page.locator('.team-mc').last().locator('[data-action="team-stop"]').click();
  await waitIdle();
  const stopped = await ws(() => {
    const el = [...document.querySelectorAll('.team-mc')].at(-1);
    return { phase: el.dataset.phase, label: el.querySelector('.team-phase').textContent, workers: [...el.querySelectorAll('.team-worker')].map((c) => c.dataset.status) };
  });
  check('7k: Cancel Worker stops one sub-agent, Stop All Agents ends the rest', !!oneCancelled && otherRuns && stopped.phase === 'stopped' && stopped.workers.every((x) => x === 'cancelled'), JSON.stringify({ stopped, oneCancelled, otherRuns }));

  // Back to Single Agent Mode for the rest of the run
  await page.locator('[data-action="mode-single"]').click();

  // ---------------------------------------------------------------- 5. Projects and chat export
  // A narrow chat hides the Export button in its header; then Export chat sits in the ⋮ menu
  const openExport = async () => {
    const direct = page.locator('.chat-bar [data-action="export"]');
    if (await direct.isVisible()) return direct.click();
    await page.locator('.chat-bar [data-action="more"]').click();
    await page.getByRole('menuitem', { name: /Export chat/ }).click();
  };
  const [mdDl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await openExport();
    await page.getByRole('menuitem', { name: /Markdown/ }).click();
  })()]);
  const md = readFileSync(await mdDl.path(), 'utf8');
  check('5a: chat export as Markdown with tool parameters', /read-sheet/.test(md) && /"path": "\/sheets\/finances\.xlsx"/.test(md), mdDl.suggestedFilename());
  const [jsonDl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await openExport();
    await page.getByRole('menuitem', { name: /JSON/ }).click();
  })()]);
  const cj = JSON.parse(readFileSync(await jsonDl.path(), 'utf8'));
  const allSteps = cj.messages.flatMap((m) => m.steps || []);
  check('5b: chat export as JSON with parameters', cj.format === 'workcraft-chat' && allSteps.some((s) => s.name === 'create-slide' && s.args.slides.length === 3), `${cj.messages.length} messages`);
  const teamMsg = cj.messages.find((m) => m.team && m.team.state.tasks.length === 5);
  check('7l: export includes the multi-agent sub-threads (JSON and Markdown)', !!teamMsg && Object.keys(teamMsg.team.threads).length === 5 && Object.values(teamMsg.team.threads).every((t) => t.some((m) => m.role === 'assistant' && m.steps?.length)) && Object.keys(teamMsg.team.state.usage).length === 6 && /Team Mission Control/.test(md) && /Sub-agent Presentation Specialist/.test(md) && /\| Role \| Model \|/.test(md), teamMsg ? Object.keys(teamMsg.team.threads).join(',') : 'no team message');

  // New project through the project switcher
  await page.locator('.tree-project').click();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  await page.locator('dialog.modal input[name="name"]').fill('Test project E2E');
  await page.locator('dialog.modal button[type="submit"]').click();
  await page.locator('dialog.modal button', { hasText: 'Empty' }).click();
  const switched = await waitFor(async () => (await page.locator('.tree-project-name').innerText()) === 'Test project E2E', 20000);
  const p2 = await api('/api/projects');
  check('5c: project created and switched', !!switched && p2.active.name === 'Test project E2E' && p2.projects.length === 2);
  check('5d: chat of the new project is empty', (await page.locator('.msg').count()) === 0);
  // An empty project offers the sample data as a project of its own
  const offer = await waitFor(async () => (await page.locator('[data-tree-empty] [data-load-sample]').count()) === 1, 10000);
  check('5d2: an empty project offers Load sample data', !!offer);
  await page.locator('[data-load-sample]').click();
  const toSample = await waitFor(async () => (await page.locator('.tree-project-name').innerText()) === 'Sample project', 20000);
  const p3 = await api('/api/projects');
  check('5d3: Load sample data opens the existing sample project, no second copy', !!toSample && p3.active.name === 'Sample project' && p3.projects.length === 2, `${p3.active.name}, ${p3.projects.length} projects`);
  // Export the sample project and import it as a new project
  const sample = p2.projects.find((p) => p.name === 'Sample project');
  const zipBytes = await page.evaluate(async (id) => Array.from(new Uint8Array(await (await fetch(`/api/projects/${id}/export`)).arrayBuffer())), sample.id);
  check('5e: export as ZIP', zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, `${zipBytes.length} bytes`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => {
    await page.locator('.tree-project').click();
    await page.getByRole('menuitem', { name: /Import project/ }).click();
  })()]);
  await chooser.setFiles({ name: 'sample-copy.zip', mimeType: 'application/zip', buffer: Buffer.from(zipBytes) });
  const imported = await waitFor(async () => (await page.locator('.tree-project-name').innerText()) === 'Sample project' && (await api('/api/projects')).projects.length === 3, 20000);
  const chats = await api('/api/chats');
  check('5f: import by ZIP including chats', !!imported && chats.length >= 1, `${chats.length} chats in the imported project`);
  await settleApps();
  // Import by drag and drop onto the workspace
  await page.evaluate(async (bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'dragged.zip', { type: 'application/zip' }));
    const target = document.querySelector('.stage');
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, zipBytes);
  const dropped = await waitFor(async () => (await api('/api/projects')).projects.length === 4, 20000);
  check('5g: import by drag and drop', !!dropped);
  await settleApps();
  // Delete with confirmation (the name has to be typed)
  const active = (await api('/api/projects')).active;
  // A right click on the project button opens everything that can be done with the project (a click opens the switcher)
  await page.locator('.tree-project').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  await page.locator('dialog.modal input[name="confirm"]').fill('wrong');
  await page.locator('dialog.modal button[type="submit"]').click();
  const refused = await page.locator('dialog.modal .dlg-error:not([hidden])').count();
  await page.locator('dialog.modal input[name="confirm"]').fill(active.name);
  await page.locator('dialog.modal button[type="submit"]').click();
  const deleted = await waitFor(async () => {
    const l = await api('/api/projects');
    return l.projects.length === 3 && !l.projects.some((p) => p.id === active.id) && l;
  }, 20000);
  check('5h: delete only after confirming with the project name', refused === 1 && !!deleted);
  await page.waitForTimeout(1500);
  await shot('08-projects');

  // Error display: plain text with an action
  await page.selectOption('select.chat-provider', 'anthropic').catch(() => {});
  const fallback = await page.locator('select.chat-provider option[value="anthropic"]').getAttribute('disabled');
  check('Errors: a provider without a key is disabled in the chat', fallback !== null);

  // ---------------------------------------------------------------- 9. Rail and command palette
  const rail = await ws(() => { const n = document.getElementById('activity'); return { chat: n.querySelectorAll('[data-tool="chat"], .act-btn [data-icon="spark"]').length, settingsInRail: n.querySelectorAll('[data-tool="settings"]').length, settingsTop: document.querySelectorAll('.top-actions [data-act="settings"]').length, last: [...n.children].at(-1)?.dataset.tool || '' }; });
  check('9d: no AI star button in the tool rail; Settings is in the top bar, the rail ends with the Terminal', rail.chat === 0 && rail.settingsInRail === 0 && rail.settingsTop === 1 && rail.last === 'terminal', JSON.stringify(rail));
  await page.keyboard.press('Escape');
  await ws(() => document.querySelector('[data-act="search"]').click());
  await page.waitForSelector('.pal-list .pal-item');
  const pal = await ws(() => {
    const l = document.querySelector('.pal-list');
    const d = document.querySelector('dialog.pal-dialog')?.getBoundingClientRect();
    const before = l.scrollTop;
    l.scrollTop = 400;
    return { items: l.querySelectorAll('.pal-item').length, scrollable: l.scrollHeight > l.clientHeight, overflow: getComputedStyle(l).overflowY, scrolled: l.scrollTop > before, max: getComputedStyle(l).maxHeight, inView: !!d && d.bottom <= innerHeight && d.top >= 0 };
  });
  check('9e: command palette results scroll inside the modal', pal.items > 15 && pal.scrollable && pal.overflow === 'auto' && pal.scrolled && pal.max !== 'none' && pal.inView, JSON.stringify(pal));
  await shot('14-palette');
  const apps = await ws(() => [...document.querySelectorAll('.pal-item')].map((i) => i.textContent.trim()).filter((x) => /^Open (WordCraft|GridCraft|DeckCraft|PdfCraft|PhotoCraft|SoundCraft)/.test(x)));
  check('9f: the search does not list the apps (the + menu and the rail do): no "Open <app>" entries', apps.length === 0, JSON.stringify(apps));
  await page.keyboard.press('Escape');
  await ws(() => document.querySelector('[data-act="add"]').click());
  await page.waitForSelector('.ctx-menu .ctx-item');
  const plus = await ws(() => [...document.querySelectorAll('.ctx-menu .ctx-item')].map((i) => i.textContent.trim()));
  check('9g: the + menu offers Upload files on a computer (Scan a document only on an iPad)', plus.some((x) => /^Upload files/.test(x)) && !plus.some((x) => /^Scan a document/.test(x)), JSON.stringify(plus));

  // ---------------------------------------------------------------- 10. New files, main menu
  await page.keyboard.press('Escape');
  await ws(() => document.querySelector('[data-action="new-file"]').click());
  await page.waitForSelector('.ctx-menu .ctx-item');
  const newMenu = await ws(() => [...document.querySelectorAll('.ctx-menu .ctx-item')].map((b) => ({ t: b.textContent.trim().replace(/\s+/g, ' '), mark: !!b.querySelector('img,svg') })));
  check('10a: New file lists the four apps, each with its mark', ['Document', 'Spreadsheet', 'Presentation', 'PDF'].every((n) => newMenu.some((m) => m.t.startsWith(n) && m.mark)), JSON.stringify(newMenu.slice(0, 4)));
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Spreadsheet' }).first().click();
  await page.locator('dialog.modal input[name="v"]').fill('fahrschule.xlsx');
  await page.locator('dialog.modal button[type="submit"]').click();
  const made = await waitFor(async () => (await api('/api/files/tree')).entries.find((e) => e.path.endsWith('/fahrschule.xlsx') && e.size > 100), 10000);
  check('10b: a new .xlsx is a real package, not 0 bytes', !!made, JSON.stringify(made));
  const menuBtn = page.locator('[data-act="menu"]');
  await menuBtn.click();
  await page.waitForSelector('.ctx-menu .ctx-item');
  const opened = await ws(() => ({ expanded: document.querySelector('[data-act="menu"]').getAttribute('aria-expanded'), closeMark: document.querySelector('[data-act="menu"] svg path')?.getAttribute('d') }));
  const kbdRights = await ws(() => [...new Set([...document.querySelectorAll('.ctx-menu .ctx-item kbd')].map((k) => Math.round(k.getBoundingClientRect().right)))]);
  check('10c: the menu button shows a close mark while open, shortcuts end in one column', opened.expanded === 'true' && opened.closeMark === 'M6 6l12 12M18 6L6 18' && kbdRights.length === 1, JSON.stringify({ ...opened, kbdRights }));
  await menuBtn.click();
  await page.waitForTimeout(250);
  const closed = await ws(() => ({ menus: document.querySelectorAll('.ctx-menu').length, expanded: document.querySelector('[data-act="menu"]').getAttribute('aria-expanded') }));
  check('10d: the same button closes the menu again', closed.menus === 0 && closed.expanded === 'false', JSON.stringify(closed));
  await page.keyboard.press('Escape');

  // ---------------------------------------------------------------- 11. Panel context menus (header, tab, rail icon, long press)
  {
    await page.keyboard.press('Escape');
    // GridCraft with its sample sheet, visible and running
    await ws(() => {
      const w = window.__workcraftWorkspace;
      const g = w.panels().find((p) => p.tool === 'gridcraft');
      if (!g) w.openPanel('gridcraft', { path: '/sheets/finances.xlsx', silent: true });
      else w.show(g.id);
    });
    await waitFor(async () => (await ws(() => window.__workcraftWorkspace.panels().some((p) => p.tool === 'gridcraft' && p.status === 'active' && p.mode === 'normal'))), 60000, 500);
    const gid = await ws(() => window.__workcraftWorkspace.panels().find((p) => p.tool === 'gridcraft').id);
    const gpath = await ws(() => window.__workcraftWorkspace.panels().find((p) => p.tool === 'gridcraft').path);
    const menuItems = () => ws(() => [...document.querySelectorAll('.ctx-menu .ctx-item')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')));
    // Escape closes the menu; its key listener is registered a moment after the menu appears, so a press that comes too early is repeated
    const closeMenu = async () => {
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        if (!(await ws(() => document.querySelector('.ctx-menu')))) return;
        console.log(`note: menu still open after Escape (try ${i + 1})`);
      }
    };
    const wanted = [/^(Maximize|Restore)/, /^(Full screen|Exit full screen)/, /^(Picture in picture|Back into the layout)/, /^Show in the project tree/, /^Copy path/, /^Reload/, /^Unload/, /^Panel info/, /^Close/];
    // a) right click on the panel header (the name, not a button)
    await page.locator(`.panel[data-id="${gid}"] .panel-head .panel-name`).click({ button: 'right' });
    await page.waitForSelector('.ctx-menu .ctx-item');
    let items = await menuItems();
    check('11a: right click on the panel header opens the panel menu', wanted.every((w) => items.some((i) => w.test(i))), JSON.stringify(items));
    await closeMenu();
    // b) right click on the tab
    await page.locator(`.tabs .tab[data-id="${gid}"] .tab-main`).click({ button: 'right' });
    await page.waitForSelector('.ctx-menu .ctx-item');
    items = await menuItems();
    check('11b: right click on the tab opens the same menu', wanted.every((w) => items.some((i) => w.test(i))), JSON.stringify(items));
    await closeMenu();
    // c) right click on the app's icon in the tool rail: the menu of its open panel
    await page.locator('#activity [data-tool="gridcraft"]').click({ button: 'right' });
    await page.waitForSelector('.ctx-menu .ctx-item');
    items = await menuItems();
    check('11c: right click on the app icon in the rail opens the menu of its panel', wanted.every((w) => items.some((i) => w.test(i))), JSON.stringify(items));
    await closeMenu();
    // d) an app that is not open: the rail icon offers to open it
    const closedApp = await ws(() => { const open = new Set(window.__workcraftWorkspace.panels().map((p) => p.tool)); return [...document.querySelectorAll('#activity [data-tool]')].map((b) => b.dataset.tool).find((t) => !open.has(t) && !['tree', 'chat', 'settings', 'code', 'terminal'].includes(t)); });
    if (closedApp) {
      await page.locator(`#activity [data-tool="${closedApp}"]`).click({ button: 'right' });
      await page.waitForSelector('.ctx-menu .ctx-item');
      items = await menuItems();
      check('11d: right click on the icon of an app that is not open offers Open', items.length >= 1 && /^Open /.test(items[0]) && !items.some((i) => i.startsWith('Reload')), JSON.stringify(items));
      await closeMenu();
    } else check('11d: right click on the icon of an app that is not open offers Open (every app is open: skipped)', true, 'skipped');
    // e) Panel info shows the app, the state and the file
    await page.locator(`.panel[data-id="${gid}"] .panel-head .panel-name`).click({ button: 'right' });
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Panel info' }).click();
    await page.waitForSelector('dialog[open] .panel-info');
    const info = await ws(() => document.querySelector('dialog[open] .panel-info').textContent.replace(/\s+/g, ' '));
    check('11e: Panel info lists the app, its state and the file', /GridCraft/.test(info) && /active/.test(info) && info.includes(gpath) && !/\bapp GridCraft\b/.test(info), info.slice(0, 200));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // f) Show in the project tree selects the file in the tree
    await page.locator(`.panel[data-id="${gid}"] .panel-head .panel-name`).click({ button: 'right' });
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Show in the project tree' }).click();
    const shown = await waitFor(async () => ws(() => { const r = document.querySelector('.tree-row.is-selected'); return r?.dataset.path === window.__workcraftWorkspace.panels().find((p) => p.tool === 'gridcraft').path ? r.dataset.path : null; }), 8000);
    check('11f: Show in the project tree selects the file there', !!shown, String(shown));
    // g) Reload starts the engine again (a new iframe document), the panel and its file stay
    await ws((id) => { window.__workcraftWorkspace.instance(id); const f = document.querySelector(`.panel[data-id="${id}"] iframe.ca-frame`); f.contentWindow.__beforeReload = 1; }, gid);
    await page.locator(`.panel[data-id="${gid}"] .panel-head .panel-name`).click({ button: 'right' });
    await page.locator('.ctx-menu .ctx-item', { hasText: /^Reload/ }).click();
    const back = await waitFor(async () => ws((id) => { const p = window.__workcraftWorkspace.panels().find((x) => x.id === id); const f = document.querySelector(`.panel[data-id="${id}"] iframe.ca-frame`); return p?.status === 'active' && f && f.contentWindow.__beforeReload === undefined ? p.path : null; }, gid), 60000, 500);
    check('11g: Reload starts the engine again; the panel and its file stay', back === gpath, String(back));
    // h) a long press with a finger opens the menu (no contextmenu event on iPadOS), and the release is not a tap
    await ws((id) => {
      const t = document.querySelector(`.panel[data-id="${id}"] .panel-head .panel-name`);
      const r = t.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: r.left + 6, clientY: r.top + 6 };
      t.dispatchEvent(new PointerEvent('pointerdown', o));
    }, gid);
    await page.waitForTimeout(800);
    items = await menuItems();
    await ws((id) => { const t = document.querySelector(`.panel[data-id="${id}"] .panel-head .panel-name`); const r = t.getBoundingClientRect(); t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: r.left + 6, clientY: r.top + 6 })); }, gid);
    check('11h: a long press with a finger opens the panel menu', wanted.every((w) => items.some((i) => w.test(i))), JSON.stringify(items));
    await closeMenu();
    // i) a short touch does not
    await ws((id) => {
      const t = document.querySelector(`.panel[data-id="${id}"] .panel-head .panel-name`);
      const o = { bubbles: true, cancelable: true, pointerId: 78, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 100 };
      t.dispatchEvent(new PointerEvent('pointerdown', o));
      t.dispatchEvent(new PointerEvent('pointerup', o));
    }, gid);
    await page.waitForTimeout(800);
    check('11i: a short touch on the header opens no menu', (await menuItems()).length === 0);
  }

  // ---------------------------------------------------------------- 8. Two independent themes (oc-ide-theme, oc-home-theme) and English default
  const store = (pg) => pg.evaluate(() => ({ ide: localStorage.getItem('oc-ide-theme'), home: localStorage.getItem('oc-home-theme'), lang: localStorage.getItem('oc-ide-lang') }));
  const htmlTheme = (pg) => pg.evaluate(() => document.documentElement.dataset.theme);
  const appTheme = () => ws(() => [...document.querySelectorAll('iframe.ca-frame')].map((f) => { try { return `${f.contentWindow.CraftTheme?.scope}:${f.contentDocument.documentElement.dataset.theme}`; } catch { return 'gone'; } }));
  check('8a: IDE renders in English by default', (await ws(() => document.documentElement.lang)) === 'en' && (await store(page)).lang === null && /Settings/.test(await ws(() => document.querySelector('[data-act="settings"]')?.getAttribute('aria-label') || document.querySelector('[data-act="settings"]')?.title || '')));
  await ws(() => window.__workcraftWorkspace.show('gridcraft'));
  await waitFor(async () => (await panelOf('gridcraft'))?.status === 'active', 40000);
  const setIde = async (want) => {
    for (let i = 0; i < 2 && (await htmlTheme(page)) !== want; i++) await page.locator('[data-act="theme"]').first().click();
    await page.waitForTimeout(400);
  };
  await setIde('dark');
  // The website's scope: the homepage in a checkout with the website, the docs page in workcraft
  const SITE = existsSync('contact/index.html') && existsSync('scripts/partials.mjs');
  const home = await ctx.newPage();
  await home.goto(SITE ? `${BASE}/` : `${BASE}/docs/`);
  const setHome = async (want) => {
    if (SITE) {
      await home.waitForSelector(`[data-theme-seg] button[data-theme-val="${want}"]`, { state: 'attached' });
      await home.evaluate((w) => document.querySelector(`[data-theme-seg] button[data-theme-val="${w}"]`).click(), want);
    } else {
      await home.waitForSelector('[data-act="theme"]');
      // The docs page has a toggle: always press it once, so the choice is stored even when it already shows
      await home.locator('[data-act="theme"]').click();
      for (let i = 0; i < 2 && (await htmlTheme(home)) !== want; i++) await home.locator('[data-act="theme"]').click();
    }
    await home.waitForTimeout(400);
  };
  await setHome('light');
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  const s1 = await store(page);
  const apps1 = await appTheme();
  check('8b: IDE dark and homepage light are stored apart', s1.ide === 'dark' && s1.home === 'light' && (await htmlTheme(page)) === 'dark' && (await htmlTheme(home)) === 'light', JSON.stringify(s1));
  check('8c: apps in IDE panels follow the IDE theme in place', apps1.length > 0 && apps1.every((a) => a === 'ide:dark'), apps1.join(' '));
  // The other way round: the homepage goes dark, the IDE goes light; neither follows the other
  await home.bringToFront();
  await setHome('dark');
  await page.bringToFront();
  await setIde('light');
  await home.reload();
  await page.waitForTimeout(600);
  const s2 = await store(page);
  const apps2 = await appTheme();
  check('8d: homepage dark and IDE light stay independent (also after a reload)', s2.ide === 'light' && s2.home === 'dark' && (await htmlTheme(page)) === 'light' && (await htmlTheme(home)) === 'dark', JSON.stringify(s2));
  check('8e: IDE switch reaches the loaded apps without a reload', apps2.length > 0 && apps2.every((a) => a === 'ide:light'), apps2.join(' '));
  const cookies = Object.fromEntries((await ctx.cookies(BASE)).map((c) => [c.name, c.value.split('.')[0]]));
  check('8f: separate cookies per scope', cookies.oc_ide_theme === 'light' && cookies.oc_home_theme === 'dark' && !('oc_theme' in cookies), JSON.stringify(cookies));
  // A standalone app launched from the website uses the website's theme
  const solo = await ctx.newPage();
  await solo.goto(`${BASE}/apps/pdfcraft/`, { waitUntil: 'domcontentloaded' });
  await solo.waitForFunction(() => !!window.CraftTheme, null, { timeout: 20000 });
  const soloTheme = await solo.evaluate(() => `${window.CraftTheme.scope}:${document.documentElement.dataset.theme}`);
  check('8g: standalone app follows oc-home-theme', soloTheme === 'home:dark', soloTheme);
  const homeLang = await home.evaluate(() => ({ lang: document.documentElement.lang, switcher: document.querySelectorAll('[data-lang], .lang-switch, select[name="lang"]').length }));
  check(SITE ? '8h: website is English with no language switch' : '8h: docs page is English with no language switch', homeLang.lang === 'en' && homeLang.switcher === 0, JSON.stringify(homeLang));
  await solo.close();
  await home.close();
  await page.bringToFront();
  // ---------------------------------------------------------------- 12. Onboarding (first start) and the X of a panel
  {
    const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const op = await octx.newPage();
    await op.goto(`${BASE}/?onboarding=1`);
    await op.waitForSelector('.onb [data-action="onb-continue"]', { timeout: 40000 });
    const early = await op.evaluate(() => ({ topbar: document.getElementById('topbar').children.length, rail: document.getElementById('activity').children.length, left: document.getElementById('zone-left').children.length, right: document.getElementById('zone-right').children.length, panels: window.__workcraftWorkspace.panels().length }));
    check('12a: the onboarding comes first: no top bar, rail, project tree, chat or panel exists yet', Object.values(early).every((v) => v === 0), JSON.stringify(early));
    const support = await op.locator('.onb-support a[href*="buymeacoffee"]').count();
    check('12b: step 1 is a welcome text with a way to support the project', support === 1 && /Welcome to/.test(await op.locator('.onb h1').innerText()));
    await op.locator('[data-action="onb-continue"]').click();
    await op.waitForSelector('.onb .eco-card[data-eco="imaging"]');
    await op.locator('.onb .eco-card[data-eco="imaging"]').click();
    await op.waitForSelector('.onb [data-choice="local"]');
    const choices = await op.locator('.onb [data-choice]').count();
    check('12c: step 2 chooses the workspace, step 3 asks where the files are saved (this computer or also the cloud)', choices === 2 && (await op.locator('.onb-dots li.is-on').count()) === 1);
    await op.locator('.onb [data-choice="local"]').click();
    await op.waitForSelector('html.is-ready', { timeout: 40000 });
    await op.waitForSelector('.panel[data-tool="tree"]', { state: 'attached', timeout: 40000 });
    const after = await op.evaluate(() => ({
      onb: document.querySelectorAll('.onb').length,
      tools: window.__workcraftWorkspace.panels().map((p) => p.tool).sort().join(','),
      railApps: [...document.querySelectorAll('#activity [data-tool]')].map((b) => b.dataset.tool).includes('photocraft'),
      settingsTop: !!document.querySelector('.top-actions [data-act="settings"]'),
      settingsRail: document.querySelectorAll('#activity [data-tool="settings"]').length,
      saved: JSON.parse(localStorage.getItem('workcraft.onboarding') || 'null')?.files,
      eco: JSON.parse(localStorage.getItem('workcraft.prefs') || '{}').ecosystem,
    }));
    check('12d: after the last step the project, tree, chat and the rail of the chosen workspace load; Settings is at the top right', after.onb === 0 && /chat/.test(after.tools) && /tree/.test(after.tools) && after.railApps && after.settingsTop && after.settingsRail === 0 && after.eco === 'imaging', JSON.stringify(after));
    check('12e: the answer is saved in the browser', after.saved === 'local');
    await op.reload();
    await op.waitForSelector('html.is-ready', { timeout: 40000 });
    check('12f: it is not asked again after a reload', (await op.locator('.onb').count()) === 0);
    // The X of a panel only hides it; closing for good is a red entry in its menu
    const cid = await op.evaluate(() => window.__workcraftWorkspace.openPanel('code'));
    await op.waitForSelector(`.panel[data-id="${cid}"] [data-btn="close"]`, { timeout: 20000 });
    await op.locator(`.panel[data-id="${cid}"] [data-btn="close"]`).click();
    const hid = await op.evaluate((id) => window.__workcraftWorkspace.panels().find((p) => p.id === id)?.mode, cid);
    check('12g: X hides the panel, it does not close it', hid === 'hidden', String(hid));
    await op.evaluate((id) => { window.__workcraftWorkspace.show(id); }, cid);
    await op.evaluate((id) => window.__workcraftWorkspace.panelMenu(id, 300, 300), cid);
    await op.waitForSelector('.ctx-menu .ctx-item');
    const red = await op.evaluate(() => [...document.querySelectorAll('.ctx-menu .ctx-item.danger')].map((b) => b.textContent.trim()));
    check('12h: the panel menu has a red Close and free memory', red.some((x) => /^Close and free memory/.test(x)), JSON.stringify(red));
    // The cloud guide: Proton Drive first and larger; a service that was found is one row with one button; every other service is one ZIP button
    await op.evaluate(() => void import('/src/app/cloud-guide.ts').then((m) => m.openCloudGuide()));
    await op.waitForSelector('.cg .cg-hero', { timeout: 20000 });
    const first = await op.evaluate(() => ({ hero: document.querySelector('.cg-hero')?.getAttribute('data-provider'), tiles: document.querySelectorAll('.cg-tile').length, zip: !!document.querySelector('[data-action="cg-zip"]'), badge: document.querySelector('.cg-badge')?.textContent }));
    check('12i: the cloud guide puts Proton Drive first and large, offers one ZIP button for every other service and has no wall of tiles', first.hero === 'proton' && first.tiles === 0 && first.zip && /Recommended/.test(first.badge || ''), JSON.stringify(first));
    await op.locator('.cg .cg-hero [data-action="cg-proton"]').click();
    await op.waitForSelector('.cg .cg-steps');
    const guide = await op.evaluate(() => ({ steps: document.querySelectorAll('.cg-steps li').length, zip: !!document.querySelector('[data-action="cg-zip"]'), get: document.querySelector('.cg-get')?.getAttribute('href') }));
    check('12j: Proton Drive shows three steps, a button for its folder, a ZIP as the other way and a link to get its app', guide.steps === 3 && guide.zip && /proton\.me/.test(guide.get || ''), JSON.stringify(guide));
    await op.keyboard.press('Escape');
    await octx.close();
  }
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
