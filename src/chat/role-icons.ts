// Icon of a team role. The roles that belong to a Craft app wear that app's own logo, the Team Leader the
// WorkCraft mark, the code specialist a code glyph; agents you create keep the icon you picked (a stroke icon from
// icons.js). One function for the chat chips, Mission Control, the roster editor and the @ menu.

import { icon, markSvg } from '../app/icons.js';
import { toolMark } from '../workspace/registry.js';
import { ROLE_DEFS, type TeamRoleId } from './team.js';
import { craftMark } from './craft-icons.js';

export function roleIcon(role: TeamRoleId, size = 16): string {
  const d = ROLE_DEFS[role];
  if (!d) return icon('spark', { size });
  if (d.custom) return icon(d.icon, { size });
  // An app specialist wears the logo of its app
  if (d.app === 'catalog' && d.appId) return craftMark(d.appId, size);
  if (role === 'leader') return markSvg(size, 'mark tool-w');
  if (d.app === 'gridcraft' || d.app === 'wordcraft' || d.app === 'deckcraft' || d.app === 'pdfcraft') return toolMark(d.app, size);
  if (role === 'dev') return icon('code', { size });
  return icon(d.icon, { size });
}
