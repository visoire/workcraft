// Context window and capabilities of Ollama models: the limit and abilities come from /api/show, Automatic keeps
// the model in GPU memory, fixed sizes never exceed the model, and the copies an older WorkCraft made are removed.
//   npx tsx --test tests/server/ollama.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORKCRAFT_HOME = mkdtempSync(join(tmpdir(), 'wc-ollama-'));
const { ollamaContext, ollamaInfo, ollamaMaxContext, isDerivedModel, OLLAMA_AUTO } = await import('../../src/server/ollama.js');
const { contextWindow } = await import('../../src/chat/models.js');

// What the fake server knows: model -> abilities. A model that fits into the GPU up to gpuLimit tokens; bigger
// contexts spill part of it to the CPU.
const MODELS: Record<string, string[] | undefined> = {
  'big:1b': ['completion', 'tools', 'thinking', 'vision'],
  'auto:1b': ['completion', 'tools'],
  'tight:1b': ['completion', 'tools'],
  'roomy:1b': ['completion', 'tools'],
  'plain:1b': ['completion'],
  'old:1b': undefined,
};
let gpuLimit = 32768;
const loads: { model: string; ctx: number }[] = [];
const deleted: string[] = [];
let tags = ['big:1b', 'wc-big-1b-ctx65536:latest', 'wc-qwen2.5-7b-ctx16384:latest'];
let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = body ? JSON.parse(body) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/show') {
        if (!(j.model in MODELS)) {
          res.statusCode = 404;
          return void res.end('{}');
        }
        const caps = MODELS[j.model];
        return void res.end(JSON.stringify({ model_info: { 'general.architecture': 'big', 'big.context_length': 262144 }, ...(caps ? { capabilities: caps } : {}) }));
      }
      if (req.url === '/api/generate') {
        loads.push({ model: j.model, ctx: j.options?.num_ctx });
        return void res.end('{"done":true}');
      }
      if (req.url === '/api/ps') {
        const last = loads[loads.length - 1];
        // like the real server, a model made without a tag is listed as name:latest
        const models = last ? [{ name: last.model.includes(':') ? last.model : `${last.model}:latest`, size: 100, size_vram: last.ctx > gpuLimit ? 60 : 100, context_length: last.ctx }] : [];
        return void res.end(JSON.stringify({ models }));
      }
      if (req.url === '/api/tags') return void res.end(JSON.stringify({ models: tags.map((name) => ({ name })) }));
      if (req.url === '/api/delete' && req.method === 'DELETE') {
        deleted.push(j.model);
        return void res.end('{}');
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
after(() => server.close());

const cfg = (model = 'big:1b') => ({ id: 'ollama', name: 'Ollama', kind: 'openai' as const, baseUrl: base, model, local: true });

test('limit and abilities of the model come from /api/show', async () => {
  assert.equal(await ollamaMaxContext(cfg()), 262144);
  assert.deepEqual(await ollamaInfo(cfg()), { max: 262144, thinking: true, tools: true, vision: true });
  assert.deepEqual(await ollamaInfo(cfg('plain:1b')), { max: 262144, thinking: false, tools: false, vision: false });
  // a server that reports no capabilities: never guess `think`, assume tools and images work
  assert.deepEqual(await ollamaInfo(cfg('old:1b')), { max: 262144, thinking: false, tools: true, vision: true });
  assert.equal((await ollamaInfo(cfg('gone:1b'))).max, 0);
});

test('embedding models that expect a retrieval prefix get it on the query side only', async () => {
  const { queryPrefix } = await import('../../src/server/search.js');
  assert.equal(queryPrefix('nomic-embed-text:latest'), 'search_query: ');
  assert.match(queryPrefix('mxbai-embed-large'), /^Represent this sentence/);
  assert.equal(queryPrefix('bge-m3'), '');
});

test('derived models of older versions are recognised', () => {
  assert.ok(isDerivedModel('wc-big-1b-ctx65536'));
  assert.ok(isDerivedModel('wc-big-1b-ctx65536:latest'));
  assert.ok(!isDerivedModel('qwen3.5:4b'));
});

test('a fixed size is sent as it is, never above the limit of the model, 0 means the maximum', async () => {
  const a = await ollamaContext(cfg(), 65536);
  assert.equal(a.window, 65536);
  assert.equal(a.max, 262144);
  assert.equal(a.thinking, true);
  assert.equal(contextWindow('big:1b'), 65536);
  assert.equal((await ollamaContext(cfg(), 0)).window, 262144);
  assert.equal((await ollamaContext(cfg(), 9_999_999)).window, 262144);
  assert.equal((await ollamaContext(cfg(), 100)).window, 2048, 'never below 2k');
  assert.equal(loads.length, 0, 'a fixed size loads nothing by itself');
});

test('the copies an older WorkCraft made are deleted, once', async () => {
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(deleted.sort(), ['wc-big-1b-ctx65536:latest', 'wc-qwen2.5-7b-ctx16384:latest']);
  tags = ['big:1b'];
  await ollamaContext(cfg(), 8192);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(deleted.length, 2);
});

test('automatic picks the largest context that keeps the model on the GPU', async () => {
  const c = cfg('auto:1b');
  const a = await ollamaContext(c, OLLAMA_AUTO);
  assert.equal(a.window, 32768, '64k spills to the CPU, 32k fits');
  assert.equal(a.gpu, 1);
  assert.equal(a.auto, true);
  assert.deepEqual(loads.map((l) => l.ctx), [65536, 32768], 'probed from the top, stops at the first fit');
  assert.equal(contextWindow('auto:1b'), 32768);
  const before = loads.length;
  await ollamaContext(c, OLLAMA_AUTO);
  assert.equal(loads.length, before, 'remembered, the model is not probed again');
});

test('automatic never goes below 16k, and uses 64k when everything fits', async () => {
  gpuLimit = 8192;
  const tight = await ollamaContext(cfg('tight:1b'), OLLAMA_AUTO);
  assert.equal(tight.window, 16384);
  assert.ok((tight.gpu ?? 1) < 0.97, 'the report says the model does not fit');
  gpuLimit = 1_000_000;
  const roomy = await ollamaContext(cfg('roomy:1b'), OLLAMA_AUTO);
  assert.equal(roomy.window, 65536);
  assert.equal(roomy.gpu, 1);
  gpuLimit = 32768;
});
