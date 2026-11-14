// The touch keys bar inside an app panel (rules and key tables: src/ipados/touch-keys.ts). Each button sends the key press a hardware
// keyboard would to the app's canvas, the same way the panel already sends Ctrl/Cmd S to save (craftapp.ts flushUnsaved).
// The idea (buttons that keep the focus on the editor, a Shift latch, a bar that docks at the top or the bottom and folds away) comes
// from the community build "FilmCraft for iPad (unofficial)"; see SOURCES.md.

import { h } from '../app/util.js';
import { bus } from '../app/bus.js';
import { prefs } from '../app/settings.js';
import { device } from '../app/device.js';
import { t as tr } from '../app/i18n.js';
import { icon } from '../app/icons.js';
import { TOOLS, type ToolId } from './registry.js';
import { barShows, isApple, keyInit, profileOf, type TouchKey } from '../ipados/touch-keys.js';

/** A real key from a hardware keyboard was used in this page: the bar steps aside in Auto (until the page is loaded again). */
let hardwareKeyboard = false;
const listeners = new Set<() => void>();

function noteKeydown(e: KeyboardEvent): void {
  // A synthetic press (our own buttons, a script) is not trusted; a modifier alone proves nothing about typing; and while the
  // on-screen keyboard is up (src/app/device.ts measures it) the keys come from the screen, not from a Magic Keyboard
  if (!e.isTrusted || hardwareKeyboard || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || device.info.keyboard > 0) return;
  hardwareKeyboard = true;
  listeners.forEach((f) => f());
}
addEventListener('keydown', noteKeydown, true);

const store = {
  get(k: string): boolean {
    try {
      return !!localStorage.getItem(k);
    } catch {
      return false;
    }
  },
  set(k: string, on: boolean): void {
    try {
      if (on) localStorage.setItem(k, '1');
      else localStorage.removeItem(k);
    } catch {
      /* private window: the bar just forgets its place */
    }
  },
};

export interface TouchKeysHandle {
  /** Watch the keyboard of the app's own window too (a hardware keyboard pressed inside the app). */
  watch(w: Window): void;
  refresh(): void;
  dispose(): void;
}

export function installTouchKeys(root: HTMLElement, tool: ToolId, appWindow: () => (Window & typeof globalThis) | null): TouchKeysHandle | null {
  const profile = profileOf(TOOLS[tool]?.traits?.keys);
  if (!profile) return null;
  const apple = isApple(navigator.platform, navigator.userAgent);
  let shiftLatch: HTMLButtonElement | null = null;

  const row = h('div.ca-keys-row', { role: 'group', 'aria-label': tr('Shortcut keys') });
  const fold = h<'button'>('button.ca-keys-ctl', { type: 'button', tabindex: '-1', title: tr('Hide or show the keys'), 'aria-label': tr('Hide or show the keys'), html: icon('keyboard', { size: 16 }) });
  const dock = h<'button'>('button.ca-keys-ctl', { type: 'button', tabindex: '-1', title: tr('Move the bar to the top or the bottom'), 'aria-label': tr('Move the bar to the top or the bottom'), html: icon('arrowUpDown', { size: 16 }) });
  const bar = h('div.ca-keys', { role: 'toolbar', 'aria-label': tr('Touch keys'), hidden: true }, fold, row, dock);
  bar.classList.toggle('is-min', store.get('wc.touchkeys.min'));
  bar.classList.toggle('is-top', store.get('wc.touchkeys.top'));
  root.append(bar);

  /** The canvas gets the key: the focused element of the app if it is one that takes typing, otherwise its first canvas. */
  function target(W: Window & typeof globalThis): EventTarget | null {
    const a = W.document.activeElement as HTMLElement | null;
    if (a && a !== W.document.body && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return a;
    return W.document.querySelector('canvas') ?? a ?? W.document.body;
  }

  function press(k: TouchKey): void {
    const W = appWindow();
    if (!W) return;
    const to = target(W);
    if (!to) return;
    try {
      (to as HTMLElement).focus?.({ preventScroll: true });
    } catch {
      /* a canvas without tabindex: the event goes to it anyway */
    }
    const init = keyInit(k, { apple, shiftHeld: !!shiftLatch });
    to.dispatchEvent(new W.KeyboardEvent('keydown', init));
    setTimeout(() => to.dispatchEvent(new W.KeyboardEvent('keyup', init)), 40);
    if (shiftLatch) {
      shiftLatch.classList.remove('is-on');
      shiftLatch.setAttribute('aria-pressed', 'false');
      shiftLatch = null;
    }
  }

  /** A button that does not take the focus from the editor (pointerdown), and still works from a keyboard (click without a pointer). */
  function button(label: string, hint: string | undefined, cls: string, run: () => void): HTMLButtonElement {
    const b = h<'button'>('button.ca-key' + cls, { type: 'button', tabindex: '-1', title: hint ? `${label}, ${hint}` : label }, h('span', label), hint ? h('small', hint) : null);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      run();
    });
    b.addEventListener('click', (e) => {
      if (e.detail === 0) run();
    });
    return b;
  }

  for (const item of profile) {
    if (item === 'sep') {
      row.append(h('span.ca-key-sep', { 'aria-hidden': 'true' }));
      continue;
    }
    row.append(button(tr(item.label), item.hint ? tr(item.hint) : undefined, item.kind === 'hot' ? '.is-hot' : '', () => press(item)));
  }
  const shift = button(tr('Shift'), tr('hold'), '.is-latch', () => {
    const on = !shiftLatch;
    shiftLatch = on ? shift : null;
    shift.classList.toggle('is-on', on);
    shift.setAttribute('aria-pressed', String(on));
  });
  shift.setAttribute('aria-pressed', 'false');
  row.append(h('span.ca-key-sep', { 'aria-hidden': 'true' }), shift);

  const keep = (e: Event) => e.preventDefault();
  fold.addEventListener('pointerdown', (e) => {
    keep(e);
    bar.classList.toggle('is-min');
    store.set('wc.touchkeys.min', bar.classList.contains('is-min'));
  });
  dock.addEventListener('pointerdown', (e) => {
    keep(e);
    bar.classList.toggle('is-top');
    store.set('wc.touchkeys.top', bar.classList.contains('is-top'));
  });

  function refresh(): void {
    bar.hidden = !barShows({ pref: prefs.get('touchKeys'), hasProfile: true, touchUi: device.touchUi, hardwareKeyboard });
  }
  listeners.add(refresh);
  const offSettings = bus.on('settings:change', ({ key }) => key === 'touchKeys' && refresh());
  const offDevice = bus.on('device:change', refresh);
  refresh();

  const watched = new WeakSet<Window>();
  return {
    watch(w) {
      if (watched.has(w)) return;
      watched.add(w);
      w.addEventListener('keydown', noteKeydown as EventListener, true);
    },
    refresh,
    dispose() {
      listeners.delete(refresh);
      offSettings?.();
      offDevice?.();
      bar.remove();
    },
  };
}
