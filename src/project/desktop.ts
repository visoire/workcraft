// The real, installed Craft apps next to the WebAssembly panels. The panels run the web builds inside the
// workspace; when the same app is installed on the computer that runs WorkCraft (found by src/server/craft.ts), a file
// can also be opened in its desktop window, which the AI drives live through the app's control port.
//
//   desktopApp(toolId)          is the desktop app of this panel installed here, and is its window open?
//   openInDesktop(toolId, path) opens a project file in the desktop app (the full path comes from the backend)
//
// Only on the computer that runs WorkCraft: not in browser mode, not over the home network (an iPad has no such apps).

import { api } from '../app/backend.js';
import { toast, notifyError } from '../app/notifications.js';
import { t } from '../app/i18n.js';
import { canLocate } from './locate.js';
import { CRAFT_IDS } from '../ecosystems/catalog.js';

export interface DesktopApp {
  id: string;
  name: string;
  installed: boolean;
  live: boolean;
  connected: boolean;
}

/** Every app of the catalog (src/ecosystems/catalog.json) has a panel in the workspace; the ids are the same in the
 *  Craft registry of the backend (src/server/craft.ts), which reports which of them are installed on this computer. */
export const PANEL_CRAFT: string[] = [...CRAFT_IDS];

let cache: { at: number; apps: DesktopApp[] } | null = null;

export async function desktopApps(fresh = false): Promise<DesktopApp[]> {
  if (!canLocate()) return [];
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.apps;
  try {
    const r = await api.get<{ apps: DesktopApp[] }>('/api/craft');
    cache = { at: Date.now(), apps: r.apps };
  } catch {
    cache = { at: Date.now(), apps: [] };
  }
  return cache.apps;
}

/** The desktop twin of a panel's app, or null (not installed, not on this computer, not an app panel). */
export async function desktopApp(toolId: string): Promise<DesktopApp | null> {
  if (!PANEL_CRAFT.includes(toolId)) return null;
  const a = (await desktopApps()).find((x) => x.id === toolId);
  return a?.installed ? a : null;
}

/** Same as desktopApp, from what was read last (menus open synchronously). Call desktopApps() early to fill it. */
export function desktopAppCached(toolId: string): DesktopApp | null {
  if (!PANEL_CRAFT.includes(toolId)) return null;
  const a = cache?.apps.find((x) => x.id === toolId);
  return a?.installed ? a : null;
}

/** Opens the file in the desktop app. Say what happened in one toast. */
export async function openInDesktop(toolId: string, path?: string): Promise<void> {
  try {
    let file: string | undefined;
    if (path) file = (await api.get<{ path: string }>(`/api/files/location?path=${encodeURIComponent(path)}`)).path;
    const r = await api.send<{ message: string }>('POST', '/api/craft/open', { id: toolId, ...(file ? { file } : {}) });
    cache = null;
    toast(r.message, 'success', t('The AI can drive this window while it is open.'));
  } catch (e) {
    notifyError(e);
  }
}
