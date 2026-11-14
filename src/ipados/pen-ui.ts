// Pencil interface parts that need the DOM: the hover circle, the tool feedback chip and the wiring of the
// finger/keyboard rule, the barrel button and the tool state to the settings.
//
// The rules themselves are in pen-input.ts (pure, tested). Events are tracked in src/workspace/pencil.ts.

import { prefs } from '../app/settings.js';
import { icon } from '../app/icons.js';
import { t } from '../app/i18n.js';
import { h } from '../app/util.js';
import { bus } from '../app/bus.js';
import { penTools, onToolChange, pencilSeen, sinceLastPen } from '../workspace/pencil.js';
import { blockFingerKeyboard, ringSpec, type PenTool, type RingKind } from './pen-input.js';
import { setKeyboardPolicy, keyboardBlocked } from './finger-keyboard.js';

// ---------------------------------------------------------------- Hover circle

export interface RingState {
  kind: RingKind;
  /** Base line width of the tool in CSS px */
  width: number;
  /** Magnification of the content (1 = as drawn) */
  zoom?: number;
  color?: string;
  /** Pencil angles in radians (PointerEvent altitudeAngle, azimuthAngle) */
  altitude?: number;
  azimuth?: number;
}

/**
 * The circle that follows a hovering Apple Pencil (iPad Pro and Air with M2 or newer). It shows the real
 * width of the line for the pen, a dashed larger circle for the eraser, and stretches along the tilt.
 * The element is positioned with a transform (no layout) inside a host with position: relative or absolute.
 */
export class HoverRing {
  readonly el: HTMLElement;
  private shown = false;

  constructor(host: HTMLElement, existing?: HTMLElement) {
    this.el = existing || h('div.pen-ring', { hidden: true, 'aria-hidden': 'true' });
    this.el.classList.add('pen-ring');
    if (!existing) host.append(this.el);
  }

  move(x: number, y: number, s: RingState): void {
    const spec = ringSpec(s.kind, s.width, s.zoom ?? 1, s.altitude, s.azimuth);
    const e = this.el;
    if (!this.shown) {
      this.shown = true;
      e.hidden = false;
    }
    e.dataset.kind = s.kind;
    e.classList.toggle('is-dashed', spec.dashed);
    if (s.color) e.style.setProperty('--pen', s.color);
    e.style.width = e.style.height = `${spec.size}px`;
    e.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${spec.rotate.toFixed(0)}deg) scaleX(${spec.stretch.toFixed(2)})`;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.hidden = true;
  }
}

export const ringKindOf = (tool: PenTool, style: string): RingKind => (tool === 'eraser' ? 'eraser' : style === 'highlight' ? 'highlight' : style === 'redact' || style === 'rect' ? 'redact' : 'pen');

// ---------------------------------------------------------------- Feedback chip

let hud: HTMLElement | null = null;
let hudTimer: ReturnType<typeof setTimeout> | undefined;

/** A short chip at the bottom centre: "Eraser", "Pen". Also read out by screen readers (role=status). */
export function penFlash(label: string, iconName: string): void {
  if (!hud) hud = h('div.pen-hud', { role: 'status', 'aria-live': 'polite' });
  // A modal dialog (the PdfCraft pencil view) sits in the top layer above everything: show the chip inside it
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (hud.parentElement !== host) host.append(hud);
  hud.innerHTML = `${icon(iconName, { size: 18 })}<span>${label}</span>`;
  hud.classList.remove('is-on');
  void hud.offsetWidth; // restart the animation
  hud.classList.add('is-on');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hud?.classList.remove('is-on'), 1300);
}

// ---------------------------------------------------------------- Wiring

let installed = false;

export function installPencilUi(): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement;

  // Finger and keyboard: the rule lives in pen-input.ts, the setting is "Finger opens the keyboard"
  setKeyboardPolicy(() => blockFingerKeyboard(prefs.get('fingerTyping'), pencilSeen(), sinceLastPen()));
  const paint = () => root.classList.toggle('pencil-types', keyboardBlocked());
  paint();
  // Judged on every touch, so the class is right before the finger reaches a field (and expires after 15 quiet minutes)
  document.addEventListener('pointerdown', paint, { capture: true, passive: true });

  // Barrel button (and, where the browser reports it as a button, the Apple Pencil Pro squeeze)
  penTools.setBarrel(prefs.get('penBarrel'));
  bus.on('settings:change', ({ key }) => {
    if (key === 'penBarrel') penTools.setBarrel(prefs.get('penBarrel'));
    if (key === 'fingerTyping') paint();
  });

  onToolChange((tool) => {
    root.dataset.penTool = tool;
    penFlash(tool === 'eraser' ? t('Eraser') : t('Pen'), tool === 'eraser' ? 'eraser' : 'pen');
  });
  root.dataset.penTool = penTools.tool;
}
