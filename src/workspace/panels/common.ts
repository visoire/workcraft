// Shared building blocks for panel tools.

import { h, extname } from '../../app/util.js';
import { icon } from '../../app/icons.js';
import { promptText } from '../../app/ui.js';
import { fs } from '../../project/fs.js';
import { TOOLS, type PanelContext } from '../registry.js';
import { t as tr } from '../../app/i18n.js';

export interface BarItem {
  icon?: string;
  label: string;
  text?: string;
  hint?: string;
  id?: string;
  run: (e: MouseEvent, b: HTMLButtonElement) => void;
}

/** Toolbar. '|' = separator, '->' = space to the right. */
export function toolbar(items: (BarItem | '|' | '->' | Node)[]): HTMLElement {
  const bar = h('div.tool-bar', { role: 'toolbar' });
  for (const it of items) {
    if (it === '|') bar.append(h('span.tool-sep', { 'aria-hidden': 'true' }));
    else if (it === '->') bar.append(h('span.spacer'));
    else if (it instanceof Node) bar.append(it);
    else {
      const b = h<'button'>(it.text ? 'button.btn.ghost.tool-btn' : 'button.icon-btn', {
        type: 'button',
        title: it.label + (it.hint ? ` (${it.hint})` : ''),
        'aria-label': it.label,
        html: (it.icon ? icon(it.icon, { size: 16 }) : '') + (it.text ? `<span>${it.text}</span>` : ''),
      });
      if (it.id) b.dataset.cmd = it.id;
      b.onclick = (e) => it.run(e, b);
      bar.append(b);
    }
  }
  return bar;
}

/** Empty state with "New" and matching project files. */
export function emptyState(ctx: PanelContext, o: { create: () => void; newLabel: string }): HTMLElement {
  const t = TOOLS[ctx.tool];
  const files = fs.files().filter((e) => t.exts.includes(extname(e.path)));
  return h(
    'div.tool-empty',
    h(
      'div.frame',
      h(
        'div.well',
        h('p.eyebrow', t.name),
        h('h3.duo', tr('No file') + ' ', h('span.tone', tr('open'))),
        h('p.muted', t.blurb + '. ' + tr('Pick a file from the project or create a new one.')),
        h('div.es-actions', h('button.btn.primary', { type: 'button', onclick: o.create, html: icon('plus', { size: 16 }) + `<span>${o.newLabel}</span>` })),
        files.length
          ? h(
              'div.es-files',
              files.slice(0, 8).map((f) => h('button.es-file', { type: 'button', onclick: () => void ctx.openFile(f.path, ctx.tool) }, h('span', { html: icon(t.icon, { size: 16 }) }), h('span.mono', f.path)))
            )
          : null
      )
    )
  );
}

export async function askPath(suggestion: string, title = tr('New file')): Promise<string | null> {
  const p = await promptText(title, tr('Path in the project'), fs.uniquePath(suggestion), tr('create'));
  if (!p) return null;
  return p.startsWith('/') ? p : '/' + p;
}

/**
 * Browser mode (no desktop backend): a notice instead of the panel for the terminal.
 * Returns an instance when the panel cannot work in the browser, otherwise null.
 */
export async function desktopOnly(el: HTMLElement, ctx: { setStatus(t: string): void }, name: string, what: string): Promise<import('../registry.js').PanelInstance | null> {
  const { backend } = await import('../../app/backend.js');
  if (!backend.browser) return null;
  const { h } = await import('../../app/util.js');
  const { bus } = await import('../../app/bus.js');
  const box = h(
    'div.desk-only',
    h(
      'div.frame.lg',
      h(
        'div.well',
        h('p.eyebrow', name),
        h('h3.duo', tr('Needs the') + ' ', h('span.tone', tr('desktop PC'))),
        h('p.muted', tr('{what} runs on the computer with the WorkCraft backend. On the home network, pair the iPad in the settings under iPad and network.', { what })),
        h('button.btn.primary', { type: 'button', onclick: () => bus.emit('open-settings', 'device') }, tr('Open iPad and network'))
      )
    )
  );
  el.append(box);
  ctx.setStatus(tr('Browser mode'));
  return { unmount: () => box.remove() };
}
