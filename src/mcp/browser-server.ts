// MCP server in the browser for browser mode (no desktop backend reachable).
// Offers the file tools list-files, search-files, read-file and write-file on the
// IndexedDB projects. Office tools and the terminal need the desktop.

import { McpServer } from '@modelcontextprotocol/server';
import { TOOL_DEFS } from './schemas.js';
import { fs } from '../project/fs.js';
import { normPath, isText } from '../app/util.js';
import { t as tr } from '../app/i18n.js';
import { VERSION } from '../app/status.js';

type Handler = (args: Record<string, unknown>) => Promise<{ text: string; data?: Record<string, unknown> }>;

const inDir = (dir: unknown) => {
  const d = normPath(String(dir || '/'));
  return (p: string) => d === '/' || p === d || p.startsWith(d + '/');
};

const HANDLERS: Record<string, Handler> = {
  async 'list-files'(a) {
    await fs.reload();
    const list = fs.list().filter((e) => inDir(a.dir)(e.path));
    return { text: list.map((e) => `${e.kind === 'dir' ? tr('Folder') : tr('File')} ${e.path}${e.kind === 'file' ? ` (${e.size} bytes)` : ''}`).join('\n') || tr('No entries.'), data: { entries: list } };
  },
  async 'search-files'(a) {
    const q = String(a.query).toLowerCase();
    const hits: string[] = [];
    for (const f of fs.files().filter((e) => inDir(a.dir)(e.path) && isText(e.path))) {
      const text = await fs.readText(f.path);
      text.split('\n').forEach((line, i) => {
        if (line.toLowerCase().includes(q) && hits.length < 200) hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 200)}`);
      });
    }
    return { text: hits.join('\n') || 'No matches.', data: { hits: hits.length } };
  },
  async 'read-file'(a) {
    const p = normPath(String(a.path));
    if (!isText(p)) {
      const c = await fs.context(p);
      return { text: c.text };
    }
    return { text: await fs.readText(p) };
  },
  async 'write-file'(a) {
    const p = await fs.write(normPath(String(a.path)), String(a.content), 'mcp');
    return { text: `${p} written.`, data: { changed: [p] } };
  },
};

export function createBrowserServer(): McpServer {
  const server = new McpServer({ name: 'workcraft-browser', version: VERSION }, { capabilities: { tools: {} } });
  for (const def of TOOL_DEFS.filter((d) => HANDLERS[d.name])) {
    const run = HANDLERS[def.name]!;
    server.registerTool(def.name, { title: def.title, description: `${def.description} (browser mode)`, inputSchema: def.input, _meta: { app: def.app } }, async (args: Record<string, unknown>) => {
      try {
        const r = await run(args);
        return { content: [{ type: 'text' as const, text: r.text }], structuredContent: { changed: [], ...(r.data || {}) } };
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] };
      }
    });
  }
  return server;
}
