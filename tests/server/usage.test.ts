// Token usage: parsing of the provider streams (OpenAI-compatible, Anthropic, Gemini), the estimate
// when an endpoint sends no usage, cost from the rate table and the context window.
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { streamChat, estimateTokens } from '../../src/chat/providers.ts';
import { addUsage, emptyUsage, rowCost, usageTotals, contextWindow, compactTokens, money, tokensPerSecond } from '../../src/chat/usage.ts';
import type { ProviderConfig, StreamEvent, TokenUsage } from '../../src/chat/types.ts';

const PORT = 5296;
let server: Server;
let lastBody: Record<string, unknown> = {};

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      lastBody = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (req.url?.startsWith('/openai-usage/')) {
        send({ choices: [{ delta: { content: 'Hello' } }] });
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        send({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 34, prompt_tokens_details: { cached_tokens: 1000 } } });
        res.end('data: [DONE]\n\n');
      } else if (req.url?.startsWith('/openai-plain/')) {
        send({ choices: [{ delta: { content: 'x'.repeat(400) } }] });
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        res.end('data: [DONE]\n\n');
      } else if (req.url?.startsWith('/anthropic/')) {
        send({ type: 'message_start', message: { usage: { input_tokens: 50, cache_read_input_tokens: 400, cache_creation_input_tokens: 10, output_tokens: 1 } } });
        send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } });
        send({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 77 } });
        res.end();
      } else if (req.url?.startsWith('/gemini/')) {
        send({ candidates: [{ content: { parts: [{ text: 'Hallo' }] } }] });
        send({ candidates: [{ content: { parts: [{ text: '!' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 20, thoughtsTokenCount: 5, cachedContentTokenCount: 300 } });
        res.end();
      } else res.end();
    });
  }).listen(PORT, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
});
after(() => server.close());

const req = { system: 'You are a test.', turns: [{ role: 'user' as const, content: 'Say hello' }], tools: [], toolChoice: 'auto' as const };
async function collect(cfg: ProviderConfig): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of streamChat(cfg, req)) out.push(ev);
  return out;
}
const usageOf = (evs: StreamEvent[]) => (evs.find((e) => e.type === 'usage') as Extract<StreamEvent, { type: 'usage' }>).usage;
const base = `http://127.0.0.1:${PORT}`;

test('OpenAI-compatible: exact usage from the last chunk, stream_options for presets', async () => {
  const evs = await collect({ id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: `${base}/openai-usage`, apiKey: 'k', model: 'deepseek-chat' });
  const u = usageOf(evs);
  assert.deepEqual([u.input, u.output, u.cached, u.estimated], [1200, 34, 1000, false]);
  assert.deepEqual(lastBody.stream_options, { include_usage: true });
  // usage comes right before done
  assert.equal(evs.at(-2)?.type, 'usage');
  assert.equal(evs.at(-1)?.type, 'done');
});

test('Own endpoint without usage: estimated from the characters, no unknown request fields', async () => {
  const evs = await collect({ id: 'custom-1', name: 'Mine', kind: 'openai', baseUrl: `${base}/openai-plain`, model: 'local-model' });
  const u = usageOf(evs);
  assert.equal(u.estimated, true);
  assert.equal(u.output, estimateTokens(400));
  assert.ok(u.input > 0);
  assert.equal(lastBody.stream_options, undefined);
});

test('Anthropic: input includes cache reads and writes, output from message_delta', async () => {
  const u = usageOf(await collect({ id: 'anthropic', name: 'Claude', kind: 'anthropic', baseUrl: `${base}/anthropic`, apiKey: 'k', model: 'claude-test' }));
  assert.deepEqual([u.input, u.output, u.cached, u.estimated], [460, 77, 400, false]);
});

test('Gemini: usageMetadata with thinking tokens counted as output', async () => {
  const u = usageOf(await collect({ id: 'gemini', name: 'Gemini', kind: 'gemini', baseUrl: `${base}/gemini`, apiKey: 'k', model: 'gemini-test' }));
  assert.deepEqual([u.input, u.output, u.cached, u.estimated], [900, 25, 300, false]);
  assert.ok(u.totalMs >= u.firstMs);
});

test('Store, cost, speed and context window', () => {
  const st = emptyUsage();
  const u: TokenUsage = { input: 2_000_000, output: 500_000, cached: 1_000_000, estimated: false, firstMs: 300, totalMs: 10_300, provider: 'ChatGPT', providerId: 'openai', model: 'gpt-x', local: false };
  addUsage(st, u);
  addUsage(st, { ...u, input: 1000, output: 100, cached: 0, estimated: true });
  addUsage(st, { ...u, providerId: 'ollama', provider: 'Ollama', model: 'qwen2.5:7b', local: true });
  const row = st.rows['openai|gpt-x']!;
  assert.deepEqual([row.requests, row.input, row.output, row.cached, row.estimated], [2, 2_001_000, 500_100, 1_000_000, 1]);
  st.rates['gpt-x'] = { input: 2, output: 8, cached: 0.5 };
  st.rates['qwen2.5:7b'] = { input: 9, output: 9 };
  // (1,001,000 uncached * 2 + 1,000,000 cached * 0.5 + 500,100 * 8) / 1M
  assert.equal(rowCost(row, st.rates).toFixed(4), ((1_001_000 * 2 + 1_000_000 * 0.5 + 500_100 * 8) / 1e6).toFixed(4));
  assert.equal(rowCost(st.rows['ollama|qwen2.5:7b']!, st.rates), 0);
  assert.equal(usageTotals(st).requests, 3);
  assert.equal(Math.round(tokensPerSecond(row)), Math.round(500_100 / 20));
  assert.equal(contextWindow('claude-sonnet-5-5'), 1_000_000);
  assert.equal(contextWindow('claude-haiku-4-5'), 200_000);
  assert.equal(contextWindow('gemini-2.5-flash'), 1_048_576);
  assert.equal(contextWindow('gpt-4o'), 128_000);
  assert.equal(contextWindow('unknown-model'), 128_000);
  assert.equal(compactTokens(12_345), '12.3k');
  assert.equal(money(0), '$0.00');
});
