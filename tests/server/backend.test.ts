// Integration test of the local backend: starts the server with a temporary data folder
// and checks projects, files, MCP tools (through the official client), approvals,
// Security and the AI router against a local OpenAI-compatible test endpoint.
//   npx tsx --test tests/server/backend.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { BpeTokenizer } from '../../src/core/bpe.ts';
import { repairJson, repairArgs, closeOpenFences } from '../../src/core/json-repair.ts';
import { addUsage, emptyUsage, cacheHitRatio, cacheSavings, usageTotals, countRequest, contextWindow } from '../../src/chat/usage.ts';
import { fitRequest, pruneText, PRUNE } from '../../src/chat/budget.ts';
import { resolveDeepSeekParams } from '../../src/chat/deepseek.ts';
import type { ChatTurn, ReplayState, TokenUsage } from '../../src/chat/types.ts';
import { compileToolSchema, normalizeToolArgs, toolSpecs, validateArgs } from '../../src/mcp/schemas.ts';
import { byProvider, toolSuccess } from '../../src/chat/usage.ts';
import { TeamRun, parseTaskGraph, parseVerdict, findCycle, levels, normalizeTeam, planSystem, reviewSystem, reviewInput, synthesisSystem, synthesisInput, workerSystem, workerInput, enabledWorkers, toolAllowed, DEFAULT_TEAM, TEAM_PRESETS, type TaskState, type TeamConfig, type WorkerOutput } from '../../src/chat/team.ts';
import { FileLocks, lockKey, lockKeysFor } from '../../src/mcp/locks.ts';

const PORT = 5297;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = mkdtempSync(join(tmpdir(), 'workcraft-test-'));
let proc: ChildProcess;
let mock: Server;
let mcp: Client;

const api = async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
};
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const call = async (name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) => {
  const r = (await mcp.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) })) as { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError, data: r.structuredContent };
};

/** Requests the DeepSeek test endpoint received, by path */
const dsBodies: { url: string; body: Record<string, unknown> }[] = [];
type WireMsg = { role: string; content?: unknown; reasoning_content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };

/**
 * DeepSeek-compatible endpoint (thinking mode): keep-alive comments, reasoning_content before the answer,
 * a two-step tool chain (read-sheet, then write-document), cache and reasoning usage fields, and the
 * API rule that a request with tools must carry the reasoning_content of every earlier assistant turn.
 */
function deepseekMock(url: string, j: Record<string, unknown>, res: import('node:http').ServerResponse) {
  dsBodies.push({ url, body: j });
  const json = (status: number, o: unknown) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(o)));
  if (url.endsWith('/beta/completions')) return json(200, { choices: [{ text: '    return fib(a-1) + fib(a-2)' }], usage: { prompt_tokens: 20, completion_tokens: 9, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 20 } });
  if (url.endsWith('/beta/chat/completions')) return json(200, { choices: [{ message: { role: 'assistant', content: '"title": \'Q1\', "rows": [1, 2,],' } }], usage: { prompt_tokens: 30, completion_tokens: 12, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 30 } });
  const messages = (j.messages || []) as WireMsg[];
  if ((j.tools as unknown[] | undefined)?.length && messages.some((m) => m.role === 'assistant' && typeof m.reasoning_content !== 'string')) {
    return json(400, { error: { message: 'Missing reasoning_content in an assistant message of a request with tools', type: 'invalid_request_error' } });
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  res.write(': keep-alive\n\n');
  const results = messages.filter((m) => m.role === 'tool').length;
  const thinking = (j.thinking as { type?: string } | undefined)?.type === 'enabled';
  const think = (parts: string[]) => thinking && parts.forEach((p) => send({ choices: [{ delta: { reasoning_content: p } }] }));
  const call = (id: string, name: string, args: string) => {
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args.slice(0, 8) } }] } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(8) } }] } }] });
  };
  // Like the API: usage rides on the last chunk, which carries no content and the finish_reason
  if (results === 0) {
    think(['The user wants ', 'a report. Read the sheet first.']);
    send({ choices: [{ delta: { content: 'Reading the sheet. ' } }] });
    call('call_ds_1', 'read-sheet', '{"path":"/sheets/finances.xlsx"}');
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1500, completion_tokens: 60, prompt_cache_hit_tokens: 1200, prompt_cache_miss_tokens: 300, prompt_tokens_details: { cached_tokens: 1200 }, completion_tokens_details: { reasoning_tokens: 40 } } });
  } else if (results === 1) {
    think(['Revenue is known. ', 'Now write the report.']);
    // Malformed arguments: single quotes and a trailing comma (the repair pass fixes them)
    call('call_ds_2', 'write-document', "{'path': '/documents/r.md', 'markdown': '# Report',}");
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1700, completion_tokens: 50, prompt_cache_hit_tokens: 1500, prompt_cache_miss_tokens: 200, completion_tokens_details: { reasoning_tokens: 30 } } });
  } else {
    think(['Both steps worked.']);
    send({ choices: [{ delta: { content: 'Report written to /documents/r.md.' } }] });
    send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1800, completion_tokens: 20, prompt_cache_hit_tokens: 1700, prompt_cache_miss_tokens: 100, completion_tokens_details: { reasoning_tokens: 6 } } });
  }
  res.end('data: [DONE]\n\n');
}

/** Requests the Claude, Gemini and OpenAI test endpoints received, and the 400s they answered */
const nativeBodies: { url: string; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }[] = [];
let nativeRejects = 0;
type Res = import('node:http').ServerResponse;
const reject = (res: Res, message: string) => {
  nativeRejects++;
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }));
};
const sendSse = (res: Res, events: unknown[], named = false) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`${named ? `event: ${(e as { type: string }).type}\n` : ''}data: ${JSON.stringify(e)}\n\n`);
  res.end();
};

/**
 * Claude Messages API: thinking (thinking_delta + signature_delta), text, a tool_use, then on the next
 * request the rules of the real API: the thinking block with its exact signature first in the assistant
 * turn, tool_result first in the user turn, otherwise 400.
 */
function claudeMock(j: Record<string, unknown>, res: Res) {
  type M = { role: string; content: Record<string, unknown>[] };
  const msgs = j.messages as M[];
  const last = msgs[msgs.length - 1]!;
  if (last.content.some((b) => b.type === 'tool_result')) {
    const asst = msgs[msgs.length - 2]!;
    const th = asst.content[0]!;
    if (th.type !== 'thinking' || th.signature !== 'sig-claude-1' || th.thinking !== 'Read the sheet first. Then answer.') return reject(res, 'messages.1.content.0: Invalid `signature` in `thinking` block');
    if (last.content[0]!.type !== 'tool_result' || last.content[0]!.tool_use_id !== 'toolu_1') return reject(res, 'tool_result blocks must come first');
    return sendSse(res, [
      { type: 'message_start', message: { usage: { input_tokens: 50, cache_read_input_tokens: 2400, cache_creation_input_tokens: 0, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The sheet has the figures.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-claude-2' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Revenue grew.' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
      { type: 'message_stop' },
    ], true);
  }
  return sendSse(res, [
    { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Read the sheet first.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' Then answer.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-claude-1' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Reading. ' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read-sheet', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path": "/sheets/' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'finances.xlsx"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 80 } },
    { type: 'message_stop' },
  ], true);
}

/** Gemini streamGenerateContent: thought parts, a functionCall with thoughtSignature that must come back verbatim. */
function geminiMock(j: Record<string, unknown>, res: Res) {
  type C = { role: string; parts: Record<string, unknown>[] };
  const contents = j.contents as C[];
  const answered = contents.some((c) => c.parts.some((p) => p.functionResponse));
  if (answered) {
    const call = contents.find((c) => c.role === 'model')?.parts.find((p) => p.functionCall);
    if (!call || (call.thoughtSignature !== 'sig-gem-1' && call.thoughtSignature !== 'skip_thought_signature_validator')) return reject(res, 'Function call is missing a thought_signature in functionCall parts.');
    return sendSse(res, [
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Checked the result.', thought: true }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Revenue grew.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 1000, candidatesTokenCount: 10, thoughtsTokenCount: 12 } },
    ]);
  }
  return sendSse(res, [
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Need the sheet', thought: true }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: ' first.', thought: true }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'gcall_1', name: 'read-sheet', args: { path: '/sheets/finances.xlsx' } }, thoughtSignature: 'sig-gem-1' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 600, candidatesTokenCount: 20, thoughtsTokenCount: 40 } },
  ]);
}

/** OpenAI Responses API: reasoning summary, an encrypted reasoning item that must precede the function call next time. */
function openaiMock(j: Record<string, unknown>, res: Res) {
  const input = j.input as Record<string, unknown>[];
  const output = input.find((i) => i.type === 'function_call_output');
  const usage = (inp: number, cached: number, out: number, reasoning: number) => ({ input_tokens: inp, input_tokens_details: { cached_tokens: cached }, output_tokens: out, output_tokens_details: { reasoning_tokens: reasoning } });
  if (output) {
    const ri = input.findIndex((i) => i.type === 'reasoning');
    const fi = input.findIndex((i) => i.type === 'function_call');
    if (ri < 0 || input[ri]!.id !== 'rs_1' || input[ri]!.encrypted_content !== 'enc-1' || fi < ri || input[fi]!.call_id !== 'call_oai_1') return reject(res, 'Item rs_1 of type reasoning is missing or out of order (encrypted_content required).');
    return sendSse(res, [
      { type: 'response.output_item.added', item: { type: 'message', id: 'msg_2' } },
      { type: 'response.output_text.delta', delta: 'Revenue grew.' },
      { type: 'response.output_item.done', item: { type: 'message', id: 'msg_2', role: 'assistant', content: [{ type: 'output_text', text: 'Revenue grew.' }], status: 'completed' } },
      { type: 'response.completed', response: { status: 'completed', usage: usage(1600, 1408, 20, 0) } },
    ]);
  }
  return sendSse(res, [
    { type: 'response.created', response: { id: 'resp_1' } },
    { type: 'response.output_item.added', item: { type: 'reasoning', id: 'rs_1' } },
    { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', summary_index: 0, delta: 'Reading the sheet' },
    { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', summary_index: 0, delta: ' first.' },
    { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Reading the sheet first.' }], encrypted_content: 'enc-1', status: 'completed' } },
    { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: 'call_oai_1', name: 'read-sheet', arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"path":"/sheets/finances.xlsx","sheet":null,"range":null}' },
    { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_oai_1', name: 'read-sheet', arguments: '{"path":"/sheets/finances.xlsx","sheet":null,"range":null}', status: 'completed' } },
    { type: 'response.completed', response: { status: 'completed', usage: usage(1500, 1024, 90, 64) } },
  ]);
}

// ---------------------------------------------------------------- Team Mode test endpoints

/** Requests of the team endpoint by role (leader plan, review, synthesis; specialists) */
const teamLog: { kind: string; at: number }[] = [];
let deckReviews = 0;
const TEAM_PLAN = {
  goal: 'Quarterly package from the finance sheet',
  tasks: [
    { id: 't1', title: 'Extract the Q3 figures', assignedAgent: 'grid-agent', dependencies: [], targetFiles: ['/sheets/finances.xlsx'], instructions: 'Read the quarterly figures.' },
    { id: 't2', title: 'Write the report', assignedAgent: 'word-agent', dependencies: ['t1'], targetFiles: ['/reports/team-report.docx'], instructions: 'Write a one-page report with the Q3 figures.' },
    { id: 't3', title: 'Build the slides', assignedAgent: 'deck-agent', dependencies: ['t1'], targetFiles: ['/presentations/team.pptx'], instructions: 'Three slides with the Q3 figures.' },
    { id: 't4', title: 'Check the contract', assignedAgent: 'pdf-agent', dependencies: [], targetFiles: ['/pdf/contract.pdf'], instructions: 'Extract the contract text and list the parties.' },
  ],
};

/**
 * OpenAI-compatible endpoint for Team Mode. The role comes from the system prompt: the leader's plan
 * (fenced JSON with prose around it), the leader's review (rejects the first DeckCraft result once),
 * the synthesis, and the specialists (each answer takes 250 ms, so overlaps are measurable).
 */
function teamMock(j: Record<string, unknown>, res: Res) {
  const msgs = (j.messages || []) as { role: string; content?: unknown }[];
  const system = msgs.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  const user = String([...msgs].reverse().find((m) => m.role === 'user')?.content || '');
  let kind = 'worker';
  let text = 'Done.';
  if (/You break the request into tasks/.test(system)) {
    kind = 'plan';
    text = 'Here is the plan:\n```json\n' + JSON.stringify(TEAM_PLAN, null, 1) + '\n```';
  } else if (/reviewing the work of one specialist/.test(system)) {
    kind = 'review';
    if (/^Task t3 /m.test(user) && deckReviews++ === 0) text = '{"accept": false, "instruction": "Add a slide with the Q3 figure of 61,250.", "note": "Q3 figure missing"}';
    else text = '{"accept": true, "note": "complete"}';
  } else if (/Your specialists finished their tasks/.test(system)) {
    kind = 'synthesis';
    text = 'The team wrote /reports/team-report.docx and /presentations/team.pptx.';
  } else {
    const role = system.match(/You are the ([^(]+) \(/)?.[1]?.trim() || 'worker';
    kind = `worker:${role}`;
    text = /Data & Sheet/.test(role) ? 'Q3 revenue 61,250 euros.' : `${role} finished.`;
  }
  teamLog.push({ kind, at: Date.now() });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  setTimeout(
    () => {
      for (const part of text.match(/[\s\S]{1,40}/g) || []) send({ choices: [{ delta: { content: part } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 400, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 100 } } });
      res.end('data: [DONE]\n\n');
    },
    kind.startsWith('worker') ? 250 : 20
  );
}

/** Streams a chunk every 100 ms for 20 s and records when the connection closes (cancellation tests). */
const slow = { open: 0, closed: 0, roles: [] as string[] };
function slowMock(j: Record<string, unknown>, res: Res) {
  const msgs = (j.messages || []) as { role: string; content?: unknown }[];
  slow.roles.push(String(msgs.find((m) => m.role === 'system')?.content || '').slice(0, 40));
  slow.open++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  let n = 0;
  const timer = setInterval(() => {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `chunk ${n++} ` } }] })}\n\n`);
    if (n > 200) (clearInterval(timer), res.end('data: [DONE]\n\n'));
  }, 100);
  res.on('close', () => {
    clearInterval(timer);
    slow.open--;
    slow.closed++;
  });
}

before(async () => {
  // OpenAI-compatible test endpoint: streams text and a tool call
  mock = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url?.startsWith('/team/')) return teamMock(JSON.parse(body) as Record<string, unknown>, res);
      if (req.url?.startsWith('/slow/')) return slowMock(JSON.parse(body) as Record<string, unknown>, res);
      if (req.url?.startsWith('/ds/')) return deepseekMock(req.url, JSON.parse(body) as Record<string, unknown>, res);
      for (const [prefix, fn] of [['/claude/', claudeMock], ['/gem/', geminiMock], ['/oai/', openaiMock]] as const) {
        if (!req.url?.startsWith(prefix) || /count_tokens|countTokens/.test(req.url)) continue;
        const j = JSON.parse(body) as Record<string, unknown>;
        nativeBodies.push({ url: req.url, body: j, headers: req.headers });
        return fn(j, res);
      }
      if (req.url?.includes('count_tokens')) return (res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify({ input_tokens: 4321 })));
      if (req.url?.includes(':countTokens')) return (res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify({ totalTokens: 1234 })));
      const j = JSON.parse(body) as { tool_choice?: unknown };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({ choices: [{ delta: { content: 'Hello ' } }] });
      send({ choices: [{ delta: { content: 'world' } }] });
      if (j.tool_choice && j.tool_choice !== 'auto') {
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read-sheet', arguments: '{"path":"/she' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ets/finances.xlsx"}' } }] } }] });
      }
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 321, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 21 } } });
      res.end('data: [DONE]\n\n');
    });
  }).listen(5298, '127.0.0.1');

  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, WORKCRAFT_FIRST_PROJECT: 'sample', WORKCRAFT_HOME: HOME, WORKCRAFT_PORT: String(PORT), WORKCRAFT_DEV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
  for (let i = 0; i < 100; i++) {
    try {
      await api('/api/health');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  mcp = new Client({ name: 'test', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
});

after(async () => {
  await mcp?.close().catch(() => {});
  proc?.kill();
  mock?.close();
  rmSync(HOME, { recursive: true, force: true });
});

test('Sample project is created', async () => {
  const p = await api<{ active: { name: string }; projects: unknown[] }>('/api/projects');
  assert.equal(p.active.name, 'Sample project');
  const tree = await api<{ entries: { path: string }[] }>('/api/files/tree');
  const paths = tree.entries.map((e) => e.path);
  for (const f of ['/sheets/finances.xlsx', '/documents/proposal.docx', '/presentations/start.pptx', '/pdf/contract.pdf']) assert.ok(paths.includes(f), f);
});

test('Security: foreign origin and foreign host are rejected', async () => {
  const r1 = await fetch(`${BASE}/api/projects`, { headers: { origin: 'https://evil.example' } });
  assert.equal(r1.status, 403);
  // fetch does not allow its own Host header, so node:http (DNS rebinding protection)
  const { request } = await import('node:http');
  // Windows reports closing the socket after the 403 as an asynchronous read ECONNRESET, sometimes
  // after the test has finished. Drain the response, close the socket ourselves and swallow errors
  // that arrive once the status is known.
  const status = await new Promise<number>((resolve, reject) => {
    let settled = false;
    const req = request({ host: '127.0.0.1', port: PORT, path: '/api/projects', agent: false, headers: { host: 'evil.example:5297', connection: 'close' } }, (res) => {
      settled = true;
      res.on('error', () => {});
      res.on('end', () => req.destroy());
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', (e) => {
      if (!settled) reject(e);
    });
    req.on('socket', (s) => s.on('error', () => {}));
    req.end();
  });
  assert.equal(status, 403);
  // .. is normalized inside the project: no access to files outside
  const r3 = await fetch(`${BASE}/api/files/raw?path=/../../etc/passwd`);
  assert.ok(r3.status === 400 || r3.status === 404, String(r3.status));
});

test('MCP: tool list with Zod schemas', async () => {
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['read-sheet', 'write-sheet', 'write-document', 'create-slide', 'sign-pdf', 'run-command']) assert.ok(names.includes(n), n);
  const bad = await call('read-sheet', { path: 42 });
  assert.ok(bad.isError && /path/.test(bad.text));
});

test('GridCraft: read-sheet evaluates formulas and dynamic arrays', async () => {
  const r = await call('read-sheet', { path: '/sheets/finances.xlsx' });
  assert.ok(!r.isError, r.text);
  const rows = r.data!.rows as unknown[][];
  assert.equal(rows[1]![3], 16300); // D2 = B2-C2
  assert.equal(rows[5]![1], 227150); // B6 = SUM(B2:B5)
  assert.equal(rows[7]![1], 66400); // SORT, spills from B8
  assert.equal(rows[10]![1], 48200);
});

test('Chain: read a sheet, write a report, create slides', async () => {
  const w = await call('write-document', { path: '/reports/quarter.docx', markdown: '# Quarterly report\n\n| Quarter | Revenue |\n|---|---|\n| Q1 | 48200 |\n\n- Growth in every quarter' });
  assert.ok(!w.isError, w.text);
  assert.deepEqual(w.data!.changed, ['/reports/quarter.docx']);
  const back = await call('read-document', { path: '/reports/quarter.docx' });
  assert.match(back.text, /Quarterly report/);
  assert.match(back.text, /48200/);
  const s = await call('create-slide', { path: '/presentations/quarter.pptx', slides: [{ title: 'Revenue', bullets: ['Q1 48,200'] }, { title: 'Costs', bullets: [] }, { title: 'Outlook', bullets: ['Q1 2027'] }] });
  assert.ok(!s.isError, s.text);
  const more = await call('create-slide', { path: '/presentations/quarter.pptx', slides: [{ title: 'Appendix', bullets: [] }], mode: 'append' });
  assert.match(more.text, /4 in total/);
  const read = await call('read-slides', { path: '/presentations/quarter.pptx' });
  assert.match(read.text, /Slide 4: Appendix/);
});

test('write-sheet adds cells and formulas', async () => {
  const w = await call('write-sheet', { path: '/sheets/new.xlsx', cells: { A1: 'Value', A2: 2, A3: 3, A4: '=SUM(A2:A3)' } });
  assert.ok(!w.isError, w.text);
  const r = await call('read-sheet', { path: '/sheets/new.xlsx' });
  assert.equal((r.data!.rows as unknown[][])[3]![0], 5);
});

test('PDF: read, and sign only with approval', async () => {
  const r = await call('read-pdf', { path: '/pdf/contract.pdf' });
  assert.match(r.text, /Sample contract/);
  const denied = await call('sign-pdf', { path: '/pdf/contract.pdf', name: 'Mara Lindt' });
  assert.ok(denied.isError && /confirmation/.test(denied.text));
  const args = { path: '/pdf/contract.pdf', name: 'Mara Lindt' };
  const { token } = await api<{ token: string }>('/api/approvals', json('POST', { tool: 'sign-pdf', args }));
  const ok = await call('sign-pdf', args, { 'workcraft/approval': token });
  assert.ok(!ok.isError, ok.text);
  const again = await call('sign-pdf', args, { 'workcraft/approval': token });
  assert.ok(again.isError, 'a token is valid only once');
});

test('Projects: create, rename, export, import, delete', async () => {
  const p = await api<{ id: string }>('/api/projects', json('POST', { name: 'Test project', template: 'empty' }));
  await api('/api/files/raw?path=/note.md', { method: 'PUT', body: '# Note' });
  await api(`/api/projects/${p.id}`, json('PATCH', { name: 'Renamed' }));
  await api('/api/chats/chat-abc1', json('PUT', { id: 'chat-abc1', title: 'T', messages: [{ role: 'user', text: 'Hello' }] }));
  const zip = new Uint8Array(await (await fetch(`${BASE}/api/projects/${p.id}/export`)).arrayBuffer());
  const files = unzipSync(zip);
  assert.ok(files['note.md']);
  assert.ok(files['.workcraft/chats/chat-abc1.json']);
  assert.equal(JSON.parse(strFromU8(files['.workcraft/project.json']!)).name, 'Renamed');
  const imported = await api<{ id: string; name: string }>('/api/projects/import?name=x.zip', { method: 'POST', body: zip });
  assert.equal(imported.name, 'Renamed');
  assert.notEqual(imported.id, p.id);
  await api(`/api/projects/${p.id}`, { method: 'DELETE' });
  const list = await api<{ projects: { id: string }[] }>('/api/projects');
  assert.ok(!list.projects.find((x) => x.id === p.id));
  const bad = await fetch(`${BASE}/api/projects/import`, { method: 'POST', body: 'not a zip' });
  assert.equal(bad.status, 422);
});

test('AI router: own endpoint, connection test and streaming with a tool call', async () => {
  const { id } = await api<{ id: string }>('/api/config/custom', json('POST', { name: 'Local test', baseUrl: 'http://127.0.0.1:5298/v1', model: 'test-model' }));
  const t = await api<{ ok: boolean; models: string[] }>('/api/ai/test', json('POST', { id }));
  assert.ok(t.ok && t.models.includes('test-model'));
  const res = await fetch(`${BASE}/api/ai/chat`, json('POST', { provider: id, system: 's', turns: [{ role: 'user', content: 'hi' }], tools: [{ name: 'read-sheet', description: 'x', parameters: { type: 'object' } }], toolChoice: { name: 'read-sheet' } }));
  const text = await res.text();
  const events = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)) as { type: string; delta?: string; call?: { name: string; args: Record<string, unknown> } });
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), 'Hello world');
  const tc = events.find((e) => e.type === 'tool_call');
  assert.equal(tc?.call?.name, 'read-sheet');
  assert.equal(tc?.call?.args.path, '/sheets/finances.xlsx');
  const cfg = await api<{ ai: { custom: { id: string; hasKey: boolean }[] } }>('/api/config');
  assert.ok(cfg.ai.custom.find((c) => c.id === id));
  const noKey = await fetch(`${BASE}/api/ai/chat`, json('POST', { provider: 'anthropic', system: 's', turns: [{ role: 'user', content: 'hi' }] }));
  assert.match(await noKey.text(), /"code":"AUTH"/);
  // Usage of the stream: exact numbers of the endpoint, right before done
  const u = events.find((e) => e.type === 'usage') as unknown as { usage: { input: number; output: number; cached: number; estimated: boolean } };
  assert.deepEqual([u.usage.input, u.usage.output, u.usage.cached, u.usage.estimated], [321, 12, 21, false]);
  customId = id;
});

let customId = '';
test('Usage: totals per provider and model, rates, reset keeps the rates', async () => {
  const st = await api<{ rows: Record<string, { requests: number; input: number; output: number; cached: number; model: string }>; rates: Record<string, unknown> }>('/api/usage');
  const row = st.rows[`${customId}|test-model`]!;
  assert.ok(row, JSON.stringify(Object.keys(st.rows)));
  assert.deepEqual([row.requests, row.input, row.output, row.cached], [1, 321, 12, 21]);
  const rated = await api<{ rates: Record<string, { input: number; output: number }> }>('/api/usage/rates', json('PUT', { 'test-model': { input: 3, output: 15 } }));
  assert.equal(rated.rates['test-model']!.output, 15);
  const bad = await fetch(`${BASE}/api/usage/rates`, json('PUT', { 'test-model': { input: -1, output: 2 } }));
  assert.equal(bad.status, 400);
  const reset = await api<{ rows: Record<string, unknown>; rates: Record<string, unknown> }>('/api/usage', { method: 'DELETE' });
  assert.equal(Object.keys(reset.rows).length, 0);
  assert.ok(reset.rates['test-model']);
});

test('Chat history: list across projects and clear the active project', async () => {
  await api('/api/chats/chat-hist1', json('PUT', { id: 'chat-hist1', title: 'History test', updated: new Date().toISOString(), messages: [{ role: 'user', text: 'x' }] }));
  const all = await api<{ id: string; project: string; projectName: string }[]>('/api/chats?scope=all');
  const mine = all.find((c) => c.id === 'chat-hist1');
  assert.ok(mine && mine.project && mine.projectName);
  const cleared = await api<{ removed: number }>('/api/chats', { method: 'DELETE' });
  assert.ok(cleared.removed >= 1);
  assert.equal((await api<unknown[]>('/api/chats')).length, 0);
});

// ---------------------------------------------------------------- DeepSeek

const tok = BpeTokenizer.fromBytes(new Uint8Array(readFileSync('public/assets/tokenizers/deepseek-v4.bin')));

test('DeepSeek V4 tokenizer: exact token ids and counts for known strings', async () => {
  // Reference ids from the official tokenizer.json with Hugging Face tokenizers 0.23 (encode without special tokens)
  const known: [string, number[]][] = [
    ['Hello!', [19923, 3]],
    ['Hello world', [19923, 2058]],
    ['Größenänderung über Ähnlichkeit ß', [32882, 2061, 25820, 67334, 1617, 13785, 43175, 15288, 60835, 1067, 256]],
    ['你好，世界！这是一个测试。', [30594, 303, 3427, 1175, 28669, 10251, 320]],
    ['emoji 😀👍🏽 family 👨‍👩‍👧', [18872, 7063, 53769, 225, 92526, 40965, 124, 3096, 52780, 104, 46088, 25730, 105, 46088, 25730, 103]],
    ['<｜User｜>hi<｜Assistant｜>hello<｜end▁of▁sentence｜>', [128803, 6366, 128804, 33310, 1]],
    ['<think>reasoning</think>answer', [128821, 86512, 288, 128822, 19995]],
    ['def fib(a):\n    return fib(a-1) + fib(a-2)\n', [3465, 10150, 6036, 3395, 361, 1354, 10150, 6036, 15, 19, 11, 940, 10150, 6036, 15, 20, 682]],
    ['{"path":"/sheets/finances.xlsx","range":"A1:E6"}', [24313, 9860, 16562, 17, 92604, 11686, 261, 3088, 10774, 101421, 10177, 16801, 16562, 35, 19, 107642, 24, 62773]],
  ];
  for (const [text, ids] of known) {
    assert.deepEqual(tok.encode(text), ids, text);
    assert.equal(tok.count(text), ids.length, text);
  }
  assert.equal(tok.header.mergeCount, 127741);
  assert.equal(tok.special('<｜fim▁hole｜>'), 128800);
  assert.equal(tok.count(''), 0);
  // The backend counts with the same asset
  const r = await api<{ tokens: number; request: { total: number; exact: boolean; tools: number } }>('/api/ai/count', json('POST', { text: 'Hello!', request: { system: 'You are a test.', turns: [{ role: 'user', content: 'Hello!' }], tools: [{ name: 'read-sheet', description: 'Read', parameters: { type: 'object' } }] } }));
  assert.equal(r.tokens, 2);
  assert.equal(r.request.exact, true);
  assert.ok(r.request.tools > 0 && r.request.total > r.request.tools);
  // Pre-flight count of a request: chat template special tokens count as one token each
  const c = countRequest({ system: 'S', turns: [{ role: 'user', content: 'Hello!' }], tools: [] }, (s) => tok.count(s));
  assert.equal(c.system, 2); // <｜begin▁of▁sentence｜> S
  assert.equal(c.history, 4); // <｜User｜> Hello ! <｜Assistant｜>
  assert.equal(contextWindow('deepseek-flash'), 1_000_000);
});

/** Reads the SSE events of one /api/ai/chat request. */
async function chatEvents(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/ai/chat`, json('POST', body));
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => JSON.parse(l.slice(5)) as { type: string; delta?: string; tokens?: number; call?: { id: string; name: string; args: Record<string, unknown>; repaired?: string[] }; usage?: TokenUsage; budget?: { exact: boolean; after: number; window: number; actions: string[] }; reasoning?: string; stop?: string; replay?: ReplayState; error?: { message: string }; providerId?: string; effort?: string });
}

const TOOLS = [
  { name: 'write-document', description: 'Write', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'read-sheet', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
];

test('DeepSeek SSE: reasoning_content, content and a multi-step MCP tool chain', async () => {
  await api('/api/config/provider', json('PUT', { id: 'deepseek', apiKey: 'test-key', baseUrl: 'http://127.0.0.1:5298/ds/v1', model: 'deepseek-chat' }));
  await api('/api/config/deepseek', json('PUT', { preset: 'reasoning' }));
  dsBodies.length = 0;
  const turns: ChatTurn[] = [{ role: 'user', content: 'Write a report about @finances.xlsx' }];
  const base = { provider: 'deepseek', system: 'Core system prompt.', context: 'Active project: Sample project.', tools: TOOLS };

  // Step 1: thinking, then text, then a tool call
  const ev1 = await chatEvents({ ...base, turns });
  const types = ev1.map((e) => e.type);
  assert.equal(types[0], 'budget');
  assert.equal(types[1], 'start');
  assert.ok(types.indexOf('reasoning') < types.indexOf('text') && types.indexOf('text') < types.indexOf('tool_call'), types.join(','));
  const budget = ev1[0]!.budget!;
  assert.equal(budget.exact, true);
  assert.equal(budget.window, 1_000_000);
  assert.ok(budget.after > 0 && !budget.actions.length);
  const reasoning1 = ev1.filter((e) => e.type === 'reasoning').map((e) => e.delta).join('');
  assert.equal(reasoning1, 'The user wants a report. Read the sheet first.');
  assert.equal(ev1.find((e) => e.type === 'reasoning')?.tokens, tok.count('The user wants '));
  const call1 = ev1.find((e) => e.type === 'tool_call')!.call!;
  assert.deepEqual([call1.id, call1.name, call1.args.path], ['call_ds_1', 'read-sheet', '/sheets/finances.xlsx']);
  const u1 = ev1.find((e) => e.type === 'usage')!.usage!;
  assert.deepEqual([u1.input, u1.output, u1.cached, u1.cacheMiss, u1.reasoning, u1.estimated, u1.model], [1500, 60, 1200, 300, 40, false, 'deepseek-flash']);
  assert.equal(u1.predicted, budget.after);
  assert.equal(ev1.find((e) => e.type === 'done')?.reasoning, reasoning1);

  // Request body: legacy name mapped, thinking parameters, fixed prefix order, sorted tools
  const b1 = dsBodies[0]!.body as { model: string; thinking: { type: string }; reasoning_effort: string; max_tokens: number; temperature?: number; tools: { function: { name: string } }[]; messages: WireMsg[]; stream_options: unknown };
  assert.equal(dsBodies[0]!.url, '/ds/chat/completions');
  assert.deepEqual([b1.model, b1.thinking.type, b1.reasoning_effort, b1.max_tokens, b1.temperature], ['deepseek-flash', 'enabled', 'high', 65536, undefined]);
  assert.deepEqual(b1.tools.map((t) => t.function.name), ['read-sheet', 'write-document']);
  assert.deepEqual(b1.messages.slice(0, 2), [{ role: 'system', content: 'Core system prompt.' }, { role: 'system', content: 'Active project: Sample project.' }]);
  assert.deepEqual(b1.stream_options, { include_usage: true });

  // Step 2: history with reasoning, tool call id and tool output; malformed arguments get repaired
  turns.push({ role: 'assistant', text: 'Reading the sheet. ', toolCalls: [{ id: call1.id, name: call1.name, args: call1.args }], reasoning: reasoning1 });
  turns.push({ role: 'tool', results: [{ id: call1.id, name: call1.name, content: 'Q1 48200', isError: false }] });
  const ev2 = await chatEvents({ ...base, turns });
  const call2 = ev2.find((e) => e.type === 'tool_call')!.call!;
  assert.deepEqual([call2.id, call2.name, call2.args.path, call2.args.markdown], ['call_ds_2', 'write-document', '/documents/r.md', '# Report']);
  assert.ok(call2.repaired?.includes('converted single quotes') && call2.repaired.includes('removed trailing commas'), String(call2.repaired));
  const b2 = dsBodies[1]!.body as { messages: WireMsg[] };
  const a2 = b2.messages.find((m) => m.role === 'assistant')!;
  assert.equal(a2.reasoning_content, reasoning1);
  assert.equal(a2.tool_calls?.[0]?.id, 'call_ds_1');
  assert.equal(b2.messages.find((m) => m.role === 'tool')?.tool_call_id, 'call_ds_1');
  // The prompt only grows at the end: the previous request is a prefix of this one (cache hit)
  assert.deepEqual(b2.messages.slice(0, b1.messages.length), b1.messages);

  // Step 3: final answer
  const reasoning2 = ev2.filter((e) => e.type === 'reasoning').map((e) => e.delta).join('');
  turns.push({ role: 'assistant', text: '', toolCalls: [{ id: call2.id, name: call2.name, args: call2.args }], reasoning: reasoning2 });
  turns.push({ role: 'tool', results: [{ id: call2.id, name: call2.name, content: 'Saved /documents/r.md', isError: false }] });
  const ev3 = await chatEvents({ ...base, turns });
  assert.equal(ev3.filter((e) => e.type === 'text').map((e) => e.delta).join(''), 'Report written to /documents/r.md.');
  assert.equal(ev3.find((e) => e.type === 'done')?.stop, 'stop');
  assert.ok(!ev3.some((e) => e.type === 'error'));

  // An assistant turn without stored reasoning (other provider earlier) still sends reasoning_content
  const mixed: ChatTurn[] = [{ role: 'user', content: 'x' }, { role: 'assistant', text: 'from Claude', toolCalls: [] }, { role: 'user', content: 'y' }];
  const ev4 = await chatEvents({ ...base, turns: mixed });
  assert.ok(!ev4.some((e) => e.type === 'error'), JSON.stringify(ev4.find((e) => e.type === 'error')));
  assert.equal((dsBodies.at(-1)!.body as { messages: WireMsg[] }).messages.find((m) => m.role === 'assistant')?.reasoning_content, '');

  // A forced tool (/ command) runs without thinking: named tool_choice is rejected in thinking mode
  await chatEvents({ ...base, turns: [{ role: 'user', content: '/read-sheet' }], toolChoice: { name: 'read-sheet' } });
  const forced = dsBodies.at(-1)!.body as { thinking: { type: string }; tool_choice: unknown; max_tokens: number };
  assert.deepEqual([forced.thinking.type, forced.tool_choice, forced.max_tokens], ['disabled', { type: 'function', function: { name: 'read-sheet' } }, 8192]);
});

test('Usage telemetry: prompt_cache_hit_tokens and prompt_cache_miss_tokens per model', async () => {
  const st = await api<{ rows: Record<string, { requests: number; input: number; cached: number; cacheMiss: number; reasoning: number }> }>('/api/usage');
  const row = st.rows['deepseek|deepseek-flash']!;
  assert.ok(row, Object.keys(st.rows).join(', '));
  // Five chat requests of the previous test: three scripted steps, the mixed history (step 1 again) and the forced call (step 1, no thinking)
  assert.equal(row.requests, 5);
  assert.equal(row.cached, 1200 + 1500 + 1700 + 1200 + 1200);
  assert.equal(row.cacheMiss, 300 + 200 + 100 + 300 + 300);
  assert.equal(row.input, row.cached + row.cacheMiss);
  assert.equal(row.reasoning, 40 + 30 + 6 + 40 + 40);
  // Ratio and savings from the rate table (US dollars per million tokens)
  const store = emptyUsage();
  const u: TokenUsage = { input: 2000, output: 100, cached: 1500, cacheMiss: 500, reasoning: 60, estimated: false, firstMs: 10, totalMs: 100, provider: 'DeepSeek', providerId: 'deepseek', model: 'deepseek-flash', local: false };
  addUsage(store, u);
  addUsage(store, { ...u, cached: 500, cacheMiss: 1500 });
  const r = store.rows['deepseek|deepseek-flash']!;
  assert.deepEqual([r.cached, r.cacheMiss, r.reasoning], [2000, 2000, 120]);
  assert.equal(cacheHitRatio(r), 0.5);
  store.rates['deepseek-flash'] = { input: 0.3, output: 1.2, cached: 0.03 };
  assert.equal(cacheSavings(r, store.rates).toFixed(6), ((2000 * (0.3 - 0.03)) / 1e6).toFixed(6));
  assert.equal(usageTotals(store).cacheMiss, 2000);
  assert.equal(cacheSavings({ ...r, local: true }, store.rates), 0);
});

test('FIM and prefix completion (DeepSeek beta) with JSON repair', async () => {
  dsBodies.length = 0;
  const f = await api<{ text: string; via: string; usage: TokenUsage }>('/api/ai/complete', json('POST', { provider: 'deepseek', mode: 'fim', prompt: 'def fib(a):\n', suffix: '\n\nprint(fib(10))', maxTokens: 6000 }));
  assert.equal(f.via, 'deepseek-fim');
  assert.match(f.text, /return fib/);
  const fb = dsBodies[0]!;
  assert.equal(fb.url, '/ds/beta/completions');
  assert.deepEqual([fb.body.model, fb.body.prompt, fb.body.suffix], ['deepseek-flash', 'def fib(a):\n', '\n\nprint(fib(10))']);
  assert.ok((fb.body.max_tokens as number) <= 4096);
  const p = await api<{ text: string; via: string; json: { title: string; rows: number[] }; repaired: boolean }>('/api/ai/complete', json('POST', { provider: 'deepseek', mode: 'prefix', prompt: '{', instruction: 'Sum up the quarter as JSON', json: true }));
  assert.equal(p.via, 'deepseek-prefix');
  assert.deepEqual(p.json, { title: 'Q1', rows: [1, 2] });
  assert.equal(p.repaired, true);
  const pb = dsBodies[1]!;
  assert.equal(pb.url, '/ds/beta/chat/completions');
  const msgs = pb.body.messages as { role: string; content: string; prefix?: boolean }[];
  assert.deepEqual(msgs.at(-1), { role: 'assistant', content: '{', prefix: true });
  assert.deepEqual([pb.body.response_format, pb.body.thinking], [{ type: 'json_object' }, { type: 'disabled' }]);
});

test('Repair pass: malformed tool JSON and unclosed code fences', () => {
  assert.deepEqual(repairJson('```json\n{path: \'/a.md\', ok: True, n: 1e3,}\n```')?.value, { path: '/a.md', ok: true, n: 1000 });
  assert.deepEqual(repairJson('{"a": 1, "b": "cut off')?.value, { a: 1, b: 'cut off' });
  assert.deepEqual(repairJson('{"a": [1, 2')?.value, { a: [1, 2] });
  assert.deepEqual(repairJson('{"a": 1, "b":')?.value, { a: 1, b: null });
  assert.deepEqual(repairJson('Here you go: {"x": "line\nbreak"} // done')?.value, { x: 'line\nbreak' });
  assert.equal(repairJson('not json at all'), null);
  assert.deepEqual(repairArgs('{"ok": true}'), { args: { ok: true } });
  assert.ok('argsError' in repairArgs('call it with path please'));
  assert.deepEqual(closeOpenFences('Text\n```ts\nconst a = 1;'), { text: 'Text\n```ts\nconst a = 1;\n```', closed: true });
  assert.equal(closeOpenFences('```\nx\n```').closed, false);
});

test('Context budget: harness pruning, attachment chunking and tool-pair safe cuts', () => {
  const count = (s: string) => tok.count(s);
  const big = 'Quarter revenue cost margin '.repeat(12_000);
  // 1. Fits: nothing changes
  const small = fitRequest({ system: 's', turns: [{ role: 'user', content: 'hi' }], tools: [], toolChoice: 'auto' }, { window: 100_000, reserve: 8192, count });
  assert.deepEqual([small.report.actions.length, small.overflow], [0, false]);
  // 2. Slightly too large: max_tokens goes down first
  const near = fitRequest({ system: 's', turns: [{ role: 'user', content: big.slice(0, 40_000) }], tools: [], toolChoice: 'auto' }, { window: 12_000, reserve: 8192, count });
  assert.ok(near.report.maxTokens && near.report.maxTokens < 8192 && near.report.maxTokens >= 4096, String(near.report.maxTokens));
  // 3. Large @-attachment: chunked head and tail with a note for the model
  const user = `Summarize\n\n<context>\n<entry type="file" ref="@big.csv" path="/sheets/big.csv">\n${big}\n</entry>\n</context>`;
  const turns: ChatTurn[] = [
    { role: 'user', content: 'old question' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'read-sheet', args: {} }] },
    { role: 'tool', results: [{ id: 'c1', name: 'read-sheet', content: 'x'.repeat(40_000), isError: false }] },
    { role: 'assistant', text: 'old answer', toolCalls: [] },
    { role: 'user', content: user },
  ];
  const fit = fitRequest({ system: 's', turns, tools: [], toolChoice: 'auto' }, { window: 32_000, reserve: 8192, count });
  assert.equal(fit.overflow, false);
  assert.ok(fit.report.after <= 32_000 - 4096, `${fit.report.after}`);
  assert.ok(fit.report.before > fit.report.after);
  assert.ok(fit.report.actions.some((a) => a.includes('earlier tool results pruned')), fit.report.actions.join(' | '));
  assert.ok(fit.report.actions.some((a) => a.includes('/sheets/big.csv')), fit.report.actions.join(' | '));
  const last = fit.req.turns.at(-1) as Extract<ChatTurn, { role: 'user' }>;
  assert.match(last.content, /left out to fit the context window/);
  assert.match(last.content, /^Summarize/);
  // The stored history is untouched
  assert.equal((turns[2] as Extract<ChatTurn, { role: 'tool' }>).results[0]!.content.length, 40_000);
  // 4. Cuts only before a user turn: the result never starts with a tool output
  const tiny = fitRequest({ system: 's', turns, tools: [], toolChoice: 'auto' }, { window: 9_000, reserve: 4096, count });
  assert.equal(tiny.req.turns[0]!.role, 'user');
  assert.ok(!tiny.req.turns.some((t, i) => t.role === 'tool' && tiny.req.turns[i - 1]?.role !== 'assistant'));
  // Pruning keeps head and tail by code point
  const pruned = pruneText('ä'.repeat(PRUNE.thresholdChars * 2));
  assert.ok(pruned.startsWith('ä'.repeat(PRUNE.headChars)) && pruned.endsWith('ä'.repeat(PRUNE.tailChars)) && pruned.includes('pruned'));
  // Preset rules of the API reference
  assert.deepEqual(resolveDeepSeekParams({ preset: 'coding' }, { model: 'deepseek-flash' }).params, { thinking: false, maxTokens: 8192, temperature: 0 });
  assert.deepEqual(resolveDeepSeekParams({ preset: 'max', temperature: 1.5 }, { model: 'deepseek-v4-pro' }).params, { thinking: true, effort: 'max', maxTokens: 131072 });
  assert.equal(resolveDeepSeekParams({ preset: 'reasoning', maxTokens: 10_000_000 }, { model: 'deepseek-flash' }).params.maxTokens, 393216);
  // Older settings still carry deepseek-chat: the model maps to deepseek-flash, the preset decides about thinking
  const legacy = resolveDeepSeekParams({ preset: 'reasoning' }, { model: 'deepseek-chat' });
  assert.deepEqual([legacy.model, legacy.params.thinking], ['deepseek-flash', true]);
});

// ---------------------------------------------------------------- Claude, Gemini, ChatGPT

type Json = Record<string, unknown>;
const keysDeep = (o: unknown, out = new Set<string>()): Set<string> => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (out.add(k), keysDeep(v, out));
  return out;
};

test('Schema compiler: OpenAI and Claude strict mode, Gemini functionDeclarations for every MCP tool', () => {
  const specs = toolSpecs();
  const schemaOf = (n: string) => specs.find((s) => s.name === n)!.parameters;
  // OpenAI strict: every property required, optional ones nullable, no additionalProperties, constraints in the description
  const o = compileToolSchema(schemaOf('read-sheet'), 'openai-strict');
  const op = o.parameters as { required: string[]; additionalProperties: boolean; properties: Record<string, Json> };
  assert.equal(o.strict, true);
  assert.deepEqual(op.required, ['path', 'sheet', 'range']);
  assert.equal(op.additionalProperties, false);
  assert.deepEqual(op.properties.sheet!.type, ['string', 'null']);
  assert.equal(op.properties.range!.pattern, undefined);
  assert.match(String(op.properties.range!.description), /pattern \^\[A-Za-z\]/);
  assert.match(String(op.properties.path!.description), /min length 1/);
  // Claude strict: additionalProperties false, required as declared
  const a = compileToolSchema(schemaOf('create-slide'), 'anthropic-strict');
  const ap = a.parameters as { required: string[]; additionalProperties: boolean; properties: { slides: { items: { additionalProperties: boolean; required: string[] } } } };
  assert.equal(a.strict, true);
  assert.deepEqual(ap.required, ['path', 'slides']);
  assert.equal(ap.additionalProperties, false);
  assert.equal(ap.properties.slides.items.additionalProperties, false);
  assert.deepEqual(ap.properties.slides.items.required, ['title']);
  // Maps (write-sheet cells) cannot be strict
  assert.equal(compileToolSchema(schemaOf('write-sheet'), 'openai-strict').strict, false);
  assert.equal(compileToolSchema(schemaOf('write-sheet'), 'anthropic-strict').strict, false);
  // Gemini: only the OpenAPI subset, upper-case types, maps as JSON strings, for every tool
  for (const s of specs) {
    const g = compileToolSchema(s.parameters, 'gemini').parameters;
    if (!g) continue;
    const keys = keysDeep(g);
    const bad = ['additionalProperties', '$schema', 'propertyNames', 'pattern', 'default', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf', 'const'].filter((k) => keys.has(k));
    assert.deepEqual(bad, [], s.name);
    assert.equal((g as Json).type, 'OBJECT', s.name);
  }
  const gw = compileToolSchema(schemaOf('write-sheet'), 'gemini').parameters as { properties: Record<string, Json> };
  assert.equal(gw.properties.cells!.type, 'STRING');
  assert.match(String(gw.properties.cells!.description), /JSON object/);
  assert.deepEqual(gw.properties.mode!.enum, ['merge', 'replace']);
  const gs = compileToolSchema(schemaOf('create-slide'), 'gemini').parameters as { properties: { slides: { type: string; items: { type: string; properties: { bullets: { type: string } } } } } };
  assert.deepEqual([gs.properties.slides.type, gs.properties.slides.items.type, gs.properties.slides.items.properties.bullets.type], ['ARRAY', 'OBJECT', 'ARRAY']);
  // Arguments back in the original shape, then the Zod check passes
  const fromOpenAI = normalizeToolArgs(schemaOf('read-sheet'), { path: '/sheets/finances.xlsx', sheet: null, range: null }, 'openai-strict');
  assert.deepEqual(fromOpenAI, { path: '/sheets/finances.xlsx' });
  assert.ok(validateArgs('read-sheet', fromOpenAI).ok);
  const fromGemini = normalizeToolArgs(schemaOf('write-sheet'), { path: '/sheets/new.xlsx', cells: '{"A1": "Revenue", "B1": 5}' }, 'gemini');
  assert.deepEqual(fromGemini.cells, { A1: 'Revenue', B1: 5 });
  assert.ok(validateArgs('write-sheet', fromGemini).ok);
});

/** Size of the sample contract PDF, for the native document reference. */
async function pdfRef() {
  // The active project may be another one by now: put a small PDF where the tests expect it
  const pdf = '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n';
  await api('/api/files/raw?path=/pdf/contract.pdf', { method: 'PUT', body: pdf });
  return { path: '/pdf/contract.pdf', mime: 'application/pdf', size: pdf.length };
}
const userWithPdf = async (): Promise<ChatTurn> => ({ role: 'user', content: 'Summarize @contract.pdf\n\n<context>\n<entry type="file" ref="@contract.pdf" path="/pdf/contract.pdf">\nSample contract text\n</entry>\n</context>', docs: [await pdfRef()] });
const textOf = (evs: Awaited<ReturnType<typeof chatEvents>>, type: string) => evs.filter((e) => e.type === type).map((e) => e.delta).join('');

test('Claude: adaptive thinking, signatures across a tool chain, cache breakpoints, native PDF, strict tools', async () => {
  await api('/api/config/provider', json('PUT', { id: 'anthropic', apiKey: 'test-key', baseUrl: 'http://127.0.0.1:5298/claude', model: 'claude-opus-5-5' }));
  nativeBodies.length = 0;
  nativeRejects = 0;
  const turns: ChatTurn[] = [await userWithPdf()];
  const base = { provider: 'anthropic', system: 'Core system prompt.', context: 'Active project: Sample project.', tools: TOOLS, effort: 'high', meta: { chat: 'chat-claude' } };
  const ev1 = await chatEvents({ ...base, turns });
  assert.ok(!ev1.some((e) => e.type === 'error'), JSON.stringify(ev1.find((e) => e.type === 'error')));
  assert.equal(textOf(ev1, 'reasoning'), 'Read the sheet first. Then answer.');
  const start = ev1.find((e) => e.type === 'start')!;
  assert.deepEqual([start.providerId, start.effort], ['anthropic', 'high']);
  const call = ev1.find((e) => e.type === 'tool_call')!.call!;
  assert.deepEqual([call.id, call.name, call.args.path], ['toolu_1', 'read-sheet', '/sheets/finances.xlsx']);
  const done = ev1.find((e) => e.type === 'done')!;
  assert.equal(done.replay?.provider, 'anthropic');
  assert.deepEqual(done.replay?.items[0], { type: 'thinking', thinking: 'Read the sheet first. Then answer.', signature: 'sig-claude-1' });
  const u = ev1.find((e) => e.type === 'usage')!.usage!;
  assert.deepEqual([u.input, u.cached, u.cacheWrite, u.cacheMiss, u.output, u.estimated], [2400, 2000, 300, 400, 80, false]);

  const b1 = nativeBodies[0]!;
  const body = b1.body as { thinking: Json; output_config: Json; tools: Json[]; system: Json[]; messages: { content: Json[] }[]; temperature?: number; tool_choice: Json; max_tokens: number };
  assert.equal(b1.url, '/claude/v1/messages');
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.deepEqual(body.output_config, { effort: 'high' });
  assert.equal(b1.headers['anthropic-beta'], 'thinking-binding-controls-2026-08-01');
  assert.equal(body.temperature, undefined);
  assert.deepEqual(body.tool_choice, { type: 'auto' });
  assert.equal(body.max_tokens, 64000);
  // Cache breakpoints: last tool, end of the system prompt, the document, end of the conversation
  assert.deepEqual(body.tools.map((t) => t.name), ['read-sheet', 'write-document']);
  assert.deepEqual(body.tools.at(-1)!.cache_control, { type: 'ephemeral' });
  assert.equal(body.tools.find((t) => t.name === 'read-sheet')!.strict, true);
  assert.equal((body.tools[0]!.input_schema as Json).additionalProperties, false);
  assert.deepEqual(body.system.map((s) => s.text), ['Core system prompt.', 'Active project: Sample project.']);
  assert.deepEqual(body.system.at(-1)!.cache_control, { type: 'ephemeral' });
  const content = body.messages[0]!.content;
  assert.equal(content[0]!.type, 'document');
  assert.match(String((content[0]!.source as Json).data), /^JVBER/);
  assert.deepEqual(content[0]!.cache_control, { type: 'ephemeral' });
  assert.match(String(content.at(-1)!.text), /PDF attached as a native document block/);
  assert.doesNotMatch(String(content.at(-1)!.text), /Sample contract text/);
  assert.deepEqual(content.at(-1)!.cache_control, { type: 'ephemeral' });
  assert.equal(JSON.stringify(body).split('cache_control').length - 1, 4);

  // Step 2: thinking block with its signature first in the assistant turn, tool_result first in the user turn
  turns.push({ role: 'assistant', text: 'Reading. ', toolCalls: [{ id: call.id, name: call.name, args: call.args }], reasoning: done.reasoning!, replay: done.replay! });
  turns.push({ role: 'tool', results: [{ id: call.id, name: call.name, content: 'Q1 48200', isError: false }] });
  const ev2 = await chatEvents({ ...base, turns });
  assert.ok(!ev2.some((e) => e.type === 'error'), JSON.stringify(ev2.find((e) => e.type === 'error')));
  assert.equal(nativeRejects, 0);
  assert.equal(textOf(ev2, 'text'), 'Revenue grew.');
  const b2 = nativeBodies[1]!.body as { messages: { role: string; content: Json[] }[] };
  assert.deepEqual(b2.messages[1]!.content.map((b) => b.type), ['thinking', 'text', 'tool_use']);
  assert.equal(b2.messages[2]!.content[0]!.type, 'tool_result');
  // The previous request is a prefix of this one (cache): same system and tools
  assert.deepEqual((nativeBodies[1]!.body as Json).system, body.system);
  assert.deepEqual((nativeBodies[1]!.body as Json).tools, body.tools);

  // Opus 5.5 rejects forced tool_choice: auto, the prompt names the tool
  await chatEvents({ ...base, turns: [{ role: 'user', content: '/read-sheet' }], toolChoice: { name: 'read-sheet' } });
  assert.deepEqual((nativeBodies.at(-1)!.body as Json).tool_choice, { type: 'auto' });
  // Sonnet 5.5, effort off: between_tools, no block_binding and no beta header
  await chatEvents({ ...base, model: 'claude-sonnet-5-5', effort: 'off', turns: [{ role: 'user', content: 'hi' }] });
  const off = nativeBodies.at(-1)!;
  assert.deepEqual([(off.body as Json).thinking, (off.body as Json).output_config, off.headers['anthropic-beta']], [{ type: 'between_tools' }, { effort: 'low' }, undefined]);
});

test('Gemini: thinkingConfig, thought parts and thoughtSignature across a tool chain, native PDF', async () => {
  await api('/api/config/provider', json('PUT', { id: 'gemini', apiKey: 'test-key', baseUrl: 'http://127.0.0.1:5298/gem', model: 'gemini-3-flash' }));
  nativeBodies.length = 0;
  nativeRejects = 0;
  const turns: ChatTurn[] = [await userWithPdf()];
  const base = { provider: 'gemini', system: 'Core system prompt.', context: 'Active project: Sample project.', tools: TOOLS, effort: 'medium', meta: { chat: 'chat-gem' } };
  const ev1 = await chatEvents({ ...base, turns });
  assert.ok(!ev1.some((e) => e.type === 'error'), JSON.stringify(ev1.find((e) => e.type === 'error')));
  assert.equal(textOf(ev1, 'reasoning'), 'Need the sheet first.');
  const call = ev1.find((e) => e.type === 'tool_call')!.call!;
  assert.deepEqual([call.id, call.name, call.args.path], ['gcall_1', 'read-sheet', '/sheets/finances.xlsx']);
  const done = ev1.find((e) => e.type === 'done')!;
  // Streamed thought chunks merged into one part, the signature stays on the call
  assert.deepEqual(done.replay?.items, [{ text: 'Need the sheet first.', thought: true }, { functionCall: { id: 'gcall_1', name: 'read-sheet', args: { path: '/sheets/finances.xlsx' } }, thoughtSignature: 'sig-gem-1' }]);
  const u = ev1.find((e) => e.type === 'usage')!.usage!;
  assert.deepEqual([u.input, u.cached, u.cacheMiss, u.reasoning, u.output], [1000, 600, 400, 40, 60]);
  const b1 = nativeBodies[0]!;
  const body = b1.body as { generationConfig: { thinkingConfig: Json }; tools: { functionDeclarations: Json[] }[]; systemInstruction: { parts: Json[] }; contents: { parts: Json[] }[] };
  assert.equal(b1.url, '/gem/v1beta/models/gemini-3-flash:streamGenerateContent?alt=sse');
  assert.deepEqual(body.generationConfig.thinkingConfig, { includeThoughts: true, thinkingLevel: 'medium' });
  assert.deepEqual(body.systemInstruction.parts.map((p) => p.text), ['Core system prompt.', 'Active project: Sample project.']);
  const decl = body.tools[0]!.functionDeclarations;
  assert.deepEqual(decl.map((d) => d.name), ['read-sheet', 'write-document']);
  assert.equal((decl[0]!.parameters as Json).type, 'OBJECT');
  assert.doesNotMatch(JSON.stringify(decl), /additionalProperties|\$schema|"pattern"/);
  assert.equal((body.contents[0]!.parts[0]!.inlineData as Json).mimeType, 'application/pdf');

  turns.push({ role: 'assistant', text: '', toolCalls: [call], reasoning: done.reasoning!, replay: done.replay! });
  turns.push({ role: 'tool', results: [{ id: call.id, name: call.name, content: 'Q1 48200', isError: false }] });
  const ev2 = await chatEvents({ ...base, turns });
  assert.ok(!ev2.some((e) => e.type === 'error'), JSON.stringify(ev2.find((e) => e.type === 'error')));
  assert.equal(nativeRejects, 0);
  assert.equal(textOf(ev2, 'text'), 'Revenue grew.');
  const b2 = nativeBodies[1]!.body as { contents: { role: string; parts: Json[] }[] };
  assert.equal(b2.contents[1]!.role, 'model');
  assert.equal(b2.contents[1]!.parts[1]!.thoughtSignature, 'sig-gem-1');
  assert.deepEqual(b2.contents[2]!.parts[0]!.functionResponse, { name: 'read-sheet', id: 'gcall_1', response: { content: 'Q1 48200' } });

  // A tool call from another provider's history gets the documented placeholder signature
  const foreign: ChatTurn[] = [{ role: 'user', content: 'x' }, { role: 'assistant', text: '', toolCalls: [{ id: 'toolu_9', name: 'read-sheet', args: { path: '/a.xlsx' } }] }, { role: 'tool', results: [{ id: 'toolu_9', name: 'read-sheet', content: 'ok', isError: false }] }];
  const ev3 = await chatEvents({ ...base, turns: foreign });
  assert.ok(!ev3.some((e) => e.type === 'error'));
  assert.equal(((nativeBodies.at(-1)!.body as { contents: { parts: Json[] }[] }).contents[1]!.parts[0]!.thoughtSignature), 'skip_thought_signature_validator');
});

test('ChatGPT: Responses API with reasoning summaries, encrypted reasoning items across a tool chain, strict tools', async () => {
  await api('/api/config/provider', json('PUT', { id: 'openai', apiKey: 'test-key', baseUrl: 'http://127.0.0.1:5298/oai/v1', model: 'gpt-5' }));
  nativeBodies.length = 0;
  nativeRejects = 0;
  const turns: ChatTurn[] = [await userWithPdf()];
  const base = { provider: 'openai', system: 'Core system prompt.', context: 'Active project: Sample project.', tools: TOOLS, effort: 'high', meta: { chat: 'chat-oai' } };
  const ev1 = await chatEvents({ ...base, turns });
  assert.ok(!ev1.some((e) => e.type === 'error'), JSON.stringify(ev1.find((e) => e.type === 'error')));
  assert.equal(textOf(ev1, 'reasoning'), 'Reading the sheet first.');
  const call = ev1.find((e) => e.type === 'tool_call')!.call!;
  // Strict mode sent null for the optional fields: back to "not given" before the Zod check
  assert.deepEqual([call.id, call.name, call.args], ['call_oai_1', 'read-sheet', { path: '/sheets/finances.xlsx' }]);
  const done = ev1.find((e) => e.type === 'done')!;
  assert.equal((done.replay?.items[0] as Json).encrypted_content, 'enc-1');
  const u = ev1.find((e) => e.type === 'usage')!.usage!;
  assert.deepEqual([u.input, u.cached, u.cacheMiss, u.reasoning, u.output], [1500, 1024, 476, 64, 90]);
  const b1 = nativeBodies[0]!;
  const body = b1.body as { reasoning: Json; include: string[]; store: boolean; prompt_cache_key: string; tools: Json[]; parallel_tool_calls: boolean; instructions: string; input: { content: Json[] }[]; temperature?: number };
  assert.equal(b1.url, '/oai/v1/responses');
  assert.deepEqual([body.reasoning, body.include, body.store, body.prompt_cache_key, body.parallel_tool_calls], [{ effort: 'high', summary: 'auto' }, ['reasoning.encrypted_content'], false, 'chat-oai', true]);
  assert.equal(body.instructions, 'Core system prompt.\n\nActive project: Sample project.');
  assert.equal(body.temperature, undefined);
  const rs = body.tools.find((t) => t.name === 'read-sheet')!;
  assert.equal(rs.strict, true);
  assert.deepEqual([(rs.parameters as { required: string[] }).required, (rs.parameters as Json).additionalProperties], [['path'], false]);
  // The optional field of write-document (no required list in the test schema) is nullable in strict mode
  assert.deepEqual(((body.tools.find((t) => t.name === 'write-document')!.parameters as { properties: Record<string, Json> }).properties.path!.type), ['string', 'null']);
  assert.equal(body.input[0]!.content[0]!.type, 'input_file');
  assert.match(String(body.input[0]!.content[0]!.file_data), /^data:application\/pdf;base64,JVBER/);

  turns.push({ role: 'assistant', text: '', toolCalls: [call], reasoning: done.reasoning!, replay: done.replay! });
  turns.push({ role: 'tool', results: [{ id: call.id, name: call.name, content: 'Q1 48200', isError: false }] });
  const ev2 = await chatEvents({ ...base, turns });
  assert.ok(!ev2.some((e) => e.type === 'error'), JSON.stringify(ev2.find((e) => e.type === 'error')));
  assert.equal(nativeRejects, 0);
  assert.equal(textOf(ev2, 'text'), 'Revenue grew.');
  const input = (nativeBodies[1]!.body as { input: Json[] }).input;
  assert.deepEqual(input.slice(1).map((i) => i.type ?? i.role), ['reasoning', 'function_call', 'function_call_output']);
});

test('Telemetry across providers: cache hits and misses, cache writes, thinking tokens, MCP success, counts', async () => {
  const st = await api<{ rows: Record<string, { requests: number; input: number; cached: number; cacheMiss?: number; cacheWrite?: number; reasoning?: number; toolCalls?: number; toolOk?: number }> }>('/api/usage');
  const claude = st.rows['anthropic|claude-opus-5-5']!;
  // Step 1 (2000 read, 300 written), step 2 (2400 read), the forced call (step 1 again)
  assert.deepEqual([claude.requests, claude.cached, claude.cacheWrite, claude.cacheMiss], [3, 6400, 600, 400 + 50 + 400]);
  const gem = st.rows['gemini|gemini-3-flash']!;
  assert.deepEqual([gem.requests, gem.cached, gem.reasoning], [3, 600 + 1000 + 1000, 40 + 12 + 12]);
  const oai = st.rows['openai|gpt-5']!;
  assert.deepEqual([oai.requests, oai.cached, oai.cacheMiss, oai.reasoning], [2, 1024 + 1408, 476 + 192, 64]);
  // MCP tool calls per provider and model
  await api('/api/usage/tool', json('POST', { providerId: 'anthropic', provider: 'Claude', model: 'claude-opus-5-5', ok: true, ms: 40 }));
  await api('/api/usage/tool', json('POST', { providerId: 'anthropic', provider: 'Claude', model: 'claude-opus-5-5', ok: false, ms: 10 }));
  const st2 = await api<Parameters<typeof byProvider>[0]>('/api/usage');
  const row = st2.rows['anthropic|claude-opus-5-5']!;
  assert.deepEqual([row.toolCalls, row.toolOk, toolSuccess(row)], [2, 1, 0.5]);
  const providers = byProvider(st2).map((r) => r.providerId);
  for (const p of ['anthropic', 'gemini', 'openai', 'deepseek']) assert.ok(providers.includes(p), p);
  const anth = byProvider(st2).find((r) => r.providerId === 'anthropic')!;
  assert.equal(anth.requests, 4); // Opus rows plus the Sonnet 5.5 request
  // Counting per provider: OpenAI exact with o200k_base, Claude and Gemini through their count endpoints
  const o = await api<{ tokens: number; method: string }>('/api/ai/count', json('POST', { provider: 'openai', model: 'gpt-4o', text: 'Hello world' }));
  assert.deepEqual([o.tokens, o.method], [2, 'o200k_base']);
  const req = { system: 's', turns: [{ role: 'user', content: 'hi' }], tools: [] };
  const c = await api<{ method: string; request: { total: number; exact: boolean } }>('/api/ai/count', json('POST', { provider: 'anthropic', request: req, remote: true }));
  assert.deepEqual([c.method, c.request.total, c.request.exact], ['count_tokens', 4321, true]);
  const g = await api<{ method: string; request: { total: number } }>('/api/ai/count', json('POST', { provider: 'gemini', request: req, remote: true }));
  assert.deepEqual([g.method, g.request.total], ['countTokens', 1234]);
  const est = await api<{ method: string; request: { exact: boolean } }>('/api/ai/count', json('POST', { provider: 'anthropic', request: req }));
  assert.deepEqual([est.method, est.request.exact], ['estimate', false]);
});


// ---------------------------------------------------------------- Team Mode

/** Streams one /api/ai/chat request; returns the text, the usage and whether the stream was aborted. */
async function sseRequest(body: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; usage?: TokenUsage; aborted: boolean; error?: string }> {
  let text = '';
  let usage: TokenUsage | undefined;
  let error: string | undefined;
  try {
    const res = await fetch(`${BASE}/api/ai/chat`, { ...json('POST', body), signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
        buf = buf.slice(i + 2);
        if (!line) continue;
        const ev = JSON.parse(line.slice(5)) as { type: string; delta?: string; usage?: TokenUsage; error?: { message: string } };
        if (ev.type === 'text') text += ev.delta;
        if (ev.type === 'usage') usage = ev.usage;
        if (ev.type === 'error') error = ev.error!.message;
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError' || signal?.aborted) return { text, usage, aborted: true };
    throw e;
  }
  return { text, usage, aborted: false, ...(error ? { error } : {}) };
}

test('Team Mode: task graph parser, roles, presets and scheduler limits', async () => {
  const enabled = enabledWorkers(DEFAULT_TEAM);
  assert.deepEqual(enabled, ['grid', 'word', 'deck', 'pdf', 'dev']);
  // Fenced JSON with prose, key variants and agent names in several spellings
  const p = parseTaskGraph('Sure!\n```json\n{"tasks":[{"id":1,"title":"A","agent":"GridCraft","files":["sheets\\\\a.xlsx"]},{"id":"2","title":"B","assignedAgent":"@word-agent","dependsOn":[1]}]}\n```', { enabled });
  assert.ok(p.ok, p.issues.join());
  assert.deepEqual(p.graph.tasks.map((t) => [t.id, t.assignedAgent, t.dependencies.join()]), [['1', 'grid', ''], ['2', 'word', '1']]);
  assert.deepEqual(p.graph.tasks[0]!.targetFiles, ['/sheets/a.xlsx']);
  // Problems the leader has to fix: unknown agent, a disabled agent, a missing dependency, a cycle
  const bad = parseTaskGraph(JSON.stringify({ tasks: [{ id: 'a', title: 'x', assignedAgent: 'robot', dependencies: ['b'] }, { id: 'b', title: 'y', assignedAgent: 'deck-agent', dependencies: ['a', 'zz'] }] }), { enabled: ['grid', 'word'] });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => /unknown agent/.test(i)) && bad.issues.some((i) => /not on the team/.test(i)) && bad.issues.some((i) => /zz/.test(i)) && bad.issues.some((i) => /cycle/.test(i)), bad.issues.join(' | '));
  const fixed = parseTaskGraph(JSON.stringify({ tasks: [{ id: 'a', title: 'x', assignedAgent: 'robot', dependencies: ['b'] }, { id: 'b', title: 'y', assignedAgent: 'deck-agent', dependencies: ['a'] }] }), { enabled: ['grid', 'word'], fallback: true });
  assert.ok(fixed.ok && !findCycle(fixed.graph.tasks) && fixed.graph.tasks.every((t) => ['grid', 'word'].includes(t.assignedAgent)));
  assert.deepEqual(levels(TEAM_PLAN.tasks), [['t1', 't4'], ['t2', 't3']]);
  assert.equal(parseTaskGraph('no json here', { enabled }).ok, false);
  // Leader verdicts, malformed answers fall back to the automatic checks
  assert.deepEqual(parseVerdict('{"accept": true}', []), { accept: true });
  assert.equal(parseVerdict('nonsense', ['read-sheet failed']).accept, false);
  assert.equal(parseVerdict('nonsense', []).accept, true);
  // Tool scopes: each specialist only sees its app plus the shared read tools
  assert.ok(toolAllowed('grid', { name: 'read-sheet', app: 'gridcraft' }) && !toolAllowed('grid', { name: 'write-document', app: 'wordcraft' }));
  assert.ok(toolAllowed('word', { name: 'list-files', app: 'project' }) && toolAllowed('dev', { name: 'run-command', app: 'terminal' }) && !toolAllowed('pdf', { name: 'run-command', app: 'terminal' }));
  assert.ok(toolAllowed('dev', { name: 'ext-tool', app: 'project', source: 'external' }) && !toolAllowed('deck', { name: 'ext-tool', app: 'project', source: 'external' }));
  // Presets and normalization: every worker role once, never an empty team
  assert.ok(TEAM_PRESETS.some((t) => t.name === 'Executive Launch Team') && TEAM_PRESETS.some((t) => t.name === 'Fast Local/Hybrid Team'));
  const norm = normalizeTeam({ ...DEFAULT_TEAM, workers: DEFAULT_TEAM.workers.map((w) => ({ ...w, enabled: false })) });
  assert.ok(norm.workers.some((w) => w.enabled) && norm.workers.length === 5);
  const hybrid = TEAM_PRESETS.find((t) => t.id === 'hybrid-local')!;
  assert.ok(hybrid.workers.every((w) => w.provider === 'ollama') && hybrid.leader.provider === '');
  // Concurrency control: four independent tasks, limit two
  let active = 0;
  let peak = 0;
  const graph = { goal: '', tasks: ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id, assignedAgent: 'grid' as const, dependencies: [], targetFiles: [], instructions: id })) };
  const run = new TeamRun({
    config: { ...DEFAULT_TEAM, concurrency: 2, review: 'checks', maxRetries: 0 },
    graph,
    driver: {
      plan: async () => '',
      work: async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 60));
        active--;
        return { text: 'ok', changed: [], toolCalls: [] };
      },
      synthesize: async () => 'done',
    },
  });
  const st = await run.run('x');
  assert.equal(peak, 2);
  assert.equal(st.phase, 'completed');
  assert.ok(st.tasks.every((t) => t.status === 'done'));
  // The team configuration is stored in the backend
  const saved = await api<{ team: { active: TeamConfig; saved: TeamConfig[] } }>('/api/config/team', json('PUT', { active: TEAM_PRESETS[1], saved: [{ ...TEAM_PRESETS[1], id: 'custom-mine', name: 'Mine' }] }));
  assert.equal(saved.team.active.id, 'executive-launch');
  assert.equal(saved.team.saved[0]!.name, 'Mine');
  assert.equal((await api<{ team: { active: TeamConfig } }>('/api/config')).team.active.workers.filter((w) => w.enabled).length, 3);
});

test('Team Mode: leader decomposes a task DAG, independent sub-agents run in parallel, dependents after, leader-ordered retry', async () => {
  const { id: provider } = await api<{ id: string }>('/api/config/custom', json('POST', { name: 'Team test', baseUrl: 'http://127.0.0.1:5298/team/v1', model: 'team-model' }));
  const config: TeamConfig = normalizeTeam({ ...DEFAULT_TEAM, leader: { ...DEFAULT_TEAM.leader, provider, effort: 'auto' }, workers: DEFAULT_TEAM.workers.map((w) => ({ ...w, provider, enabled: w.role !== 'dev' })), concurrency: 3, review: 'leader', maxRetries: 1 });
  const locks = new FileLocks();
  const span: Record<string, { start: number; end: number }[]> = {};
  const feedback: Record<string, string[]> = {};
  const toolOf = (name: string) => ({ name, app: name.includes('sheet') ? 'gridcraft' : name.includes('document') ? 'wordcraft' : name.includes('slide') ? 'deckcraft' : 'pdfcraft', writes: /write|create/.test(name), pathArg: 'path' });
  const leaderCall = async (system: string, user: string, signal: AbortSignal) => {
    const r = await sseRequest({ provider, system, turns: [{ role: 'user', content: user }], tools: [], toolChoice: 'none', meta: { files: [], role: 'leader' } }, signal);
    if (r.usage) run.addUsage('leader', r.usage);
    return r.text;
  };
  const run: TeamRun = new TeamRun({
    config,
    driver: {
      plan: (prompt, _c, signal) => leaderCall(planSystem(enabledWorkers(config)), prompt, signal),
      work: async (task: TaskState, input, signal): Promise<WorkerOutput> => {
        const t0 = Date.now();
        if (input.feedback) (feedback[task.id] ||= []).push(input.feedback);
        // The sub-agent's own model request (its own SSE stream), then its MCP tool call
        const r = await sseRequest({ provider, system: workerSystem(task.assignedAgent, false), turns: [{ role: 'user', content: workerInput(task, input.deps, input.feedback) }], tools: [], toolChoice: 'none', meta: { files: [], role: task.assignedAgent } }, signal);
        if (r.usage) run.addUsage(task.assignedAgent, r.usage);
        const q3 = input.deps.find((d) => d.agent === 'grid')?.output.match(/[\d,]+ euros/)?.[0] || '';
        const callMap: Record<string, [string, Record<string, unknown>]> = {
          grid: ['read-sheet', { path: '/sheets/finances.xlsx' }],
          word: ['write-document', { path: '/reports/team-report.docx', markdown: `# Team report\n\nQ3 revenue: ${q3}` }],
          deck: ['create-slide', { path: '/presentations/team.pptx', slides: [{ title: 'Q3', bullets: [q3] }, ...(input.feedback ? [{ title: 'Q3 figure', bullets: ['61,250'] }] : [])] }],
          pdf: ['read-pdf', { path: '/pdf/contract.pdf' }],
        };
        const [name, args] = callMap[task.assignedAgent]!;
        const out = await locks.run(lockKeysFor(toolOf(name), args), () => call(name, args));
        (span[task.id] ||= []).push({ start: t0, end: Date.now() });
        return { text: r.text, changed: (out.data?.changed as string[]) || [], toolCalls: [{ name, ok: !out.isError, path: String(args.path), text: out.text.slice(0, 200) }] };
      },
      review: async (task, out, findings, signal) => parseVerdict(await leaderCall(reviewSystem(), reviewInput(task, out, findings), signal), findings),
      synthesize: (prompt, tasks, signal) => leaderCall(synthesisSystem(false), synthesisInput(prompt, tasks), signal),
    },
  });
  const st = await run.run('Read @finances.xlsx, write a report and slides, and check the contract.');
  assert.equal(st.phase, 'completed', st.error);
  // Stage 1: the plan as a DAG (fenced JSON repaired)
  assert.deepEqual(st.tasks.map((t) => [t.id, t.assignedAgent, t.dependencies.join()]), [['t1', 'grid', ''], ['t2', 'word', 't1'], ['t3', 'deck', 't1'], ['t4', 'pdf', '']]);
  assert.ok(st.notes.some((n) => /fence/.test(n)), st.notes.join());
  // Stage 2: t1 and t4 have no dependencies and overlap; t2 and t3 start after t1 and overlap each other
  const first = (id: string) => span[id]![0]!;
  assert.ok(first('t4').start < first('t1').end && first('t1').start < first('t4').end, 'grid and pdf ran in parallel');
  assert.ok(first('t2').start >= first('t1').end && first('t3').start >= first('t1').end, 'word and deck waited for grid');
  assert.ok(first('t2').start < first('t3').end && first('t3').start < first('t2').end, 'word and deck ran in parallel');
  // The dependency result reached the dependents (shared context)
  const report = await call('read-document', { path: '/reports/team-report.docx' });
  assert.match(report.text, /61,250 euros/);
  // Stage 3: the leader rejected the first deck result and the retry carried its instruction
  const t3 = st.tasks.find((t) => t.id === 't3')!;
  assert.equal(t3.attempts, 2);
  assert.match(feedback.t3![0]!, /Q3 figure of 61,250/);
  assert.deepEqual(st.leader.reviews.filter((r) => r.task === 't3').map((r) => r.accept), [false, true]);
  assert.match((await call('read-slides', { path: '/presentations/team.pptx' })).text, /Q3 figure/);
  assert.ok(st.tasks.every((t) => t.status === 'done'));
  assert.match(st.summary || '', /team-report\.docx/);
  // Telemetry per role: in the run and in the backend store
  assert.deepEqual(Object.keys(st.usage).sort(), ['deck', 'grid', 'leader', 'pdf', 'word']);
  assert.equal(st.usage.deck!.requests, 2);
  assert.ok(st.usage.leader!.requests >= 6, String(st.usage.leader!.requests)); // plan, 5 reviews, synthesis
  const store = await api<{ roles?: Record<string, { requests: number; input: number }> }>('/api/usage');
  for (const r of ['leader', 'grid', 'word', 'deck', 'pdf']) assert.ok(store.roles?.[r]?.requests, r);
});

test('Team Mode: per-file write mutex serializes writes to one file without lost updates, other files in parallel', async () => {
  assert.equal(lockKey('\\Sheets\\.\\Budget.xlsx'), lockKey('/sheets/x/../budget.xlsx'));
  const ws = { name: 'write-sheet', app: 'gridcraft', writes: true, pathArg: 'path' };
  assert.deepEqual(lockKeysFor({ name: 'read-sheet', app: 'gridcraft', pathArg: 'path' }, { path: '/sheets/a.xlsx' }), [], 'reads never lock');
  assert.deepEqual(lockKeysFor({ name: 'run-command', app: 'terminal', writes: true }, { command: 'x' }), ['#terminal']);
  assert.deepEqual(lockKeysFor({ name: 'images-to-pdf', app: 'pdfcraft', writes: true, pathArg: 'output' }, { output: '/pdf/B.pdf' }), ['/pdf/b.pdf']);
  // Eight simultaneous merge writes into the same workbook: every cell survives
  const same = new FileLocks();
  const cells = Array.from({ length: 8 }, (_, i) => `B${i + 1}`);
  await call('write-sheet', { path: '/sheets/mutex.xlsx', cells: { A1: 'start' } });
  const res = await Promise.all(cells.map((c, i) => same.run(lockKeysFor(ws, { path: i % 2 ? '/sheets/mutex.xlsx' : '/Sheets/MUTEX.xlsx' }), () => call('write-sheet', { path: '/sheets/mutex.xlsx', cells: { [c]: i + 1 } }))));
  assert.ok(res.every((r) => !r.isError), res.find((r) => r.isError)?.text);
  assert.equal(same.stats.peak, 1);
  assert.equal(same.stats.queued, 7);
  const rows = (await call('read-sheet', { path: '/sheets/mutex.xlsx' })).data!.rows as unknown[][];
  assert.deepEqual(rows.map((r) => r[1]), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Four writes to four documents run at the same time; reads in between never wait
  const multi = new FileLocks();
  const wd = { name: 'write-document', app: 'wordcraft', writes: true, pathArg: 'path' };
  let readsDuringWrites = 0;
  await Promise.all([
    ...[1, 2, 3, 4].map((n) => multi.run(lockKeysFor(wd, { path: `/documents/par-${n}.md` }), async () => {
      await new Promise((r) => setTimeout(r, 80));
      return call('write-document', { path: `/documents/par-${n}.md`, markdown: `# Doc ${n}` });
    })),
    (async () => {
      await new Promise((r) => setTimeout(r, 20));
      await multi.run(lockKeysFor({ name: 'read-sheet', app: 'gridcraft', pathArg: 'path' }, { path: '/sheets/mutex.xlsx' }), () => call('read-sheet', { path: '/sheets/mutex.xlsx' }));
      if (multi.stats.active > 0) readsDuringWrites++;
    })(),
  ]);
  assert.ok(multi.stats.peak >= 3, `peak ${multi.stats.peak}`);
  assert.equal(multi.stats.queued, 0);
  assert.equal(readsDuringWrites, 1);
  for (const n of [1, 2, 3, 4]) assert.match((await call('read-document', { path: `/documents/par-${n}.md` })).text, new RegExp(`Doc ${n}`));
  // An aborted waiter leaves the queue, the writes behind it still run in order
  const q = new FileLocks();
  const order: string[] = [];
  const ac = new AbortController();
  const a = q.run(['/x'], async () => (await new Promise((r) => setTimeout(r, 60)), order.push('a')));
  const b = q.run(['/x'], async () => order.push('b'), { signal: ac.signal });
  const c2 = q.run(['/x'], async () => order.push('c'));
  ac.abort();
  await assert.rejects(b, /Aborted/);
  await Promise.all([a, c2]);
  assert.deepEqual(order, ['a', 'c']);
});

test('Team Mode: cancelling one worker and Stop All close the parallel SSE streams cleanly', async () => {
  const { id: provider } = await api<{ id: string }>('/api/config/custom', json('POST', { name: 'Slow test', baseUrl: 'http://127.0.0.1:5298/slow/v1', model: 'slow-model' }));
  slow.open = 0;
  slow.closed = 0;
  const graph = { goal: '', tasks: (['grid', 'word', 'deck'] as const).map((role, i) => ({ id: `t${i + 1}`, title: role, assignedAgent: role, dependencies: [], targetFiles: [], instructions: 'stream' })) };
  const ended: Record<string, { aborted: boolean; chunks: number }> = {};
  const run = new TeamRun({
    config: { ...DEFAULT_TEAM, concurrency: 3, review: 'checks', maxRetries: 0 },
    graph,
    driver: {
      plan: async () => '',
      work: async (task, _i, signal) => {
        const r = await sseRequest({ provider, system: `worker ${task.id}`, turns: [{ role: 'user', content: 'go' }], tools: [], toolChoice: 'none', meta: { files: [], role: task.assignedAgent } }, signal);
        ended[task.id] = { aborted: r.aborted, chunks: (r.text.match(/chunk/g) || []).length };
        return { text: r.text, changed: [], toolCalls: [] };
      },
      synthesize: async () => 'never',
    },
  });
  const done = run.run('three long streams');
  const until = async (fn: () => boolean, ms = 5000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  await until(() => slow.open === 3);
  assert.equal(run.active, 3);
  // Cancel one worker: only its stream closes, the other two keep streaming
  run.cancel('t2');
  await until(() => slow.closed === 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(slow.open, 2);
  assert.equal(run.state.tasks.find((t) => t.id === 't2')!.status, 'cancelled');
  assert.ok(ended.t2?.aborted);
  assert.equal(run.state.tasks.filter((t) => t.status === 'running').length, 2);
  // Stop All: the master AbortController ends every remaining stream
  run.stop();
  const st = await done;
  await until(() => slow.open === 0);
  assert.equal(slow.closed, 3);
  assert.equal(st.phase, 'stopped');
  assert.ok(st.tasks.every((t) => t.status === 'cancelled'));
  assert.ok(ended.t1?.aborted && ended.t3?.aborted && ended.t1.chunks > 0);
  assert.match(st.summary || '', /0 of 3 tasks/);
  // The backend stays healthy and answers new requests
  const h = await api<{ ok: boolean }>('/api/health');
  assert.ok(h.ok);
});
