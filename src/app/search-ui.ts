// Project search (the search button in the top bar, /find, the command palette): full-text and semantic search
// across all files and chats of the project, with the place of every hit (page, slide, sheet
// rows). Enter opens the file in its app.

import { h, debounce } from './util.js';
import { icon } from './icons.js';
import { api } from './backend.js';
import { t, tn } from './i18n.js';
import { hitRow } from '../workspace/panels/settings-extra.js';

interface Hit {
  source: string;
  kind: string;
  loc: string;
  snippet: string;
  score: number;
}

let open: HTMLDialogElement | null = null;

export function openSearch(initial = ''): void {
  if (open) {
    open.querySelector<HTMLInputElement>('input')?.focus();
    return;
  }
  let mode: 'hybrid' | 'text' | 'semantic' = 'hybrid';
  let kind = '';
  let seq = 0;
  let sel = 0;
  const input = h<'input'>('input.input.gs-input', { type: 'search', value: initial, placeholder: t('Search all files and chats, for example: the part with the revenue forecast'), 'aria-label': t('Search the project'), autocomplete: 'off', spellcheck: 'false' });
  const info = h('small.muted.gs-info');
  const list = h('div.gs-list', { role: 'listbox', 'aria-label': t('Results') });
  const seg = <T extends string>(items: [T, string][], get: () => T, set: (v: T) => void, label: string) => {
    const el = h('div.seg', { role: 'group', 'aria-label': label });
    const paint = () => el.replaceChildren(...items.map(([v, l]) => h('button.seg-btn', { type: 'button', 'aria-pressed': String(get() === v), 'data-value': v, onclick: () => (set(v), paint(), run()) }, l)));
    paint();
    return el;
  };
  const modes = seg<'hybrid' | 'text' | 'semantic'>(
    [
      ['hybrid', t('Smart')],
      ['text', t('Exact words')],
      ['semantic', t('By meaning')],
    ],
    () => mode,
    (v) => (mode = v),
    t('Search mode')
  );
  const kinds = seg<string>(
    [
      ['', t('All')],
      ['document', 'WordCraft'],
      ['sheet', 'GridCraft'],
      ['presentation', 'DeckCraft'],
      ['pdf', 'PdfCraft'],
      ['code', t('Code')],
      ['chat', t('Chats')],
    ],
    () => kind,
    (v) => (kind = v),
    t('Type')
  );
  const close = () => dlg.close();
  const paintSel = () => [...list.children].forEach((c, i) => c.classList.toggle('is-sel', i === sel));
  const run = debounce(async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) {
      list.replaceChildren(h('p.muted.gs-empty', t('Type at least two characters.')));
      info.textContent = '';
      return;
    }
    info.textContent = t('Searching …');
    try {
      const r = await api.get<{ hits: Hit[]; mode: string; semantic: boolean; error?: string; ms?: number }>(`/api/search?q=${encodeURIComponent(q)}&mode=${mode}&limit=30${kind ? `&kinds=${kind}` : ''}`);
      if (my !== seq) return;
      sel = 0;
      list.replaceChildren(...(r.hits.length ? r.hits.map((hit) => hitRow(hit, close)) : [h('p.muted.gs-empty', t('No matches.'))]));
      paintSel();
      info.textContent = `${tn(r.hits.length, '{n} hit', '{n} hits')}${r.ms !== undefined ? ` · ${r.ms} ms` : ''} · ${r.semantic ? t('with embeddings') : t('full text')}${r.error ? ` · ${r.error}` : ''}`;
    } catch (e) {
      if (my === seq) info.textContent = (e as Error).message;
    }
  }, 220);
  input.oninput = () => run();
  input.onkeydown = (e) => {
    const n = list.children.length;
    if (e.key === 'ArrowDown') (sel = Math.min(n - 1, sel + 1)), paintSel(), e.preventDefault();
    else if (e.key === 'ArrowUp') (sel = Math.max(0, sel - 1)), paintSel(), e.preventDefault();
    else if (e.key === 'Enter') (list.children[sel] as HTMLElement | undefined)?.click();
  };
  const dlg = h<'dialog'>(
    'dialog.modal.wide.gs',
    { 'aria-label': t('Search the project') },
    h('div.frame.lg', h('div.well', h('div.gs-head', h('span', { html: icon('search', { size: 18 }) }), input, h('button.icon-btn', { type: 'button', 'aria-label': t('Close'), html: icon('close', { size: 16 }), onclick: close })), h('div.gs-filters', modes, kinds), info, list))
  );
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  // An app that finishes loading in the background may pull the focus into its iframe: keep it here
  const keepFocus = () => setTimeout(() => open === dlg && !dlg.contains(document.activeElement) && input.focus(), 0);
  addEventListener('blur', keepFocus);
  dlg.addEventListener('close', () => {
    removeEventListener('blur', keepFocus);
    dlg.remove();
    open = null;
  });
  document.body.append(dlg);
  open = dlg;
  dlg.showModal();
  input.focus();
  if (initial) run();
  else list.replaceChildren(h('p.muted.gs-empty', t('Searches Word, Excel, PowerPoint, PDF, Markdown, code and the chats of this project.')));
}
