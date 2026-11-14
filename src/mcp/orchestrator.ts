// Central MCP client in the frontend.
//
// - Backend tools (files, sheets, documents, slides, PDF, terminal, external servers)
//   over Streamable HTTP at /mcp.
// - Panel tools (open-panel, panel-status) through an MCP server in the browser (InMemoryTransport).
//
// Every call: Zod check of the arguments, approval for risky tools, progress through
// MCP progress, then the affected files show in the matching app (live sync).

import { Client, StreamableHTTPClientTransport, InMemoryTransport } from '@modelcontextprotocol/client';
import { TOOL_BY_NAME, validateArgs, jsonSchemaOf, APP_ACCENT, type ToolDef } from './schemas.js';
import type { ToolApp, ToolSpec } from '../chat/types.js';
import { api, backend as backendMode } from '../app/backend.js';
import { bus } from '../app/bus.js';
import { prefs } from '../app/settings.js';
import { uid } from '../app/util.js';
import { workspace } from '../workspace/layout.js';
import { isApp, toolForPath } from '../workspace/registry.js';
import { createPanelServer } from './panel-server.js';
import { FileLocks, lockKeysFor } from './locks.js';
import { t as tr, lang } from '../app/i18n.js';
import { z } from 'zod';
import { VERSION } from '../core/version.js';

// Validation messages in the language of the interface (the backend keeps English)
if (lang === 'de') z.config(z.locales.de());

export interface ToolMeta {
  name: string;
  title: string;
  description: string;
  app: ToolApp;
  source: 'server' | 'client' | 'external';
  approval: boolean;
  writes: boolean;
  pathArg?: string;
  inputSchema: Record<string, unknown>;
  def?: ToolDef;
}

export type FailStage = 'validation' | 'approval' | 'execution' | 'transport';

export interface CallOutcome {
  ok: boolean;
  text: string;
  data?: Record<string, unknown>;
  changed: string[];
  issues?: string[];
  stage?: FailStage;
  ms: number;
  args: Record<string, unknown>;
}

export interface CallOptions {
  callId?: string;
  signal?: AbortSignal;
  onProgress?: (message: string, progress?: number, total?: number) => void;
  /** Asks the user for tools that need approval. Without asking, the call is refused. */
  approve?: (tool: ToolMeta, args: Record<string, unknown>) => Promise<boolean>;
  /** Show affected files in the matching app (default: the autoOpenPanels setting) */
  reveal?: boolean;
  /** ID of the AI answer: the backend links all steps of one answer (snapshot, project graph) */
  chain?: string;
  /** Team Mode sub-agent that makes the call: its accent flashes on the panels of the files it writes */
  agent?: { role: string; label: string; accent: string };
}

/** Per-file write locks: parallel sub-agents never write the same file at the same time. */
export const fileLocks = new FileLocks();

let backend: Client | null = null;
let panels: Client | null = null;
let tools: ToolMeta[] = [];
let connecting: Promise<void> | null = null;

const APPS_FOR_PATH_TOOLS = new Set(['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft']);

function metaFor(name: string, description: string, inputSchema: Record<string, unknown>, source: ToolMeta['source'], extra: Record<string, unknown> | undefined): ToolMeta {
  const def = TOOL_BY_NAME.get(name);
  if (def) return { name, title: def.title, description: def.description, app: def.app, source, approval: !!def.approval, writes: !!def.writes, pathArg: def.pathArg, inputSchema: jsonSchemaOf(def.input), def };
  const m = (extra?.meta || {}) as Record<string, unknown>;
  return { name, title: String(extra?.title || name), description, app: 'project', source: 'external', approval: !!m.approval, writes: true, inputSchema };
}

async function connectBackend(): Promise<void> {
  const c = new Client({ name: 'workcraft', version: VERSION });
  if (backendMode.browser) {
    // Browser mode: file tools through the IndexedDB, without the desktop
    const { createBrowserServer } = await import('./browser-server.js');
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createBrowserServer().connect(b);
    await c.connect(a);
  } else await c.connect(new StreamableHTTPClientTransport(new URL('/mcp', location.origin)));
  backend = c;
}

async function connectPanels(): Promise<void> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createPanelServer();
  await server.connect(b);
  const c = new Client({ name: 'workcraft-panels-client', version: VERSION });
  await c.connect(a);
  panels = c;
}

export const orchestrator = {
  get ready() {
    return !!backend && !!panels;
  },

  async connect(): Promise<void> {
    if (connecting) return connecting;
    connecting = (async () => {
      if (!panels) await connectPanels();
      if (!backend) await connectBackend();
      await this.refresh();
    })().finally(() => (connecting = null));
    return connecting;
  },

  /** Reloads the tool list (for example after the external MCP servers changed). */
  async refresh(): Promise<ToolMeta[]> {
    const out: ToolMeta[] = [];
    if (backend) {
      const r = await backend.listTools(undefined, { cacheMode: 'refresh' });
      for (const t of r.tools) out.push(metaFor(t.name, t.description || '', t.inputSchema as Record<string, unknown>, TOOL_BY_NAME.has(t.name) ? 'server' : 'external', { title: t.title, meta: (t as { _meta?: unknown })._meta }));
    }
    if (panels) {
      const r = await panels.listTools(undefined, { cacheMode: 'refresh' });
      for (const t of r.tools) out.push(metaFor(t.name, t.description || '', t.inputSchema as Record<string, unknown>, 'client', { title: t.title }));
    }
    tools = out;
    return tools;
  },

  tools: () => tools,
  tool: (name: string) => tools.find((t) => t.name === name) || null,
  accent: (t: ToolMeta | null) => APP_ACCENT[t?.app || 'workspace'],

  /**
   * Tool definitions for the language model, sorted by name: the same tool set always gives the same
   * prompt prefix, so DeepSeek (and other providers with prefix caching) can reuse the cache.
   */
  specs(names?: string[]): ToolSpec[] {
    return tools
      .filter((t) => !names || names.includes(t.name))
      .map((t) => ({ name: t.name, description: `[${t.title}] ${t.description}`, parameters: t.inputSchema }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  },

  /**
   * Structured feedback for one self-correction turn of the model (DeepSeek Harness pattern: invalid
   * arguments become an error result with path-qualified violations, nothing runs). Model-facing, so
   * always English.
   */
  correction(name: string, sent: Record<string, unknown> | string, issues: string[]): string {
    const t = this.tool(name);
    const schema = t ? JSON.stringify(t.inputSchema) : '';
    return [
      t ? `Invalid arguments for ${name}. Nothing was executed. Fix these fields and call ${name} again with valid JSON arguments:` : `There is no tool named ${name}. Available tools: ${tools.map((x) => x.name).join(', ')}.`,
      ...issues.map((i) => `- ${i}`),
      `Arguments you sent: ${typeof sent === 'string' ? sent.slice(0, 2000) : JSON.stringify(sent).slice(0, 2000)}`,
      schema ? `Expected parameters (JSON Schema): ${schema.slice(0, 4000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  },

  /** Checks arguments before the call. External tools are checked by the backend server itself. */
  validate(name: string, args: Record<string, unknown>): { ok: true; data: Record<string, unknown> } | { ok: false; issues: string[] } {
    const t = this.tool(name);
    if (!t) return { ok: false, issues: [tr('Tool {name} is not available. Available tools: {list}', { name, list: tools.map((x) => x.name).join(', ') })] };
    if (t.def) return validateArgs(name, args);
    return { ok: true, data: args };
  },

  async call(name: string, rawArgs: Record<string, unknown>, opt: CallOptions = {}): Promise<CallOutcome> {
    const t0 = performance.now();
    const done = (o: Omit<CallOutcome, 'ms'>): CallOutcome => ({ ...o, ms: Math.round(performance.now() - t0) });
    if (!this.ready) {
      try {
        await this.connect();
      } catch (e) {
        return done({ ok: false, stage: 'transport', text: tr('MCP connection to the backend failed: {message}', { message: (e as Error).message }), changed: [], args: rawArgs });
      }
    }
    const tool = this.tool(name);
    const v = this.validate(name, rawArgs);
    if (!tool || !v.ok) {
      const issues = v.ok ? [tr('Unknown tool {name}', { name })] : v.issues;
      return done({ ok: false, stage: 'validation', text: `${tr('Invalid arguments for {name}:', { name })}\n${issues.map((i) => '- ' + i).join('\n')}`, issues, changed: [], args: rawArgs });
    }
    const args = v.data;
    const callId = opt.callId || uid('call');
    const meta: Record<string, unknown> = { 'workcraft/callId': callId, ...(opt.chain ? { 'workcraft/chain': opt.chain } : {}) };

    if (tool.approval) {
      const ok = opt.approve ? await opt.approve(tool, args) : false;
      if (!ok) return done({ ok: false, stage: 'approval', text: tr('{title} was not approved.', { title: tool.title }), changed: [], args });
      try {
        const r = await api.send<{ token: string }>('POST', '/api/approvals', { tool: name, args });
        meta['workcraft/approval'] = r.token;
      } catch (e) {
        return done({ ok: false, stage: 'approval', text: tr('Approval failed: {message}', { message: (e as Error).message }), changed: [], args });
      }
    }

    // Reads run freely; writes hold the lock of their target file (other files go on in parallel)
    const keys = lockKeysFor(tool, args);
    if (!keys.length) return this.invoke(tool, args, meta, opt, done);
    try {
      return await fileLocks.run(keys, () => this.invoke(tool, args, meta, opt, done), {
        signal: opt.signal,
        onWait: (busy) => opt.onProgress?.(tr('Waiting for another agent to finish writing {path}', { path: busy.join(', ') })),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return done({ ok: false, stage: 'transport', text: tr('Stopped.'), changed: [], args });
      throw e;
    }
  },

  /** The MCP call itself (after validation, approval and the write lock). */
  async invoke(tool: ToolMeta, args: Record<string, unknown>, meta: Record<string, unknown>, opt: CallOptions, done: (o: Omit<CallOutcome, 'ms'>) => CallOutcome): Promise<CallOutcome> {
    const name = tool.name;
    const targets = tool.writes ? writeTargets(tool, args) : [];
    // The file may be open with unsaved changes: put them into the project first, reads and writes alike
    if (tool.pathArg && typeof args[tool.pathArg] === 'string' && APPS_FOR_PATH_TOOLS.has(tool.app)) {
      const p = String(args[tool.pathArg]);
      await workspace.flushUnsaved(p.startsWith('/') ? p : '/' + p).catch(() => []);
    }
    if (opt.agent) for (const path of targets) bus.emit('agent:file', { path, role: opt.agent.role, label: opt.agent.label, accent: opt.agent.accent, state: 'writing' });
    // Make panel tools visible first: the app loads on demand (lazy loading).
    const client = tool.source === 'client' ? panels! : backend!;
    try {
      const res = await client.callTool(
        { name, arguments: args, _meta: meta },
        {
          signal: opt.signal,
          timeout: 180_000,
          resetTimeoutOnProgress: true,
          onprogress: (p) => opt.onProgress?.(String(p.message || ''), p.progress, p.total),
        }
      );
      const text = (res.content || [])
        .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
        .join('\n')
        .trim();
      const data = (res.structuredContent || undefined) as Record<string, unknown> | undefined;
      const changed = Array.isArray(data?.changed) ? (data!.changed as string[]) : [];
      if (opt.agent) for (const path of new Set([...targets, ...changed])) bus.emit('agent:file', { path, role: opt.agent.role, label: opt.agent.label, accent: opt.agent.accent, state: res.isError ? 'error' : 'written' });
      if (res.isError) return done({ ok: false, stage: 'execution', text: text || tr('The tool reported an error without text.'), data, changed, args });
      if (opt.reveal ?? prefs.get('autoOpenPanels')) void this.reveal(tool, args, changed);
      const out = done({ ok: true, text, data, changed, args });
      bus.emit('metric', { name: `mcp:${tool.source === 'external' ? 'external' : name}`, value: out.ms });
      return out;
    } catch (e) {
      const err = e as Error;
      if (opt.agent) for (const path of targets) bus.emit('agent:file', { path, role: opt.agent.role, label: opt.agent.label, accent: opt.agent.accent, state: 'error' });
      if (err.name === 'AbortError' || opt.signal?.aborted) return done({ ok: false, stage: 'transport', text: tr('Stopped.'), changed: [], args });
      // Reconnect in case the backend restarted
      if (tool.source !== 'client') backend = null;
      return done({ ok: false, stage: 'transport', text: tr('MCP call failed: {message}', { message: err.message }), changed: [], args });
    }
  },

  /** Shows edited or read files in the matching app. Loads the app only now. */
  async reveal(tool: ToolMeta, args: Record<string, unknown>, changed: string[]): Promise<void> {
    const paths = new Set<string>(changed);
    const p = tool.pathArg ? args[tool.pathArg] : undefined;
    if (typeof p === 'string' && APPS_FOR_PATH_TOOLS.has(tool.app)) paths.add(p.startsWith('/') ? p : '/' + p);
    if (typeof args.output === 'string' && args.output) paths.add(String(args.output));
    for (const path of paths) {
      const target = toolForPath(path);
      if (!isApp(target) && target !== 'code') continue;
      const already = workspace.panelsWithPath(path).length > 0;
      if (already) continue;
      try {
        await workspace.openFile(path, target);
      } catch (e) {
        console.warn(e);
      }
    }
    bus.emit('workspace:change');
  },
};

/** Project paths a write call targets (path argument and output). */
function writeTargets(tool: ToolMeta, args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const p = tool.pathArg ? args[tool.pathArg] : undefined;
  if (typeof p === 'string' && p) out.push(p.startsWith('/') ? p : '/' + p);
  if (typeof args.output === 'string' && args.output) out.push(args.output.startsWith('/') ? args.output : '/' + args.output);
  return out;
}

export type { ToolApp };
