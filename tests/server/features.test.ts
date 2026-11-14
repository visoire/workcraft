// Integration test of the trust, search, history and home-network features: local-only mode and
// the audit log, trash with restore, snapshots (undo across tools), project graph, search and
// memory, export formats, LAN share, sync between two backends, plugins and sandbox, health
// check, logs and the one-click wipe.
//   npx tsx --test tests/server/features.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';

const A = { port: 5301, home: mkdtempSync(join(tmpdir(), 'oc-feat-a-')), share: 5311 };
const B = { port: 5302, home: mkdtempSync(join(tmpdir(), 'oc-feat-b-')), share: 5312 };
const MOCK = 5303;
let procs: ChildProcess[] = [];
let mock: Server;
let mcp: Client;

const url = (s: { port: number }, p: string) => `http://127.0.0.1:${s.port}${p}`;
async function api<T = unknown>(path: string, init: RequestInit = {}, s = A): Promise<T> {
  const res = await fetch(url(s, path), init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const call = async (name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) => {
  const r = (await mcp.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) })) as { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError, data: r.structuredContent };
};
async function sse(path: string, body: unknown): Promise<{ type: string; error?: { code: string } }[]> {
  const res = await fetch(url(A, path), json('POST', body));
  const text = await res.text();
  return text
    .split('\n\n')
    .map((b) => b.replace(/^data:\s?/m, '').trim())
    .filter(Boolean)
    .map((d) => JSON.parse(d));
}

function start(s: typeof A) {
  const p = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, WORKCRAFT_FIRST_PROJECT: 'sample', WORKCRAFT_HOME: s.home, WORKCRAFT_PORT: String(s.port), WORKCRAFT_SHARE_PORT: String(s.share), WORKCRAFT_DEV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
  procs.push(p);
}
async function ready(s: typeof A) {
  for (let i = 0; i < 150; i++) {
    try {
      await api('/api/health', {}, s);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('backend did not start');
}

before(async () => {
  mock = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'local-model' }] }));
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'local answer' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  }).listen(MOCK, '127.0.0.1');
  start(A);
  start(B);
  await Promise.all([ready(A), ready(B)]);
  mcp = new Client({ name: 'test', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(url(A, '/mcp'))));
});

after(async () => {
  await mcp?.close().catch(() => {});
  for (const p of procs) p.kill();
  mock?.close();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(A.home, { recursive: true, force: true });
  rmSync(B.home, { recursive: true, force: true });
});

test('Local-only mode blocks cloud providers, local endpoints keep working, the audit log records both', async () => {
  const cloud = await api<{ id: string }>('/api/config/custom', json('POST', { name: 'Cloud test', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-0000000000', model: 'x' }));
  const local = await api<{ id: string }>('/api/config/custom', json('POST', { name: 'Local test', baseUrl: `http://127.0.0.1:${MOCK}/v1`, model: 'local-model' }));
  await api('/api/config/privacy', json('PUT', { localOnly: true }));
  const status = await api<{ localOnly: boolean; providers: { id: string; blocked: boolean }[] }>('/api/ai/status');
  assert.equal(status.localOnly, true);
  assert.equal(status.providers.find((p) => p.id === cloud.id)!.blocked, true);
  assert.equal(status.providers.find((p) => p.id === 'anthropic')!.blocked, true);
  assert.equal(status.providers.find((p) => p.id === local.id)!.blocked, false);

  const blocked = await sse('/api/ai/chat', { provider: cloud.id, system: 's', turns: [{ role: 'user', content: 'hi' }], meta: { files: [{ name: 'finances.xlsx', kind: 'sheet', size: 1200 }] } });
  assert.equal(blocked.find((e) => e.type === 'error')?.error?.code, 'LOCAL_ONLY');
  const test = await api<{ ok: boolean; error?: { code: string } }>('/api/ai/test', json('POST', { id: cloud.id }));
  assert.equal(test.error?.code, 'LOCAL_ONLY');

  const ok = await sse('/api/ai/chat', { provider: local.id, system: 's', turns: [{ role: 'user', content: 'hi' }], meta: { files: [{ name: 'proposal.docx', kind: 'document', size: 800 }] } });
  assert.ok(ok.some((e) => e.type === 'text'));

  const audit = await api<{ kind: string; status: string; local: boolean; destination: string; files: { name: string }[]; bytes: number }[]>('/api/audit');
  const b = audit.find((e) => e.status === 'blocked' && e.destination === 'api.example.com' && e.files.length)!;
  assert.ok(audit.some((e) => e.status === 'blocked' && !e.files.length), 'blocked connection test');
  assert.ok(b, 'blocked request in the audit log');
  assert.equal(b.bytes, 0);
  assert.equal(b.files[0]!.name, 'finances.xlsx');
  const l = audit.find((e) => e.kind === 'ai' && e.destination === `127.0.0.1:${MOCK}`)!;
  assert.equal(l.local, true);
  assert.equal(l.files[0]!.name, 'proposal.docx');
  // the audit log holds no message text
  assert.ok(!JSON.stringify(audit).includes('"hi"'));
  const csv = await (await fetch(url(A, '/api/audit/export'))).text();
  assert.match(csv, /^time,kind,destination/);
  await api('/api/config/privacy', json('PUT', { localOnly: false }));
});

test('Trash: deleted files and projects come back', async () => {
  await api('/api/files/raw?path=/notes/plan.md', { method: 'PUT', body: '# Plan\n\nKeep this.' });
  const del = await api<{ trash: string }>('/api/files?path=/notes/plan.md', { method: 'DELETE' });
  assert.ok(del.trash);
  const tree = await api<{ entries: { path: string }[] }>('/api/files/tree');
  assert.ok(!tree.entries.some((e) => e.path === '/notes/plan.md'));
  let trash = await api<{ id: string; kind: string; path?: string; expires: string }[]>('/api/trash');
  const entry = trash.find((e) => e.path === '/notes/plan.md')!;
  assert.ok(entry && Date.parse(entry.expires) > Date.now() + 29 * 86400_000);
  const r = await api<{ path: string }>(`/api/trash/${entry.id}/restore`, { method: 'POST' });
  assert.equal(r.path, '/notes/plan.md');
  assert.equal(await (await fetch(url(A, '/api/files/raw?path=/notes/plan.md'))).text(), '# Plan\n\nKeep this.');

  const p = await api<{ id: string }>('/api/projects', json('POST', { name: 'Throwaway', template: 'empty', switchTo: false }));
  await api(`/api/projects/${p.id}`, { method: 'DELETE' });
  trash = await api('/api/trash');
  const pe = trash.find((e) => e.kind === 'project' && e.id && (e as unknown as { projectId: string }).projectId === p.id)!;
  const rp = await api<{ projectId: string }>(`/api/trash/${pe.id}/restore`, { method: 'POST' });
  const list = await api<{ projects: { id: string; name: string }[] }>('/api/projects');
  assert.ok(list.projects.some((x) => x.id === rp.projectId && x.name === 'Throwaway'));
  // delete for good
  await api(`/api/projects/${rp.projectId}`, { method: 'DELETE' });
  const again = (await api<{ id: string; projectId: string }[]>('/api/trash')).find((e) => e.projectId === rp.projectId)!;
  await api(`/api/trash/${again.id}`, { method: 'DELETE' });
  assert.ok(!(await api<{ id: string }[]>('/api/trash')).some((e) => e.id === again.id));
});

test('Snapshots: an AI chain is undone across all tools at once', async () => {
  const before = await (await fetch(url(A, '/api/files/raw?path=/documents/welcome.md'))).text();
  const chain = 'msg-undo-test';
  const r1 = await call('read-sheet', { path: '/sheets/finances.xlsx' }, { 'workcraft/callId': 'c-read', 'workcraft/chain': chain });
  assert.ok(!r1.isError, r1.text);
  const w1 = await call('write-document', { path: '/documents/welcome.md', markdown: '# Replaced by the AI' }, { 'workcraft/callId': 'c-w1', 'workcraft/chain': chain });
  assert.ok(!w1.isError, w1.text);
  const w2 = await call('write-sheet', { path: '/sheets/ai.xlsx', cells: { A1: 'new' } }, { 'workcraft/callId': 'c-w2', 'workcraft/chain': chain });
  assert.ok(!w2.isError, w2.text);
  const snap = await api<{ id: string; auto: boolean; label: string } | null>(`/api/snapshots/chain/${chain}`);
  assert.ok(snap && snap.auto, 'automatic snapshot before the first write');
  const diff = await api<{ changed: string[]; added: string[] }>(`/api/snapshots/${snap.id}/diff`);
  assert.ok(diff.changed.includes('/documents/welcome.md'));
  assert.ok(diff.added.includes('/sheets/ai.xlsx'));

  // project graph: versions and "derived from" edges of the chain
  const g = await api<{ node: { versions: { v: number; tool?: string; chain?: string }[] }; derivedFrom: { from: string; tool: string }[] }>('/api/graph/file?path=/documents/welcome.md');
  assert.equal(g.node.versions.at(-1)!.tool, 'write-document');
  assert.equal(g.node.versions.at(-1)!.chain, chain);
  assert.ok(g.derivedFrom.some((e) => e.from === '/sheets/finances.xlsx' && e.tool === 'write-document'));
  const hist = await call('file-history', { path: '/documents/welcome.md' });
  assert.match(hist.text, /Derived from:\n\/sheets\/finances.xlsx -> \/documents\/welcome.md via write-document/);

  const res = await api<{ safety: string; written: number; trashed: number }>(`/api/snapshots/${snap.id}/restore`, json('POST', {}));
  assert.equal(res.trashed, 1);
  assert.equal(await (await fetch(url(A, '/api/files/raw?path=/documents/welcome.md'))).text(), before);
  assert.equal((await fetch(url(A, '/api/files/raw?path=/sheets/ai.xlsx'))).status, 404);
  // the safety snapshot undoes the restore
  const back = await api<{ written: number }>(`/api/snapshots/${res.safety}/restore`, json('POST', {}));
  assert.ok(back.written >= 1);
  assert.match(await (await fetch(url(A, '/api/files/raw?path=/documents/welcome.md'))).text(), /Replaced by the AI/);

  // restore an older version of one file
  const v1 = g.node.versions[0]!.v;
  await api('/api/graph/restore', json('POST', { path: '/documents/welcome.md', v: v1 }));
});

test('Search: Word, Excel, PowerPoint, PDF and chats, with places, and project memory', async () => {
  await api('/api/chats/chat-search1', json('PUT', { id: 'chat-search1', title: 'Budget talk', updated: new Date().toISOString(), messages: [{ role: 'user', text: 'We decided the marketing budget stays at 12000 euros' }] }));
  await call('write-document', { path: '/documents/forecast.docx', markdown: '# Umsatzprognose 2027\n\nWir erwarten 310000 Euro Umsatz im Jahr 2027.' });
  await api('/api/search/reindex?force=1', { method: 'POST' });
  const de = await api<{ hits: { source: string; kind: string; loc: string }[] }>('/api/search?q=' + encodeURIComponent('finde den Teil mit den Umsatzprognosen'));
  assert.equal(de.hits[0]!.source, '/documents/forecast.docx');
  assert.equal(de.hits[0]!.kind, 'document');
  const en = await api<{ hits: { source: string }[] }>('/api/search?q=' + encodeURIComponent('revenue forecast'));
  assert.ok(en.hits.some((h) => h.source === '/documents/forecast.docx'), 'bilingual terms without embeddings');
  const pdf = await api<{ hits: { source: string; loc: string }[] }>('/api/search?q=contract');
  assert.ok(pdf.hits.some((h) => h.source === '/pdf/contract.pdf' && /^page \d/.test(h.loc)));
  const chat = await api<{ hits: { source: string; kind: string }[] }>('/api/search?q=marketing%20budget');
  assert.ok(chat.hits.some((h) => h.kind === 'chat' && h.source === 'chat:chat-search1'));
  const sheet = await api<{ hits: { kind: string; loc: string }[] }>('/api/search?q=revenue&kinds=sheet');
  assert.ok(sheet.hits.length && sheet.hits.every((h) => h.kind === 'sheet'));
  const tool = await call('search-project', { query: 'Umsatz 2027' });
  assert.match(tool.text, /forecast\.docx/);
  const sem = await api<{ error?: string; semantic: boolean }>('/api/search?mode=semantic&q=revenue');
  assert.equal(sem.semantic, false);
  assert.match(sem.error || '', /embeddings/i);

  await api('/api/memory', json('POST', { text: 'Prices in proposals are net, without VAT' }));
  const rem = await call('remember', { note: 'The customer is Northwind Ltd.' });
  assert.ok(!rem.isError);
  const ctx = await api<{ block: string; notes: { text: string }[]; passages: { source: string }[] }>('/api/memory/context', json('POST', { query: 'What revenue do we expect in 2027?' }));
  assert.match(ctx.block, /net, without VAT/);
  assert.match(ctx.block, /Northwind/);
  assert.ok(ctx.passages.some((p) => p.source === '/documents/forecast.docx'));
  assert.match(ctx.block, /Recent AI steps/);
});

test('Export: HTML gallery, PDF portfolio and Markdown folder', async () => {
  const { active } = await api<{ active: { id: string } }>('/api/projects');
  const html = unzipSync(new Uint8Array(await (await fetch(url(A, `/api/projects/${active.id}/export/html`))).arrayBuffer()));
  assert.match(strFromU8(html['index.html']!), /class="grid"/);
  assert.ok(html['files/sheets/finances.xlsx']);
  assert.ok(Object.keys(html).some((k) => k.startsWith('pages/') && k.includes('finances')));
  assert.ok(Object.keys(html).some((k) => k.startsWith('chats/')));
  const md = unzipSync(new Uint8Array(await (await fetch(url(A, `/api/projects/${active.id}/export/markdown`))).arrayBuffer()));
  assert.match(strFromU8(md['README.md']!), /## \/sheets/);
  assert.match(strFromU8(md['docs/sheets/finances.md']!), /\| # \|/);
  const res = await fetch(url(A, `/api/projects/${active.id}/export/pdf`));
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const pdf = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
  assert.ok(pdf.getPageCount() >= 6, `${pdf.getPageCount()} pages`);
});

test('LAN share: read-only, expires, revocable', async () => {
  const s = await api<{ token: string; urls: string[]; expires: string }>('/api/share', json('POST', { minutes: 30, download: false }));
  const base = `http://127.0.0.1:${A.share}/s/${s.token}`;
  const list = await (await fetch(base + '/')).text();
  assert.match(list, /finances\.xlsx/);
  const view = await fetch(`${base}/view?path=/sheets/finances.xlsx`);
  assert.equal(view.status, 200);
  assert.match(view.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.equal((await fetch(`${base}/raw?path=/sheets/finances.xlsx`)).status, 403, 'downloads are off');
  assert.equal((await fetch(`${base}/view?path=/.workcraft/project.json`)).status, 404);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(`http://127.0.0.1:${A.share}/api/projects`)).status, 404, 'no API on the share port');
  assert.equal((await fetch(`http://127.0.0.1:${A.share}/s/${'x'.repeat(32)}/`)).status, 404);
  await api(`/api/share/${s.token}`, { method: 'DELETE' });
  const gone = await fetch(base + '/').catch(() => null);
  assert.ok(!gone || gone.status === 404);
});

test('Sync: two desktops on the home network, both ways, with a conflict copy', async () => {
  const p = await api<{ id: string }>('/api/projects', json('POST', { name: 'Sync project', template: 'empty', switchTo: false }));
  const put = (s: typeof A, path: string, body: string) => api(`/api/sync/${p.id}/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body }, s);
  await put(A, '/a.md', 'from A');
  const peer = { host: '127.0.0.1', port: B.port, token: 'x'.repeat(24), project: p.id };
  const r1 = await api<{ pushed: number; pulled: number }>('/api/sync/peer', json('POST', peer));
  assert.equal(r1.pushed, 1);
  assert.equal(await (await fetch(url(B, `/api/sync/${p.id}/file?path=/a.md`))).text(), 'from A');
  await put(B, '/b.md', 'from B');
  await put(B, '/a.md', 'edited on B');
  const r2 = await api<{ pulled: number; conflicts: number }>('/api/sync/peer', json('POST', peer));
  assert.equal(r2.pulled, 2);
  assert.equal(await (await fetch(url(A, `/api/sync/${p.id}/file?path=/a.md`))).text(), 'edited on B');
  // both sides change the same file: conflict copy on both sides
  await put(A, '/a.md', 'A again');
  await put(B, '/a.md', 'B again');
  const r3 = await api<{ conflicts: number }>('/api/sync/peer', json('POST', peer));
  assert.equal(r3.conflicts, 1);
  const ma = await api<{ path: string }[]>(`/api/sync/${p.id}/manifest`);
  const mb = await api<{ path: string }[]>(`/api/sync/${p.id}/manifest`, {}, B);
  assert.equal(ma.filter((f) => f.path.includes('(conflict')).length, 1);
  assert.deepEqual(ma.map((f) => f.path).sort(), mb.map((f) => f.path).sort());
  // a deletion travels too (into the trash of the other side)
  await api(`/api/sync/${p.id}/file?path=/b.md`, { method: 'DELETE' });
  const r4 = await api<{ deleted: number }>('/api/sync/peer', json('POST', peer));
  assert.equal(r4.deleted, 1);
  assert.equal((await fetch(url(B, `/api/sync/${p.id}/file?path=/b.md`))).status, 404);
  const bad = await fetch(url(A, '/api/sync/peer'), json('POST', { ...peer, host: '8.8.8.8' }));
  assert.equal(bad.status, 400, 'only devices in the home network');
});

test('Plugins: catalog, install a template (off), sandbox parameters', async () => {
  const p = await api<{ catalog: { name: string }[]; plugins: unknown[] }>('/api/plugins');
  for (const n of ['comfyui', 'blender', 'photocraft', 'artcraft']) assert.ok(p.catalog.some((c) => c.name === n), n);
  await api('/api/plugins/install', json('POST', { name: 'photocraft' }));
  const after = await api<{ plugins: { name: string; enabled: boolean }[] }>('/api/plugins');
  assert.equal(after.plugins.find((x) => x.name === 'photocraft')!.enabled, false);
  assert.ok(existsSync(join(A.home, 'plugins', 'photocraft', 'workcraft.plugin.json')));
  const { sandboxParams } = await import('../../src/server/mcp.ts');
  process.env.OPENAI_API_KEY = 'sk-should-not-leak';
  const strict = sandboxParams({ id: 'x', name: 'x', command: process.execPath, args: ['s.js'], enabled: true, transport: 'stdio', sandbox: 'strict', approval: 'ask', cwd: A.home }, '/tmp/project');
  assert.ok(strict.args.some((a) => /permission/.test(a)));
  assert.ok(strict.args.includes('--allow-fs-write=/tmp/project'));
  assert.ok(!('OPENAI_API_KEY' in strict.env));
  const off = sandboxParams({ id: 'x', name: 'x', command: 'tool', args: [], enabled: true, transport: 'stdio', sandbox: 'off', approval: 'all', cwd: A.home }, '/tmp/project');
  assert.equal(off.env.OPENAI_API_KEY, 'sk-should-not-leak');
});

test('Health check, logs and metrics', async () => {
  const h = await api<{ backend: { ok: boolean }; mcp: { ok: boolean; detail: { tools: number } }; disk: { ok: boolean }; ollama: { ok: boolean } }>('/api/health/full');
  assert.ok(h.backend.ok);
  assert.ok(h.mcp.ok && h.mcp.detail.tools >= 15);
  assert.ok(h.disk.ok);
  assert.equal(typeof h.ollama.ok, 'boolean');
  await api('/api/logs', json('POST', [{ level: 'warn', source: 'test', message: 'frontend line' }]));
  const logs = await api<{ source: string; message: string }[]>('/api/logs');
  assert.ok(logs.some((l) => l.source === 'ui:test'));
  assert.ok(logs.some((l) => l.source === 'mcp'));
  await api('/api/metrics/config', json('PUT', { enabled: true }));
  await api('/api/metrics', json('POST', [{ name: 'app:gridcraft', value: 820 }, { name: 'app:gridcraft', value: 900 }]));
  const m = await api<{ series: { name: string; p50: number; n: number }[] }>('/api/metrics');
  assert.equal(m.series.find((s) => s.name === 'app:gridcraft')!.n, 2);
  const rep = await api<{ series: { name: string }[] }>('/api/metrics/report');
  assert.ok(rep.series.every((s) => !s.name.includes('/')));
});

test('Personal context and personas', async () => {
  const cfg = await api<{ personal: { personas: { id: string }[]; active: string } }>('/api/config');
  assert.ok(cfg.personal.personas.some((p) => p.id === 'reviewer'));
  const next = await api<{ personal: { context: string; active: string } }>('/api/config/personal', json('PUT', { context: 'I am a freelance designer in Berlin.', active: 'reviewer' }));
  assert.equal(next.personal.active, 'reviewer');
  assert.match(next.personal.context, /Berlin/);
});

test('One-click wipe: keys, projects, chats, audit log', async () => {
  const denied = await fetch(url(A, '/api/wipe'), json('POST', { confirm: 'yes' }));
  assert.equal(denied.status, 400);
  const r = await api<{ ok: boolean; done: string[] }>('/api/wipe', json('POST', { confirm: 'WIPE' }));
  assert.ok(r.ok);
  const cfg = await api<{ ai: { custom: unknown[]; providers: { hasKey: boolean }[] }; personal: { context: string } }>('/api/config');
  assert.equal(cfg.ai.custom.length, 0);
  assert.ok(cfg.ai.providers.every((p) => !p.hasKey));
  assert.equal(cfg.personal.context, '');
  const list = await api<{ projects: { name: string }[] }>('/api/projects');
  assert.equal(list.projects.length, 1, 'only a fresh sample project');
  assert.equal((await api<unknown[]>('/api/trash')).length, 0);
  assert.equal((await api<unknown[]>('/api/audit')).length, 0);
  assert.equal((await api<unknown[]>('/api/chats')).length, 0);
});
