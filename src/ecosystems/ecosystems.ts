// The ecosystem in use: which group of Craft apps the workspace shows (rail, New menu, launcher, palette).
// State lives in the prefs (workcraft.prefs) of this browser: `ecosystem`, `ecosystemsCustom`, `ecosystemChosen`.
// Nothing is stored in a project, so the same project opens in any ecosystem, and a file of another ecosystem
// (a .png in the Office workspace) is still in the project and still opens, through Open with.

import { prefs } from '../app/settings.js';
import { bus } from '../app/bus.js';
import { setPreferredApps } from '../workspace/registry.js';
import { DEFAULT_ECOSYSTEM, ECOSYSTEMS, ecosystemById, makeCustomEcosystem, sanitizeCustom, type CraftId, type CustomResult, type Ecosystem } from './catalog.js';

export const customEcosystems = (): Ecosystem[] => sanitizeCustom(prefs.get('ecosystemsCustom'));
export const allEcosystems = (): Ecosystem[] => [...ECOSYSTEMS, ...customEcosystems()];

/** The ecosystem in use. A removed custom one falls back to Office. */
export function activeEcosystem(): Ecosystem {
  return ecosystemById(prefs.get('ecosystem'), customEcosystems()) ?? ECOSYSTEMS.find((e) => e.id === DEFAULT_ECOSYSTEM)!;
}
export const activeApps = (): CraftId[] => activeEcosystem().apps;

export function setEcosystem(id: string): Ecosystem {
  const eco = ecosystemById(id, customEcosystems()) ?? ECOSYSTEMS.find((e) => e.id === DEFAULT_ECOSYSTEM)!;
  prefs.set('ecosystem', eco.id);
  prefs.set('ecosystemChosen', true);
  setPreferredApps(eco.apps);
  bus.emit('ecosystem:change', { id: eco.id });
  return eco;
}

/** Saves a new custom ecosystem and switches to it. */
export function addCustomEcosystem(name: string, apps: readonly string[]): CustomResult {
  const mine = customEcosystems();
  const r = makeCustomEcosystem(name, apps, mine);
  if (!r.ok) return r;
  prefs.set('ecosystemsCustom', [...mine, r.ecosystem]);
  setEcosystem(r.ecosystem.id);
  return r;
}

/** Changes the apps of a custom ecosystem (the name and id stay). */
export function updateCustomEcosystem(id: string, apps: readonly string[]): boolean {
  const mine = customEcosystems();
  const at = mine.findIndex((e) => e.id === id);
  if (at < 0) return false;
  const next = makeCustomEcosystem(mine[at]!.name, apps, mine.filter((e) => e.id !== id));
  if (!next.ok) return false;
  mine[at] = { ...next.ecosystem, id };
  prefs.set('ecosystemsCustom', mine);
  if (prefs.get('ecosystem') === id) setEcosystem(id);
  return true;
}

export function removeCustomEcosystem(id: string): void {
  const mine = customEcosystems();
  prefs.set('ecosystemsCustom', mine.filter((e) => e.id !== id));
  if (prefs.get('ecosystem') === id) setEcosystem(DEFAULT_ECOSYSTEM);
}

/** Call once at boot: the file routing (registry.toolForPath) follows the ecosystem in use. A link can choose one
 *  (/?ecosystem=imaging, for example from the homepage), which also counts as the first-run choice. */
export function initEcosystems(search = ''): void {
  const wanted = new URLSearchParams(search).get('ecosystem');
  if (wanted && ecosystemById(wanted, customEcosystems())) setEcosystem(wanted);
  else setPreferredApps(activeApps());
  bus.on('ecosystem:change', () => void reportWorkspace());
  bus.on('backend:mode', () => void reportWorkspace());
  void reportWorkspace();
}

/**
 * Tells the desktop backend which apps the workspace in use has, so the MCP servers of those apps that are installed connect
 * on their own (the AI reaches every app you are looking at, without a trip to the settings; a server you switched off stays
 * off). Browser mode has no servers. The backend may still be starting: a few tries.
 */
export async function reportWorkspace(tries = 4): Promise<void> {
  const { api, backend } = await import('../app/backend.js');
  if (backend.browser) return;
  for (let i = 0; i < tries; i++) {
    try {
      await api.send('PUT', '/api/craft', { workspace: activeApps() });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

/** The first run has not chosen yet: the picker opens by itself, once. */
export const needsChoice = (): boolean => !prefs.get('ecosystemChosen');
