// Registry of all panels. The four apps are the WebAssembly builds of the current release set
// (public/releases.json, today versions/v9-10/web/), served under apps/<app>/ (Vite plugin in
// scripts/releases.mjs, copy-apps.mjs in the build). Versions come from that file too: Vite does not
// let code import files from public/, so vite.config.js passes the data in as __OC_RELEASES__.

import { icon, markSvg } from '../app/icons.js';
import { t } from '../app/i18n.js';
import { ROOT } from '../app/util.js';
import { APPS, CRAFT_IDS, OFFICE_IDS, availabilityOf, defaultAppFor, extOf, type CraftId, type Weight, type WebBuild } from '../ecosystems/catalog.js';

export const WORKSPACE_ACCENT = '#335CFF';

/** Every Craft app of the catalog (src/ecosystems/catalog.json) plus the workspace's own tools. */
export type ToolId = CraftId | 'code' | 'terminal' | 'settings' | 'tree' | 'chat';
export type Zone = 'stage' | 'left' | 'right';

export interface PanelInstance {
  open?(path: string): Promise<unknown>;
  /** Stop the render loop, keep the state */
  pause?(): void;
  resume?(): void;
  /** May the memory be freed? (no unsaved input) */
  canUnload?(): boolean;
  /** Save unsaved changes into the project (the AI reads what the user sees); true when nothing is left unsaved */
  flushUnsaved?(): Promise<boolean>;
  /** A file changed outside the panel (AI, terminal, disk) */
  externalChange?(path: string, kind: 'change' | 'delete' | 'create'): void;
  status?(): Record<string, unknown>;
  /** Memory of the panel: WebAssembly memory, estimated GPU memory, JS heap (memory monitor) */
  resources?(): PanelResources | null;
  getScroll?(): { top: number; left: number } | null;
  setScroll?(s: { top: number; left: number }): void;
  ready?: Promise<void>;
  beforeClose?(): Promise<boolean> | boolean;
  /** Apple Pencil: open the pencil view (PdfCraft: sign, ink, mark, redact) */
  pen?(tool?: string): Promise<unknown> | void;
  unmount(): void | Promise<void>;
}

export interface PanelResources {
  wasm: number;
  gpu: number;
  gpuApi: string;
  heap: number | null;
  gpuBuffers?: number;
  gpuTextures?: number;
}

export interface PanelContext {
  id: string;
  tool: ToolId;
  readonly path: string | null;
  setPath(path: string | null): void;
  setStatus(text: string): void;
  setDirty(dirty: boolean): void;
  setBadge(text: string | null): void;
  focus(): void;
  openFile(path: string, tool?: ToolId): Promise<string | undefined>;
  restore: { scroll?: { top: number; left: number } } | null;
  onDispose(fn: () => void): void;
  /** Origin tag for writes of this panel (live sync recognises its own changes) */
  origin: string;
}

export interface ToolInfo {
  id: ToolId;
  name: string;
  kind: 'app' | 'dev' | 'system' | 'side';
  zone: Zone;
  accent: string;
  icon: string;
  logo?: string;
  src?: string;
  canvas?: string;
  version?: string;
  folder?: string;
  blurb: string;
  /** File types the tool is the natural home for (double click, the project tree) */
  exts: string[];
  /** Further types an app reads (file picker of the app, "Open with"). Only Craft apps. */
  imports?: string[];
  /** A Craft app has a web build in this installation. False: the panel explains how to get it. */
  available?: boolean;
  /** Catalog traits (iPadOS decisions): weight, pen, audio */
  traits?: { weight: Weight; pen: 'precise' | 'pressure'; audio: boolean; needsFiles: boolean; keys?: 'video' | 'paint' };
  single?: boolean;
  load(): Promise<{ mount(el: HTMLElement, ctx: PanelContext): Promise<PanelInstance> }>;
}

export interface AppRelease {
  app: string;
  name: string;
  version: string;
  tag: string;
  date: string;
  web: string;
  /** Set when the browser build is older than the release (webNote says why) */
  webVersion?: string;
  webNote?: string;
  webZipBytes: number;
}

declare const __OC_RELEASES__: AppRelease[] | undefined;

/** The app releases this build serves (public/releases.json, inlined by vite.config.js). */
export const RELEASES: AppRelease[] = typeof __OC_RELEASES__ !== 'undefined' ? __OC_RELEASES__ : [];
export const releaseOf = (id: string): AppRelease | undefined => RELEASES.find((r) => r.app === id);

declare const __WC_BUILDS__: WebBuild[] | undefined;

/** Web builds of the other apps (public/web-builds.json, written by npm run apps:fetch, inlined by vite.config.js). */
export const WEB_BUILDS: WebBuild[] = typeof __WC_BUILDS__ !== 'undefined' ? __WC_BUILDS__ : [];
/** Which apps have a web build in this installation, and its version. */
export const AVAILABLE = availabilityOf(RELEASES, WEB_BUILDS);

// The office apps keep their own wording (and German strings); every other app takes its blurb from the catalog.
const OFFICE_BLURBS: Record<string, string> = {
  wordcraft: t('Documents in .docx, .odt and .md'),
  gridcraft: t('Spreadsheets in .xlsx, .csv with dynamic arrays'),
  deckcraft: t('Presentations in .pptx with vector morphing'),
  pdfcraft: t('PDF with deep zoom, local signing and redaction'),
};
// Logos: the office apps keep their WebP (public/assets/logos/, 256 px); every other app has a 128 px PNG of its real app icon in
// public/assets/craft/<id>.png (trimmed from artcraft/apps/<app>/assets/app-icon, also used by the MCP tool cards). A monogram is
// the fallback only for an app someone adds to the catalog before its icon exists (toolMark).
const OFFICE_LOGO = new Set<string>(OFFICE_IDS);

const craftTool = (a: (typeof APPS)[number]): ToolInfo => {
  const available = AVAILABLE.has(a.id);
  return {
    id: a.id,
    name: a.name,
    // The version that runs in the panel: the browser build, which can be older than the release
    version: AVAILABLE.version(a.id) ?? '?',
    kind: 'app',
    zone: 'stage',
    accent: a.accent,
    icon: 'file',
    logo: OFFICE_LOGO.has(a.id) ? `${ROOT}assets/logos/${a.id}.webp` : `${ROOT}assets/craft/${a.id}.png`,
    src: `${ROOT}apps/${a.id}/`,
    // The office engines name their canvas; for the others the panel takes the first canvas of the page
    canvas: a.id === 'pdfcraft' ? 'pdfcraft' : OFFICE_LOGO.has(a.id) ? `${a.id}_canvas` : undefined,
    folder: a.folder,
    blurb: OFFICE_BLURBS[a.id] ?? t(a.blurb),
    exts: a.opens,
    imports: a.imports,
    available,
    traits: a.traits,
    load: () => (available ? import('./panels/craftapp.js') : import('./panels/unavailable.js')),
  };
};

const craftTools = Object.fromEntries(APPS.map((a) => [a.id, craftTool(a)])) as Record<CraftId, ToolInfo>;

export const TOOLS: Record<ToolId, ToolInfo> = {
  ...craftTools,
  code: { id: 'code', name: 'Code', kind: 'dev', zone: 'stage', accent: WORKSPACE_ACCENT, icon: 'code', blurb: t('Code editor'), exts: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'html', 'xml', 'svg', 'yml', 'yaml', 'toml', 'py', 'sh', 'sql', 'rs', 'go', 'gitignore', 'ini', 'log'], load: () => import('./panels/code.js') },
  terminal: { id: 'terminal', name: 'Terminal', kind: 'dev', zone: 'stage', accent: WORKSPACE_ACCENT, icon: 'terminal', blurb: t('Real terminal in the project folder'), exts: [], load: () => import('./panels/terminal.js') },
  settings: { id: 'settings', name: t('Settings'), kind: 'system', zone: 'stage', accent: WORKSPACE_ACCENT, icon: 'settings', blurb: t('Models, keys and MCP'), exts: [], single: true, load: () => import('./panels/settings.js') },
  tree: { id: 'tree', name: t('Project'), kind: 'side', zone: 'left', accent: WORKSPACE_ACCENT, icon: 'folder', blurb: t('Project tree'), exts: [], single: true, load: () => import('../project/tree.js') },
  chat: { id: 'chat', name: t('AI assistant'), kind: 'side', zone: 'right', accent: WORKSPACE_ACCENT, icon: 'spark', blurb: t('AI chat with @ and /'), exts: [], single: true, load: () => import('../chat/sidebar.js') },
};

/** The four office apps: the ones with their own MCP tools (read-sheet, write-doc, ...) and the default layout. */
export const APP_IDS: CraftId[] = [...OFFICE_IDS];
/** Every Craft app of the catalog, in catalog order. */
export const CRAFT_APP_IDS: readonly CraftId[] = CRAFT_IDS;
/** A Craft app engine that runs in a panel (an iframe with WebAssembly) in this installation. Panels of these get
 *  unload, pop-out, memory accounting and the iPadOS layer. */
export const isApp = (id: string): id is CraftId => (CRAFT_IDS as readonly string[]).includes(id) && AVAILABLE.has(id);
/** Any Craft app of the catalog, with or without a web build here. */
export const isCraftApp = (id: string): id is CraftId => (CRAFT_IDS as readonly string[]).includes(id);

// The active ecosystem tells which non-office apps may claim a file type (see toolForPath).
let preferred: CraftId[] = [...OFFICE_IDS];
export function setPreferredApps(ids: readonly CraftId[]): void {
  preferred = [...ids];
}
export const preferredApps = (): readonly CraftId[] => preferred;

/**
 * The tool a file opens in. An office file type always goes to its office app. A type of another app (a PNG, an
 * SVG, a video) goes to that app only when it is part of the active ecosystem and has a web build here, so the
 * AI writing a .png into an Office project does not open a photo editor. Everything else: the code editor.
 */
export function toolForPath(path: string): ToolId {
  const app = defaultAppFor(path, { available: (id) => AVAILABLE.has(id), prefer: preferred, nativeOnly: true });
  if (app && (preferred.includes(app.id) || (OFFICE_IDS as readonly string[]).includes(app.id))) return app.id;
  const ext = extOf(path);
  for (const t of Object.values(TOOLS)) if (t.kind !== 'side' && t.kind !== 'app' && t.exts.includes(ext)) return t.id;
  return 'code';
}

/** Logo of the four office apps and the apps with an icon; a monogram in the app color for the rest. */
export function toolMark(id: string, size = 18): string {
  // The AI assistant carries the WorkCraft W mark
  if (id === 'chat') return markSvg(size, 'mark tool-w');
  const t = TOOLS[id as ToolId];
  if (t?.logo) return `<img class="tool-logo" src="${t.logo}" width="${size}" height="${size}" alt="" decoding="async">`;
  if (t?.kind === 'app') return `<span class="tool-mono" style="--tool:${t.accent};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.58)}px" aria-hidden="true">${t.name.charAt(0)}</span>`;
  return icon(t?.icon || 'file', { size });
}