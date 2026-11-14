// REST routes of the trust, search, history and home-network features (mounted under /api).
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { statfs } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freemem, totalmem, cpus, loadavg, platform } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { HOME, normProjectPath } from './paths.js';
import { mcpSchemaValidator } from './mcp-validator.js';
import { config, updateConfig, publicConfig, providerConfig, DEFAULT_PERSONAS, isLocalUrl } from './config.js';
import { withBuiltinPersonas } from '../core/defaults.js';
import * as P from './projects.js';
import { auditList, auditClear, auditCsv, AUDIT_FILE } from './audit.js';
import { logList, logClear, log, metricsSummary, metricsReset, anonymizedReport, metric, STARTED, type LogLevel } from './logs.js';
import { search, updateIndex, searchStatus, dropIndex } from './search.js';
import { notes, addNote, removeNote, clearNotes, memoryContext } from './memory.js';
import { trashList, trashRestore, trashPurge, trashEmpty } from './trash.js';
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot, diffSnapshot, snapshotForChain, gc } from './snapshots.js';
import { graph } from './graph.js';
import { objectsSize } from './objects.js';
import { exportHtml, exportMarkdown, exportPdf, exportTheme } from './export.js';
import { createShare, listShares, revokeShare, revokeAll } from './share.js';
import { manifest, ensureProject, readSyncFile, writeSyncFile, removeSyncFile, syncWithPeer } from './sync.js';
import { scanPlugins, CATALOG, installTemplate, PLUGINS_DIR } from './plugins.js';
import { externalStatus, syncExternalServers } from './mcp.js';
import { closeAllTerminals } from './terminal.js';
import { secureRemove } from './fsutil.js';
import { broadcast } from './events.js';
import { usage } from './usage.js';
import { TeamSettingsSchema, normalizeTeam, registerAgents } from '../chat/team.js';
import { TOOL_DEFS } from '../mcp/schemas.js';


export interface ExtraDeps {
  version: string;
  port: number;
  isLocal(c: Context): boolean;
  lan: boolean;
}

export function registerExtra(api: Hono, deps: ExtraDeps): void {
  const project = () => P.activeProject();
  const localOnly = (c: Context) => (deps.isLocal(c) ? null : c.json({ error: { code: 'LOCAL_ONLY', message: 'This action is only possible on the desktop itself.' } }, 403));

  // ------------------------------------------------------------ Privacy: local-only mode, audit
  api.put('/config/privacy', async (c) => {
    const b = z.object({ localOnly: z.boolean().optional(), audit: z.boolean().optional() }).parse(await c.req.json());
    updateConfig((cfg) => {
      if (b.localOnly !== undefined) cfg.privacy.localOnly = b.localOnly;
      if (b.audit !== undefined) cfg.privacy.audit = b.audit;
    });
    if (b.localOnly !== undefined) {
      log('info', 'privacy', `Local-only mode ${b.localOnly ? 'on' : 'off'}`);
      await syncExternalServers().catch(() => {});
    }
    return c.json(publicConfig());
  });
  api.get('/audit', (c) => c.json(auditList({ cloudOnly: c.req.query('cloud') === '1', limit: Number(c.req.query('limit')) || 500 })));
  api.get('/audit/export', (c) => new Response(auditCsv(auditList({ limit: 5000 })), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="workcraft-audit.csv"' } }));
  api.delete('/audit', (c) => {
    auditClear();
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ Personal context and personas
  const PersonaBody = z.object({ id: z.string().regex(/^[\w-]{2,40}$/), name: z.string().min(1).max(60), prompt: z.string().max(8000), builtIn: z.boolean().optional(), category: z.string().max(30).optional(), description: z.string().max(160).optional(), apps: z.array(z.string().max(40)).max(20).optional() });
  const ContextBody = z.object({ id: z.string().regex(/^[\w-]{2,40}$/), name: z.string().min(1).max(60), text: z.string().max(8000) });
  api.put('/config/personal', async (c) => {
    const b = z.object({ context: z.string().max(8000).optional(), active: z.string().max(40).optional(), personas: z.array(PersonaBody).max(80).optional(), contexts: z.array(ContextBody).max(40).optional(), contextActive: z.string().max(40).optional() }).parse(await c.req.json());
    updateConfig((cfg) => {
      if (b.context !== undefined) cfg.personal.context = b.context;
      if (b.personas) cfg.personal.personas = withBuiltinPersonas(b.personas.length ? b.personas : DEFAULT_PERSONAS);
      if (b.active !== undefined) cfg.personal.active = cfg.personal.personas.some((p) => p.id === b.active) ? b.active : 'default';
      if (b.contexts) cfg.personal.contexts = b.contexts;
      if (b.contextActive !== undefined) cfg.personal.contextActive = (cfg.personal.contexts || []).some((x) => x.id === b.contextActive) ? b.contextActive : '';
    });
    return c.json(publicConfig());
  });

  // ------------------------------------------------------------ Team Mode
  api.put('/config/team', async (c) => {
    const b = TeamSettingsSchema.partial().parse(await c.req.json());
    updateConfig((cfg) => {
      // Agents first: teams refer to them, and normalizing a team drops members that are not registered
      if (b.agents) cfg.team.agents = b.agents;
      registerAgents(cfg.team.agents);
      if (b.active !== undefined) cfg.team.active = normalizeTeam(b.active);
      if (b.saved) cfg.team.saved = b.saved.map(normalizeTeam);
    });
    return c.json(publicConfig());
  });

  // ------------------------------------------------------------ Search and memory
  api.put('/config/search', async (c) => {
    const b = z.object({ embeddings: z.boolean().optional(), embedModel: z.string().min(1).max(80).optional(), memory: z.boolean().optional(), ragChunks: z.number().int().min(0).max(12).optional() }).parse(await c.req.json());
    updateConfig((cfg) => void Object.assign(cfg.search, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))));
    if (b.embeddings || b.embedModel) {
      const { root } = await project();
      void updateIndex(root).catch(() => {});
    }
    return c.json(publicConfig());
  });
  api.get('/search', async (c) => {
    const { root } = await project();
    const q = z.string().min(1).max(500).parse(c.req.query('q'));
    const kinds = (c.req.query('kinds') || '').split(',').filter(Boolean) as never[];
    const t0 = Date.now();
    const r = await search(root, q, { mode: (c.req.query('mode') as 'hybrid') || 'hybrid', limit: Math.min(50, Number(c.req.query('limit')) || 20), kinds });
    metric('search', Date.now() - t0);
    return c.json({ ...r, ms: Date.now() - t0 });
  });
  api.get('/search/status', async (c) => c.json(searchStatus((await project()).root)));
  api.post('/search/reindex', async (c) => {
    const { root } = await project();
    const force = c.req.query('force') === '1';
    void updateIndex(root, force).catch((e) => log('warn', 'search', (e as Error).message));
    return c.json(searchStatus(root));
  });
  api.get('/memory', async (c) => c.json(notes((await project()).root)));
  api.post('/memory', async (c) => {
    const b = z.object({ text: z.string().min(3).max(1200), chat: z.string().max(80).optional() }).parse(await c.req.json());
    return c.json(addNote((await project()).root, b.text, 'user', b.chat));
  });
  api.delete('/memory/:id', async (c) => {
    removeNote((await project()).root, c.req.param('id'));
    return c.json({ ok: true });
  });
  api.delete('/memory', async (c) => {
    clearNotes((await project()).root);
    return c.json({ ok: true });
  });
  api.post('/memory/context', async (c) => {
    const b = z.object({ query: z.string().max(20000), exclude: z.array(z.string()).max(40).optional() }).parse(await c.req.json());
    return c.json(await memoryContext((await project()).root, b.query, { exclude: b.exclude }));
  });

  // ------------------------------------------------------------ Trash
  api.get('/trash', (c) => c.json(trashList()));
  api.post('/trash/:id/restore', async (c) => {
    const r = await trashRestore(c.req.param('id'), { adopt: (id, name) => void P.adoptProject(id, name), rootOf: (id) => P.projectRoot(id), exists: (id) => P.listProjects().some((p) => p.id === id) });
    if (r.kind === 'project') broadcast({ t: 'project', kind: 'changed', id: r.projectId });
    return c.json(r);
  });
  api.delete('/trash/:id', (c) => {
    trashPurge(c.req.param('id'));
    return c.json({ ok: true });
  });
  api.delete('/trash', (c) => c.json({ removed: trashEmpty() }));

  // ------------------------------------------------------------ Snapshots (undo across all tools)
  api.get('/snapshots', async (c) => {
    const { root } = await project();
    return c.json({ snapshots: listSnapshots(root), store: objectsSize(root) });
  });
  api.post('/snapshots', async (c) => {
    const b = z.object({ label: z.string().max(120).default('Snapshot'), auto: z.boolean().default(false), chain: z.string().max(80).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await createSnapshot((await project()).root, b.label, { auto: b.auto, chain: b.chain }));
  });
  api.get('/snapshots/chain/:chain', async (c) => c.json(snapshotForChain((await project()).root, c.req.param('chain'))));
  api.get('/snapshots/:id/diff', async (c) => c.json(await diffSnapshot((await project()).root, c.req.param('id'))));
  api.post('/snapshots/:id/restore', async (c) => {
    const b = z.object({ chats: z.boolean().default(true) }).parse(await c.req.json().catch(() => ({})));
    const r = await restoreSnapshot((await project()).root, c.req.param('id'), b);
    log('info', 'snapshot', `Restored ${c.req.param('id')}: ${r.written} files written, ${r.trashed} moved to the trash`);
    return c.json(r);
  });
  api.delete('/snapshots/:id', async (c) => {
    deleteSnapshot((await project()).root, c.req.param('id'));
    return c.json({ ok: true });
  });
  api.post('/snapshots/gc', async (c) => c.json({ freed: gc((await project()).root) }));

  // ------------------------------------------------------------ Project graph
  api.get('/graph', async (c) => {
    const { root } = await project();
    // Every file of the project is an asset node; files without history get their first version now
    for (const e of await P.listTree(root)) {
      if (e.kind !== 'file' || graph.get(root).nodes[e.path] || e.size > 25 * 1024 * 1024) continue;
      graph.recordWrite(root, e.path, await P.readProjectFile(root, e.path), 'disk');
    }
    const g = graph.get(root);
    return c.json({ nodes: Object.values(g.nodes).map((n) => ({ path: n.path, created: n.created, deleted: n.deleted, versions: n.versions.length, last: n.versions.at(-1) })), edges: g.edges, steps: g.steps.slice(-100) });
  });
  api.get('/graph/file', async (c) => c.json(graph.lineage((await project()).root, normProjectPath(c.req.query('path') || ''))));
  api.get('/graph/version', async (c) => {
    const { root } = await project();
    const data = graph.versionData(root, normProjectPath(c.req.query('path') || ''), Number(c.req.query('v')));
    if (!data) return c.json({ error: { code: 'NOT_FOUND', message: 'This version was not kept (larger than 25 MB or removed).' } }, 404);
    return new Response(data, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
  });
  api.post('/graph/restore', async (c) => {
    const { root } = await project();
    const b = z.object({ path: z.string(), v: z.number().int().min(1) }).parse(await c.req.json());
    const path = normProjectPath(b.path);
    const data = graph.versionData(root, path, b.v);
    if (!data) return c.json({ error: { code: 'NOT_FOUND', message: 'This version was not kept.' } }, 404);
    await P.writeProjectFile(root, path, data, 'history');
    return c.json({ ok: true, path });
  });

  // ------------------------------------------------------------ More export formats
  api.get('/projects/:id/export/:format', async (c) => {
    const id = c.req.param('id');
    const chats = c.req.query('chats') !== '0';
    const f = z.enum(['html', 'pdf', 'markdown']).parse(c.req.param('format'));
    const t0 = Date.now();
    const theme = exportTheme(c.req.query('theme'));
    const r = f === 'html' ? await exportHtml(id, chats, theme) : f === 'markdown' ? await exportMarkdown(id, chats) : await exportPdf(id, c.req.query('chats') === '1', theme);
    log('info', 'export', `${f}: ${r.name} (${r.bytes.byteLength} bytes)`, Date.now() - t0);
    return new Response(r.bytes, { headers: { 'content-type': f === 'pdf' ? 'application/pdf' : 'application/zip', 'content-disposition': `attachment; filename="${r.name}"` } });
  });

  // ------------------------------------------------------------ LAN share (read-only link)
  api.get('/share', (c) => localOnly(c) || c.json(listShares()));
  api.post('/share', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ minutes: z.number().int().min(5).max(1440).default(60), download: z.boolean().default(true), project: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await createShare(b.project || (await project()).meta.id, b.minutes, b.download));
  });
  api.delete('/share/:token', (c) => localOnly(c) || c.json({ ok: revokeShare(c.req.param('token')) }));
  api.delete('/share', (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    revokeAll();
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ Home-network sync
  const pid = (c: Context) => z.string().regex(/^[a-z0-9-]{3,80}$/).parse(c.req.param('id'));
  api.get('/sync/projects', (c) => c.json(P.listProjects()));
  api.post('/sync/:id/ensure', async (c) => c.json(await ensureProject(pid(c), z.object({ name: z.string().min(1).max(80) }).parse(await c.req.json()).name)));
  api.get('/sync/:id/manifest', async (c) => c.json(await manifest(pid(c))));
  api.get('/sync/:id/file', async (c) => new Response(await readSyncFile(pid(c), c.req.query('path') || ''), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } }));
  api.put('/sync/:id/file', async (c) => c.json({ path: await writeSyncFile(pid(c), c.req.query('path') || '', new Uint8Array(await c.req.arrayBuffer()), Number(c.req.query('mtime')) || undefined) }));
  api.delete('/sync/:id/file', async (c) => c.json({ trash: await removeSyncFile(pid(c), c.req.query('path') || '') }));
  api.post('/sync/peer', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ host: z.string().regex(/^[\w.:-]+$/), port: z.number().int().min(1).max(65535).default(5175), token: z.string().min(16), project: z.string().optional(), remoteProject: z.string().optional(), dryRun: z.boolean().default(false) }).parse(await c.req.json());
    if (!isLocalUrl(`http://${b.host}`)) return c.json({ error: { code: 'VALIDATION', message: 'Sync only works with devices in the home network (private IP addresses).' } }, 400);
    return c.json(await syncWithPeer(b.project || (await project()).meta.id, { host: b.host, port: b.port, token: b.token }, { remoteId: b.remoteProject, dryRun: b.dryRun }));
  });

  // ------------------------------------------------------------ Plugins
  api.get('/plugins', (c) => c.json({ dir: PLUGINS_DIR, plugins: scanPlugins().map((p) => ({ ...p, enabled: !config().plugins.disabled.includes(p.name) })), catalog: CATALOG, external: externalStatus() }));
  api.post('/plugins/install', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const name = z.object({ name: z.string() }).parse(await c.req.json()).name;
    const p = installTemplate(name);
    // templates start switched off: the user checks the command first
    updateConfig((cfg) => void (cfg.plugins.disabled = [...new Set([...cfg.plugins.disabled, name])]));
    return c.json(p);
  });
  api.put('/plugins/:name', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    const name = c.req.param('name');
    updateConfig((cfg) => void (cfg.plugins.disabled = b.enabled ? cfg.plugins.disabled.filter((x) => x !== name) : [...new Set([...cfg.plugins.disabled, name])]));
    await syncExternalServers();
    return c.json({ external: externalStatus() });
  });
  api.delete('/plugins/:name', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const name = z.string().regex(/^[a-z0-9-]{2,40}$/).parse(c.req.param('name'));
    rmSync(join(PLUGINS_DIR, name), { recursive: true, force: true });
    await syncExternalServers();
    return c.json({ ok: true });
  });
  api.post('/plugins/reload', async (c) => {
    await syncExternalServers();
    return c.json({ external: externalStatus() });
  });

  // ------------------------------------------------------------ Observability
  api.get('/logs', (c) => c.json(logList({ since: Number(c.req.query('since')) || 0, level: (c.req.query('level') as LogLevel) || undefined, limit: Number(c.req.query('limit')) || 500 })));
  api.delete('/logs', (c) => {
    logClear();
    return c.json({ ok: true });
  });
  api.post('/logs', async (c) => {
    // Lines from the frontend (errors, app start times) join the same log
    const b = z.array(z.object({ level: z.enum(['debug', 'info', 'warn', 'error']), source: z.string().max(40), message: z.string().max(2000), ms: z.number().optional() })).max(100).parse(await c.req.json());
    for (const l of b) log(l.level, `ui:${l.source}`, l.message, l.ms);
    return c.json({ ok: true });
  });
  api.get('/metrics', (c) => c.json(metricsSummary()));
  api.post('/metrics', async (c) => {
    const b = z.array(z.object({ name: z.string().max(80), value: z.number() })).max(100).parse(await c.req.json());
    for (const m of b) metric(m.name, m.value);
    return c.json({ ok: true });
  });
  api.put('/metrics/config', async (c) => {
    const b = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    updateConfig((cfg) => void (cfg.metrics.enabled = b.enabled));
    return c.json(metricsSummary());
  });
  api.delete('/metrics', (c) => {
    metricsReset();
    return c.json(metricsSummary());
  });
  api.get('/metrics/report', (c) => new Response(JSON.stringify(anonymizedReport(), null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="workcraft-performance.json"' } }));
  api.get('/health/resources', (c) => {
    const m = process.memoryUsage();
    return c.json({ rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, arrayBuffers: m.arrayBuffers, freemem: freemem(), totalmem: totalmem(), cpus: cpus().length, load: loadavg(), uptime: Math.round((Date.now() - STARTED) / 1000) });
  });

  // ------------------------------------------------------------ Health check
  api.get('/health/full', async (c) => {
    const t0 = Date.now();
    const check = async <T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; detail?: T; error?: string }> => {
      const s = Date.now();
      try {
        return { ok: true, ms: Date.now() - s, detail: await fn() };
      } catch (e) {
        return { ok: false, ms: Date.now() - s, error: (e as Error).message.slice(0, 300) };
      }
    };
    const { root, meta } = await project();
    const ollamaBase = (providerConfig('ollama')?.baseUrl || 'http://127.0.0.1:11434/v1').replace(/\/v1\/?$/, '');
    const [mcp, ollama, disk, pty] = await Promise.all([
      check(async () => {
        const client = new Client({ name: 'workcraft-health', version: deps.version }, { jsonSchemaValidator: mcpSchemaValidator });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${deps.port}/mcp`)));
        const s = Date.now();
        const list = await client.listTools();
        const ms = Date.now() - s;
        await client.close().catch(() => {});
        return { tools: list.tools.length, builtIn: TOOL_DEFS.filter((d) => d.side === 'server').length, listMs: ms };
      }),
      check(async () => {
        const v = (await (await fetch(`${ollamaBase}/api/version`, { signal: AbortSignal.timeout(1500) })).json()) as { version?: string };
        const tags = (await (await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(1500) })).json()) as { models?: { name: string }[] };
        const models = (tags.models || []).map((m) => m.name);
        const em = config().search.embedModel;
        return { url: ollamaBase, version: v.version, models, embedModel: em, embedModelPresent: models.some((m) => m === em || m.startsWith(em + ':')) };
      }),
      check(async () => {
        const s = await statfs(HOME);
        return { free: s.bavail * s.bsize, total: s.blocks * s.bsize, path: HOME };
      }),
      check(async () => {
        await import('node-pty');
        return 'node-pty';
      }),
    ]);
    const m = process.memoryUsage();
    return c.json({
      at: new Date().toISOString(),
      ms: Date.now() - t0,
      backend: { ok: true, version: deps.version, node: process.versions.node, platform: platform(), pid: process.pid, uptime: Math.round((Date.now() - STARTED) / 1000), rss: m.rss, heapUsed: m.heapUsed, lan: deps.lan },
      system: { freemem: freemem(), totalmem: totalmem(), cpus: cpus().length, load: loadavg() },
      mcp,
      external: externalStatus(),
      ollama,
      disk,
      terminal: { ok: true, pty: pty.ok, mode: pty.ok ? 'pty' : 'line' },
      privacy: { localOnly: config().privacy.localOnly, audit: config().privacy.audit, auditFile: existsSync(AUDIT_FILE) },
      search: { project: meta.name, ...searchStatus(root) },
      share: listShares(),
      trash: { entries: trashList().length },
      snapshots: { count: listSnapshots(root).length, store: objectsSize(root) },
    });
  });

  // ------------------------------------------------------------ One-click wipe
  api.post('/wipe', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z
      .object({ confirm: z.literal('WIPE'), keys: z.boolean().default(true), projects: z.boolean().default(true), chats: z.boolean().default(true), usage: z.boolean().default(true), audit: z.boolean().default(true), personal: z.boolean().default(true), plugins: z.boolean().default(false) })
      .parse(await c.req.json());
    const done: string[] = [];
    revokeAll();
    if (b.keys) {
      updateConfig((cfg) => {
        for (const e of Object.values(cfg.ai.providers)) delete e.apiKey;
        for (const e of cfg.ai.custom) delete e.apiKey;
        cfg.ai.custom = [];
        cfg.ai.active = 'auto';
        cfg.lan.token = undefined;
        cfg.lan.enabled = false;
      });
      done.push('API keys, own endpoints and the home-network token');
    }
    if (b.personal) {
      updateConfig((cfg) => void (cfg.personal = { context: '', active: 'default', personas: DEFAULT_PERSONAS, contexts: [], contextActive: '' }));
      done.push('personal context and personas');
    }
    let files = 0;
    if (b.projects) {
      closeAllTerminals();
      for (const p of P.listProjects()) {
        P.releaseProject(p.id);
        graph.forget(P.projectRoot(p.id));
        dropIndex(P.projectRoot(p.id));
        files += secureRemove(P.projectRoot(p.id));
      }
      trashEmpty();
      updateConfig((cfg) => void (cfg.activeProject = null));
      done.push('all projects, their chats, snapshots and the trash');
    } else if (b.chats) {
      for (const p of P.listProjects()) {
        const r = P.projectRoot(p.id);
        for (const f of await P.listMetaDir(r, 'chats')) await P.removeMetaFile(r, `chats/${f}`);
        const mem = join(r, '.workcraft', 'memory.json');
        if (existsSync(mem)) secureRemove(mem);
      }
      done.push('chat history and project memory');
    }
    if (b.usage) {
      for (const f of ['usage.json', 'metrics.json']) if (existsSync(join(HOME, f))) secureRemove(join(HOME, f));
      usage.reset();
      usage.setRates({});
      metricsReset();
      done.push('usage statistics and metrics');
    }
    if (b.plugins) {
      secureRemove(PLUGINS_DIR);
      updateConfig((cfg) => void ((cfg.mcpServers = []), (cfg.plugins.disabled = [])));
      done.push('plugins and MCP servers');
    }
    logClear();
    if (b.audit && existsSync(AUDIT_FILE)) secureRemove(AUDIT_FILE);
    if (b.audit) done.push('audit log and logs');
    // a fresh sample project, so the workspace opens normally
    const fresh = await project();
    broadcast({ t: 'project', kind: 'switched', id: fresh.meta.id });
    return c.json({ ok: true, done, overwritten: files, project: fresh.meta.id });
  });
}
