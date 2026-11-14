// Command palette (Ctrl K or Cmd K): commands, files and MCP tools. Free text goes to the chat.

import { h, modKey } from './util.js';
import { icon } from './icons.js';
import { bus } from './bus.js';
import { fs } from '../project/fs.js';
import { TOOLS, toolForPath, toolMark, type ToolId } from '../workspace/registry.js';
import { workspace } from '../workspace/layout.js';
import { loadedOrchestrator } from '../mcp/lazy.js';
import { allowScribble } from '../workspace/pencil.js';
import { t } from './i18n.js';

export interface Command {
  id: string;
  label: string;
  icon?: string;
  mark?: ToolId;
  hint?: string;
  keywords?: string;
  group?: string;
  mono?: boolean;
  run: () => void;
}

let commands: Command[] = [];
let dlg: HTMLDialogElement | null = null;

export function registerCommands(list: Command[]): void {
  commands = list;
}

function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  const i = t.indexOf(s);
  if (i >= 0) return 100 - i;
  let j = 0;
  for (const ch of t) if (ch === s[j]) j++;
  return j === s.length ? 10 : 0;
}

export function openPalette(initial = ''): void {
  if (dlg?.open) {
    dlg.querySelector('input')?.focus();
    return;
  }
  const input = h<'input'>('input.pal-input', { type: 'text', placeholder: t('Command, file, tool or a question for the AI'), 'aria-label': t('Command palette'), autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list' });
  allowScribble(input);
  input.setAttribute('enterkeyhint', 'go');
  input.value = initial;
  const list = h('div.pal-list', { role: 'listbox', id: 'pal-list' });
  const foot = h('div.pal-foot.mono', h('span', h('kbd', '↑'), h('kbd', '↓'), ' ' + t('select')), h('span', h('kbd', '↵'), ' ' + t('run')), h('span', h('kbd', modKey), h('kbd', '↵'), ' ' + t('to the chat')));
  const box = h('div.frame.lg.pal', h('div.well.flush', h('div.pal-head', h('span', { html: icon('search', { size: 18 }) }), input, h('kbd', 'Esc')), list, foot));
  const d = h<'dialog'>('dialog.modal.pal-dialog', { 'aria-label': t('Command palette') }, box);
  dlg = d;
  document.body.append(d);

  let items: Command[] = [];
  let active = 0;

  function build() {
    const q = input.value.trim();
    const cmd = commands.map((c) => ({ c, s: score(q, c.label + ' ' + (c.keywords || '')) })).filter((x) => x.s > 0);
    const files = q
      ? fs
          .files()
          .map((e) => ({ c: { id: 'file:' + e.path, label: e.path, mark: toolForPath(e.path), group: t('Files'), mono: true, run: () => void workspace.openFile(e.path) } as Command, s: score(q, e.path) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 8)
      : [];
    const tools = q
      ? (loadedOrchestrator()?.tools() || [])
          .map((tool) => ({ c: { id: 'tool:' + tool.name, label: `/${tool.name} · ${tool.title}`, icon: 'slash', group: t('MCP tools'), mono: true, run: () => (bus.emit('chat:insert', `/${tool.name} `), void 0) } as Command, s: score(q, tool.name + ' ' + tool.title) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 6)
      : [];
    items = [...cmd.sort((a, b) => b.s - a.s).slice(0, q ? 8 : 16).map((x) => x.c), ...files.map((x) => x.c), ...tools.map((x) => x.c)];
    if (q) items.push({ id: 'ai', label: t('Ask the AI: {q}', { q }), icon: 'spark', group: t('AI'), run: () => bus.emit('chat:insert', q) });
    active = Math.max(0, Math.min(active, items.length - 1));
    list.replaceChildren();
    let group = '';
    items.forEach((it, i) => {
      const g = it.group || t('Commands');
      if (g !== group) {
        group = g;
        list.append(h('div.pal-group.eyebrow', g));
      }
      const row = h(
        'button.pal-item' + (i === active ? '.is-active' : ''),
        { type: 'button', role: 'option', 'aria-selected': i === active ? 'true' : 'false', id: 'pal-' + i, style: it.mark ? `--tool:${TOOLS[it.mark].accent}` : '' },
        h('span.pal-ic', { html: it.mark ? toolMark(it.mark, 16) : icon(it.icon || 'command', { size: 16 }) }),
        h('span' + (it.mono ? '.mono' : ''), it.label),
        it.hint ? h('kbd', it.hint) : null
      );
      row.onmousemove = () => {
        if (active === i) return;
        active = i;
        paintActive();
      };
      row.onclick = () => exec(it);
      list.append(row);
    });
    input.setAttribute('aria-activedescendant', items.length ? 'pal-' + active : '');
  }
  function paintActive() {
    list.querySelectorAll('.pal-item').forEach((r, i) => {
      r.classList.toggle('is-active', i === active);
      r.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', 'pal-' + active);
  }
  function exec(it: Command | undefined) {
    if (!it) return;
    d.close();
    it.run();
  }
  input.addEventListener('input', () => {
    active = 0;
    build();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % Math.max(1, items.length);
      paintActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + items.length) % Math.max(1, items.length);
      paintActive();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const q = input.value.trim();
      d.close();
      if (q) bus.emit('chat:insert', q);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      exec(items[active]);
    }
  });
  d.addEventListener('close', () => {
    d.remove();
    dlg = null;
  });
  d.addEventListener('click', (e) => e.target === d && d.close());
  build();
  d.showModal();
  input.focus();
  input.select();
}
