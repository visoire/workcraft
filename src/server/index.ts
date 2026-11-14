// Local desktop backend of WorkCraft (Node.js + Hono).
// Binds to 127.0.0.1 only. Host and origin checks protect against foreign web pages
// (DNS rebinding, cross-site requests). In production it also serves the frontend from dist/.

import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import { existsSync, statSync } from 'node:fs';
import { resolve, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { z, ZodError } from 'zod';
import { HOME, PathError, normProjectPath, resolveIn, IS_WIN } from './paths.js';
import { config, publicConfig, updateConfig, providerConfig, ConfigSchema, DeepSeekEntry } from './config.js';
import { ollamaContext } from './ollama.js';
import { checkReleases, validateItems } from './updates.js';
import { githubService } from './apicraft.js';
import { addPeer, broadcast, onEvent } from './events.js';
import { updateIndex } from './search.js';
import * as P from './projects.js';
import { openTerminal, writeTerminal, resizeTerminal, closeTerminal, closeAllTerminals, shellKinds } from './terminal.js';
import { chatRoute, testRoute, aiStatus, completeRoute, countRoute, toolStatRoute } from './ai.js';
import { usage } from './usage.js';
import { mcpHandler, issueApproval, syncExternalServers, externalStatus, healthCheck } from './mcp.js';
import { fileContext } from './tools.js';
import { seedProject } from './seed.js';
import { isLocalRequest, decideRemote, readCookie, tokenMatches, newToken, lanAddresses, pairUrl, LAN_COOKIE } from './lan.js';
import type { IncomingMessage } from 'node:http';
import { registerExtra } from './routes-extra.js';
import { registerAi } from './routes-ai.js';
import { startAutoSync } from './cloud.js';
import { registerAgents } from '../chat/team.js';
import { captureConsole, log } from './logs.js';
import { trashAutoPurge } from './trash.js';
import { graph } from './graph.js';
import { gc as gcObjects } from './snapshots.js';
import { createServer as createHttpsServer } from 'node:https';
import { resolveTls, certProblems, schemeOf } from './tls.js';

captureConsole();

export { VERSION } from '../core/version.js';
import { VERSION } from '../core/version.js';
const DEV = process.env.WORKCRAFT_DEV === '1';
const PORT = Number(process.env.WORKCRAFT_PORT || 5175);
const UI_PORT = Number(process.env.WORKCRAFT_UI_PORT || PORT);
// dist/ is two levels above this file (src/server/index.ts and dist-server/server/index.js),
// whatever working directory npm start runs in.
const DIST = resolve(process.env.WORKCRAFT_DIST || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist'));

P.setSeed(seedProject);

// Home network mode (iPad on Wi-Fi): setting, WORKCRAFT_LAN=1 or --lan. Applies at start.
const LAN = process.env.WORKCRAFT_LAN === '1' || process.argv.includes('--lan') || config().lan.enabled;
if (LAN && !config().lan.token) updateConfig((cfg) => void (cfg.lan.token = newToken()));
const lanToken = () => config().lan.token;

// HTTPS (src/server/tls.ts): a certificate the iPad trusts gives it WebGPU, the offline cache and OPFS back.
// In development Vite serves the pages over HTTPS and talks plain HTTP to this backend, so scripts/dev.mjs
// sets WORKCRAFT_UI_SCHEME=https for the pairing address, the cookie and the allowed origins.
const TLS = resolveTls({ env: process.env, argv: process.argv, home: HOME, cwd: process.cwd() });
if (!TLS.enabled && TLS.reason) console.warn(`[tls] ${TLS.reason}. Continuing on HTTP.`);
const SCHEME = schemeOf(TLS.enabled || process.env.WORKCRAFT_UI_SCHEME === 'https');

const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

// ---------------------------------------------------------------- Sicherheit
const hosts = new Set([PORT, UI_PORT].flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]));
const origins = new Set([UI_PORT, PORT].flatMap((p) => [`${SCHEME}://127.0.0.1:${p}`, `${SCHEME}://localhost:${p}`, ...(SCHEME === 'https' ? [`http://127.0.0.1:${p}`, `http://localhost:${p}`] : [])]));

const remoteOf = (c: Context) => (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket?.remoteAddress;
/** Request from the desktop itself (not from the home network)? */
const isLocal = (c: Context) => isLocalRequest({ remote: remoteOf(c), forwarded: c.req.header('x-forwarded-for'), host: c.req.header('host') || '', localHosts: hosts });

app.use('*', async (c, next) => {
  const host = c.req.header('host') || '';
  const origin = c.req.header('origin');
  if (isLocal(c)) {
    if (origin && !origins.has(origin)) return c.text('Origin not allowed', 403);
    return next();
  }
  // Preflight for x-oc-token (interface on another address in the home network)
  if (LAN && c.req.method === 'OPTIONS' && origin) {
    c.header('access-control-allow-origin', origin);
    c.header('access-control-allow-headers', 'content-type, x-oc-token, x-oc-origin, mcp-session-id, mcp-protocol-version, last-event-id');
    c.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header('access-control-max-age', '600');
    c.header('vary', 'Origin');
    return c.body(null, 204);
  }
  // Home network: pairing through /pair?token=… sets the cookie for this address
  const path = c.req.path;
  if (LAN && path === '/pair') {
    if (!tokenMatches(c.req.query('token'), lanToken())) return c.text('Pairing failed: the access token does not match.', 401);
    c.header('set-cookie', `${LAN_COOKIE}=${encodeURIComponent(lanToken()!)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${SCHEME === 'https' ? '; Secure' : ''}`);
    return c.redirect('/', 302);
  }
  const d = decideRemote({ lanActive: LAN, token: lanToken(), path, host, origin, cookie: readCookie(c.req.header('cookie'), LAN_COOKIE), header: c.req.header('x-oc-token'), query: c.req.query('token') });
  if (!d.ok) return path.startsWith('/api') ? c.json({ error: { code: d.code, message: d.message } }, d.status) : c.text(d.message, d.status);
  // Token in the header: access also from another address (interface on another server)
  if (d.via === 'header' && origin) {
    c.header('access-control-allow-origin', origin);
    c.header('vary', 'Origin');
  }
  await next();
});


// ---------------------------------------------------------------- Security headers
// Hardened Content Security Policy for the workspace pages; the apps (WebAssembly) get their own policy
// with wasm-unsafe-eval. The meta tag in index.html stays as a second line of defence.
const CSP_IDE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'self'; worker-src 'self' blob:; connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const CSP_APP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
app.use('*', async (c, next) => {
  await next();
  const p = c.req.path;
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'same-origin');
  c.header('permissions-policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
  if (p.startsWith('/api') || p === '/mcp') {
    c.header('cache-control', c.res.headers.get('cache-control') || 'no-store');
    return;
  }
  const type = c.res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return;
  c.header('x-frame-options', 'SAMEORIGIN');
  c.header('cross-origin-opener-policy', 'same-origin');
  if (p.startsWith('/apps/')) c.header('content-security-policy', CSP_APP);
  else if (p.startsWith('/ide') || p.startsWith('/docs')) c.header('content-security-policy', CSP_IDE);
});

// ---------------------------------------------------------------- Errors
app.onError((err, c) => {
  const e = err as Error & { code?: string };
  let status: 400 | 403 | 404 | 409 | 422 | 500 | 501 = 500;
  let code = e.code || 'INTERNAL';
  let message = e.message;
  if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION';
    message = err.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ');
  } else if (err instanceof PathError) status = 400;
  else if (err instanceof P.ProjectError) status = ({ NOT_FOUND: 404, INVALID: 400, EXISTS: 409, IMPORT: 422 } as const)[err.code];
  else console.error(err);
  if (status === 500 && code !== 'INTERNAL') status = ({ NOT_FOUND: 404, INVALID: 400, VALIDATION: 400, SHARE: 409 } as Record<string, 404 | 400 | 409>)[code] || 500;
  if (status >= 500) log('error', 'api', `${c.req.method} ${c.req.path}: ${message}`);
  return c.json({ error: { code, message } }, status);
});

const project = async () => P.activeProject();
const qpath = (c: Context) => normProjectPath(c.req.query('path') || '');

// ---------------------------------------------------------------- System and configuration
const api = new Hono();

api.get('/health', async (c) => {
  let pty = false;
  try {
    await import('node-pty');
    pty = true;
  } catch {
    /* line mode */
  }
  return c.json({ ok: true, version: VERSION, home: HOME, pty, platform: platform(), shells: shellKinds(), dev: DEV, mode: 'desktop', lan: LAN, tls: SCHEME === 'https', remote: !isLocal(c) });
});

// ---------------------------------------------------------------- Home network (only from the desktop itself)
const localOnly = (c: Context) => (isLocal(c) ? null : c.json({ error: { code: 'LOCAL_ONLY', message: 'This setting is only possible on the desktop itself.' } }, 403));
api.get('/lan', (c) => {
  const deny = localOnly(c);
  if (deny) return deny;
  const addresses = lanAddresses();
  const token = lanToken() || null;
  return c.json({ active: LAN, enabled: config().lan.enabled, token, port: UI_PORT, scheme: SCHEME, addresses, urls: token ? addresses.map((a) => pairUrl(a, UI_PORT, token, SCHEME)) : [] });
});
api.put('/lan', async (c) => {
  const deny = localOnly(c);
  if (deny) return deny;
  const b = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  updateConfig((cfg) => {
    cfg.lan.enabled = b.enabled;
    if (b.enabled && !cfg.lan.token) cfg.lan.token = newToken();
  });
  return c.json({ enabled: config().lan.enabled, restart: b.enabled !== LAN });
});
api.post('/lan/token', (c) => {
  const deny = localOnly(c);
  if (deny) return deny;
  updateConfig((cfg) => void (cfg.lan.token = newToken()));
  return c.json({ token: lanToken() });
});

api.get('/config', (c) => c.json(publicConfig()));

api.put('/config/provider', async (c) => {
  const b = z.object({ id: z.string(), apiKey: z.string().nullable().optional(), model: z.string().optional(), baseUrl: z.string().url().optional().or(z.literal('')) }).parse(await c.req.json());
  updateConfig((cfg) => {
    const e = (cfg.ai.providers[b.id] ||= {});
    if (b.apiKey === null) delete e.apiKey;
    else if (b.apiKey) e.apiKey = b.apiKey.trim();
    if (b.model !== undefined) e.model = b.model.trim() || undefined;
    if (b.baseUrl !== undefined) e.baseUrl = b.baseUrl.trim() || undefined;
  });
  return c.json(publicConfig());
});

const CustomBody = z.object({ name: z.string().min(1).max(60), baseUrl: z.string().url(), apiKey: z.string().nullable().optional(), model: z.string().min(1) });
api.post('/config/custom', async (c) => {
  const b = CustomBody.parse(await c.req.json());
  const id = `custom-${randomUUID().slice(0, 8)}`;
  updateConfig((cfg) => void cfg.ai.custom.push({ id, name: b.name, baseUrl: b.baseUrl.replace(/\/$/, ''), apiKey: b.apiKey || undefined, model: b.model }));
  return c.json({ id, config: publicConfig() });
});
api.put('/config/custom/:id', async (c) => {
  const b = CustomBody.partial().parse(await c.req.json());
  updateConfig((cfg) => {
    const x = cfg.ai.custom.find((e) => e.id === c.req.param('id'));
    if (!x) throw new P.ProjectError('NOT_FOUND', 'Endpoint not found');
    if (b.name) x.name = b.name;
    if (b.baseUrl) x.baseUrl = b.baseUrl.replace(/\/$/, '');
    if (b.model) x.model = b.model;
    if (b.apiKey === null) delete x.apiKey;
    else if (b.apiKey) x.apiKey = b.apiKey;
  });
  return c.json(publicConfig());
});
api.delete('/config/custom/:id', (c) => {
  updateConfig((cfg) => {
    cfg.ai.custom = cfg.ai.custom.filter((e) => e.id !== c.req.param('id'));
    if (cfg.ai.active === c.req.param('id')) cfg.ai.active = 'auto';
  });
  return c.json(publicConfig());
});
api.put('/config/deepseek', async (c) => {
  const b = DeepSeekEntry.parse(await c.req.json());
  updateConfig((cfg) => void (cfg.ai.deepseek = b));
  return c.json(publicConfig());
});
// Context of Ollama models (tokens, -1 = automatic, 0 = the maximum of the model)
api.put('/config/ollama-context', async (c) => {
  const b = z.object({ tokens: z.number().int().min(-1).max(2_097_152) }).parse(await c.req.json());
  updateConfig((cfg) => void (cfg.ai.ollamaContext = b.tokens));
  return c.json(publicConfig());
});
api.get('/ai/ollama-context', async (c) => {
  const cfg = providerConfig('ollama');
  if (!cfg) return c.json({ available: false });
  const o = await ollamaContext(cfg, config().ai.ollamaContext).catch(() => null);
  return c.json(o ? { available: true, model: cfg.model, ...o } : { available: false });
});
api.put('/config/active', async (c) => {
  const b = z.object({ active: z.string() }).parse(await c.req.json());
  updateConfig((cfg) => void (cfg.ai.active = b.active));
  return c.json(publicConfig());
});
// Release check (apicraft logic, GitHub asked directly; off by default; the optional token stays here and is only ever shown masked)
api.put('/config/updates', async (c) => {
  const b = z.object({ enabled: z.boolean().optional(), githubToken: z.string().nullable().optional() }).parse(await c.req.json());
  updateConfig((cfg) => {
    if (b.enabled !== undefined) cfg.updates.enabled = b.enabled;
    if (b.githubToken !== undefined) cfg.updates.githubToken = b.githubToken?.trim() || undefined;
  });
  return c.json(publicConfig());
});
// Check a GitHub token without spending quota (apicraft verify_token)
api.post('/updates/verify-token', async (c) => {
  const b = z.object({ token: z.string().min(8).max(300) }).parse(await c.req.json());
  return c.json(await githubService.verifyToken(b.token));
});
api.post('/updates/check', async (c) => {
  const b = z.object({ repos: z.array(z.unknown()), force: z.boolean().optional() }).parse(await c.req.json());
  return c.json(await checkReleases(validateItems(b.repos), !!b.force));
});
api.put('/config/mcp', async (c) => {
  const b = ConfigSchema.shape.mcpServers.parse(await c.req.json());
  updateConfig((cfg) => void (cfg.mcpServers = b));
  await syncExternalServers();
  return c.json({ config: publicConfig(), external: externalStatus() });
});
api.get('/mcp/external', (c) => c.json(externalStatus()));

// ---------------------------------------------------------------- KI
api.get('/ai/status', async (c) => c.json(await aiStatus()));
api.post('/ai/chat', chatRoute);
api.post('/ai/test', testRoute);
api.post('/ai/complete', completeRoute);
api.post('/ai/count', countRoute);
api.post('/usage/tool', toolStatRoute);

// ---------------------------------------------------------------- Usage and telemetry
api.get('/usage', (c) => c.json(usage.get()));
api.delete('/usage', (c) => c.json(usage.reset()));
const RateSchema = z.object({ input: z.number().min(0).max(10_000), output: z.number().min(0).max(10_000), cached: z.number().min(0).max(10_000).optional() });
api.put('/usage/rates', async (c) => c.json(usage.setRates(z.record(z.string().max(160), RateSchema).parse(await c.req.json()))));
api.post('/approvals', async (c) => {
  const b = z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()) }).parse(await c.req.json());
  try {
    return c.json({ token: issueApproval(b.tool, b.args) });
  } catch (e) {
    return c.json({ error: { code: 'VALIDATION', message: (e as Error).message } }, 400);
  }
});

// ---------------------------------------------------------------- Projects
api.get('/projects', async (c) => {
  const { meta } = await project();
  return c.json({ active: meta, projects: P.listProjects() });
});
api.post('/projects', async (c) => {
  const b = z.object({ name: z.string().min(1).max(80), template: z.enum(['empty', 'sample']).default('empty'), switchTo: z.boolean().default(true) }).parse(await c.req.json());
  const meta = await P.createProject(b.name, b.template);
  if (b.switchTo) await P.switchProject(meta.id);
  return c.json(meta);
});
// "Load sample data": opens the sample project (created from the template the first time)
api.post('/projects/sample', async (c) => c.json(await P.openSample()));
api.post('/projects/:id/switch', async (c) => c.json(await P.switchProject(c.req.param('id'))));
api.patch('/projects/:id', async (c) => c.json(P.renameProject(c.req.param('id'), z.object({ name: z.string() }).parse(await c.req.json()).name)));
api.delete('/projects/:id', async (c) => {
  // Open shells keep the project folder locked on Windows: close them first
  if ((await project()).meta.id === c.req.param('id')) closeAllTerminals();
  const r = await P.deleteProject(c.req.param('id'));
  await project();
  return c.json(r);
});
api.get('/projects/:id/export', async (c) => {
  const { name, bytes } = await P.exportProject(c.req.param('id'));
  return new Response(bytes, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}"` } });
});
api.post('/projects/import', async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const meta = await P.importProject(bytes, c.req.query('name'));
  if (c.req.query('switch') !== '0') await P.switchProject(meta.id);
  return c.json(meta);
});

// ---------------------------------------------------------------- Files
api.get('/files/tree', async (c) => {
  const { meta, root } = await project();
  return c.json({ project: meta.id, entries: await P.listTree(root) });
});
api.get('/files/raw', async (c) => {
  const { root } = await project();
  const data = await P.readProjectFile(root, qpath(c));
  return new Response(data, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
});
api.put('/files/raw', async (c) => {
  const { root } = await project();
  const path = await P.writeProjectFile(root, qpath(c), new Uint8Array(await c.req.arrayBuffer()), c.req.header('x-oc-origin') || 'ui');
  return c.json({ path });
});
api.post('/files/mkdir', async (c) => {
  const { root } = await project();
  await P.mkdirProject(root, z.object({ path: z.string() }).parse(await c.req.json()).path);
  return c.json({ ok: true });
});
api.post('/files/rename', async (c) => {
  const { root } = await project();
  const b = z.object({ from: z.string(), to: z.string() }).parse(await c.req.json());
  return c.json({ path: await P.renameProjectPath(root, b.from, b.to) });
});
// Where a file lives on this computer, and "show it in the file manager": only from the computer that runs WorkCraft
api.get('/files/location', async (c) => {
  if (!isLocal(c)) return c.json({ error: 'The location is only shown on the computer that runs WorkCraft.' }, 403);
  const { root } = await project();
  return c.json({ path: resolveIn(root, qpath(c)) });
});
api.post('/files/reveal', async (c) => {
  if (!isLocal(c)) return c.json({ error: 'Only on the computer that runs WorkCraft.' }, 403);
  const { root } = await project();
  const abs = resolveIn(root, z.object({ path: z.string() }).parse(await c.req.json()).path);
  const dir = existsSync(abs) && statSync(abs).isDirectory();
  if (IS_WIN) spawn('explorer.exe', [dir ? `"${abs}"` : `/select,"${abs}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  else if (process.platform === 'darwin') spawn('open', dir ? [abs] : ['-R', abs], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [dir ? abs : dirname(abs)], { detached: true, stdio: 'ignore' }).unref();
  return c.json({ ok: true });
});
// Deleting moves into the trash (30 days), ?permanent=1 deletes at once
api.delete('/files', async (c) => {
  const { root } = await project();
  if (c.req.query('permanent') === '1') {
    await P.removeProjectPath(root, qpath(c), c.req.header('x-oc-origin') || 'ui');
    return c.json({ ok: true });
  }
  return c.json({ ok: true, trash: await P.trashProjectPath(root, qpath(c), c.req.header('x-oc-origin') || 'ui') });
});
api.get('/files/context', async (c) => {
  const { root } = await project();
  return c.json(await fileContext(root, qpath(c), Number(c.req.query('limit')) || 24000));
});

// ---------------------------------------------------------------- Layout and chats (per project)
api.get('/meta/layout', async (c) => {
  const { root } = await project();
  const raw = await P.readMetaFile(root, 'layout.json');
  return c.json(raw ? JSON.parse(raw) : null);
});
api.put('/meta/layout', async (c) => {
  const { root } = await project();
  await P.writeMetaFile(root, 'layout.json', JSON.stringify(await c.req.json()));
  return c.json({ ok: true });
});
async function chatSummaries(root: string, extra: Record<string, unknown> = {}) {
  const out = [];
  for (const f of await P.listMetaDir(root, 'chats')) {
    const raw = await P.readMetaFile(root, `chats/${f}`);
    if (!raw) continue;
    try {
      const j = JSON.parse(raw) as { id: string; title?: string; updated?: string; messages?: unknown[] };
      out.push({ id: j.id, title: j.title || 'Chat', updated: j.updated, count: j.messages?.length || 0, ...extra });
    } catch {
      /* skip a broken file */
    }
  }
  return out;
}
// ?scope=all lists the chats of every project (the history drawer's "All projects")
api.get('/chats', async (c) => {
  const { root, meta } = await project();
  let out: Awaited<ReturnType<typeof chatSummaries>> = [];
  if (c.req.query('scope') === 'all') {
    for (const p of P.listProjects()) {
      try {
        out.push(...(await chatSummaries(P.getProject(p.id).root, { project: p.id, projectName: p.name })));
      } catch {
        /* project folder gone */
      }
    }
  } else out = await chatSummaries(root, { project: meta.id, projectName: meta.name });
  return c.json(out.sort((a, b) => String(b.updated).localeCompare(String(a.updated))));
});
// Clear the history of the active project
api.delete('/chats', async (c) => {
  const { root } = await project();
  let n = 0;
  for (const f of await P.listMetaDir(root, 'chats')) {
    await P.removeMetaFile(root, `chats/${f}`);
    n++;
  }
  return c.json({ ok: true, removed: n });
});
const chatId = (c: Context) => z.string().regex(/^[\w-]{4,64}$/).parse(c.req.param('id'));
api.get('/chats/:id', async (c) => {
  const { root } = await project();
  const raw = await P.readMetaFile(root, `chats/${chatId(c)}.json`);
  return raw ? c.json(JSON.parse(raw)) : c.json({ error: { code: 'NOT_FOUND', message: 'Chat not found' } }, 404);
});
api.put('/chats/:id', async (c) => {
  const { root } = await project();
  await P.writeMetaFile(root, `chats/${chatId(c)}.json`, JSON.stringify(await c.req.json()));
  return c.json({ ok: true });
});
api.delete('/chats/:id', async (c) => {
  const { root } = await project();
  await P.removeMetaFile(root, `chats/${chatId(c)}.json`);
  return c.json({ ok: true });
});

registerExtra(api, { version: VERSION, port: PORT, isLocal, lan: LAN });
registerAi(api, { port: PORT, lan: LAN, isLocal });
registerAgents(config().team.agents);
startAutoSync();

app.route('/api', api);

// ---------------------------------------------------------------- MCP (Streamable HTTP)
app.all('/mcp', (c) => mcpHandler.fetch(c.req.raw));

// ---------------------------------------------------------------- WebSocket: events and terminal
const TermMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('term:open'), id: z.string().max(40), cols: z.number().int().optional(), rows: z.number().int().optional(), shell: z.enum(['powershell', 'cmd', 'posix']).optional() }),
  z.object({ t: z.literal('term:input'), id: z.string(), data: z.string().max(100_000) }),
  z.object({ t: z.literal('term:resize'), id: z.string(), cols: z.number().int(), rows: z.number().int() }),
  z.object({ t: z.literal('term:close'), id: z.string() }),
]);

app.get(
  '/ws',
  upgradeWebSocket(() => {
    let off: (() => void) | null = null;
    return {
      async onOpen(_e, ws) {
        off = addPeer({ id: randomUUID(), send: (d) => ws.send(d) });
        const { meta } = await project();
        ws.send(JSON.stringify({ t: 'hello', version: VERSION, project: meta.id }));
      },
      async onMessage(e) {
        let msg: z.infer<typeof TermMsg>;
        try {
          msg = TermMsg.parse(JSON.parse(String(e.data)));
        } catch {
          return;
        }
        if (msg.t === 'term:open') {
          const { root } = await project();
          await openTerminal(msg.id, root, msg.cols, msg.rows, msg.shell);
        } else if (msg.t === 'term:input') writeTerminal(msg.id, msg.data);
        else if (msg.t === 'term:resize') resizeTerminal(msg.id, msg.cols, msg.rows);
        else closeTerminal(msg.id);
      },
      onClose() {
        off?.();
      },
    };
  })
);

// ---------------------------------------------------------------- Frontend (Produktion)
if (!DEV && existsSync(DIST)) {
  // Clean URLs: /docs.html -> /docs/, /docs/index.html -> /docs/, /docs -> /docs/
  app.use('*', async (c, next) => {
    const p = c.req.path;
    const qs = new URL(c.req.url).search;
    // The workspace used to live under /ide/ (bookmarks, installed apps): it is the root page now
    if (p === '/ide' || p === '/ide/' || p === '/ide.html') return c.redirect('/' + qs, 301);
    const index = p.match(/^(.*\/)index\.html$/);
    if (index && !p.includes('/apps/')) return c.redirect(index[1] + qs, 301);
    const page = p.match(/^\/(.+)\.html$/);
    if (page && existsSync(resolve(DIST, page[1]!, 'index.html'))) return c.redirect(`/${page[1]}/${qs}`, 301);
    if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p) && !p.startsWith('/api') && existsSync(resolve(DIST, p.slice(1), 'index.html'))) return c.redirect(`${p}/${qs}`, 301);
    await next();
  });
  // serveStatic expects a path relative to the working directory with forward slashes (Windows)
  const rel = relative(process.cwd(), DIST);
  const root = (rel && !rel.includes(':') ? rel : DIST).split(sep).join('/') || '.';
  app.use('/*', serveStatic({ root }));
}

// ---------------------------------------------------------------- Start
await project();
syncExternalServers().catch(() => {});
// The Craft apps come and go (a window is opened, an app is closed or hangs): every 45 s the connected servers are pinged and
// the rest is looked at again, so a live window is picked up and a dead pipe is replaced before the AI calls it
setInterval(() => void healthCheck().catch(() => {}), 45_000).unref();
// Trash: remove entries older than 30 days on start and every six hours
const purge = () => {
  try {
    const n = trashAutoPurge();
    if (n) log('info', 'trash', `${n} entries older than 30 days removed`);
  } catch (e) {
    log('warn', 'trash', (e as Error).message);
  }
  // Version store: free contents that no snapshot and no kept file version uses any more
  void project()
    .then(({ root }) => {
      graph.flush(root);
      const freed = gcObjects(root);
      if (freed) log('info', 'history', `${freed} bytes of old file versions freed`);
    })
    .catch(() => {});
};
purge();
setInterval(purge, 6 * 3600_000).unref();
// Search index: build it in the background and keep it fresh a few seconds after changes
let indexTimer: ReturnType<typeof setTimeout> | undefined;
const reindexSoon = (ms = 4000) => {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => void project().then(({ root }) => updateIndex(root)).catch((e) => log('warn', 'search', (e as Error).message)), ms);
};
onEvent((ev) => {
  if (ev.t === 'fs' || (ev.t === 'project' && ev.kind === 'switched')) reindexSoon();
});
reindexSoon(1500);
log('info', 'backend', `WorkCraft ${VERSION} started (Node ${process.versions.node}, ${platform()})`);
const server = serve({ fetch: app.fetch, port: PORT, hostname: LAN ? '0.0.0.0' : '127.0.0.1', ...(TLS.enabled ? { createServer: createHttpsServer, serverOptions: { key: TLS.tls.key, cert: TLS.tls.cert } } : {}) }, (info) => {
  // localhost (not 127.0.0.1): the theme cookie is then shared with the website under XAMPP
  const url = `${SCHEME}://localhost:${UI_PORT}/`;
  console.log(`WorkCraft backend ${VERSION} at ${schemeOf(TLS.enabled)}://${LAN ? '0.0.0.0' : '127.0.0.1'}:${info.port} · data: ${HOME}`);
  if (LAN) {
    console.log('Home network mode on. Pair the iPad with one of these addresses:');
    for (const a of lanAddresses()) console.log(`  ${pairUrl(a, UI_PORT, lanToken()!, SCHEME)}`);
    if (TLS.enabled) for (const p of certProblems(TLS.tls.cert, ['localhost', ...lanAddresses()])) console.warn(`[tls] ${p}`);
    else if (SCHEME === 'http') console.log('  Over HTTP Safari offers no WebGPU, offline cache or OPFS. For HTTPS see docs/IPADOS-GUIDE.md (npm run lan:cert).');
  }
  if (!DEV) console.log(`Workspace: ${url}`);
  if (process.argv.includes('--open')) {
    const cmd = platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]] : platform() === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  }
});
injectWebSocket(server as Parameters<typeof injectWebSocket>[0]);
broadcast({ t: 'hello', version: VERSION, project: config().activeProject });

const stop = () => {
  usage.flush();
  graph.flush();
  server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
