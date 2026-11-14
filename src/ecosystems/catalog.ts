// The Craft app catalog and the ecosystems built from it. Pure: no DOM, no Node, no storage, so the
// workspace, the build scripts (through catalog.json) and the tests all use the same logic.
//
// Why a catalog: WorkCraft does not put every app into one workspace. An ecosystem is a named group of apps
// (Office, Imaging, Video and Audio, Design, 3D and CAD, Exploration, or one the user builds). The apps
// themselves are the same everywhere: one file of the project opens in any app that reads its type.
//
// Rules:
//   - Versions never appear here (public/releases.json and public/web-builds.json own them), so an app
//     update does not touch this file.
//   - An app without a web build in this installation is still listed: the launcher shows it as "not
//     installed in this build" and offers the desktop app, instead of hiding it.
//   - File types: `opens` = the app is the natural home, `imports` = it also reads them.

// The import attribute is what Node (the backend and the tests) requires for a JSON module; Vite and tsc accept it too.
import data from './catalog.json' with { type: 'json' };
import type { AppTheme } from './theme.js';

// Same ids, same order as catalog.json (tests/server/ecosystems.test.ts keeps them equal). The literal type is what
// lets the rest of the code use CraftId as a union; a new app is one id here and one entry in catalog.json.
export const CRAFT_IDS = [
  // ArtCraft: the office apps, imaging, motion, design, CAD
  'wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft',
  'photocraft', 'lightcraft', 'vectorcraft',
  'filmcraft', 'effectcraft', 'soundcraft',
  'designcraft', 'figcraft',
  'cadcraft', 'texturecraft', 'materialcraft', 'solidcraft',
  // Added with the 2026-11-12 versions: MailCraft, AniCraft, Craft Anything
  'mailcraft', 'anicraft', 'craft-anything',
  // Community apps of independent developers (not made by the ArtCraft team)
  'tracedraw', 'lightcraft-classic', 'firecraft', 'paintcraft', 'paintrs', 'procraft', 'pixelcraft',
  'notecraft', 'textcraft', 'matcraft', 'picasso-suite', 'align', 'subcraft', 'clothcraft', 'humanmotioncraft', 'oxybrush',
  'retake', 'lemon-studio', 'honeydew', 'suhina', 'prowave', 'oxiguitar', 'transit', 'mixstudio', 'earthcraft',
] as const;
export type CraftId = (typeof CRAFT_IDS)[number];

/** The four apps with their own MCP tools in the workspace (read-sheet, write-doc, ...). */
export const OFFICE_IDS: readonly CraftId[] = ['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft'];

export type Weight = 'light' | 'medium' | 'heavy';

/** What the workspace needs to know about an app to treat it well on an iPad. Not a promise about the engine:
 *  the engine's own capability manifest (src/ipados/compat.ts) still wins. */
export interface AppTraits {
  /** Expected memory pressure. The memory governor measures the real numbers; this only orders the first decisions. */
  weight: Weight;
  /** pressure: a brush surface where Apple Pencil pressure and tilt matter; precise: a precise pointer is enough */
  pen: 'precise' | 'pressure';
  /** Plays or records sound: Safari needs a tap before audio starts */
  audio: boolean;
  /** The app opens and saves files (false: it works from its own state, so nothing to import) */
  needsFiles: boolean;
  /** The app is worked with keyboard shortcuts: the key table of the touch keys bar on a screen without a keyboard (src/ipados/touch-keys.ts) */
  keys?: 'video' | 'paint';
}

/** Who makes the app: the ArtCraft team, a community app the ArtCraft launcher lists, or a third-party app of independent developers. */
export type Origin = 'artcraft' | 'community' | 'independent';
/** How a web build is obtained: `release` = the repository publishes a web zip (scripts/fetch-apps.mjs installs it);
 *  `pages` = the app itself is deployed on GitHub Pages (`pages` is its URL) and `apps:fetch` mirrors that site;
 *  `source` = the upstream collection builds it from source, so only a build folder dropped into versions/ can be imported. */
export type Channel = 'release' | 'pages' | 'source';

export const ORIGIN_LABEL: Record<Origin, string> = { artcraft: 'ArtCraft', community: 'Community', independent: 'Independent' };

export interface CatalogApp {
  id: CraftId;
  name: string;
  kind: string;
  accent: string;
  /** GitHub repository that publishes the web build (owner/name) */
  repo: string;
  origin: Origin;
  /** SPDX id of the app's licence (shown in the launcher; a GPL app is fetched on the user's machine, never committed) */
  license: string;
  channel: Channel;
  /** Regex of the release asset when it is not the default `-web-*.zip` */
  asset?: string;
  /** Channel `pages`: the URL of the deployed app (https, ends with a slash) */
  pages?: string;
  /** The engine needs cross-origin isolation (shared memory) */
  isolated?: boolean;
  /** Default project folder for new files of this app */
  folder: string;
  blurb: string;
  opens: string[];
  imports: string[];
  traits: AppTraits;
  /** What the app does with the light and dark switch of the workspace (src/ecosystems/theme.ts, docs/THEMING.md) */
  theme: AppTheme;
}

export interface Ecosystem {
  id: string;
  name: string;
  blurb: string;
  apps: CraftId[];
  accent: string;
  /** Made by the user */
  custom?: boolean;
}

export const APPS: readonly CatalogApp[] = data.apps as CatalogApp[];
export const ECOSYSTEMS: readonly Ecosystem[] = data.ecosystems as Ecosystem[];
export const DEFAULT_ECOSYSTEM = 'office';

export const isCraftId = (id: string): id is CraftId => (CRAFT_IDS as readonly string[]).includes(id);
/** The name a tool of the app carries: `ext-<group>-<tool>` (src/server/mcp.ts keeps letters and digits of the server id, so
 *  craft-anything is craftanything). */
export const groupKey = (id: string): string => id.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** The app a tool-name group belongs to, or undefined (another MCP server). */
export const appOfGroup = (group: string): CatalogApp | undefined => APPS.find((a) => groupKey(a.id) === group);
/** Apps whose natural home is this file type (`opens`), in catalog order. The tool router uses it to offer the tools of the
 *  app that works on a file the question refers to. */
export const nativeAppsOf = (ext: string): CatalogApp[] => APPS.filter((a) => a.opens.includes(ext.toLowerCase()));
/** Apps of one origin, in catalog order (the "Create your own" form groups by it). */
export const appsOfOrigin = (o: Origin): CatalogApp[] => APPS.filter((a) => a.origin === o);
export const appById = (id: string): CatalogApp | undefined => APPS.find((a) => a.id === id);

/** Letters and digits only, lower case: "Paint.RS", "paint-rs" and "paintrs" are one name; "Craft Anything" is craft-anything. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "WordCraft", "wordcraft", "word", "Pro Wave" to the app. Used by chat tools and the palette. A short form ("word" for
 *  wordcraft) counts only when it names one app: "text" is TextCraft, but a form two apps share is not guessed. */
export function lookupApp(raw: string): CatalogApp | undefined {
  const s = norm(raw);
  if (!s) return undefined;
  const exact = APPS.find((a) => norm(a.id) === s || norm(a.name) === s);
  if (exact) return exact;
  const short = (a: CatalogApp) => norm(a.id).replace(/craft$/, '');
  const hits = APPS.filter((a) => short(a) === s);
  return hits.length === 1 ? hits[0] : undefined;
}

export const extOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
};

export function ecosystemById(id: string, custom: readonly Ecosystem[] = []): Ecosystem | undefined {
  return ECOSYSTEMS.find((e) => e.id === id) || custom.find((e) => e.id === id);
}

/** Every ecosystem an app belongs to, built-in first. */
export const ecosystemsOf = (app: string, custom: readonly Ecosystem[] = []): Ecosystem[] =>
  [...ECOSYSTEMS, ...custom].filter((e) => (e.apps as string[]).includes(app));

/** Apps that can take a file of this name, best home first. `prefer` (the active ecosystem) goes before the rest,
 *  and an app that has the type in `opens` goes before one that only imports it. */
export function appsFor(name: string, opts: { available?: (id: CraftId) => boolean; prefer?: readonly CraftId[] } = {}): CatalogApp[] {
  const ext = extOf(name);
  if (!ext) return [];
  const prefer = opts.prefer ?? [];
  const rank = (a: CatalogApp) => (prefer.includes(a.id) ? 0 : 2) + (a.opens.includes(ext) ? 0 : 1);
  return APPS.filter((a) => (a.opens.includes(ext) || a.imports.includes(ext)) && (!opts.available || opts.available(a.id)))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((x) => x.a);
}

/** The app a double click opens: the first of appsFor(), or undefined. With `nativeOnly` an app that merely
 *  imports the type does not count (an AI-written .png should not pop open a photo editor in the Office workspace). */
export function defaultAppFor(name: string, opts: { available?: (id: CraftId) => boolean; prefer?: readonly CraftId[]; nativeOnly?: boolean } = {}): CatalogApp | undefined {
  const ext = extOf(name);
  const list = appsFor(name, opts);
  return opts.nativeOnly ? list.find((a) => a.opens.includes(ext)) : list[0];
}

// ---------------------------------------------------------------- custom ecosystems

export const CUSTOM_PREFIX = 'custom-';
const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

export type CustomResult = { ok: true; ecosystem: Ecosystem } | { ok: false; error: 'name' | 'apps' | 'duplicate' };

/** Checks what the "Create your own" form collected. The id is derived from the name and kept unique. */
export function makeCustomEcosystem(name: string, apps: readonly string[], existing: readonly Ecosystem[] = []): CustomResult {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean || !slug(clean)) return { ok: false, error: 'name' };
  const ids = [...new Set(apps)].filter(isCraftId);
  if (!ids.length) return { ok: false, error: 'apps' };
  const taken = new Set([...ECOSYSTEMS, ...existing].map((e) => e.id));
  const base = CUSTOM_PREFIX + slug(clean);
  if ([...ECOSYSTEMS, ...existing].some((e) => e.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: 'duplicate' };
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  // Keep the catalog order, so the rail does not depend on the order of clicks
  const ordered = CRAFT_IDS.filter((x) => ids.includes(x));
  return { ok: true, ecosystem: { id, name: clean, blurb: ordered.map((x) => appById(x)!.name).join(', '), apps: [...ordered], accent: '#335CFF', custom: true } };
}

/** Custom ecosystems stored as JSON (localStorage) can come back damaged or from a newer version: keep what is valid. */
export function sanitizeCustom(raw: unknown): Ecosystem[] {
  if (!Array.isArray(raw)) return [];
  const out: Ecosystem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { id, name, apps } = r as { id?: unknown; name?: unknown; apps?: unknown };
    if (typeof id !== 'string' || !id.startsWith(CUSTOM_PREFIX) || typeof name !== 'string' || !Array.isArray(apps)) continue;
    if (out.some((e) => e.id === id) || ECOSYSTEMS.some((e) => e.id === id)) continue;
    const known = apps.filter((x): x is CraftId => typeof x === 'string' && isCraftId(x));
    if (!known.length) continue;
    out.push({ id, name: name.slice(0, 40), blurb: known.map((x) => appById(x)!.name).join(', '), apps: known, accent: '#335CFF', custom: true });
  }
  return out;
}

// ---------------------------------------------------------------- web builds

/** One entry of public/web-builds.json (written by scripts/fetch-apps.mjs). */
export interface WebBuild {
  app: string;
  version: string;
  /** Folder name under versions/web-builds/ */
  dir: string;
  bytes?: number;
  source?: string;
  fetchedAt?: string;
}

export interface Availability {
  /** The app has a web build in this installation */
  has(id: string): boolean;
  /** Version of that build */
  version(id: string): string | null;
}

/** Availability from the office releases (public/releases.json) and the fetched builds (public/web-builds.json). */
export function availabilityOf(officeReleases: readonly { app: string; version: string; webVersion?: string }[], builds: readonly WebBuild[]): Availability {
  const map = new Map<string, string>();
  for (const r of officeReleases) map.set(r.app, r.webVersion || r.version);
  for (const b of builds) if (isCraftId(b.app)) map.set(b.app, b.version);
  return { has: (id) => map.has(id), version: (id) => map.get(id) ?? null };
}

export const heavierThan = (a: Weight, b: Weight) => ['light', 'medium', 'heavy'].indexOf(a) > ['light', 'medium', 'heavy'].indexOf(b);
