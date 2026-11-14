// The 19 Craft apps that ship a CLI, on this computer, as MCP servers, so WorkCraft can open, edit and save their documents
// without setup. Ported from workcraft-ai (crates/agents/src/craft.rs). The independent apps (src/ecosystems/catalog.json,
// origin independent) are web apps only: they have no CLI and no MCP server, the AI reaches their files through the project.
//
// Each Craft app ships `<app>-cli`, whose `mcp` subcommand is an MCP server over stdio (headless: it works on
// files). When the desktop app runs with `--control <port>`, its live flag (`--connect`, `--bridge`, `--attach`)
// drives the open desktop window directly. The servers join the external MCP servers of mcp.ts under the
// app id, so their tools are called `ext-<app>-<tool>` and show the app icon (public/assets/craft/<app>.png).

import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface CraftApp {
  id: string;
  name: string;
  /** Group in the interface */
  kind: string;
  /** Extra arguments of `mcp` in headless mode */
  extra: string[];
  /** The desktop app can be driven live through its control port */
  live: boolean;
  /** Default `--control <port>` */
  port?: number;
}

export const CRAFT_APPS: CraftApp[] = [
  { id: 'wordcraft', name: 'WordCraft', kind: 'Documents', extra: [], live: true, port: 7981 },
  { id: 'gridcraft', name: 'GridCraft', kind: 'Spreadsheets', extra: [], live: true, port: 7982 },
  { id: 'deckcraft', name: 'DeckCraft', kind: 'Presentations', extra: [], live: true, port: 7983 },
  { id: 'pdfcraft', name: 'PdfCraft', kind: 'PDF', extra: ['--compact'], live: false },
  { id: 'photocraft', name: 'PhotoCraft', kind: 'Photos', extra: [], live: false },
  { id: 'vectorcraft', name: 'VectorCraft', kind: 'Vector art', extra: ['--headless'], live: true, port: 7985 },
  { id: 'lightcraft', name: 'LightCraft', kind: 'RAW photos', extra: ['--compact'], live: true, port: 7980 },
  { id: 'designcraft', name: 'DesignCraft', kind: 'Layout', extra: [], live: true, port: 7986 },
  { id: 'filmcraft', name: 'FilmCraft', kind: 'Video', extra: [], live: true, port: 9876 },
  { id: 'effectcraft', name: 'EffectCraft', kind: 'Motion', extra: [], live: true, port: 9877 },
  { id: 'soundcraft', name: 'SoundCraft', kind: 'Audio', extra: ['--demo'], live: true, port: 7987 },
  { id: 'cadcraft', name: 'CADCraft', kind: 'CAD', extra: [], live: true, port: 7988 },
  { id: 'figcraft', name: 'FigCraft', kind: 'Figures', extra: [], live: true, port: 7989 },
  // Added with the 2026-11-12 versions. Flags checked against the apps/<app>-cli sources of versions/<app>-<version>/:
  // mailcraft-cli mcp [--connect HOST:PORT | --file F | --sample], solidcraft-cli mcp [--headless] [--connect HOST:PORT],
  // texturecraft-cli and materialcraft-cli mcp [--bridge <port>] [--read-root] [--write-root], anicraft-cli mcp [file|--sample],
  // craft-anything-cli mcp [--restricted] (restricted turns off the tools that act on the machine; the app itself is the full mode).
  { id: 'mailcraft', name: 'MailCraft', kind: 'Mail', extra: [], live: true, port: 7991 },
  { id: 'texturecraft', name: 'TextureCraft', kind: '3D textures', extra: [], live: true, port: 7992 },
  { id: 'materialcraft', name: 'MaterialCraft', kind: 'Materials', extra: [], live: true, port: 7993 },
  { id: 'solidcraft', name: 'SolidCraft', kind: '3D CAD', extra: ['--headless'], live: true, port: 7994 },
  { id: 'anicraft', name: 'AniCraft', kind: 'Animation', extra: [], live: false },
  { id: 'craft-anything', name: 'Craft Anything', kind: 'Reverse engineering', extra: ['--restricted'], live: false },
];

/** On unless the user switched them off: the document suite. */
export const ON_BY_DEFAULT = ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft'];

export interface FoundApp extends CraftApp {
  cli: string;
  gui: string | null;
  /** Port of a running app that accepts a live bridge */
  livePort: number | null;
}

const exe = (n: string) => (process.platform === 'win32' ? `${n}.exe` : n);

/** Where a binary of an app may be: the installer location, then PATH. */
function candidates(bin: string, appName: string): string[] {
  const out: string[] = [];
  if (process.platform === 'win32') {
    for (const v of ['ProgramFiles', 'ProgramW6432', 'LOCALAPPDATA']) {
      const base = process.env[v];
      if (base) out.push(join(base, appName, exe(bin)), join(base, 'Programs', appName, exe(bin)));
    }
  } else if (process.platform === 'darwin') out.push(join('/Applications', `${appName}.app`, 'Contents', 'MacOS', exe(bin)));
  for (const d of (process.env.PATH || '').split(delimiter)) if (d) out.push(join(d, exe(bin)));
  return out;
}

export const findCli = (a: CraftApp) => candidates(`${a.id}-cli`, a.name).find((p) => existsSync(p)) || null;
export function findGui(a: CraftApp, cli: string | null): string | null {
  if (cli) {
    const sibling = join(cli, '..', exe(a.id));
    if (existsSync(sibling)) return sibling;
  }
  return candidates(a.id, a.name).find((p) => existsSync(p)) || null;
}

export function isPortListening(port: number, timeout = 60): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port, timeout });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('timeout', () => (s.destroy(), resolve(false)));
    s.once('error', () => resolve(false));
  });
}

/** Port from a `control-key.local-<port>` file in the app's settings folder (written by a running app). */
async function keyFilePort(name: string): Promise<number | null> {
  const dirs =
    process.platform === 'win32'
      ? ['APPDATA', 'LOCALAPPDATA'].flatMap((v) => (process.env[v] ? [join(process.env[v]!, name)] : []))
      : process.platform === 'darwin'
        ? [join(homedir(), 'Library', 'Application Support', name)]
        : [join(homedir(), '.config', name.toLowerCase())];
  for (const d of dirs) {
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      const m = /^control-key\.local-(\d+)$/.exec(n);
      if (m && (await isPortListening(Number(m[1])))) return Number(m[1]);
    }
  }
  return null;
}

/** The active control port of a running Craft desktop app. */
export async function livePortFor(a: CraftApp): Promise<number | null> {
  const k = await keyFilePort(a.name);
  if (k) return k;
  if (a.id === 'wordcraft') return null; // its CLI needs the control-key file to authenticate
  return a.port && (await isPortListening(a.port)) ? a.port : null;
}

/** `mcp` arguments that connect `<id>-cli` to a running desktop window on `port`. */
export function liveMcpArgs(id: string, port: number): string[] {
  if (['gridcraft', 'deckcraft', 'designcraft', 'soundcraft'].includes(id)) return ['mcp', '--connect', String(port)];
  if (id === 'lightcraft') return ['mcp', '--connect', `127.0.0.1:${port}`, '--compact'];
  if (id === 'filmcraft') return ['mcp', '--bridge', `127.0.0.1:${port}`];
  if (id === 'effectcraft' || id === 'texturecraft' || id === 'materialcraft') return ['mcp', '--bridge', String(port)];
  if (id === 'figcraft') return ['mcp', '--attach', String(port)];
  return ['mcp', '--connect', `127.0.0.1:${port}`];
}

/** Arguments of the MCP server of a found app: live when its window runs with a control port, else headless on files. */
export function mcpArgs(f: Pick<FoundApp, 'id' | 'extra' | 'livePort'>): string[] {
  if (f.livePort) return liveMcpArgs(f.id, f.livePort);
  if (['photocraft', 'figcraft', 'texturecraft', 'materialcraft'].includes(f.id)) return ['mcp', '--automation-read-root', homedir(), '--automation-write-root', homedir()];
  return ['mcp', ...f.extra];
}

/** Every Craft app found on this computer. WORKCRAFT_NO_CRAFT_DISCOVERY=1 turns this off (tests). */
export async function discover(): Promise<FoundApp[]> {
  if (process.env.WORKCRAFT_NO_CRAFT_DISCOVERY) return [];
  const found: FoundApp[] = [];
  for (const a of CRAFT_APPS) {
    const cli = findCli(a);
    if (!cli) continue;
    found.push({ ...a, cli, gui: findGui(a, cli), livePort: a.live ? await livePortFor(a) : null });
  }
  return found;
}

/**
 * Is the MCP server of this app on? An explicit choice of the user wins; otherwise the document suite and every app of the
 * workspace in use are on, so the AI can reach all the apps the user is looking at without a trip to the settings.
 */
export const craftEnabled = (id: string, choices: Record<string, boolean>, workspace: readonly string[] = []) => choices[id] ?? (ON_BY_DEFAULT.includes(id) || workspace.includes(id));

/** What one connected server reports (src/server/mcp.ts externalStatus), as far as the settings screen needs it. */
export interface ServerHealth {
  id: string;
  status: string;
  error?: string;
  tools: string[];
  attempts: number;
  retry_in_s?: number;
}

/** What the settings screen shows for the Craft apps: installed, on, connected, and why not when it is not. */
export function craftReport(found: FoundApp[], choices: Record<string, boolean>, connected: string[], health: readonly ServerHealth[] = [], workspace: readonly string[] = []) {
  return CRAFT_APPS.map((a) => {
    const f = found.find((x) => x.id === a.id);
    const h = health.find((x) => x.id === a.id);
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      installed: !!f,
      cli: f?.cli ?? null,
      live: !!f?.livePort,
      enabled: craftEnabled(a.id, choices, workspace),
      connected: connected.includes(a.id),
      /** The app belongs to the workspace in use */
      workspace: workspace.includes(a.id),
      tools: h?.status === 'connected' ? h.tools.length : 0,
      ...(h?.status === 'error' ? { error: h.error || 'connection failed', attempts: h.attempts, retry_in_s: h.retry_in_s } : {}),
    };
  });
}

/** Resolves an app id or name ("WordCraft", "wordcraft", "word"). */
export function lookupApp(raw: string): CraftApp | undefined {
  const s = raw.trim().toLowerCase();
  return CRAFT_APPS.find((a) => a.id === s || a.name.toLowerCase() === s || a.id.replace(/craft$/, '') === s);
}

/**
 * Opens the desktop window of an app (with `--control <port>` when it supports a live bridge) and optionally a
 * file. Returns what happened in one line. The MCP server picks the live port up on the next sync.
 */
export async function openApp(raw: string, file?: string): Promise<string> {
  const a = lookupApp(raw);
  if (!a) throw new Error(`Unknown Craft app '${raw}'`);
  const cli = findCli(a);
  const gui = findGui(a, cli);
  if (!gui) throw new Error(`${a.name} is not installed on this computer`);
  const live = a.live ? await livePortFor(a) : null;
  if (live) return `${a.name} is already open and live on port ${live}`;
  const args: string[] = [];
  if (a.live && a.port) args.push('--control', String(a.port));
  else if (a.id === 'photocraft') args.push('--control', '7878');
  if (file) args.push(file);
  const child = spawn(gui, args, { detached: true, stdio: 'ignore' });
  child.unref();
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    setTimeout(resolve, 150);
  });
  return `Opened ${a.name}${file ? ` with ${file}` : ''}`;
}
