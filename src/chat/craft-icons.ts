// Icons of the Craft apps (public/assets/craft/<app>.png, 128 px renders of artcraft/apps/<app>/assets/app-icon, also the logos of the workspace rail and picker). A tool of a connected Craft app is named
// ext-<app>-<tool> (src/server/mcp.ts), so the app can be read from the name; the tool card, the tool list and
// the team lanes show its icon instead of the generic plug.

import { ROOT } from '../app/util.js';
import { APPS, appOfGroup } from '../ecosystems/catalog.js';

/** Every app of the catalog (the list used to be written out here and missed the apps added later). */
export const CRAFT_IDS: string[] = APPS.map((a) => a.id);

/** The Craft app a tool belongs to, or null (built-in tools and other MCP servers). The server id loses its hyphens in the
 *  tool name (ext-craftanything-...), so the group is mapped back to the catalog id. */
export function craftIdOfTool(name: string): string | null {
  const m = /^ext-([a-z0-9]+)-/.exec(name);
  return m ? (appOfGroup(m[1]!)?.id ?? null) : null;
}

export const craftIconUrl = (id: string) => `${ROOT}assets/craft/${id}.png`;

export function craftMark(id: string, size = 16): string {
  return `<img class="tool-logo craft-logo" src="${craftIconUrl(id)}" width="${size}" height="${size}" alt="" decoding="async">`;
}

/** Icon HTML for a tool call: the Craft app icon when the tool belongs to one, else ''. */
export function craftMarkForTool(name: string, size = 16): string {
  const id = craftIdOfTool(name);
  return id ? craftMark(id, size) : '';
}
