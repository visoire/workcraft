// Picture in picture for every panel.
//
// In-workspace floating window: the panel leaves the split layout and floats above the workspace
// (and above Full Chat Mode), freely draggable by its header, resizable at all eight edges and
// corners, snapping to the nearest corner when released close to one. The panel element is never
// moved in the DOM, it only changes its position: app iframes keep their WebAssembly state.
//
// Native picture in picture (Document Picture-in-Picture API, desktop Chrome and Edge): the AI chat
// can move into an always-on-top window of the operating system. That works for the chat because it
// has no iframe; moving an app iframe into another window would restart the app, so the apps use
// the floating window inside WorkCraft.

import { h } from '../app/util.js';
import { capture, guardSurface } from './pencil.js';

export interface PipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PIP_MIN = { w: 280, h: 180 };
const SNAP = 56;
const MARGIN = 12;
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

/** Visible area (follows the on-screen keyboard on iPad through the Visual Viewport API). */
export function viewportBox(): { w: number; h: number; top: number } {
  const vv = window.visualViewport;
  return { w: Math.round(vv?.width || innerWidth), h: Math.round(vv?.height || innerHeight), top: Math.round(vv?.offsetTop || 0) };
}

/** Keeps a window inside the visible area (rotation, Stage Manager, keyboard). */
export function clampRect(r: PipRect, _headH = 38): PipRect {
  const vp = viewportBox();
  const w = Math.min(Math.max(r.w, PIP_MIN.w), vp.w - 2 * MARGIN);
  const hh = Math.min(Math.max(r.h, PIP_MIN.h), vp.h - 2 * MARGIN);
  const x = Math.min(Math.max(r.x, MARGIN), vp.w - w - MARGIN);
  const y = Math.min(Math.max(r.y, vp.top + MARGIN), vp.top + vp.h - hh - MARGIN);
  return { ...r, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
}

/** First position of a new floating window: bottom right, about a third of the screen. */
export function defaultRect(kind: 'app' | 'chat' | 'tool'): PipRect {
  const vp = viewportBox();
  const w = kind === 'chat' ? Math.min(420, vp.w - 24) : Math.min(Math.round(vp.w * 0.36), 640);
  const hh = kind === 'chat' ? Math.min(Math.round(vp.h * 0.7), 640) : Math.min(Math.round(w * 0.68), Math.round(vp.h * 0.6));
  return clampRect({ x: vp.w - w - 20, y: vp.top + vp.h - hh - 20, w, h: hh });
}

/** Snaps to a corner when the window was released close to two edges. */
export function snapRect(r: PipRect): PipRect {
  const vp = viewportBox();
  const nearL = r.x < SNAP;
  const nearR = vp.w - (r.x + r.w) < SNAP;
  const nearT = r.y - vp.top < SNAP;
  const nearB = vp.top + vp.h - (r.y + r.h) < SNAP;
  const out = { ...r };
  if ((nearL || nearR) && (nearT || nearB)) {
    out.x = nearL ? MARGIN : vp.w - r.w - MARGIN;
    out.y = nearT ? vp.top + MARGIN : vp.top + vp.h - r.h - MARGIN;
  }
  return clampRect(out);
}

/**
 * Drag by the header and resize at the edges. get/set read and write the rectangle; end runs after
 * a gesture (save the layout). Works with mouse, finger and Apple Pencil (Pointer Events).
 */
export function attachPip(el: HTMLElement, head: HTMLElement, o: { active: () => boolean; get: () => PipRect | undefined; set: (r: PipRect) => void; end: () => void }): void {
  const frame = h('div.pip-handles', { 'aria-hidden': 'true' });
  for (const d of DIRS) {
    const hd = h('div.pip-h', { 'data-dir': d });
    guardSurface(hd);
    hd.addEventListener('pointerdown', (e) => start(e, d));
    frame.append(hd);
  }
  el.append(frame);
  head.addEventListener('pointerdown', (e) => {
    if (!o.active() || e.button !== 0 || (e.target as Element).closest('button, select, input')) return;
    start(e, 'move');
  });

  function start(e: PointerEvent, mode: (typeof DIRS)[number] | 'move') {
    const r0 = o.get();
    if (!r0 || !o.active()) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    capture(target, e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    document.body.classList.add('is-dragging', 'is-pip-moving');
    el.classList.add('is-pip-active');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      const r = { ...r0 };
      if (mode === 'move') {
        r.x = r0.x + dx;
        r.y = r0.y + dy;
      } else {
        if (mode.includes('e')) r.w = Math.max(PIP_MIN.w, r0.w + dx);
        if (mode.includes('s')) r.h = Math.max(PIP_MIN.h, r0.h + dy);
        if (mode.includes('w')) {
          r.w = Math.max(PIP_MIN.w, r0.w - dx);
          r.x = r0.x + r0.w - r.w;
        }
        if (mode.includes('n')) {
          r.h = Math.max(PIP_MIN.h, r0.h - dy);
          r.y = r0.y + r0.h - r.h;
        }
      }
      o.set(clampRect(r));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-dragging', 'is-pip-moving');
      el.classList.remove('is-pip-active');
      const cur = o.get();
      if (cur && mode === 'move') o.set(snapRect(cur));
      o.end();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }
}

// ---------------------------------------------------------------- Native picture in picture (desktop)

interface DocPip {
  requestWindow(o?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}
const docPip = () => (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture;

export const nativePipSupported = () => !!docPip() && window.isSecureContext;

let nativeWin: Window | null = null;

/**
 * Moves an element without iframes into an operating system window that stays on top.
 * Styles and the color scheme are copied. When the window closes, the element returns to its place.
 */
export async function popOut(el: HTMLElement, o: { width: number; height: number; title: string; onReturn: () => void }): Promise<boolean> {
  const api = docPip();
  if (!api) return false;
  if (nativeWin && !nativeWin.closed) nativeWin.close();
  const parent = el.parentElement!;
  const next = el.nextSibling;
  const win = await api.requestWindow({ width: o.width, height: o.height });
  nativeWin = win;
  const d = win.document;
  d.title = o.title;
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) d.head.append(node.cloneNode(true));
  d.documentElement.className = document.documentElement.className;
  d.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
  d.documentElement.lang = document.documentElement.lang;
  d.body.className = 'pip-native';
  el.classList.add('is-native-pip');
  d.body.append(el);
  // The color scheme follows while the window is open
  const sync = new MutationObserver(() => {
    d.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
  });
  sync.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  win.addEventListener('pagehide', () => {
    sync.disconnect();
    el.classList.remove('is-native-pip');
    if (next && next.parentNode === parent) parent.insertBefore(el, next);
    else parent.append(el);
    nativeWin = null;
    o.onReturn();
  });
  return true;
}

export const nativePipOpen = () => !!nativeWin && !nativeWin.closed;
export function closeNativePip() {
  if (nativeWin && !nativeWin.closed) nativeWin.close();
}
