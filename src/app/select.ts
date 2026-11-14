// One dropdown for the whole workspace. Every native <select> gets a button in the style of the project
// switcher and a listbox in the style of the context menus (.ctx-menu); the native element stays in
// the DOM, invisible, and keeps its value, its change events and its role for code and tests.
//
//   installSelects(document)   enhances every select now and whenever one is added
//   enhanceSelect(select)      one element (also in a picture-in-picture window)
//
// Keyboard: Enter, Space, Arrow Down or Up open the list; Arrow keys, Home and End move, typing jumps
// to an entry, Enter picks it, Escape or Tab closes. The list opens below the button, or above it when
// there is more room there, and never leaves the visible area.

import { h } from './util.js';
import { icon } from './icons.js';
import { claimOverlay, releaseOverlay } from './ui.js';

/** Enhanced selects and their wrapper (a re-render may move the select out of it) */
const done = new WeakMap<HTMLSelectElement, HTMLElement>();
const proto = HTMLSelectElement.prototype;
const valueProp = Object.getOwnPropertyDescriptor(proto, 'value')!;
const indexProp = Object.getOwnPropertyDescriptor(proto, 'selectedIndex')!;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Selects that keep their own control (the chat's model and persona pickers already have one). */
const skip = (sel: HTMLSelectElement) => sel.multiple || sel.size > 1 || !!sel.closest('.chat-select-wrap, [data-native-select]') || sel.hasAttribute('data-native');

/** Closes the open dropdown list of this select (set while it is open). Menus and other dropdowns are closed by claimOverlay. */
export function enhanceSelect(sel: HTMLSelectElement): void {
  const known = done.get(sel);
  if (known) {
    // Moved by a re-render: put the wrapper back around it
    if (sel.parentElement !== known && sel.isConnected) {
      sel.replaceWith(known);
      known.append(sel);
    }
    return;
  }
  if (skip(sel)) return;
  const label = sel.getAttribute('aria-label') || sel.closest('label')?.querySelector('span')?.textContent?.trim() || '';
  // The select's own classes (sizes like .tm-shell or .sp-policy) move to the button, .input stays
  const extra = [...sel.classList].filter((c) => c !== 'input');
  const btn = h<'button'>('button.oc-select' + extra.map((c) => '.' + c).join(''), {
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    ...(label ? { 'aria-label': label } : {}),
    ...(sel.title ? { title: sel.title } : {}),
  });
  const wrap = h('span.oc-select-wrap');
  done.set(sel, wrap);
  if (sel.closest('label.field, .field, .sp-grid')) wrap.classList.add('is-block');
  sel.replaceWith(wrap);
  // Button first: a click on the surrounding <label> then opens the list
  wrap.append(btn, sel);
  sel.classList.add('oc-select-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');

  const paint = () => {
    const opt = sel.selectedOptions[0];
    btn.innerHTML = `<span class="oc-select-name">${esc(opt?.textContent?.trim() || '')}</span>` + icon('chevronDown', { size: 12 });
    btn.disabled = sel.disabled;
  };
  // Code that sets .value or .selectedIndex directly fires no event: repaint anyway
  Object.defineProperty(sel, 'value', { configurable: true, get: () => valueProp.get!.call(sel), set: (v: string) => (valueProp.set!.call(sel, v), paint()) });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get: () => indexProp.get!.call(sel), set: (v: number) => (indexProp.set!.call(sel, v), paint()) });
  sel.addEventListener('change', paint);
  sel.addEventListener('input', paint);
  new MutationObserver(paint).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
  paint();

  const pick = (value: string) => {
    if (valueProp.get!.call(sel) !== value) {
      valueProp.set!.call(sel, value);
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    paint();
  };

  let closeMine: (() => void) | null = null;
  function open() {
    const doc = btn.ownerDocument;
    const win = doc.defaultView || window;
    const well = h('div.well.flush');
    const list = h('div.ctx-menu.frame.sm.oc-listbox', { role: 'listbox', 'aria-label': label }, well);
    const items: HTMLButtonElement[] = [];
    const current = valueProp.get!.call(sel);
    const addOption = (o: HTMLOptionElement) => {
      if (o.hidden) return;
      const on = o.value === current;
      const b = h<'button'>('button.ctx-item.oc-option' + (on ? '.is-checked' : ''), {
        type: 'button',
        role: 'option',
        'aria-selected': String(on),
        'data-value': o.value,
        disabled: o.disabled,
        html: `<span>${esc(o.textContent?.trim() || '')}</span><span class="ctx-check" aria-hidden="true">${on ? icon('check', { size: 14 }) : ''}</span>`,
      });
      b.onclick = () => {
        pick(o.value);
        close(true);
      };
      items.push(b);
      well.append(b);
    };
    for (const child of [...sel.children]) {
      if (child instanceof HTMLOptGroupElement) {
        well.append(h('div.ctx-heading.eyebrow', child.label));
        [...child.children].forEach((o) => o instanceof HTMLOptionElement && addOption(o));
      } else if (child instanceof HTMLOptionElement) addOption(child);
    }
    doc.body.append(list);

    // Below the button, or above it when there is more room there; inside the visible area
    const place = () => {
      const a = btn.getBoundingClientRect();
      const vw = win.innerWidth;
      const vh = win.visualViewport?.height || win.innerHeight;
      list.style.minWidth = `${Math.round(a.width)}px`;
      list.style.maxHeight = '';
      const natural = list.getBoundingClientRect();
      const below = vh - a.bottom - 12;
      const above = a.top - 12;
      const up = natural.height > below && above > below;
      list.style.maxHeight = `${Math.max(120, Math.floor(up ? above : below))}px`;
      const r = list.getBoundingClientRect();
      list.style.left = `${Math.max(8, Math.min(a.left, vw - r.width - 8))}px`;
      list.style.top = `${up ? Math.max(8, a.top - r.height - 6) : a.bottom + 6}px`;
    };
    place();
    btn.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
    const enabled = () => items.filter((b) => !b.disabled);
    // The cursor is tracked here, not read from document.activeElement: an app in a panel may take
    // the keyboard focus into its iframe while the list is open
    let cur = -1;
    const focusAt = (i: number) => {
      const opts = enabled();
      if (!opts.length) return;
      cur = (i + opts.length) % opts.length;
      const b = opts[cur]!;
      b.focus({ preventScroll: true });
      b.scrollIntoView({ block: 'nearest' });
    };
    focusAt(Math.max(0, enabled().findIndex((b) => b.dataset.value === current)));

    let typed = '';
    let typedAt = 0;
    const keys = (e: KeyboardEvent) => {
      // Removed from the page by someone else: stop listening, let the key through
      if (!list.isConnected) return close(false);
      const opts = enabled();
      const hovered = opts.indexOf(doc.activeElement as HTMLButtonElement);
      const i = hovered >= 0 ? hovered : cur;
      if (e.key === 'ArrowDown') focusAt(i + 1);
      else if (e.key === 'ArrowUp') focusAt(i - 1);
      else if (e.key === 'Home') focusAt(0);
      else if (e.key === 'End') focusAt(opts.length - 1);
      else if (e.key === 'Escape') close(true);
      else if (e.key === 'Tab') return close(false);
      else if (e.key === 'Enter' || e.key === ' ') {
        if (i >= 0) opts[i]!.click();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typed = Date.now() - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
        typedAt = Date.now();
        const hit = opts.findIndex((b) => (b.textContent || '').trim().toLowerCase().startsWith(typed));
        if (hit >= 0) focusAt(hit);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Only real taps close the list: the apps receive synthetic pointer events (public/craft-theme.js)
    const outside = (e: PointerEvent) => {
      if (e.isTrusted && !list.contains(e.target as Node) && !btn.contains(e.target as Node)) close(false);
    };
    const inFrame = (e: Event) => e.isTrusted && close(false);
    // Layout changes and scrolling move the list with its button; it closes only when the button is gone
    const follow = (e?: Event) => {
      if (e && list.contains(e.target as Node)) return;
      const a = btn.getBoundingClientRect();
      if (!btn.isConnected || a.width === 0 || a.bottom < 0 || a.top > (win.visualViewport?.height || win.innerHeight)) return close(false);
      place();
    };
    // Same-origin frames (the apps in the panels): keys and taps there belong to the open list too
    const frames: Window[] = [];
    for (const f of doc.querySelectorAll('iframe')) {
      try {
        if (f.contentWindow && f.contentWindow.document) frames.push(f.contentWindow);
      } catch {
        /* other origin */
      }
    }
    let closed = false;
    function close(refocus: boolean) {
      if (closed) return;
      closed = true;
      releaseOverlay('list', closer);
      closeMine = null;
      list.remove();
      btn.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
      win.removeEventListener('pointerdown', outside, true);
      win.removeEventListener('keydown', keys, true);
      win.removeEventListener('resize', follow);
      win.removeEventListener('scroll', follow, true);
      for (const fw of frames) {
        try {
          fw.removeEventListener('keydown', keys, true);
          fw.removeEventListener('pointerdown', inFrame, true);
        } catch {
          /* frame gone */
        }
      }
      if (refocus) btn.focus();
    }
    const closer = () => close(false);
    closeMine = closer;
    // Any menu or other dropdown that is open closes now
    claimOverlay('list', closer);
    // Attached at once: the click or key that opened the list has already passed the window, and a
    // key pressed right after opening must reach the list
    win.addEventListener('pointerdown', outside, true);
    win.addEventListener('keydown', keys, true);
    win.addEventListener('resize', follow);
    win.addEventListener('scroll', follow, true);
    for (const fw of frames) {
      try {
        fw.addEventListener('keydown', keys, true);
        fw.addEventListener('pointerdown', inFrame, true);
      } catch {
        /* frame gone */
      }
    }
  }

  btn.addEventListener('click', (e) => {
    // The surrounding <label> would send a second click to its control (this button)
    e.preventDefault();
    if (closeMine) closeMine();
    else open();
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });
}

/** Enhances every select below root, now and when new ones appear (panels, dialogs, popovers). */
export function installSelects(doc: Document = document): () => void {
  const scan = (root: ParentNode) => root.querySelectorAll<HTMLSelectElement>('select').forEach(enhanceSelect);
  scan(doc);
  const mo = new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (n instanceof HTMLSelectElement) enhanceSelect(n);
        else if (n instanceof Element && n.querySelector('select')) scan(n);
      }
  });
  mo.observe(doc.body, { childList: true, subtree: true });
  return () => mo.disconnect();
}
