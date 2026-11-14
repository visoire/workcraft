// Dialogs and menus in the .frame/.well style.
import { h } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';

export interface DialogField {
  name: string;
  label: string;
  value?: string;
  mono?: boolean;
  type?: string;
  placeholder?: string;
  textarea?: boolean;
}
export interface DialogOptions {
  title: string;
  tone?: string;
  body?: Node | string;
  fields?: DialogField[];
  ok?: string | false;
  cancel?: string;
  danger?: boolean;
  wide?: boolean;
  validate?: (values: Record<string, string>) => string | null;
  onOpen?: (close: () => void) => void;
}

export function dialog(o: DialogOptions): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const form = h<'form'>('form.well', { method: 'dialog' });
    form.append(h('div.dlg-head', h('h3.duo', o.title, ' ', o.tone ? h('span.tone', o.tone) : null)));
    if (o.body) form.append(typeof o.body === 'string' ? h('p.muted.dlg-text', o.body) : o.body);
    const inputs: (HTMLInputElement | HTMLTextAreaElement)[] = [];
    for (const f of o.fields || []) {
      const inp = f.textarea
        ? h<'textarea'>('textarea.input' + (f.mono ? '.mono' : ''), { name: f.name, rows: 8, placeholder: f.placeholder || '', spellcheck: 'false' })
        : h<'input'>('input.input' + (f.mono ? '.mono' : ''), { name: f.name, type: f.type || 'text', placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
      inp.value = f.value || '';
      inputs.push(inp);
      form.append(h('label.field', h('span', f.label), inp));
    }
    const err = h('p.dlg-error', { role: 'alert', hidden: true });
    form.append(err);
    const cancel = h<'button'>('button.btn.ghost', { type: 'button' }, o.cancel || t('Cancel'));
    const ok = o.ok === false ? null : h<'button'>('button.btn' + (o.danger ? '.danger' : '.primary'), { type: 'submit' }, o.ok || 'OK');
    form.append(h('div.dlg-actions', cancel, ok));
    const dlg = h<'dialog'>('dialog.modal' + (o.wide ? '.wide' : ''), h('div.frame.lg', form));
    document.body.append(dlg);
    let result: Record<string, string> | null = null;
    cancel.onclick = () => dlg.close();
    form.onsubmit = (e) => {
      e.preventDefault();
      const values = Object.fromEntries(inputs.map((i) => [i.name, i.value]));
      const problem = o.validate?.(values);
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        return;
      }
      result = o.fields ? values : {};
      dlg.close();
    };
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.showModal();
    o.onOpen?.(() => dlg.close());
    // preventScroll: a tall dialog (the workspace picker) must open at its title, not scrolled down to its last button
    (inputs[0] || ok || cancel).focus({ preventScroll: true });
  });
}

export async function promptText(title: string, label: string, value = '', tone?: string): Promise<string | null> {
  const r = await dialog({ title, tone, fields: [{ name: 'v', label, value, mono: true }] });
  return r ? r.v!.trim() : null;
}

export async function confirmDanger(title: string, text: string, ok = t('Delete')): Promise<boolean> {
  return !!(await dialog({ title, body: text, ok, danger: true }));
}

export interface MenuItem {
  label: string;
  icon?: string;
  html?: string;
  hint?: string;
  /** A second, quieter line under the label (already escaped) */
  desc?: string;
  danger?: boolean;
  /** Shows a check mark (on or off state) */
  checked?: boolean;
  /** Entries of the menu that a right click (or a long press) on this row opens in place of this menu */
  context?: () => MenuEntry[];
  run: () => void;
}
/** An item, a separator ('-') or a small heading above a group */
export type MenuEntry = MenuItem | '-' | { heading: string };

// ---------------------------------------------------------------- One open overlay at a time
// Menus, dropdown lists (select.ts) and cards (popover) register here. Opening one closes the previous one
// properly (its onClose runs, its listeners go), a second tap on the button that opened it closes it, and the
// tap does not reopen it. Two layers: lists (menus and dropdowns) and cards; a card closes everything, a list
// only the previous list, so a dropdown inside a card works.
type OverlayLayer = 'list' | 'card';
const openLayers: Record<OverlayLayer, (() => void) | null> = { list: null, card: null };

export function claimOverlay(layer: OverlayLayer, close: () => void): void {
  if (layer === 'card') {
    const l = openLayers.list;
    openLayers.list = null;
    l?.();
  }
  const prev = openLayers[layer];
  openLayers[layer] = close;
  if (prev && prev !== close) prev();
}
export function releaseOverlay(layer: OverlayLayer, close: () => void): void {
  if (openLayers[layer] === close) openLayers[layer] = null;
}
/** Closes whatever menu, list or card is open. */
export function closeOverlays(): void {
  const c = openLayers.card;
  const l = openLayers.list;
  openLayers.card = openLayers.list = null;
  l?.();
  c?.();
}

const TRIGGER = 'button, [role="button"], [role="tab"], summary, a[href]';
let lastDown: { el: Element | null; at: number } = { el: null, at: 0 };
if (typeof window !== 'undefined') {
  // Only a primary press counts: a right click on a row opens a context menu there, it is not a toggle button
  window.addEventListener('pointerdown', (e) => (lastDown = { el: e.button === 0 && e.target instanceof Element ? e.target.closest(TRIGGER) : null, at: Date.now() }), true);
}
/** The button the user just pressed (a menu opened from its click belongs to it), unless the press is old. */
function recentTrigger(): Element | null {
  return Date.now() - lastDown.at < 1200 && lastDown.el?.isConnected ? lastDown.el : null;
}
/** After a tap on the trigger closed an overlay, the click that follows must not open it again. */
function swallowClickOn(trigger: Element): void {
  const stop = (e: Event) => {
    if (e.target instanceof Node && trigger.contains(e.target)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
    done();
  };
  const done = () => {
    removeEventListener('click', stop, true);
    clearTimeout(timer);
  };
  addEventListener('click', stop, true);
  const timer = setTimeout(done, 500);
}

export function menu(items: MenuEntry[], x: number, y: number, opt: { alignRight?: boolean; /** Place the menu above the anchor, whatever its height */ above?: boolean; /** The button that opened the menu: a second tap on it closes the menu (it does not reopen) */ anchor?: HTMLElement; onClose?: () => void } = {}): () => void {
  const trigger: Element | null = opt.anchor || recentTrigger();
  const well = h('div.well.flush');
  // Menus with check marks reserve the check column in every row, so the shortcuts line up
  const hasCheck = items.some((i) => i !== '-' && !('heading' in i) && i.checked !== undefined);
  const list = h('div.ctx-menu.frame.sm' + (hasCheck ? '.has-check' : ''), { role: 'menu' }, well);
  for (const it of items) {
    if (it === '-') {
      well.append(h('hr'));
      continue;
    }
    if ('heading' in it) {
      well.append(h('div.ctx-heading.eyebrow', it.heading));
      continue;
    }
    const check = it.checked === undefined ? '' : `<span class="ctx-check" aria-hidden="true">${it.checked ? icon('check', { size: 14 }) : ''}</span>`;
    const b = h<'button'>('button.ctx-item' + (it.danger ? '.danger' : '') + (it.checked ? '.is-checked' : '') + (it.desc ? '.has-desc' : ''), {
      role: it.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
      ...(it.checked === undefined ? {} : { 'aria-checked': String(it.checked) }),
      type: 'button',
      html: (it.html || (it.icon ? icon(it.icon, { size: 16 }) : '<i class="ctx-ic"></i>')) + `<span>${it.label}${it.desc ? `<small class="ctx-desc">${it.desc}</small>` : ''}</span>` + (it.hint ? `<kbd>${it.hint}</kbd>` : '') + check,
    });
    b.onclick = () => {
      close();
      it.run();
    };
    if (it.context) {
      const ctx = it.context;
      b.title = t('Right-click for more');
      b.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        close();
        menu(ctx(), ev.clientX, ev.clientY);
      });
    }
    well.append(b);
  }
  document.body.append(list);
  const r = list.getBoundingClientRect();
  if (opt.alignRight) x -= r.width;
  // Above the button that opened it (the prompt bar sits at the bottom of the panel)
  if (opt.above && opt.anchor) y = opt.anchor.getBoundingClientRect().top - r.height - 6;
  list.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  list.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  list.querySelector('button')?.focus();
  if (trigger?.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-expanded', 'true');
  const outside = (e: PointerEvent) => {
    if (list.contains(e.target as Node)) return;
    // A tap on the button that opened the menu closes it, and the click that follows is dropped
    if (trigger?.contains(e.target as Node) && e.button === 0) swallowClickOn(trigger);
    close();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const bs = [...list.querySelectorAll('button')];
      const i = bs.indexOf(document.activeElement as HTMLButtonElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus();
      e.preventDefault();
    }
  };
  function close() {
    if (closed) return;
    closed = true;
    list.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', keys, true);
    releaseOverlay('list', close);
    if (trigger?.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-expanded', 'false');
    opt.onClose?.();
  }
  let closed = false;
  // Closes the menu that was open before (its onClose runs); from here on this one is the open list
  claimOverlay('list', close);
  setTimeout(() => {
    if (closed) return;
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', keys, true);
  });
  return close;
}

/**
 * Small card anchored below a button (usage of the chat, for example). Closes on a tap outside,
 * on Escape and when the anchor's window closes. Uses the anchor's document, so it also works in a
 * native picture-in-picture window.
 */
let cardAnchor: HTMLElement | null = null;
export function popover(anchor: HTMLElement, content: Node, opt: { width?: number; label?: string } = {}): () => void {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView || window;
  // The same button again: the card closes (it does not reopen)
  if (openLayers.card && cardAnchor === anchor) {
    const c = openLayers.card;
    openLayers.card = null;
    c();
    return () => {};
  }
  const card = h('div.pop-card.frame.sm', { role: 'dialog', 'aria-label': opt.label || '' }, h('div.well', content));
  if (opt.width) card.style.width = `${opt.width}px`;
  doc.body.append(card);
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const vw = win.innerWidth;
    const vh = win.visualViewport?.height || win.innerHeight;
    card.style.left = `${Math.max(8, Math.min(a.right - r.width, vw - r.width - 8))}px`;
    const below = a.bottom + 6;
    card.style.top = `${below + r.height > vh - 8 ? Math.max(8, a.top - r.height - 6) : below}px`;
  };
  place();
  const outside = (e: PointerEvent) => {
    const target = e.target as Node;
    if (card.contains(target) || anchor.contains(target)) return;
    // A dropdown opened from inside the card lives on the page body: picking from it is not "outside"
    if (target instanceof Element && target.closest('.oc-listbox, .ctx-menu')) return;
    close();
  };
  // Escape closes the dropdown first (select.ts), the card only when no list is open
  const keys = (e: KeyboardEvent) => e.key === 'Escape' && !doc.querySelector('.oc-listbox') && close();
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    card.remove();
    win.removeEventListener('pointerdown', outside, true);
    win.removeEventListener('keydown', keys, true);
    win.removeEventListener('resize', place);
    releaseOverlay('card', close);
    if (cardAnchor === anchor) cardAnchor = null;
  }
  claimOverlay('card', close);
  cardAnchor = anchor;
  setTimeout(() => {
    if (closed) return;
    win.addEventListener('pointerdown', outside, true);
    win.addEventListener('keydown', keys, true);
    win.addEventListener('resize', place);
  });
  return close;
}
