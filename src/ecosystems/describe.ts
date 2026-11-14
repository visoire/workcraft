// What the AI is told about the apps of the catalog (the list-craft-apps tool) and why an app cannot be opened (open-in-app).
// Pure, so the wording and the filters are tested without a browser.

import { APPS, ORIGIN_LABEL, ecosystemById, ecosystemsOf, lookupApp, type Availability, type CatalogApp, type Ecosystem, type Origin } from './catalog.js';

export interface ListFilter {
  type?: string;
  ecosystem?: string;
  origin?: Origin;
  available?: boolean;
  app?: string;
}

export interface AppRow {
  id: string;
  name: string;
  kind: string;
  origin: Origin;
  license: string;
  ecosystems: string[];
  web_build: boolean;
  version: string | null;
  /** Only in detail: when a file type or one app was asked for */
  opens?: string[];
  imports?: string[];
  /** Only for an app without a web build here: what to do about it */
  how_to_get?: string;
}

/** The one command that gives an app a web build, by the channel it comes through. */
export function howToGet(a: CatalogApp): string {
  const drop = `drop a ${a.id}-web-<version> folder into versions/ and run npm run apps:import -- --yes --app ${a.id}`;
  if (a.channel === 'release') return `run npm run apps:fetch -- --yes --app ${a.id} (installs the web zip of github.com/${a.repo} releases), or ${drop}`;
  if (a.channel === 'pages') return `run npm run apps:fetch -- --yes --app ${a.id} (mirrors the deployed app at ${a.pages}), or ${drop}`;
  return `${a.name} is only built from source and has no ready web build, so ${drop}`;
}

/** The catalog filtered for the AI. `unknown` names a filter value that matched nothing (an app or ecosystem id that does not exist). */
export function listApps(f: ListFilter, has: Availability, custom: readonly Ecosystem[]): { rows: AppRow[]; unknown?: string } {
  const type = (f.type ?? '').replace(/^\./, '').toLowerCase();
  let pool: readonly CatalogApp[] = APPS;
  if (f.app) {
    const one = lookupApp(f.app);
    if (!one) return { rows: [], unknown: f.app };
    pool = [one];
  }
  const eco = f.ecosystem ? ecosystemById(f.ecosystem, custom) : undefined;
  if (f.ecosystem && !eco) return { rows: [], unknown: f.ecosystem };
  const detail = !!type || !!f.app;
  const rows = pool
    .filter((a) => !type || a.opens.includes(type) || a.imports.includes(type))
    .filter((a) => !eco || (eco.apps as string[]).includes(a.id))
    .filter((a) => !f.origin || a.origin === f.origin)
    .filter((a) => !f.available || has.has(a.id))
    .map((a): AppRow => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      origin: a.origin,
      license: a.license,
      ecosystems: ecosystemsOf(a.id, custom).map((e) => e.id),
      web_build: has.has(a.id),
      version: has.version(a.id),
      ...(detail ? { opens: a.opens, imports: a.imports } : {}),
      ...(!has.has(a.id) && f.app ? { how_to_get: howToGet(a) } : {}),
    }));
  return { rows };
}

/** The sentence open-in-app answers with when the app cannot start here. */
export function noBuildMessage(a: CatalogApp, runnable: readonly string[]): string {
  return `${a.name} (${ORIGIN_LABEL[a.origin]}) has no web build in this workspace. To get one, ${howToGet(a)}. Apps that run now: ${runnable.join(', ') || 'none'}.`;
}
