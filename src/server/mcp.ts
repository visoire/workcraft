// MCP in the backend:
// - McpServer (@modelcontextprotocol/server) with all project tools, reachable at /mcp
//   (Streamable HTTP). The orchestrator in the frontend and external MCP clients use it.
// - MCP clients (@modelcontextprotocol/client) to own stdio servers from the configuration
//   (for example wordcraft-cli mcp). Their tools are passed on with the prefix ext-<name>-.

import { McpServer, createMcpHandler, fromJsonSchema } from '@modelcontextprotocol/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { mcpSchemaValidator } from './mcp-validator.js';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_DEFS, TOOL_BY_NAME } from '../mcp/schemas.js';
import { HANDLERS, ToolError } from './tools.js';
import { activeProject } from './projects.js';
import { broadcast } from './events.js';
import { config, isLocalUrl, type McpServerEntry } from './config.js';
import { HOME } from './paths.js';
import { pluginServers } from './plugins.js';
import { graph } from './graph.js';
import { createSnapshot, snapshotForChain } from './snapshots.js';
import { log, metric } from './logs.js';
import { auditRecord } from './audit.js';
import { VERSION } from '../core/version.js';
import { craftEnabled, discover, mcpArgs } from './craft.js';

// ---------------------------------------------------------------- Approvals (run-command, sign-pdf)

const approvals = new Map<string, { tool: string; hash: string; until: number }>();
const argsHash = (args: unknown) => createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex');

/** One-time token after confirmation in the frontend. Valid for 2 minutes for exactly this call. */
export function issueApproval(tool: string, args: unknown): string {
  if (!TOOL_BY_NAME.get(tool)?.approval && !externalNeedsApproval(tool)) throw Object.assign(new Error('This tool needs no approval'), { code: 'VALIDATION' });
  const token = randomBytes(16).toString('hex');
  // the same normalization as for the call (defaults from the Zod schema)
  const parsed = TOOL_BY_NAME.get(tool)?.input.parse(args ?? {}) ?? args;
  approvals.set(token, { tool, hash: argsHash(parsed), until: Date.now() + 120_000 });
  return token;
}

function consumeApproval(token: unknown, tool: string, args: unknown): boolean {
  if (typeof token !== 'string') return false;
  const a = approvals.get(token);
  approvals.delete(token);
  return !!a && a.tool === tool && a.until > Date.now() && a.hash === argsHash(args);
}

// ---------------------------------------------------------------- External servers and plugins (sandbox)

type ServerEntry = McpServerEntry & { env?: Record<string, string>; cwd?: string; accent?: string };
interface ExtTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}
interface External {
  entry: ServerEntry;
  client: Client | null;
  tools: ExtTool[];
  status: 'connected' | 'error' | 'off';
  error?: string;
  /** what the sandbox actually applies */
  sandbox: string;
  /** Connection attempts since the last success, and when the last one started (drives the retry back-off) */
  attempts: number;
  lastTry: number;
}
const externals = new Map<string, External>();
const CALL_TIMEOUT = 120_000;
const MAX_RESULT = 200_000;
/** A server can list its tools over several pages (SolidCraft and Craft Anything have dozens); bound the loop anyway. */
const MAX_TOOL_PAGES = 20;

/** A server that failed to start is tried again on a later sync: after 15 s, 30 s, 60 s ... up to 5 minutes. A fixed
 *  configuration is picked up by its changed signature at once; this covers a desktop app that was not running yet. */
export const retryDelay = (attempts: number) => Math.min(300_000, 15_000 * 2 ** Math.max(0, attempts - 1));
export const shouldRetry = (ext: Pick<External, 'status' | 'attempts' | 'lastTry'>, now = Date.now()) => ext.status === 'error' && now - ext.lastTry >= retryDelay(ext.attempts);

/** Errors that mean the connection to a server is gone (the process exited, the pipe closed), not that the tool failed. */
export const isConnectionLost = (e: unknown) => /closed|EPIPE|ECONNRESET|ECONNREFUSED|not connected|Connection (?:lost|reset)|socket hang up|spawn .* ENOENT/i.test((e as Error)?.message ?? '');

/** All wanted servers: added by hand plus plugins. */
async function wantedServers(): Promise<ServerEntry[]> {
  const c = config();
  const mine = [...c.mcpServers, ...pluginServers(c.plugins.disabled)];
  // The Craft apps found on this computer, unless a server of the same id was added by hand
  const craft = (await discover())
    .filter((f) => craftEnabled(f.id, c.craft.apps, c.craft.workspace) && !mine.some((m) => m.id === f.id || m.name === f.id))
    .map((f): ServerEntry => ({ id: f.id, name: f.id, command: f.cli, args: mcpArgs(f), enabled: true, transport: 'stdio', sandbox: 'standard', approval: c.craft.approval, accent: undefined }));
  return [...mine, ...craft].filter((s) => s.enabled);
}

const sig = (e: ServerEntry) => JSON.stringify([e.transport, e.command, e.args, e.url, e.sandbox, e.env, e.cwd]);

/** Node permission model flag of this Node version (--permission from 23.5, before --experimental-permission). */
const permFlag = () => (process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission');

/**
 * Process parameters with the sandbox applied:
 * - standard: only the safe default environment (PATH, HOME, TEMP …) plus the env of the plugin,
 *   no API keys or tokens of the backend; working folder is the plugin folder or ~/workcraft/sandbox/<id>
 * - strict: as standard, and for node commands the Node permission model: read the plugin folder
 *   and the project, write only the project, no child processes, no workers
 * - off: the full environment of the backend (only for servers you trust)
 */
export function sandboxParams(e: ServerEntry, projectRoot: string): { command: string; args: string[]; env: Record<string, string>; cwd: string; applied: string } {
  const cwd = e.cwd || join(HOME, 'sandbox', e.id.replace(/[^\w-]+/g, '_'));
  mkdirSync(cwd, { recursive: true });
  if (e.sandbox === 'off') return { command: e.command, args: e.args, env: { ...(process.env as Record<string, string>), ...(e.env || {}) }, cwd, applied: 'off (full environment)' };
  const env = { ...getDefaultEnvironment(), ...(e.env || {}) };
  for (const k of Object.keys(env)) if (/(_KEY|TOKEN|SECRET|PASSWORD)$/i.test(k) && !(e.env && k in e.env)) delete env[k];
  const isNode = /(^|[\\/])node(\.exe)?$/i.test(e.command);
  if (e.sandbox === 'strict' && isNode) {
    const args = [permFlag(), `--allow-fs-read=${cwd}`, `--allow-fs-read=${projectRoot}`, `--allow-fs-write=${projectRoot}`, ...e.args];
    return { command: e.command, args, env, cwd, applied: 'strict (Node permission model, clean environment)' };
  }
  return { command: e.command, args: e.args, env, cwd, applied: e.sandbox === 'strict' ? 'strict (clean environment, the permission model applies to node commands only)' : 'standard (clean environment)' };
}

/** Attempt counts of servers that were removed for a retry (see shouldRetry). */
const retries = new Map<string, number>();

/** Every tool of a server, following the cursor of tools/list. Duplicate names (a buggy server) keep the first. */
async function listAllTools(client: Client): Promise<ExtTool[]> {
  const out: ExtTool[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const list = await client.listTools(cursor ? { cursor } : undefined);
    for (const t of list.tools) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, readOnly: !!t.annotations?.readOnlyHint });
    }
    cursor = list.nextCursor;
    if (!cursor) break;
  }
  return out;
}

let running: Promise<void> | null = null;
let again = false;

/** Brings the connected servers in line with the configuration. Calls that overlap share one run (plus one more pass when the
 *  configuration may have changed meanwhile), so two requests never start the same server twice. */
export function syncExternalServers(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** A call found the connection gone: connect the server again now (not after the back-off) and hand back the fresh entry. */
async function reconnect(id: string): Promise<External | null> {
  const cur = externals.get(id);
  if (cur) {
    cur.status = 'error';
    cur.error = 'connection lost';
    cur.lastTry = 0;
    cur.attempts = 0;
  }
  await syncExternalServers();
  const next = externals.get(id);
  return next?.status === 'connected' && next.client ? next : null;
}

/**
 * Forgets the back-off of failed servers (all of them, or only `ids`) and connects them now: the Reconnect button. A
 * connected server named in `ids` is closed and started again too, which picks up a changed app or a new live window.
 */
export async function reconnectNow(ids?: string[]): Promise<void> {
  for (const [id, ext] of [...externals]) {
    if (ids && !ids.includes(id)) continue;
    if (ext.status === 'error') {
      ext.lastTry = 0;
      ext.attempts = 0;
    } else if (ids) {
      await ext.client?.close().catch(() => {});
      externals.delete(id);
    }
  }
  await syncExternalServers();
}

/**
 * Pings every connected server. One that does not answer within a few seconds counts as lost (the app was closed, the process
 * hung): it is marked and connected again at once, so the next tool call does not find a dead pipe. Returns the ids it lost.
 */
export async function healthCheck(timeout = 5000): Promise<string[]> {
  const lost: string[] = [];
  await Promise.all(
    [...externals.values()]
      .filter((e) => e.status === 'connected' && e.client)
      .map(async (e) => {
        try {
          await e.client!.ping({ timeout });
        } catch (err) {
          lost.push(e.entry.id);
          e.status = 'error';
          e.error = `no answer to a ping (${(err as Error).message})`;
          e.lastTry = 0;
          e.attempts = 0;
          log('warn', 'mcp', `${e.entry.name}: ${e.error}`);
        }
      })
  );
  // Also the right time to notice a new live window or an app that was not running before
  await syncExternalServers();
  return lost;
}

async function syncOnce(): Promise<void> {
  const wanted = await wantedServers();
  for (const [id, ext] of externals) {
    const stale = !wanted.find((w) => w.id === id && sig(w) === sig(ext.entry));
    if (stale || shouldRetry(ext)) {
      await ext.client?.close().catch(() => {});
      externals.delete(id);
      // A retry keeps its count, so the back-off grows while a server stays down
      if (!stale) retries.set(id, ext.attempts);
    }
  }
  const { root } = await activeProject();
  await Promise.all(
    wanted
      .filter((w) => !externals.has(w.id))
      .map(async (entry) => {
        const ext: External = { entry, client: null, tools: [], status: 'off', sandbox: '', attempts: (retries.get(entry.id) ?? 0) + 1, lastTry: Date.now() };
        retries.delete(entry.id);
        externals.set(entry.id, ext);
        try {
          const client = new Client({ name: 'workcraft', version: VERSION }, { jsonSchemaValidator: mcpSchemaValidator });
          if (entry.transport === 'http') {
            if (!entry.url) throw new Error('The server has no URL');
            if (config().privacy.localOnly && !isLocalUrl(entry.url)) throw new Error('Local-only mode is on: remote MCP servers are blocked');
            ext.sandbox = isLocalUrl(entry.url) ? 'http (this computer or home network)' : 'http (remote, every call lands in the audit log)';
            await client.connect(new StreamableHTTPClientTransport(new URL(entry.url)));
          } else {
            const p = sandboxParams(entry, root);
            ext.sandbox = p.applied;
            await client.connect(new StdioClientTransport({ command: p.command, args: p.args, env: p.env, cwd: p.cwd, stderr: 'ignore' }));
          }
          ext.tools = await listAllTools(client);
          ext.client = client;
          ext.status = 'connected';
          ext.attempts = 0;
          log('info', 'mcp', `${entry.name}: ${ext.tools.length} tools, sandbox ${ext.sandbox}`);
        } catch (e) {
          ext.status = 'error';
          ext.error = (e as Error).message;
          log('warn', 'mcp', `${entry.name}: ${ext.error}`);
        }
      })
  );
}

/** Ids of the servers that are connected right now (the Craft apps among them). */
export const connectedServers = () => [...externals.values()].filter((e) => e.status === 'connected').map((e) => e.entry.id);

export function externalStatus() {
  const now = Date.now();
  return [...externals.values()].map((e) => ({
    id: e.entry.id,
    name: e.entry.name,
    status: e.status,
    error: e.error,
    tools: e.tools.map((t) => t.name),
    sandbox: e.sandbox,
    approval: e.entry.approval,
    transport: e.entry.transport,
    plugin: e.entry.plugin,
    // A failed server is tried again by itself: how many times so far and in how many seconds the next try can happen
    attempts: e.attempts,
    ...(e.status === 'error' ? { retry_in_s: Math.max(0, Math.ceil((e.lastTry + retryDelay(e.attempts) - now) / 1000)) } : {}),
  }));
}

const extName = (server: string, tool: string) => `ext-${server.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${tool}`.slice(0, 64);

function externalTool(name: string): { ext: External; tool: ExtTool } | null {
  for (const ext of externals.values()) for (const t of ext.tools) if (extName(ext.entry.name, t.name) === name) return { ext, tool: t };
  return null;
}

/** Does a call of this external tool need a confirmation (approval rule of its server)? */
export function externalNeedsApproval(name: string): boolean {
  const x = externalTool(name);
  if (!x) return false;
  const rule = x.ext.entry.approval || 'ask';
  return rule === 'ask' || (rule === 'read' && !x.tool.readOnly);
}

// ---------------------------------------------------------------- Server

function buildServer(): McpServer {
  const server = new McpServer({ name: 'workcraft-project', version: VERSION }, { capabilities: { tools: { listChanged: true } } });
  for (const def of TOOL_DEFS.filter((d) => d.side === 'server')) {
    const handler = HANDLERS[def.name];
    if (!handler) continue;
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.input, annotations: { readOnlyHint: !def.writes && !def.approval, destructiveHint: !!def.approval }, _meta: { app: def.app, approval: !!def.approval } },
      async (args: Record<string, unknown>, ctx) => {
        const meta = (ctx.mcpReq._meta || {}) as Record<string, unknown>;
        const token = meta.progressToken as string | number | undefined;
        const callId = typeof meta['workcraft/callId'] === 'string' ? (meta['workcraft/callId'] as string) : undefined;
        const path = def.pathArg ? String(args[def.pathArg] ?? '') : undefined;
        if (def.approval && !consumeApproval(meta['workcraft/approval'], def.name, args)) {
          return { isError: true, content: [{ type: 'text' as const, text: `${def.title} needs a confirmation in WorkCraft.` }] };
        }
        let step = 0;
        const progress = async (message: string, s?: number, total?: number) => {
          step = s ?? step + 1;
          broadcast({ t: 'tool', phase: 'progress', name: def.name, path, message, callId });
          if (token !== undefined) {
            await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: step, ...(total ? { total } : {}), message } }).catch(() => {});
          }
        };
        const chain = typeof meta['workcraft/chain'] === 'string' ? (meta['workcraft/chain'] as string).slice(0, 80) : undefined;
        const id = callId || randomBytes(6).toString('hex');
        broadcast({ t: 'tool', phase: 'start', name: def.name, path, callId });
        const t0 = Date.now();
        let root = '';
        try {
          root = (await activeProject()).root;
          // Undo across all tools: before the first write of an AI answer, keep the project state
          if (def.writes && chain && !snapshotForChain(root, chain)) await createSnapshot(root, `Before AI: ${def.title}`, { auto: true, chain });
          graph.beginStep(id, def.name, chain);
          const out = await handler(args, { root, origin: `tool:${id}`, progress });
          broadcast({ t: 'tool', phase: 'end', name: def.name, path, ok: true, callId });
          const reads = !def.writes && path ? [path.startsWith('/') ? path : '/' + path] : [];
          graph.endStep(root, id, { ok: true, ms: Date.now() - t0, inputs: reads, outputs: out.changed || [] });
          metric(`mcp:${def.name}`, Date.now() - t0);
          log('info', 'mcp', `${def.name}${path ? ' ' + path : ''}: ok`, Date.now() - t0);
          return {
            content: [{ type: 'text' as const, text: out.text }],
            structuredContent: { ...(out.data || {}), changed: out.changed || [] },
          };
        } catch (e) {
          const err = e as Error & { code?: string };
          broadcast({ t: 'tool', phase: 'end', name: def.name, path, ok: false, message: err.message, callId });
          if (root) graph.endStep(root, id, { ok: false, ms: Date.now() - t0, inputs: [], outputs: [] });
          log('warn', 'mcp', `${def.name}: ${err.message}`, Date.now() - t0);
          return { isError: true, content: [{ type: 'text' as const, text: err instanceof ToolError || err.code ? err.message : `Error: ${err.message}` }] };
        }
      }
    );
  }
  for (const ext of externals.values()) {
    if (ext.status !== 'connected' || !ext.client) continue;
    for (const t of ext.tools) {
      const client = ext.client;
      const name = extName(ext.entry.name, t.name);
      server.registerTool(
        name,
        { title: `${ext.entry.name}: ${t.name}`, description: `[${ext.entry.name}] ${t.description || t.name}`, inputSchema: fromJsonSchema(t.inputSchema as never), annotations: { readOnlyHint: t.readOnly }, _meta: { app: 'project', external: ext.entry.name, approval: externalNeedsApproval(name), accent: ext.entry.accent, sandbox: ext.sandbox } },
        async (args: unknown, ctx) => {
          const meta = (ctx.mcpReq._meta || {}) as Record<string, unknown>;
          if (externalNeedsApproval(name) && !consumeApproval(meta['workcraft/approval'], name, args)) {
            return { isError: true, content: [{ type: 'text' as const, text: `${ext.entry.name}: ${t.name} needs a confirmation in WorkCraft (approval rule of the server).` }] } as never;
          }
          const t0 = Date.now();
          try {
            const call = (c: Client) => c.callTool({ name: t.name, arguments: args as Record<string, unknown> }, { timeout: CALL_TIMEOUT }) as Promise<{ content?: { type: string; text?: string }[] }>;
            let r: { content?: { type: string; text?: string }[] };
            try {
              r = await call(client);
            } catch (e) {
              // The desktop app was closed, or the CLI exited: connect once more and repeat the call (once, never in a loop)
              if (!isConnectionLost(e)) throw e;
              log('warn', 'mcp', `${name}: connection lost, reconnecting`);
              const fresh = await reconnect(ext.entry.id);
              if (!fresh?.client) throw new Error(`${ext.entry.name} is not running any more and could not be started again (${(e as Error).message}). Open the app and try again.`);
              r = await call(fresh.client);
            }
            // Size limit for results of external tools
            for (const c of r.content || []) if (c.type === 'text' && c.text && c.text.length > MAX_RESULT) c.text = c.text.slice(0, MAX_RESULT) + '\n[shortened by the WorkCraft sandbox]';
            metric(`mcp:${ext.entry.plugin || 'external'}`, Date.now() - t0);
            log('info', 'mcp', `${name}: ok`, Date.now() - t0);
            if (ext.entry.transport === 'http' && ext.entry.url && !isLocalUrl(ext.entry.url)) auditRecord({ kind: 'mcp', url: ext.entry.url, bytes: JSON.stringify(args ?? {}).length, files: [], status: 'ok', note: `${ext.entry.name}: ${t.name}` });
            return r as never;
          } catch (e) {
            log('warn', 'mcp', `${name}: ${(e as Error).message}`, Date.now() - t0);
            return { isError: true, content: [{ type: 'text' as const, text: `${ext.entry.name}: ${(e as Error).message}` }] } as never;
          }
        }
      );
    }
  }
  return server;
}

export const mcpHandler = createMcpHandler(() => buildServer(), { onerror: (e) => console.warn('MCP:', e.message) });
