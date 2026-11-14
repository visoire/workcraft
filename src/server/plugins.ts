// Plugin and tool API: further tools (PhotoCraft, ArtCraft, Blender headless, ComfyUI …) join as
// MCP servers without changes to the core. A plugin is a folder in ~/workcraft/plugins/<name>/
// with an workcraft.plugin.json:
//
//   {
//     "name": "comfyui",                  lowercase, digits and dashes
//     "title": "ComfyUI",
//     "version": "0.1.0",
//     "description": "Image generation with a local ComfyUI",
//     "mcp": { "transport": "stdio", "command": "node", "args": ["${pluginDir}/server.js"], "env": {} }
//        or  { "transport": "http", "url": "http://127.0.0.1:8188/mcp" },
//     "sandbox": "strict" | "standard" | "off",
//     "approval": "ask" | "read" | "all",
//     "accent": "#A855F7"
//   }
//
// ${pluginDir} and ${home} in command and args are replaced. The catalog below holds templates
// that write such a folder (disabled until the user switches them on).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { HOME } from './paths.js';
import type { McpServerEntry } from './config.js';

export const PLUGINS_DIR = join(HOME, 'plugins');
mkdirSync(PLUGINS_DIR, { recursive: true });

export const PluginManifest = z.object({
  name: z.string().regex(/^[a-z0-9-]{2,40}$/),
  title: z.string().min(1).max(60),
  version: z.string().max(30).default('0.0.0'),
  description: z.string().max(400).default(''),
  mcp: z.discriminatedUnion('transport', [
    z.object({ transport: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).default({}) }),
    z.object({ transport: z.literal('http'), url: z.string().url() }),
  ]),
  sandbox: z.enum(['strict', 'standard', 'off']).default('strict'),
  approval: z.enum(['ask', 'read', 'all']).default('ask'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  homepage: z.string().url().optional(),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

export interface PluginInfo {
  name: string;
  dir: string;
  manifest: PluginManifest | null;
  error?: string;
}

export function scanPlugins(): PluginInfo[] {
  const out: PluginInfo[] = [];
  for (const d of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(PLUGINS_DIR, d.name);
    // 'opencraft.plugin.json' is the manifest name of plugins made before the rename
    const f = [join(dir, 'workcraft.plugin.json'), join(dir, 'opencraft.plugin.json')].find(existsSync);
    if (!f) continue;
    try {
      out.push({ name: d.name, dir, manifest: PluginManifest.parse(JSON.parse(readFileSync(f, 'utf8'))) });
    } catch (e) {
      out.push({ name: d.name, dir, manifest: null, error: (e as Error).message.slice(0, 300) });
    }
  }
  return out;
}

const fill = (s: string, dir: string) => s.replace(/\$\{pluginDir\}/g, dir).replace(/\$\{home\}/g, HOME);

/** MCP server entries of the plugins (merged with the servers added by hand). */
export function pluginServers(disabled: string[]): (McpServerEntry & { env?: Record<string, string>; cwd?: string; accent?: string })[] {
  return scanPlugins()
    .filter((p) => p.manifest)
    .map((p) => {
      const m = p.manifest!;
      const base = { id: `plugin-${m.name}`, name: m.title.slice(0, 40), enabled: !disabled.includes(m.name), sandbox: m.sandbox, approval: m.approval, plugin: m.name, cwd: p.dir, accent: m.accent };
      return m.mcp.transport === 'http'
        ? { ...base, transport: 'http' as const, url: m.mcp.url, command: 'http', args: [] }
        : { ...base, transport: 'stdio' as const, command: fill(m.mcp.command, p.dir), args: m.mcp.args.map((a) => fill(a, p.dir)), env: m.mcp.env };
    });
}

/** Templates for the catalog in Settings, MCP servers and plugins. */
export const CATALOG: (PluginManifest & { note: string })[] = [
  {
    name: 'comfyui',
    title: 'ComfyUI',
    version: '0.1.0',
    description: 'Image generation and editing with a local ComfyUI through its MCP bridge.',
    mcp: { transport: 'http', url: 'http://127.0.0.1:8188/mcp' },
    sandbox: 'strict',
    approval: 'ask',
    accent: '#A855F7',
    note: 'Needs ComfyUI with an MCP bridge on port 8188.',
  },
  {
    name: 'blender',
    title: 'Blender headless',
    version: '0.1.0',
    description: '3D scenes, renders and exports through Blender in the background (blender-mcp).',
    mcp: { transport: 'stdio', command: 'uvx', args: ['blender-mcp'], env: {} },
    sandbox: 'standard',
    approval: 'ask',
    accent: '#F59E0B',
    note: 'Needs Blender and uv (uvx blender-mcp).',
  },
  {
    name: 'photocraft',
    title: 'PhotoCraft',
    version: '0.1.0',
    description: 'Photo editing engine of the Craft family as an MCP server (planned).',
    mcp: { transport: 'stdio', command: 'photocraft-cli', args: ['mcp'], env: {} },
    sandbox: 'strict',
    approval: 'read',
    accent: '#EC4899',
    note: 'Placeholder for the PhotoCraft desktop build with its mcp command.',
  },
  {
    name: 'artcraft',
    title: 'ArtCraft',
    version: '0.1.0',
    description: 'Vector and illustration engine of the Craft family as an MCP server (planned).',
    mcp: { transport: 'stdio', command: 'artcraft-cli', args: ['mcp'], env: {} },
    sandbox: 'strict',
    approval: 'read',
    accent: '#8B5CF6',
    note: 'Placeholder for the ArtCraft desktop build with its mcp command.',
  },
  {
    name: 'everything',
    title: 'MCP test server',
    version: '0.1.0',
    description: 'Reference server of the Model Context Protocol with example tools, for trying the plugin API.',
    mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], env: {} },
    sandbox: 'standard',
    approval: 'ask',
    accent: '#64748B',
    note: 'Downloads the package with npx on the first start.',
  },
];

export function installTemplate(name: string): PluginInfo {
  const t = CATALOG.find((x) => x.name === name);
  if (!t) throw Object.assign(new Error(`Unknown template ${name}`), { code: 'NOT_FOUND' });
  const dir = join(PLUGINS_DIR, t.name);
  mkdirSync(dir, { recursive: true });
  const { note, ...manifest } = t;
  writeFileSync(join(dir, 'workcraft.plugin.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'README.md'), `# ${t.title}\n\n${t.description}\n\n${note}\n\nEdit workcraft.plugin.json to change the command, the sandbox or the approval rule.\n`);
  return { name: t.name, dir, manifest: PluginManifest.parse(manifest) };
}
