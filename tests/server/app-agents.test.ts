// Per-app specialists, workspace teams, tool scopes and the model-not-found recovery.
//   npx tsx --test tests/server/app-agents.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPS, ECOSYSTEMS } from '../../src/ecosystems/catalog.js';
import { APP_ROLES, appPrompt, externalGroup, roleIdOfApp } from '../../src/chat/app-roles.js';
import { ROLE_DEFS, TEAM_PRESETS, TeamConfigSchema, autoRoute, ecosystemTeam, enabledWorkers, normalizeTeam, planSystem, rolesOfRequest, roleFromName, toolAllowed, workerSystem } from '../../src/chat/team.js';
import { addressHint, baseName, pickReplacement } from '../../src/chat/model-recovery.js';
import { streamChat } from '../../src/chat/providers.js';
import type { ProviderConfig, StreamEvent } from '../../src/chat/types.js';

// ---------------------------------------------------------------- one specialist per app

test('Every app of the catalog has a specialist; the office apps keep their historic roles', () => {
  for (const a of APPS) {
    const r = ROLE_DEFS[roleIdOfApp(a.id)];
    assert.ok(r, `${a.id} has a role`);
    assert.equal(r!.appId, a.id);
  }
  assert.equal(roleIdOfApp('wordcraft'), 'word');
  assert.equal(roleIdOfApp('photocraft'), 'photocraft');
  assert.equal(APP_ROLES.length, APPS.length - 4, 'the four office apps are not generated twice');
  const mentions = Object.values(ROLE_DEFS).map((d) => d.mention);
  assert.equal(new Set(mentions).size, mentions.length, 'every @mention is unique');
});

test('Only apps without a CLI are reached through project files, and their prompt says so', () => {
  const web = APPS.find((a) => a.origin === 'independent')!;
  const cli = APPS.find((a) => a.id === 'photocraft')!;
  assert.equal(ROLE_DEFS[web.id]!.webOnly, true);
  assert.equal(ROLE_DEFS[cli.id]!.webOnly, undefined);
  assert.match(appPrompt(web), /no tool interface/);
  assert.match(appPrompt(web), new RegExp(web.folder));
  assert.match(appPrompt(cli), /ext-photocraft-\*/);
  assert.doesNotMatch(appPrompt(cli), /no tool interface/);
});

test('Tool scopes: the MCP server of a Craft app belongs to the specialist of that app', () => {
  const ext = (name: string) => ({ name, app: 'project', source: 'external' });
  assert.equal(toolAllowed('photocraft', ext('ext-photocraft-apply-filter')), true);
  assert.equal(toolAllowed('vectorcraft', ext('ext-photocraft-apply-filter')), false);
  assert.equal(toolAllowed('dev', ext('ext-photocraft-apply-filter')), false, 'dev no longer gets the Craft apps');
  assert.equal(toolAllowed('word', ext('ext-wordcraft-open')), true, 'the office specialists get their own CLI tools');
  assert.equal(toolAllowed('craft-anything', ext('ext-craftanything-scan')), true, 'the hyphenless group maps back to craft-anything');
  assert.equal(toolAllowed('dev', ext('ext-github-create-issue')), true, 'other MCP servers stay with dev');
  assert.equal(toolAllowed('photocraft', ext('ext-github-create-issue')), false);
  assert.equal(toolAllowed('leader', ext('ext-photocraft-x')), false);
});

test('Tool scopes: skills and the app list are readable by everyone, files only for web-only apps', () => {
  const t = (name: string, app = 'project') => ({ name, app, source: 'server' });
  for (const r of ['grid', 'dev', 'photocraft', 'notecraft']) assert.equal(toolAllowed(r, t('read-skill')), true, r);
  assert.equal(toolAllowed('notecraft', t('write-file', 'code')), true, 'a web-only app has no tools: its specialist writes the file');
  assert.equal(toolAllowed('notecraft', t('open-in-app', 'workspace')), true);
  assert.equal(toolAllowed('photocraft', t('write-file', 'code')), false, 'an app with tools does not write files directly');
  assert.equal(toolAllowed('grid', t('write-sheet', 'gridcraft')), true);
  assert.equal(toolAllowed('grid', t('write-document', 'wordcraft')), false);
});

test('@mentions and names reach the specialist of an app', () => {
  assert.equal(roleFromName('@photocraft-agent'), 'photocraft');
  assert.equal(roleFromName('Paint.RS'), 'paintrs');
  assert.equal(roleFromName('oxybrush'), 'oxybrush');
  assert.equal(roleFromName('wordcraft-agent'), 'word');
  assert.equal(roleFromName('Craft Anything'), 'craft-anything');
});

// ---------------------------------------------------------------- teams per workspace

test('Every built-in workspace has a ready-made team that parses and contains exactly its apps', () => {
  for (const e of ECOSYSTEMS) {
    const p = TEAM_PRESETS.find((x) => x.id === `eco-${e.id}`);
    assert.ok(p, `team for ${e.id}`);
    assert.ok(TeamConfigSchema.safeParse(p).success, e.id);
    const team = normalizeTeam(p);
    const on = enabledWorkers(team).sort();
    assert.deepEqual(on, [...new Set(e.apps.map(roleIdOfApp))].sort(), `${e.id}: enabled specialists are the apps of the workspace`);
  }
});

test('A workspace you made yourself gets a team too, and a team keeps its app specialists when normalized', () => {
  const t = ecosystemTeam({ id: 'custom-mine', name: 'Mine', apps: ['photocraft', 'notecraft', 'gridcraft'] });
  assert.equal(t.id, 'eco-custom-mine');
  const n = normalizeTeam(t);
  assert.deepEqual(enabledWorkers(n).sort(), ['grid', 'notecraft', 'photocraft']);
  assert.match(planSystem(enabledWorkers(n)), /photocraft-agent: PhotoCraft Specialist/);
  assert.match(planSystem(enabledWorkers(n)), /notecraft-agent[^\n]*No tools of its own/, 'the leader is told which specialist has no tools');
});

test('Routing: file types and app names find the specialist, an ambiguous type keeps the team', () => {
  const on = ['photocraft', 'notecraft', 'grid'];
  assert.deepEqual(rolesOfRequest('Sharpen it', ['/images/a.jpg'], on), ['photocraft']);
  assert.deepEqual(rolesOfRequest('Tidy my notes in NoteCraft', [], on), ['notecraft']);
  assert.deepEqual(autoRoute('Sharpen the photo in @a.jpg', ['/images/a.jpg'], on), { role: 'photocraft' });
  // two enabled apps open a png: the team plans instead of guessing
  assert.equal(autoRoute('Crop this', ['/images/a.png'], ['photocraft', 'paintcraft']), null);
});

test('Every specialist gets instructions in its system prompt', () => {
  for (const r of ['grid', 'word', 'deck', 'pdf', 'dev', 'photocraft', 'notecraft']) assert.match(workerSystem(r, false), /Your instructions:/, r);
  assert.match(workerSystem('photocraft', false), /read-skill/);
});

test('externalGroup reads the app out of an external tool name', () => {
  assert.equal(externalGroup('ext-photocraft-crop'), 'photocraft');
  assert.equal(externalGroup('write-sheet'), null);
});

// ---------------------------------------------------------------- model not found

test('pickReplacement: same name with another tag, same family, preferred model, nothing to replace', () => {
  assert.equal(pickReplacement(['qwen2.5:14b', 'llama3.2:3b', 'nomic-embed-text:latest'], 'qwen2.5:7b', 'ollama')?.model, 'qwen2.5:14b');
  assert.equal(pickReplacement(['claude-sonnet-5-5-20261001', 'claude-haiku-5-5'], 'claude-sonnet-5-5', 'anthropic')?.model, 'claude-sonnet-5-5-20261001');
  assert.equal(pickReplacement(['llama3.2:3b', 'qwen3:4b', 'nomic-embed-text'], 'gone:1b', 'ollama')?.model, 'qwen3:4b', 'the preference list decides and embedding models are never picked');
  assert.equal(pickReplacement(['gpt-5', 'text-embedding-3-large'], 'gpt-5', 'openai'), null, 'the model exists');
  assert.equal(pickReplacement(['text-embedding-3-large', 'whisper-1'], 'gpt-5', 'openai'), null, 'nothing that can chat');
  assert.equal(pickReplacement(['qwen3:4b'], 'qwen3', 'ollama')?.model, 'qwen3:4b', 'an untagged name finds its tag');
  assert.equal(baseName('claude-sonnet-5-5-20261001'), 'claude-sonnet-5-5');
  assert.match(addressHint('https://example.com'), /end in \/v1/);
  assert.doesNotMatch(addressHint('http://127.0.0.1:11434/v1'), /end in \/v1/);
});

/** A fake provider: /models lists `installed`, /chat/completions answers 404 for any model that is not installed. */
async function withServer(installed: string[], run: (base: string, hits: string[]) => Promise<void>): Promise<void> {
  const { createServer } = await import('node:http');
  const hits: string[] = [];
  const srv = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify({ data: installed.map((id) => ({ id })) }));
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const model = (JSON.parse(body || '{}') as { model?: string }).model || '';
      hits.push(model);
      if (!installed.includes(model)) {
        res.statusCode = 404;
        return void res.end(JSON.stringify({ error: { message: `model '${model}' not found` } }));
      }
      res.setHeader('content-type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await run(`http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`, hits);
  } finally {
    srv.close();
  }
}

const collect = async (cfg: ProviderConfig) => {
  const out: StreamEvent[] = [];
  let error: unknown;
  try {
    for await (const ev of streamChat(cfg, { system: 's', turns: [{ role: 'user', content: 'hi' }], tools: [], toolChoice: 'none' })) out.push(ev);
  } catch (e) {
    error = e;
  }
  return { out, error: error as { info?: { code: string; message: string } } | undefined };
};

test('A 404 for the model: the request runs again with an installed model and a notice says so', async () => {
  await withServer(['qwen3:4b', 'llama3.2:3b'], async (base, hits) => {
    const { out, error } = await collect({ id: 'custom-x', name: 'Local', kind: 'openai', baseUrl: base, model: 'qwen2.5:7b' });
    assert.equal(error, undefined);
    assert.deepEqual(hits, ['qwen2.5:7b', 'qwen3:4b'], 'one failed try, one repeat');
    const notice = out.find((e) => e.type === 'notice');
    assert.ok(notice && notice.type === 'notice');
    assert.deepEqual(notice.fix, { providerId: 'custom-x', from: 'qwen2.5:7b', to: 'qwen3:4b' });
    assert.ok(out.some((e) => e.type === 'text' && e.delta === 'hello'));
    assert.equal(out.filter((e) => e.type === 'start').length, 2, 'the interface learns the model that answers');
    assert.ok(out.some((e) => e.type === 'usage' && e.usage.model === 'qwen3:4b'));
  });
});

test('A 404 when the model is listed (or the list is empty) keeps an error that names the real cause', async () => {
  await withServer([], async (base) => {
    const { error } = await collect({ id: 'custom-x', name: 'Local', kind: 'openai', baseUrl: base, model: 'qwen2.5:7b' });
    assert.equal(error?.info?.code, 'NOT_FOUND');
    assert.match(error!.info!.message, /reports no models/);
  });
  // the address is wrong: the models endpoint answers 404 as well
  const { createServer } = await import('node:http');
  const srv = createServer((_req, res) => ((res.statusCode = 404), res.end('nope')));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const { error } = await collect({ id: 'custom-y', name: 'Own', kind: 'openai', baseUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, model: 'm' });
    assert.equal(error?.info?.code, 'NOT_FOUND');
    assert.match(error!.info!.message, /does not answer the models endpoint/);
  } finally {
    srv.close();
  }
});

// ---------------------------------------------------------------- personas and contexts

import { DEFAULT_PERSONAS, personalPrompt, withBuiltinPersonas } from '../../src/core/defaults.js';
import { craftEnabled, craftReport } from '../../src/server/craft.js';
import { elapsedText, connectionLost, stepDisplay, stepTotals } from '../../src/chat/step-view.js';
import { ConfigSchema } from '../../src/server/config.js';
import { readFileSync } from 'node:fs';

test('Personas: an older config gets the new built-in personas, what it edited stays', () => {
  const old = [DEFAULT_PERSONAS[0]!, { id: 'finance', name: 'My analyst', prompt: 'my own words', builtIn: true }, { id: 'mine', name: 'Mine', prompt: 'x' }];
  const merged = withBuiltinPersonas(old);
  assert.equal(merged.find((p) => p.id === 'finance')!.prompt, 'my own words', 'an edited built-in prompt stays');
  assert.equal(merged.find((p) => p.id === 'finance')!.category, 'Work', 'the category comes from the code');
  assert.ok(merged.some((p) => p.id === 'retoucher') && merged.some((p) => p.id === 'cad'), 'new built-in personas are added');
  assert.equal(merged.filter((p) => p.id === 'finance').length, 1);
  assert.deepEqual(merged.slice(0, 3).map((p) => p.id), ['default', 'finance', 'mine'], 'the saved order is kept, new ones follow');
  assert.ok(DEFAULT_PERSONAS.length >= 15, 'a useful set ships');
  for (const p of DEFAULT_PERSONAS) assert.ok(p.id === 'default' || (p.category && p.description && p.prompt.length > 40), p.id);
  assert.equal(new Set(DEFAULT_PERSONAS.map((p) => p.id)).size, DEFAULT_PERSONAS.length);
});

test('The prompt carries the persona, the always context and the context in use, and nothing else', () => {
  const base = { context: 'I live in Berlin.', active: 'finance', personas: DEFAULT_PERSONAS, contexts: [{ id: 'client', name: 'Client Meyer', text: 'Tone: formal.' }], contextActive: 'client' };
  const p = personalPrompt(base);
  assert.match(p, /financial analyst/i);
  assert.match(p, /I live in Berlin/);
  assert.match(p, /Context in use \(Client Meyer/);
  assert.doesNotMatch(personalPrompt({ ...base, contextActive: '' }), /Context in use/);
  assert.equal(personalPrompt({ context: '', active: 'default', personas: DEFAULT_PERSONAS }), '');
});

test('A config saved before contexts existed loads with the built-in personas and empty contexts', () => {
  const cfg = ConfigSchema.parse({ personal: { context: 'hi', active: 'finance', personas: [DEFAULT_PERSONAS[0], DEFAULT_PERSONAS[1]] } });
  assert.deepEqual(cfg.personal.contexts, []);
  assert.equal(cfg.personal.contextActive, '');
  assert.ok(cfg.personal.personas.length >= DEFAULT_PERSONAS.length);
  assert.deepEqual(cfg.craft.workspace, []);
});

// ---------------------------------------------------------------- the apps of the workspace reach the AI

test('The MCP server of an app of the workspace in use is on unless the user switched it off', () => {
  assert.equal(craftEnabled('photocraft', {}), false);
  assert.equal(craftEnabled('photocraft', {}, ['photocraft']), true);
  assert.equal(craftEnabled('photocraft', { photocraft: false }, ['photocraft']), false, 'a choice of the user wins');
  assert.equal(craftEnabled('wordcraft', {}, []), true, 'the document suite stays on');
});

test('The report says why an app is not connected and which apps belong to the workspace', () => {
  const rows = craftReport([], {}, [], [{ id: 'photocraft', status: 'error', error: 'spawn ENOENT', tools: [], attempts: 2, retry_in_s: 30 }], ['photocraft']);
  const p = rows.find((r) => r.id === 'photocraft')!;
  assert.equal(p.workspace, true);
  assert.equal(p.error, 'spawn ENOENT');
  assert.equal(p.retry_in_s, 30);
  assert.equal(rows.find((r) => r.id === 'wordcraft')!.workspace, false);
});

test('Browser mode answers PUT /api/config/team (it fell through to "not available in browser mode")', () => {
  const src = readFileSync('src/app/offline.ts', 'utf8');
  assert.match(src, /\(privacy\|personal\|search\|team\)/);
  const extra = readFileSync('src/app/offline-extra.ts', 'utf8');
  assert.match(extra, /registerAgents\(t\.team\.agents\)/, 'agents are stored and registered like on the desktop');
});

test('The chat request accepts the role of an app specialist and of an agent you created', () => {
  const src = readFileSync('src/server/ai.ts', 'utf8');
  assert.doesNotMatch(src, /z\.enum\(TEAM_ROLES/, 'a fixed list of five roles rejected every other role with a 400');
});

// ---------------------------------------------------------------- tool cards

test('Tool cards: the app chip and the readable name of a Craft tool, the clock, the totals', () => {
  assert.deepEqual(stepDisplay('ext-photocraft-apply-filter'), { label: 'apply-filter', app: { id: 'photocraft', name: 'PhotoCraft' } });
  assert.equal(stepDisplay('ext-craftanything-scan').app?.id, 'craft-anything');
  assert.deepEqual(stepDisplay('write-sheet'), { label: 'write-sheet' });
  assert.deepEqual(stepDisplay('ext-github-create-issue'), { label: 'ext-github-create-issue' }, 'another MCP server keeps its name');
  assert.equal(elapsedText(420), '420 ms');
  assert.equal(elapsedText(4200), '4.2 s');
  assert.equal(elapsedText(125_000), '2 m 05 s');
  assert.equal(connectionLost('PhotoCraft is not running any more and could not be started again'), true);
  assert.equal(connectionLost('Error: layer 3 not found'), false);
  assert.deepEqual(stepTotals([{ status: 'done', result: { ms: 10 } }, { status: 'error', result: { ms: 5 } }, { status: 'running' }]), { total: 3, done: 1, failed: 1, running: 1, ms: 15 });
});