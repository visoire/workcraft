// The AI workspace features: skills, Craft apps as MCP servers, the IDE bridge, custom agents with
// collaboration patterns and shared memory, and cloud storage (Google Drive adapter, synced folders).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORKCRAFT_HOME = mkdtempSync(join(tmpdir(), 'wc-ai-'));
process.env.WORKCRAFT_NO_CRAFT_DISCOVERY = '1';
const skills = await import('../../src/server/skills.ts');
const craft = await import('../../src/server/craft.ts');
const { bridgeConfigs } = await import('../../src/server/bridge.ts');
const team = await import('../../src/chat/team.ts');
const cloud = await import('../../src/server/cloud.ts');
const { updateConfig } = await import('../../src/server/config.ts');
const { runSync } = await import('../../src/core/sync.ts');
const { sha } = await import('../../src/server/sync.ts');

// ---------------------------------------------------------------- Skills

test('skills: front matter (folded and plain), the 13 bundled skills, safe file reads', () => {
  const fm = skills.parseFrontMatter('---\nname: photocraft\ndescription: >\n  PhotoCraft is a native,\n  image editor.\n---\n\n# PhotoCraft\n\nBody.\n');
  assert.equal(fm.name, 'photocraft');
  assert.equal(fm.description, 'PhotoCraft is a native, image editor.');
  assert.ok(fm.body.startsWith('# PhotoCraft'));
  assert.equal(skills.parseFrontMatter('no front matter').body, 'no front matter');
  // the same file with Windows line endings (a checkout with core.autocrlf=true): the description is the LAST key, which used to be lost
  const crlf = skills.parseFrontMatter('---\r\nname: deckcraft\r\ndescription: DeckCraft is a presentation app.\r\n---\r\n\r\n# DeckCraft\r\n\r\nBody.\r\n');
  assert.equal(crlf.name, 'deckcraft');
  assert.equal(crlf.description, 'DeckCraft is a presentation app.');
  assert.ok(crlf.body.startsWith('# DeckCraft'));

  const bundled = skills.scanSkills(skills.skillRoots().filter((r) => r.origin === 'bundled'));
  assert.equal(bundled.length, 13, bundled.map((s) => s.name).join(','));
  assert.ok(bundled.every((s) => s.description.length > 20), 'every skill has a description');
  assert.match(skills.readSkill(bundled, 'WordCraft'), /wordcraft-cli/i, 'names match without case');
  assert.match(skills.skillIndex(bundled), /^- cadcraft: /m);
  assert.throws(() => skills.readSkill(bundled, 'nope'), /Available: /);
  assert.throws(() => skills.readSkill(bundled, 'wordcraft', '../../package.json'), /outside the skill folder/);
  const refs = bundled.find((s) => s.name === 'deckcraft')!;
  assert.match(skills.readSkill(bundled, 'deckcraft'), /references\//, 'the extra files are listed');
  assert.ok(skills.readSkill(bundled, 'deckcraft', 'references/commands-and-formats.md').length > 100);
  void refs;
});

test('installing the bundled skills for other agents leaves existing folders alone', () => {
  const target = mkdtempSync(join(tmpdir(), 'wc-skillinst-'));
  assert.equal(skills.installBundledSkills(target).length, 13);
  writeFileSync(join(target, 'wordcraft', 'SKILL.md'), '---\nname: wordcraft\ndescription: mine\n---\nmine');
  assert.deepEqual(skills.installBundledSkills(target), []);
  assert.match(readFileSync(join(target, 'wordcraft', 'SKILL.md'), 'utf8'), /mine/);
});

// ---------------------------------------------------------------- Craft apps

test('craft apps: 19 apps with a CLI, document suite on by default, live bridge arguments per app', async () => {
  assert.equal(craft.CRAFT_APPS.length, 19);
  // the six added with the 2026-11-12 versions (flags checked against their apps/<app>-cli sources)
  assert.deepEqual(craft.liveMcpArgs('mailcraft', 7991), ['mcp', '--connect', '127.0.0.1:7991']);
  assert.deepEqual(craft.liveMcpArgs('texturecraft', 7992), ['mcp', '--bridge', '7992']);
  assert.deepEqual(craft.liveMcpArgs('materialcraft', 7993), ['mcp', '--bridge', '7993']);
  assert.deepEqual(craft.liveMcpArgs('solidcraft', 7994), ['mcp', '--connect', '127.0.0.1:7994']);
  assert.deepEqual(craft.mcpArgs({ id: 'solidcraft', extra: ['--headless'], livePort: null }), ['mcp', '--headless']);
  assert.deepEqual(craft.mcpArgs({ id: 'craft-anything', extra: ['--restricted'], livePort: null }), ['mcp', '--restricted']);
  assert.deepEqual(craft.mcpArgs({ id: 'anicraft', extra: [], livePort: null }), ['mcp']);
  assert.equal(craft.mcpArgs({ id: 'texturecraft', extra: [], livePort: null })[1], '--automation-read-root');
  assert.equal(craft.lookupApp('Craft Anything')?.id, 'craft-anything');
  assert.equal(new Set(craft.CRAFT_APPS.map((a) => a.port).filter(Boolean)).size, craft.CRAFT_APPS.filter((a) => a.port).length, 'no two apps share a control port');
  assert.equal(craft.craftEnabled('wordcraft', {}), true);
  assert.equal(craft.craftEnabled('filmcraft', {}), false);
  assert.equal(craft.craftEnabled('filmcraft', { filmcraft: true }), true);
  assert.equal(craft.craftEnabled('wordcraft', { wordcraft: false }), false);
  assert.deepEqual(craft.liveMcpArgs('gridcraft', 7982), ['mcp', '--connect', '7982']);
  assert.deepEqual(craft.liveMcpArgs('filmcraft', 9876), ['mcp', '--bridge', '127.0.0.1:9876']);
  assert.deepEqual(craft.liveMcpArgs('effectcraft', 9877), ['mcp', '--bridge', '9877']);
  assert.deepEqual(craft.liveMcpArgs('figcraft', 7989), ['mcp', '--attach', '7989']);
  assert.deepEqual(craft.liveMcpArgs('lightcraft', 7980), ['mcp', '--connect', '127.0.0.1:7980', '--compact']);
  assert.deepEqual(craft.mcpArgs({ id: 'pdfcraft', extra: ['--compact'], livePort: null }), ['mcp', '--compact']);
  assert.deepEqual(craft.mcpArgs({ id: 'wordcraft', extra: [], livePort: 7981 }), ['mcp', '--connect', '127.0.0.1:7981']);
  assert.equal(craft.lookupApp('Word')?.id, 'wordcraft');
  assert.equal(craft.lookupApp('CADCraft')?.id, 'cadcraft');
  assert.equal(craft.lookupApp('excel'), undefined);
  assert.deepEqual(await craft.discover(), [], 'discovery is switched off in tests');
  const rep = craft.craftReport([], {}, []);
  assert.equal(rep.length, 19);
  assert.ok(rep.every((r) => !r.installed));
  // the icons exist for all 19
  for (const a of craft.CRAFT_APPS) assert.ok(existsSync(join(process.cwd(), 'public', 'assets', 'craft', `${a.id}.png`)), a.id);
});

// ---------------------------------------------------------------- IDE bridge

test('IDE bridge: one snippet per platform, the home network one only with a token', () => {
  const b = bridgeConfigs({ origin: 'http://127.0.0.1:5176', lan: null, host: '127.0.0.1:5176' });
  assert.equal(b.url, 'http://127.0.0.1:5176/mcp');
  assert.equal(b.lanUrl, null);
  const ids = b.targets.map((t) => t.id);
  for (const id of ['antigravity', 'trae', 'cursor', 'windsurf', 'claude-code', 'claude-desktop', 'opencode', 'zcode']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('network'));
  for (const t of b.targets.filter((x) => x.format !== 'shell')) JSON.parse(t.snippet);
  assert.deepEqual(JSON.parse(b.targets.find((t) => t.id === 'antigravity')!.snippet), { mcpServers: { workcraft: { url: 'http://127.0.0.1:5176/mcp', transport: 'http' } } });
  assert.equal(b.targets.find((t) => t.id === 'claude-code')!.snippet, 'claude mcp add --transport http workcraft http://127.0.0.1:5176/mcp');
  assert.equal(JSON.parse(b.targets.find((t) => t.id === 'opencode')!.snippet).mcp.workcraft.type, 'remote');
  const lan = bridgeConfigs({ origin: 'http://127.0.0.1:5176', lan: { token: 'tok123' }, host: '192.168.1.5:5175' });
  assert.ok(lan.targets.some((t) => t.id === 'network' && t.snippet.includes('x-oc-token:tok123') && t.snippet.includes('http://192.168.1.5:5175/mcp')));
});

// ---------------------------------------------------------------- Agents, patterns, memory

const agent = (id: string, name: string, extra: Partial<ReturnType<typeof team.AgentProfileSchema.parse>> = {}) => team.AgentProfileSchema.parse({ id, name, role: `${name} does research`, prompt: 'Be careful.', tools: ['read-*', 'ext-photocraft-*'], color: '#EC4899', icon: 'search', ...extra });

test('agents you create: mention, tool patterns, colors, kept by normalizeTeam, gone when removed', () => {
  const research = agent('a-research', 'Research Desk');
  team.registerAgents([research]);
  assert.equal(team.ROLE_DEFS['a-research']!.mention, 'research-desk');
  assert.equal(team.roleFromName('@research-desk'), 'a-research');
  assert.equal(team.roleFromName('Research Desk'), 'a-research');
  assert.equal(team.ROLE_DEFS['a-research']!.accent, '#EC4899');
  const t = (name: string, app = 'project', source?: string) => ({ name, app, source });
  assert.equal(team.toolAllowed('a-research', t('read-sheet', 'gridcraft')), true, 'read-* pattern');
  assert.equal(team.toolAllowed('a-research', t('write-sheet', 'gridcraft')), false);
  assert.equal(team.toolAllowed('a-research', t('ext-photocraft-open', 'project', 'external')), true);
  assert.equal(team.toolAllowed('a-research', t('read-skill')), true, 'skills are always readable');
  assert.equal(team.toolAllowed('a-research', t('search-project')), true, 'the shared read tools');
  assert.equal(team.toolAllowed('leader', t('read-sheet')), false);
  assert.equal(team.toolAllowed('grid', t('read-sheet', 'gridcraft')), true, 'built-in roles are unchanged');
  assert.equal(team.toolAllowed('grid', t('ext-x-y', 'project', 'external')), false);
  assert.equal(team.toolPatternMatches('app:gridcraft', t('x', 'gridcraft')), true);

  const cfg = team.normalizeTeam({ ...team.DEFAULT_TEAM, workers: [...team.DEFAULT_TEAM.workers, team.memberFromAgent(research)] });
  assert.ok(cfg.workers.some((w) => w.role === 'a-research'));
  assert.equal(team.rosterLines(team.enabledWorkers(cfg)).includes('research-desk'), true);
  assert.match(team.workerSystem('a-research', false), /Be careful\./);
  team.registerAgents([]);
  assert.equal(team.roleFromName('@research-desk'), null);
  assert.ok(!team.normalizeTeam(cfg).workers.some((w) => w.role === 'a-research'), 'an agent that was deleted leaves the team');
});

test('patterns: sequential chains the plan, parallel drops dependencies, supervisor keeps them', () => {
  const g = { goal: 'g', tasks: [1, 2, 3].map((n) => ({ id: `t${n}`, title: `T${n}`, assignedAgent: 'grid', dependencies: n === 3 ? ['t1'] : [], targetFiles: [], instructions: 'x' })) };
  assert.deepEqual(team.applyPattern(g, 'sequential').tasks.map((t) => t.dependencies), [[], ['t1'], ['t2']]);
  assert.deepEqual(team.applyPattern(g, 'parallel').tasks.map((t) => t.dependencies), [[], [], []]);
  assert.deepEqual(team.applyPattern(g, 'supervisor').tasks.map((t) => t.dependencies), [[], [], ['t1']]);
  assert.deepEqual(team.applyPattern(g, 'human'), g);
});

function scripted(opt: { pattern: 'sequential' | 'parallel' | 'human'; approve?: boolean }) {
  team.registerAgents([agent('a-writer', 'Writer')]);
  const cfg = team.normalizeTeam({ ...team.DEFAULT_TEAM, pattern: opt.pattern, concurrency: 3, review: 'checks', workers: [...team.DEFAULT_TEAM.workers.map((w) => ({ ...w, enabled: w.role === 'grid' })), { ...team.memberFromAgent(agent('a-writer', 'Writer')), enabled: true }] });
  const seen: { task: string; memory: string; at: number }[] = [];
  const plan = JSON.stringify({ goal: 'g', tasks: [{ id: 't1', title: 'Figures', assignedAgent: 'grid-agent', dependencies: [], instructions: 'a' }, { id: 't2', title: 'Text', assignedAgent: 'writer', dependencies: ['t1'], instructions: 'b' }, { id: 't3', title: 'More', assignedAgent: 'grid-agent', dependencies: [], instructions: 'c' }] });
  let clock = 0;
  const run = new team.TeamRun({
    config: cfg,
    driver: {
      plan: async () => plan,
      approvePlan: async () => opt.approve ?? true,
      work: async (task, input) => {
        seen.push({ task: task.id, memory: input.memory, at: ++clock });
        await new Promise((r) => setTimeout(r, task.id === 't1' ? 25 : 1));
        return { text: `report of ${task.id}`, changed: [`/${task.id}.md`], toolCalls: [{ name: 'write-document', ok: true, path: `/${task.id}.md` }] };
      },
      synthesize: async () => 'done',
    },
  });
  return { run, seen };
}

test('a sequential run waits for each agent, and the shared memory reaches the next agent', async () => {
  const { run, seen } = scripted({ pattern: 'sequential' });
  const s = await run.run('make it');
  assert.equal(s.phase, 'completed');
  assert.deepEqual(seen.map((x) => x.task), ['t1', 't2', 't3'], 'one after another, in plan order');
  assert.equal(seen[0]!.memory, '', 'the first agent has nothing to read yet');
  assert.match(seen[2]!.memory, /<team-memory>[\s\S]*t1 \(grid-agent\): report of t1[\s\S]*\[files: \/t1\.md\]/, 'the third agent reads what the first did (the second arrives through its dependency)');
  assert.equal(s.memory.length, 3);
  assert.equal(s.pattern, 'sequential');
});

test('a parallel run starts all agents at once', async () => {
  const { run, seen } = scripted({ pattern: 'parallel' });
  const s = await run.run('make it');
  assert.equal(s.phase, 'completed');
  assert.deepEqual(seen.map((x) => x.task).sort(), ['t1', 't2', 't3']);
  assert.equal(seen.filter((x) => x.at <= 3).length, 3);
  assert.ok(seen.every((x) => x.memory === ''), 'nothing was finished when they started');
});

test('human in the loop: no agent starts before the plan is approved; a refusal stops the run', async () => {
  const yes = scripted({ pattern: 'human', approve: true });
  const a = await yes.run.run('make it');
  assert.equal(a.phase, 'completed');
  assert.equal(a.awaitingApproval, false);
  const no = scripted({ pattern: 'human', approve: false });
  const b = await no.run.run('make it');
  assert.equal(b.phase, 'stopped');
  assert.equal(no.seen.length, 0, 'nothing ran');
});

// ---------------------------------------------------------------- Cloud storage

test('Google sign-in uses PKCE with the loopback redirect and the chosen scope', () => {
  assert.throws(() => cloud.googleStart('http://127.0.0.1:5176/api/cloud/google/callback'), /OAuth client ID/);
  updateConfig((c) => void ((c.cloud.google.clientId = 'abc123.apps.googleusercontent.com'), (c.cloud.google.clientSecret = 'secret-1'), (c.cloud.google.scope = 'file')));
  const u = new URL(cloud.googleStart('http://127.0.0.1:5176/api/cloud/google/callback'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok((u.searchParams.get('code_challenge') || '').length >= 40);
  assert.match(u.searchParams.get('scope') || '', /auth\/drive\.file/);
  assert.ok(!(u.searchParams.get('scope') || '').includes('auth/drive '), 'the narrow scope by default');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:5176/api/cloud/google/callback');
  assert.ok(!u.toString().includes('secret-1'), 'the client secret never goes into the URL');
  assert.equal(cloud.googleStatus().connected, false);
});

test('a state that was not started here is refused', async () => {
  await assert.rejects(() => cloud.googleCallback('code', 'forged'), /expired or was not started here/);
});

test('a synced folder (iCloud Drive and others) mirrors both ways, keeps both versions on a conflict', async () => {
  const remoteRoot = mkdtempSync(join(tmpdir(), 'wc-icloud-'));
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  const local = {
    name: 'this computer',
    manifest: async () => [...files].map(([path, f]) => ({ path, size: f.data.length, mtime: f.mtime, hash: sha(f.data) })),
    read: async (p: string) => files.get(p)!.data,
    write: async (p: string, d: Uint8Array, m: number) => void files.set(p, { data: d, mtime: m }),
    remove: async (p: string) => void files.delete(p),
  };
  const put = (p: string, s: string, mtime = Date.now()) => files.set(p, { data: new TextEncoder().encode(s), mtime });
  const text = (p: string) => new TextDecoder().decode(files.get(p)!.data);
  const folder = cloud.folderAdapter(join(remoteRoot, 'WorkCraft', 'Plan'), 'iCloud Drive');
  const hash = async (d: Uint8Array) => sha(d);
  put('/documents/report.docx', 'v1');
  put('/notes/a.md', 'a');
  let base: Record<string, string> | null = null;
  let r = await runSync(local, folder, base, { hash });
  base = r.base;
  assert.equal(r.pushed, 2);
  assert.equal(readFileSync(join(remoteRoot, 'WorkCraft', 'Plan', 'documents', 'report.docx'), 'utf8'), 'v1');
  // the cloud side changes the report (as iCloud would deliver an edit from another device)
  writeFileSync(join(remoteRoot, 'WorkCraft', 'Plan', 'documents', 'report.docx'), 'v2 from phone');
  mkdirSync(join(remoteRoot, 'WorkCraft', 'Plan', 'pdf'), { recursive: true });
  writeFileSync(join(remoteRoot, 'WorkCraft', 'Plan', 'pdf', 'scan.pdf'), 'pdf');
  writeFileSync(join(remoteRoot, 'WorkCraft', 'Plan', 'pdf', 'big.pdf.icloud'), 'not downloaded');
  r = await runSync(local, folder, base, { hash });
  base = r.base;
  assert.equal(r.pulled, 2);
  assert.equal(text('/documents/report.docx'), 'v2 from phone');
  assert.ok(!files.has('/pdf/big.pdf.icloud'), 'iCloud placeholders are not mirrored');
  // both sides change one file: both versions survive
  put('/notes/a.md', 'local edit', Date.now() + 5000);
  writeFileSync(join(remoteRoot, 'WorkCraft', 'Plan', 'notes', 'a.md'), 'cloud edit');
  r = await runSync(local, folder, base, { hash });
  assert.equal(r.conflicts, 1);
  assert.ok([...files.keys()].some((k) => /a \(conflict .*\)\.md$/.test(k)), 'the other version is kept next to it');
  assert.deepEqual(r.errors, []);
});

test('the Drive adapter lists with stored hashes, writes with the hash, trashes instead of deleting', async () => {
  updateConfig((c) => {
    c.cloud.google.refreshToken = 'rt';
    c.cloud.google.accessToken = 'at';
    c.cloud.google.expiresAt = Date.now() + 3_600_000;
  });
  const calls: { method: string; url: string; body?: string }[] = [];
  const real = globalThis.fetch;
  const drive: Record<string, unknown>[] = [
    { id: 'f1', name: 'plan.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: '2', modifiedTime: '2026-11-01T10:00:00.000Z', md5Checksum: 'md5x', appProperties: { sha256: 'abc' }, parents: ['root1'] },
    { id: 'd1', name: 'sub', mimeType: 'application/vnd.google-apps.folder', parents: ['root1'] },
    { id: 'g1', name: 'Native doc', mimeType: 'application/vnd.google-apps.document', parents: ['root1'] },
    { id: 'f2', name: 'inner.md', mimeType: 'text/markdown', size: '1', modifiedTime: '2026-11-02T10:00:00.000Z', md5Checksum: 'm2', parents: ['d1'] },
  ];
  globalThis.fetch = (async (url: URL | string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    calls.push({ method: init.method || 'GET', url: u.pathname + u.search, body: init.body ? String(typeof init.body === 'string' ? init.body : Buffer.from(init.body as Buffer).toString('utf8')) : undefined });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer at');
    if (u.pathname === '/drive/v3/files' && (init.method || 'GET') === 'GET') {
      const parent = /'([^']+)' in parents/.exec(u.searchParams.get('q') || '')?.[1];
      return new Response(JSON.stringify({ files: drive.filter((f) => (f.parents as string[]).includes(parent!)) }), { status: 200 });
    }
    if (u.pathname.startsWith('/upload/drive/v3/files')) return new Response(JSON.stringify({ id: u.pathname.endsWith('/files') ? 'new1' : 'f1', name: 'x', mimeType: 'text/markdown' }), { status: 200 });
    if (u.pathname === '/drive/v3/files/f1' && init.method === 'PATCH') return new Response('{}', { status: 200 });
    if (u.pathname === '/drive/v3/files/f1') return new Response(new Uint8Array([1, 2]), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const a = cloud.driveAdapter('root1');
    const m = await a.manifest();
    assert.deepEqual(m.map((x) => [x.path, x.hash]).sort(), [['/plan.docx', 'abc'], ['/sub/inner.md', 'md5:m2']], 'sha256 from appProperties, md5 as the fallback, Google-native documents left out');
    assert.deepEqual([...(await a.read('/plan.docx'))], [1, 2]);
    await a.write('/plan.docx', new TextEncoder().encode('new'), Date.parse('2026-11-03T00:00:00Z'));
    const up = calls.find((c) => c.method === 'POST' || (c.method === 'PATCH' && c.url.startsWith('/upload')));
    assert.ok(up && up.url.includes('/upload/drive/v3/files/f1') && up.body?.includes(sha(new TextEncoder().encode('new'))), 'an existing file is updated with its new sha256');
    await a.remove('/plan.docx');
    const trash = calls.find((c) => c.method === 'PATCH' && c.url === '/drive/v3/files/f1');
    assert.equal(JSON.parse(trash!.body!).trashed, true, 'the remote delete goes to the Drive trash');
    assert.ok(!calls.some((c) => c.method === 'DELETE'));
  } finally {
    globalThis.fetch = real;
  }
});

test('local-only mode blocks cloud storage', async () => {
  updateConfig((c) => void (c.privacy.localOnly = true));
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => (calls++, new Response('{}'))) as typeof fetch;
  try {
    await assert.rejects(() => cloud.driveList(), /Local-only mode/);
    assert.throws(() => cloud.googleStart('http://127.0.0.1:1/cb'), /Local-only mode/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = real;
    updateConfig((c) => void (c.privacy.localOnly = false));
  }
});
