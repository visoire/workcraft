// MCP server in the browser: offers the panels of the workspace as tools
// (open-panel, panel-status). The orchestrator connects through InMemoryTransport.

import { McpServer } from '@modelcontextprotocol/server';
import { TOOL_DEFS } from './schemas.js';
import { workspace } from '../workspace/layout.js';
import { TOOLS, AVAILABLE, type ToolId } from '../workspace/registry.js';
import { APPS, appsFor, lookupApp, type Origin } from '../ecosystems/catalog.js';
import { listApps, noBuildMessage } from '../ecosystems/describe.js';
import { activeEcosystem, allEcosystems, customEcosystems } from '../ecosystems/ecosystems.js';
import { loadRecent, recentFor } from '../storage/recent.js';
import { fs } from '../project/fs.js';
import { t as tr } from '../app/i18n.js';
import { api } from '../app/backend.js';
import { VERSION } from '../core/version.js';

type Handler = (args: Record<string, unknown>) => Promise<{ text: string; data?: Record<string, unknown> }>;

const HANDLERS: Record<string, Handler> = {
  async 'open-panel'(args) {
    const app = args.app as ToolId;
    const path = typeof args.path === 'string' && args.path ? (args.path.startsWith('/') ? args.path : '/' + args.path) : undefined;
    const { id, instance } = await workspace.instanceForTool(app, path);
    await instance.ready?.catch(() => {});
    const p = workspace.panel(id);
    return { text: p?.path ? tr('{name} is open with {path}.', { name: TOOLS[app].name, path: p.path }) : tr('{name} is open.', { name: TOOLS[app].name }), data: { panel: id, path: p?.path || null } };
  },
  async 'list-craft-apps'(args) {
    const str = (k: string) => (typeof args[k] === 'string' && args[k] ? String(args[k]) : undefined);
    const { rows, unknown } = listApps(
      { type: str('type'), ecosystem: str('ecosystem'), origin: str('origin') as Origin | undefined, available: typeof args.available === 'boolean' ? args.available : undefined, app: str('app') },
      AVAILABLE,
      customEcosystems()
    );
    if (unknown) throw new Error(tr('Unknown app or ecosystem "{app}". Call list-craft-apps without filters for the ids.', { app: unknown }));
    const active = activeEcosystem();
    // What the AI needs to know before it plans: which apps have tools right now (desktop app found and its MCP server
    // connected), which could have and why they do not. Web-only apps are reached through project files.
    const desktop = await api.get<{ apps: { id: string; installed: boolean; enabled: boolean; connected: boolean; tools?: number; error?: string }[] }>('/api/craft').then((r) => r.apps, () => null);
    const withTools = rows.map((r) => {
      const d = desktop?.find((x) => x.id === r.id);
      const access = d?.connected ? `tools (${d.tools ?? 0} via the desktop app)` : d?.installed ? (d.enabled ? `desktop app found, not connected${d.error ? ': ' + d.error.slice(0, 120) : ''}` : 'desktop app found, its server is switched off in Settings, Craft apps') : 'project files only (open it with open-in-app)';
      return { ...r, ai_access: access };
    });
    return { text: JSON.stringify({ active_ecosystem: { id: active.id, name: active.name, apps: active.apps }, ecosystems: allEcosystems().map((e) => e.id), count: rows.length, apps: withTools }, null, 2), data: { count: rows.length } };
  },
  async 'open-in-app'(args) {
    const app = lookupApp(String(args.app || ''));
    if (!app) throw new Error(tr('Unknown app "{app}". Call list-craft-apps for the ids.', { app: String(args.app || '') }));
    const t = TOOLS[app.id];
    if (!t.available) throw new Error(noBuildMessage(app, APPS.filter((a) => AVAILABLE.has(a.id)).map((a) => a.id)));
    const path = typeof args.path === 'string' && args.path ? (args.path.startsWith('/') ? args.path : '/' + args.path) : undefined;
    if (path) {
      if (!fs.exists(path)) throw new Error(tr('File not found: {path}', { path }));
      if (!appsFor(path).some((a) => a.id === app.id)) {
        const fits = appsFor(path, { available: (id) => !!TOOLS[id].available }).map((a) => a.id);
        throw new Error(tr('{name} does not read this file type. Apps that do: {list}.', { name: app.name, list: fits.join(', ') || tr('none with a web build here') }));
      }
    }
    const { id, instance } = await workspace.instanceForTool(app.id, path);
    await instance.ready?.catch(() => {});
    return { text: path ? tr('{name} is open with {path}.', { name: app.name, path }) : tr('{name} is open.', { name: app.name }), data: { panel: id, path: path || null } };
  },
  async 'recent-files'(args) {
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));
    const rows = recentFor(loadRecent(), fs.project, (p) => fs.exists(p), limit).map((e) => ({ path: e.path, app: e.tool, opened: new Date(e.at).toISOString() }));
    return { text: rows.length ? JSON.stringify(rows, null, 2) : tr('No recent files in this project yet.'), data: { count: rows.length } };
  },
  async 'panel-status'(args) {
    const app = args.app as ToolId;
    const list = workspace.panels().filter((p) => p.tool === app);
    if (!list.length) return { text: tr('{name} is not open.', { name: TOOLS[app].name }), data: { open: false } };
    const out = list.map((p) => ({ panel: p.id, file: p.path, mode: p.mode, state: p.paused ? 'paused' : p.status, visible: p.visible, ...(workspace.instance(p.id)?.status?.() || {}) }));
    return { text: JSON.stringify(out, null, 2), data: { open: true, panels: out } };
  },
};

export function createPanelServer(): McpServer {
  const server = new McpServer({ name: 'workcraft-panels', version: VERSION }, { capabilities: { tools: {} } });
  for (const def of TOOL_DEFS.filter((d) => d.side === 'client')) {
    const run = HANDLERS[def.name];
    if (!run) continue;
    server.registerTool(def.name, { title: def.title, description: def.description, inputSchema: def.input, _meta: { app: def.app } }, async (args: Record<string, unknown>) => {
      try {
        const r = await run(args);
        return { content: [{ type: 'text' as const, text: r.text }], structuredContent: { ...(r.data || {}), changed: [] } };
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] };
      }
    });
  }
  return server;
}
