// Device detection for iPadOS, touch, Apple Pencil, Magic Keyboard and window modes.
//
// Safari on the iPad reports itself as a macOS desktop by default, so version numbers in the
// user agent are worthless. The detection relies on hardware features only:
//   navigator.maxTouchPoints > 1          multi-touch screen (Macs have none)
//   (pointer: coarse), (any-pointer: coarse)  finger as the input device
//   (any-pointer: fine), (any-hover: hover)   Apple Pencil (hover), trackpad or mouse
//   window.visualViewport                  visible area, on-screen keyboard, zoom
//
// The module sets classes and CSS variables on <html> and reports changes on the bus
// (rotation, Stage Manager, Split View, Slide Over, on-screen keyboard, Magic Keyboard attached or not).

import { bus } from './bus.js';

export type WindowMode = 'full' | 'stage' | 'split' | 'slide';

export interface DeviceInfo {
  /** iPadOS (also with the desktop identifier of Safari) */
  ipad: boolean;
  /** Touch-Bildschirm vorhanden (iPad, Android-Tablet, Windows-Touch) */
  touch: boolean;
  /** The primary pointer is a finger */
  coarse: boolean;
  /** Any precise pointer available (Apple Pencil, trackpad, mouse) */
  fine: boolean;
  /** Any pointer can hover (Pencil hover from M2, trackpad, mouse) */
  hover: boolean;
  /** Real device pixel ratio */
  dpr: number;
  /** Pixel ratio for drawing surfaces, capped at 2 (WebKit memory limits) */
  renderDpr: number;
  orientation: 'portrait' | 'landscape';
  windowMode: WindowMode;
  /** Started as a web app from the Home Screen */
  standalone: boolean;
  /** Secure context (HTTPS or localhost): needed for WebGPU and service workers */
  secure: boolean;
  webgpu: boolean;
  viewport: { width: number; height: number; offsetTop: number; offsetLeft: number; scale: number };
  /** Height covered by the on-screen keyboard in CSS pixels */
  keyboard: number;
}

const mq = (q: string) => (typeof matchMedia === 'function' ? matchMedia(q) : null);
const QUERIES = {
  coarse: mq('(pointer: coarse)'),
  anyCoarse: mq('(any-pointer: coarse)'),
  anyFine: mq('(any-pointer: fine)'),
  anyHover: mq('(any-hover: hover)'),
  standalone: mq('(display-mode: standalone)'),
  portrait: mq('(orientation: portrait)'),
};

function platformName(): string {
  const n = navigator as Navigator & { userAgentData?: { platform?: string } };
  return n.userAgentData?.platform || n.platform || '';
}

/**
 * iPadOS detection without version numbers: a device with a multi-touch screen that reports
 * itself as a Mac or an iPad. Macs have no touch screen, so maxTouchPoints above 1 on the
 * Mac platform is clearly an iPad with desktop-class Safari.
 */
export function isIPadOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const touchPoints = navigator.maxTouchPoints || 0;
  if (touchPoints <= 1) return false;
  const plat = platformName();
  const appleish = /^(MacIntel|Mac|macOS|iPad)/i.test(plat) || /iPad/.test(plat);
  const coarse = !!(QUERIES.anyCoarse?.matches || QUERIES.coarse?.matches);
  return appleish && (coarse || 'ontouchend' in document);
}

let lastKeyboard = 0;

function windowMode(w: number, h: number, landscape: boolean): WindowMode {
  // screen.width stays the portrait width on iPadOS in both orientations.
  const long = Math.max(screen.width || w, screen.height || h);
  const short = Math.min(screen.width || w, screen.height || h);
  const fullW = landscape ? long : short;
  const fullH = landscape ? short : long;
  const rw = w / fullW;
  const rh = h / fullH;
  if (w <= 420) return 'slide';
  if (rw >= 0.97) return 'full';
  // Split View: full height, split width. Stage Manager: freely sized windows.
  return rh >= 0.86 ? 'split' : 'stage';
}

export function readDevice(): DeviceInfo {
  const vv = window.visualViewport;
  const width = vv?.width ?? innerWidth;
  const height = vv?.height ?? innerHeight;
  const offsetTop = vv?.offsetTop ?? 0;
  const offsetLeft = vv?.offsetLeft ?? 0;
  const scale = vv?.scale ?? 1;
  // Keyboard: the layout viewport stays, the visible area shrinks. With zoom (scale > 1)
  // it shrinks too, that is not a keyboard.
  const keyboard = scale > 1.01 ? lastKeyboard : Math.max(0, Math.round(innerHeight - height - offsetTop));
  lastKeyboard = keyboard;
  const landscape = QUERIES.portrait ? !QUERIES.portrait.matches : innerWidth >= innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const touch = (navigator.maxTouchPoints || 0) > 0 || !!QUERIES.anyCoarse?.matches;
  const nav = navigator as Navigator & { standalone?: boolean; gpu?: unknown };
  return {
    ipad: isIPadOS(),
    touch,
    coarse: !!QUERIES.coarse?.matches,
    fine: !!QUERIES.anyFine?.matches,
    hover: !!QUERIES.anyHover?.matches,
    dpr,
    renderDpr: Math.min(2, dpr),
    orientation: landscape ? 'landscape' : 'portrait',
    windowMode: windowMode(innerWidth, innerHeight, landscape),
    standalone: !!(QUERIES.standalone?.matches || nav.standalone),
    secure: !!window.isSecureContext,
    webgpu: !!window.isSecureContext && !!nav.gpu,
    viewport: { width, height, offsetTop, offsetLeft, scale },
    keyboard: keyboard > 80 ? keyboard : 0,
  };
}

let current: DeviceInfo | null = null;
let installed = false;
let raf = 0;

function apply(info: DeviceInfo) {
  const root = document.documentElement;
  const c = root.classList;
  c.toggle('is-ipad', info.ipad);
  c.toggle('is-touch', info.touch);
  c.toggle('has-fine-pointer', info.fine);
  c.toggle('has-hover', info.hover);
  c.toggle('is-standalone', info.standalone);
  c.toggle('is-portrait', info.orientation === 'portrait');
  c.toggle('kb-open', info.keyboard > 0);
  for (const m of ['full', 'stage', 'split', 'slide'] as const) c.toggle('wm-' + m, info.windowMode === m);
  const s = root.style;
  s.setProperty('--vvw', `${Math.round(info.viewport.width)}px`);
  s.setProperty('--vvh', `${Math.round(info.viewport.height)}px`);
  s.setProperty('--vv-top', `${Math.round(info.viewport.offsetTop)}px`);
  s.setProperty('--kb', `${info.keyboard}px`);
  s.setProperty('--dpr', String(info.renderDpr));
  // For embedded apps (iframes of the same origin): one pixel ratio
  (window as unknown as { __workcraftDpr: number }).__workcraftDpr = info.renderDpr;
}

function changed(a: DeviceInfo | null, b: DeviceInfo): boolean {
  if (!a) return true;
  return (
    a.ipad !== b.ipad ||
    a.touch !== b.touch ||
    a.fine !== b.fine ||
    a.hover !== b.hover ||
    a.dpr !== b.dpr ||
    a.orientation !== b.orientation ||
    a.windowMode !== b.windowMode ||
    a.keyboard !== b.keyboard ||
    Math.abs(a.viewport.width - b.viewport.width) >= 1 ||
    Math.abs(a.viewport.height - b.viewport.height) >= 1 ||
    Math.abs(a.viewport.offsetTop - b.viewport.offsetTop) >= 1
  );
}

function update() {
  raf = 0;
  const next = readDevice();
  const diff = changed(current, next);
  current = next;
  apply(next);
  if (diff) bus.emit('device:change', next);
}

const schedule = () => {
  if (!raf) raf = requestAnimationFrame(update);
};

/** Starts watching. Calling it more than once is harmless. */
export function installDevice(): DeviceInfo {
  if (!installed) {
    installed = true;
    addEventListener('resize', schedule);
    addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    screen.orientation?.addEventListener?.('change', schedule);
    // Magic Keyboard with trackpad attached or detached, Pencil connected: media queries change
    for (const q of Object.values(QUERIES)) q?.addEventListener?.('change', schedule);
    watchDpr();
    // Safari pushes the layout viewport up when an input gets focus.
    // The workspace is fixed in place, so push it back.
    addEventListener('focusin', () => setTimeout(schedule, 50));
    addEventListener('focusout', () => setTimeout(schedule, 50));
  }
  update();
  return current!;
}

function watchDpr() {
  const q = mq(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  q?.addEventListener?.(
    'change',
    () => {
      schedule();
      watchDpr();
    },
    { once: true }
  );
}

export const device = {
  get info(): DeviceInfo {
    return current || readDevice();
  },
  /** Touch interface: larger targets, visible quick buttons instead of keyboard shortcuts */
  get touchUi(): boolean {
    const i = this.info;
    return i.ipad || i.touch;
  },
  /**
   * Compact width: the side bars become drawers over the stage. Slide Over, Split View 1/3 and narrow Stage Manager
   * windows (below 700 px), and every touch device below 900 px (iPad in portrait: a tree, two panels and a chat
   * side by side leave each of them about 150 px).
   */
  get compact(): boolean {
    const i = this.info;
    return i.viewport.width < 700 || (i.touch && i.viewport.width < 900);
  },
};

if (typeof window !== 'undefined') (window as unknown as { __workcraftDevice: typeof device }).__workcraftDevice = device;
