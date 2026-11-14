// The native Ollama chat adapter: request body (context, thinking, keep_alive, tools, history) and the stream it
// turns back into events (text, thinking, parsed tool calls, usage).
//   npx tsx --test tests/server/ollama-chat.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { streamChat } from '../../src/chat/providers.js';
import { ollamaBody, ollamaMessages } from '../../src/chat/adapters/ollama.js';
import { effortChoices, familyOf, ollamaThink } from '../../src/chat/models.js';
import type { ChatRequest, ProviderConfig, StreamEvent } from '../../src/chat/types.js';

let server: Server;
let base = '';
let seen: Record<string, unknown> = {};
let script: string[] = [];
let status = 200;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = body ? JSON.parse(body) : {};
      res.statusCode = status;
      res.setHeader('content-type', 'application/x-ndjson');
      res.end(script.join('\n') + '\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
after(() => server.close());

const cfg = (extra: Partial<ProviderConfig> = {}): ProviderConfig => ({ id: 'ollama', name: 'Ollama', kind: 'openai', baseUrl: base, model: 'qwen3.5:4b', local: true, ...extra });
const tool = { name: 'read-sheet', description: 'Read cells', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({ system: 'Be brief.', turns: [{ role: 'user', content: 'hi' }], tools: [], toolChoice: 'auto', ...extra });

async function collect(c: ProviderConfig, r: ChatRequest): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of streamChat(c, r)) out.push(ev);
  return out;
}

test('Ollama has its own family, and thinking models get a menu', () => {
  assert.equal(familyOf({ id: 'ollama', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' }), 'ollama');
  assert.deepEqual(effortChoices('ollama', 'qwen3.5:4b').map((c) => c.id), ['off', 'medium']);
  assert.deepEqual(effortChoices('ollama', 'gpt-oss:20b').map((c) => c.id), ['low', 'medium', 'high']);
  assert.deepEqual(effortChoices('ollama', 'qwen2.5:7b'), []);
  assert.equal(ollamaThink('qwen3.5:4b', 'off'), false);
  assert.equal(ollamaThink('qwen3.5:4b', 'high'), true);
  assert.equal(ollamaThink('qwen3.5:4b', undefined), undefined);
  assert.equal(ollamaThink('gpt-oss:20b', 'off'), 'low', 'gpt-oss cannot switch thinking off');
});

test('the body carries the context, thinking, keep_alive and no silent truncation', () => {
  const { body } = ollamaBody(cfg({ ollama: { numCtx: 32768, thinking: true } }), req({ params: { effort: 'off' }, tools: [tool] }));
  assert.equal(body.model, 'qwen3.5:4b');
  assert.equal((body.options as { num_ctx: number }).num_ctx, 32768);
  assert.equal(body.think, false);
  assert.equal(body.keep_alive, '15m');
  assert.equal(body.truncate, false);
  assert.deepEqual((body.tools as { function: { name: string } }[]).map((t) => t.function.name), ['read-sheet']);
});

test('think is only sent when the model reports thinking; tools only when it supports them', () => {
  assert.equal(ollamaBody(cfg({ ollama: { numCtx: 8192, thinking: false } }), req({ params: { effort: 'off' } })).body.think, undefined);
  assert.equal(ollamaBody(cfg(), req({ params: { effort: 'off' } })).body.think, false, 'browser mode: no capabilities known, the user asked');
  assert.equal(ollamaBody(cfg({ ollama: { thinking: true } }), req()).body.think, undefined, 'Auto leaves the model default');
  assert.equal(ollamaBody(cfg({ ollama: { tools: false } }), req({ tools: [tool] })).body.tools, undefined);
  assert.equal(ollamaBody(cfg(), req({ tools: [tool], toolChoice: 'none' })).body.tools, undefined);
  assert.equal((ollamaBody(cfg(), req()).body.options as { num_ctx: number }).num_ctx, 16384, 'default when the backend sets none');
});

test('a forced tool leaves only that tool', () => {
  const other = { ...tool, name: 'write-sheet' };
  const { body } = ollamaBody(cfg(), req({ tools: [tool, other], toolChoice: { name: 'write-sheet' } }));
  assert.deepEqual((body.tools as { function: { name: string } }[]).map((t) => t.function.name), ['write-sheet']);
});

test('history: tool calls with object arguments, tool results by name, thinking only inside the running chain', () => {
  const m = ollamaMessages({
    system: 'S',
    context: 'C',
    turns: [
      { role: 'user', content: 'one' },
      { role: 'assistant', text: 'old', toolCalls: [{ id: 'a', name: 'read-sheet', args: { path: 'x' } }], reasoning: 'old thoughts' },
      { role: 'tool', results: [{ id: 'a', name: 'read-sheet', content: '42', isError: false }] },
      { role: 'user', content: 'two' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'b', name: 'read-sheet', args: { path: 'y' } }], reasoning: 'current thoughts' },
      { role: 'tool', results: [{ id: 'b', name: 'read-sheet', content: '7', isError: false }] },
    ],
  });
  assert.equal(m[0].content, 'S\n\nC');
  assert.deepEqual(m[2], { role: 'assistant', content: 'old', tool_calls: [{ type: 'function', function: { name: 'read-sheet', arguments: { path: 'x' } } }] });
  assert.deepEqual(m[3], { role: 'tool', tool_name: 'read-sheet', content: '42' });
  assert.equal(m[5].thinking, 'current thoughts');
  assert.equal(m[2].thinking, undefined, 'earlier turns do not replay their thinking');
});

test('the stream becomes thinking, text, a parsed tool call and the usage numbers', async () => {
  script = [
    JSON.stringify({ message: { role: 'assistant', thinking: 'hmm' }, done: false }),
    JSON.stringify({ message: { role: 'assistant', content: 'Reading' }, done: false }),
    JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read-sheet', arguments: { path: 'budget.xlsx' } } }] }, done: false }),
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 120, eval_count: 15 }),
  ];
  const ev = await collect(cfg({ ollama: { numCtx: 16384, thinking: true, tools: true } }), req({ tools: [tool] }));
  assert.deepEqual(ev.filter((e) => e.type === 'reasoning').map((e) => (e as { delta: string }).delta), ['hmm']);
  assert.equal(ev.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join(''), 'Reading');
  const call = ev.find((e) => e.type === 'tool_call') as Extract<StreamEvent, { type: 'tool_call' }>;
  assert.equal(call.call.name, 'read-sheet');
  assert.deepEqual(call.call.args, { path: 'budget.xlsx' });
  const done = ev.find((e) => e.type === 'done') as Extract<StreamEvent, { type: 'done' }>;
  assert.equal(done.stop, 'tool_calls');
  assert.equal(done.reasoning, 'hmm');
  const u = (ev.find((e) => e.type === 'usage') as Extract<StreamEvent, { type: 'usage' }>).usage;
  assert.deepEqual([u.input, u.output, u.estimated], [120, 15, false]);
});

test('tool calls of an answer cut off by the limit are dropped, thinking without an answer is reported', async () => {
  script = [JSON.stringify({ message: { content: 'x', tool_calls: [{ function: { name: 'read-sheet', arguments: { path: 'a' } } }] }, done: true, done_reason: 'length' })];
  const ev = await collect(cfg(), req({ tools: [tool] }));
  assert.equal(ev.filter((e) => e.type === 'tool_call').length, 0);
  script = [JSON.stringify({ message: { thinking: 'long' }, done: false }), JSON.stringify({ message: {}, done: true, done_reason: 'length' })];
  await assert.rejects(collect(cfg(), req()), /whole budget on thinking/);
});

test('a prompt longer than the context gets a message that names the setting', async () => {
  status = 400;
  script = [JSON.stringify({ error: 'the input length exceeds the context length' })];
  await assert.rejects(collect(cfg({ ollama: { numCtx: 4096 } }), req()), /longer than the context window.*4,096 tokens.*Settings/);
  status = 200;
  assert.ok(seen.truncate === false);
});
