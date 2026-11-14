// The Recent files list as DOM: used by the launcher (src/ecosystems/ui.ts) and by the empty stage of the window
// manager. It only reads (recent.ts, the project mirror) and calls back; it never opens a panel itself, so it can be
// imported from the layout code without a cycle.

import { h, basename, dirname } from '../app/util.js';
import { t as tr, lang } from '../app/i18n.js';
import { fs } from '../project/fs.js';
import { TOOLS, toolMark, type ToolId } from '../workspace/registry.js';
import { loadRecent, recentFor, type RecentEntry } from './recent.js';

const rel = () => new Intl.RelativeTimeFormat(lang === 'de' ? 'de' : 'en', { numeric: 'auto' });

/** "5 minutes ago", "yesterday", then a date. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  const f = rel();
  if (s < 60) return f.format(0, 'second');
  if (s < 3600) return f.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return f.format(-Math.floor(s / 3600), 'hour');
  if (s < 86400 * 7) return f.format(-Math.floor(s / 86400), 'day');
  return new Date(at).toLocaleDateString(lang === 'de' ? 'de' : 'en', { month: 'short', day: 'numeric' });
}

/** Entries of the open project that still exist and whose tool can run here (an app without a web build is left out). */
export function recentEntries(project: string, limit = 8): RecentEntry[] {
  return recentFor(loadRecent(), project, (p) => fs.exists(p), limit * 2)
    .filter((e) => {
      const t = TOOLS[e.tool as ToolId];
      return !!t && (t.kind !== 'app' || t.available);
    })
    .slice(0, limit);
}

export function recentList(project: string, open: (e: RecentEntry) => void, limit = 8): HTMLElement | null {
  const entries = recentEntries(project, limit);
  if (!entries.length) return null;
  return h(
    'div.recent',
    h('p.eyebrow', tr('Recent files')),
    h(
      'div.recent-list',
      { role: 'list' },
      ...entries.map((e) => {
        const t = TOOLS[e.tool as ToolId]!;
        const dir = dirname(e.path);
        return h(
          'button.recent-item',
          { type: 'button', role: 'listitem', style: `--tool:${t.accent}`, title: e.path, onclick: () => open(e) },
          h('span.recent-mark', { html: toolMark(t.id, 20) }),
          h('span.recent-name', h('strong', basename(e.path)), h('small.mono.muted', `${t.name}${dir && dir !== '/' ? ' · ' + dir : ''}`)),
          h('span.recent-when.mono.muted', ago(e.at))
        );
      })
    )
  );
}
