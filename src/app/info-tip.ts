// The (i) icon: a short label stays on the page, the long explanation sits behind the icon (hover, keyboard
// focus or tap). One tooltip element for the whole page; it opens on a pointer hover, on focus, and a click or
// tap pins it until the next tap elsewhere or Escape.
//
//   infoTip(text | element)       the button; an element is read when the tip opens (live notes stay current)
//   condenseHints(root)           Settings: turns the long grey lines under a field or a switch into (i) icons
//   statusChip(state, label)      a short status with an icon: key missing, local, ready ...

import { h } from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

let pop: HTMLElement | null = null;
let popFor: HTMLElement | null = null;
let pinned = false;
let wired = false;

function hide() {
  pop?.remove();
  pop = null;
  popFor?.setAttribute('aria-expanded', 'false');
  popFor = null;
  pinned = false;
}

function show(btn: HTMLElement, text: string) {
  if (!text) return;
  hide();
  const doc = btn.ownerDocument;
  const win = doc.defaultView || window;
  pop = h('div.info-pop', { role: 'tooltip', id: 'oc-info-pop' }, text);
  doc.body.append(pop);
  popFor = btn;
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'oc-info-pop');
  const a = btn.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  const vw = win.innerWidth;
  const vh = win.visualViewport?.height || win.innerHeight;
  const left = Math.max(8, Math.min(a.left + a.width / 2 - r.width / 2, vw - r.width - 8));
  const below = a.bottom + 8;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(below + r.height > vh - 8 ? Math.max(8, a.top - r.height - 8) : below)}px`;
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (pop && !(popFor && popFor.contains(e.target as Node))) hide();
    },
    true
  );
  window.addEventListener('keydown', (e) => e.key === 'Escape' && pop && hide(), true);
  window.addEventListener('scroll', () => pop && !pinned && hide(), true);
}

export function infoTip(source: string | HTMLElement, label = t('More information')): HTMLButtonElement {
  wire();
  const read = () => (typeof source === 'string' ? source : source.textContent || '').trim();
  const btn = h<'button'>('button.info-tip', { type: 'button', 'aria-label': label, 'aria-expanded': 'false', html: icon('info', { size: 14 }) });
  btn.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && !pinned && show(btn, read()));
  btn.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && !pinned && popFor === btn && hide());
  btn.addEventListener('focus', () => !pinned && show(btn, read()));
  btn.addEventListener('blur', () => !pinned && popFor === btn && hide());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pop && popFor === btn && pinned) return hide();
    show(btn, read());
    pinned = true;
  });
  return btn;
}

/** Short status with an icon in front (or icon-only when meaning is obvious, e.g. key/cpu/lock). state: ok, local, warn, off. */
export function statusChip(state: 'ok' | 'local' | 'warn' | 'off', label: string, ic: string, title?: string, iconOnly = ic === 'key' || ic === 'lock'): HTMLElement {
  return h(
    'span.status-chip' + (iconOnly ? '.is-icon-only' : ''),
    { 'data-state': state, title: title || label, 'aria-label': title || label },
    h('span.status-ic', { 'aria-hidden': 'true', html: icon(ic, { size: 13 }) }),
    h('span' + (iconOnly ? '.sr-only' : ''), label)
  );
}

const clean = (s: string) => s.trim().replace(/^\((.*)\)$/s, '$1');

/**
 * Settings read better with one short label per control. A grey explanation under a field, or after the label of
 * a switch, moves behind an (i) icon next to the label. Lines that carry a state or an error stay (data-keep, or
 * the sp-err and upd-* classes).
 */
export function condenseHints(root: ParentNode): void {
  const keep = (s: Element) => s.hasAttribute('data-keep') || s.closest('[data-keep]') || s.classList.contains('sp-err');
  root.querySelectorAll<HTMLElement>('.field').forEach((f) => {
    const hint = [...f.children].find((c): c is HTMLElement => c.tagName === 'SMALL' && !(c as HTMLElement).hidden && !keep(c));
    const label = [...f.children].find((c) => c.tagName === 'SPAN');
    if (!hint || !label || !hint.textContent?.trim()) return;
    label.append(' ', infoTip(hint));
    hint.hidden = true;
  });
  root.querySelectorAll<HTMLElement>('label.switch:not(.upd-switch) > span').forEach((s) => {
    const hint = [...s.children].find((c): c is HTMLElement => c.tagName === 'SMALL' && !keep(c));
    if (!hint || !hint.textContent?.trim()) return;
    const text = clean(hint.textContent);
    hint.replaceWith(infoTip(text));
  });
}
