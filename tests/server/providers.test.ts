// Provider presets and wire details documented in artifical-intelligence: Grok (xAI), GLM (Z.ai), the
// OpenAI-compatible hosts, and LM Studio as a local endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, streamChat } from '../../src/chat/providers.ts';
import { familyOf, effortChoices, contextWindow } from '../../src/chat/models.ts';
import type { ChatRequest, ProviderConfig, StreamEvent } from '../../src/chat/types.ts';

const sse = (...chunks: unknown[]) => new Response(chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });

async function run(cfg: ProviderConfig, req: Partial<ChatRequest>, reply: Response) {
  const real = globalThis.fetch;
  let seen: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
    return reply;
  }) as typeof fetch;
  const events: StreamEvent[] = [];
  try {
    for await (const ev of streamChat(cfg, { system: 'S', turns: [{ role: 'user', content: 'hi' }], tools: [], toolChoice: 'auto', ...req } as ChatRequest)) events.push(ev);
  } finally {
    globalThis.fetch = real;
  }
  return { seen: seen!, events };
}

test('every preset id is unique and the documented providers are there', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['anthropic', 'openai', 'gemini', 'deepseek', 'xai', 'zai', 'mistral', 'groq', 'openrouter', 'together', 'ollama', 'lmstudio']) assert.ok(ids.includes(id), id);
  assert.ok(PRESETS.find((p) => p.id === 'lmstudio')!.local, 'LM Studio is local');
  assert.ok(PRESETS.find((p) => p.id === 'ollama')!.local);
  assert.equal(PRESETS.find((p) => p.id === 'zai')!.baseUrl, 'https://api.z.ai/api/paas/v4');
});

test('Grok and GLM have their own family, also behind another name', () => {
  assert.equal(familyOf({ id: 'xai', kind: 'openai', baseUrl: 'https://api.x.ai/v1' }), 'xai');
  assert.equal(familyOf({ id: 'custom-x', kind: 'openai', baseUrl: 'https://api.x.ai/v1' }), 'xai');
  assert.equal(familyOf({ id: 'zai', kind: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4' }), 'zai');
  assert.equal(familyOf({ id: 'custom-cn', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }), 'zai');
  assert.equal(familyOf({ id: 'lmstudio', kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1' }), 'compatible');
  assert.deepEqual(effortChoices('zai', 'glm-5.3').map((e) => e.id), ['off', 'low', 'high', 'max']);
  assert.equal(contextWindow('grok-4.7'), 500_000);
  assert.equal(contextWindow('glm-5.3'), 1_000_000);
  assert.equal(contextWindow('glm-4.7'), 128_000);
});

test('GLM: thinking switch and reasoning_effort, reasoning_content streams, cached tokens are read', async () => {
  const cfg: ProviderConfig = { id: 'zai', name: 'GLM', kind: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'k', model: 'glm-5.3' };
  const reply = () => sse({ choices: [{ delta: { reasoning_content: 'think ' } }] }, { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }, { usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 } }, choices: [] }, '[DONE]');
  const on = await run(cfg, { params: { effort: 'max' } }, reply());
  assert.equal(on.seen.url, 'https://api.z.ai/api/paas/v4/chat/completions');
  assert.equal(on.seen.headers.get('authorization'), 'Bearer k');
  assert.deepEqual(on.seen.body.thinking, { type: 'enabled' });
  assert.equal(on.seen.body.reasoning_effort, 'max');
  assert.deepEqual(on.seen.body.stream_options, { include_usage: true });
  assert.ok(on.events.some((e) => e.type === 'reasoning' && e.delta === 'think '));
  const usage = on.events.find((e) => e.type === 'usage');
  assert.ok(usage && usage.type === 'usage' && usage.usage.cached === 80 && usage.usage.input === 100);

  const medium = await run(cfg, { params: { effort: 'medium' } }, reply());
  assert.equal(medium.seen.body.reasoning_effort, 'high', 'medium maps to high');
  const off = await run(cfg, { params: { effort: 'off' } }, reply());
  assert.deepEqual(off.seen.body.thinking, { type: 'disabled' });
  assert.equal(off.seen.body.reasoning_effort, undefined);
  const forced = await run(cfg, { params: { effort: 'high' }, toolChoice: { name: 'read-sheet' }, tools: [{ name: 'read-sheet', description: 'd', parameters: { type: 'object', properties: {} } }] }, reply());
  assert.deepEqual(forced.seen.body.thinking, { type: 'disabled' }, 'a named tool_choice and thinking do not mix');
});

test('Grok: Chat Completions with Bearer auth and sorted tools; Mistral gets no unknown fields', async () => {
  const tools = [
    { name: 'b-tool', description: 'b', parameters: { type: 'object', properties: {} } },
    { name: 'a-tool', description: 'a', parameters: { type: 'object', properties: {} } },
  ];
  const grok = await run({ id: 'xai', name: 'Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', apiKey: 'xk', model: 'grok-4.7' }, { tools }, sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]'));
  assert.equal(grok.seen.url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(grok.seen.headers.get('authorization'), 'Bearer xk');
  assert.deepEqual((grok.seen.body.tools as { function: { name: string } }[]).map((t) => t.function.name), ['a-tool', 'b-tool'], 'sorted for the prompt cache');
  assert.equal(grok.seen.body.thinking, undefined);
  const mistral = await run({ id: 'mistral', name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', apiKey: 'mk', model: 'mistral-large-latest' }, {}, sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]'));
  assert.equal(mistral.seen.body.stream_options, undefined);
});
