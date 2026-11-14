// Apple Pencil, finger and mouse (Pointer Events Level 3).
//
// - inputKind(): strict distinction by event.pointerType (pen, touch, mouse)
// - sample(): pressure, tilt (tiltX, tiltY, altitudeAngle, azimuthAngle), rotation
//   (twist, barrel roll on the Apple Pencil Pro) and hover (before touching down)
// - guardSurface(): drag bars, drawing surfaces and grips without scrolling, text selection and
//   Scribble handwriting recognition, with palm rejection (a finger does not count while the pencil
//   writes)
// - allowScribble(): inputs where Scribble turns handwriting into text
// - onDoubleTap(): double tap with finger or pencil
// - InkLayer: pressure-sensitive strokes (signature, freehand, highlighter, redaction, frame)
// - bridgeFrame(): bridge into the WebAssembly apps. There the pencil works like a precise mouse
//   (select, drag, place, reshape), the finger pans and zooms (scroll events),
//   a short finger tap stays a click, a long press opens the context menu.

import { pen as penCal } from '../ipados/pen-calibration.js';
import { isPalm, strokesHitBy, PenToolState, type PenContext, type PenTool, type TouchInfo } from '../ipados/pen-input.js';
import { installFingerKeyboardGuard } from '../ipados/finger-keyboard.js';

export type InputKind = 'pen' | 'touch' | 'mouse';

export interface PenSample {
  kind: InputKind;
  x: number;
  y: number;
  /** 0 to 1. 0 while hovering. A mouse with a pressed button reports 0.5. */
  pressure: number;
  /** -90 to 90 degrees */
  tiltX: number;
  tiltY: number;
  /** 0 to 359 degrees (barrel roll of the Apple Pencil Pro) */
  twist: number;
  /** 0 (flat) to PI/2 (upright) */
  altitude: number;
  /** 0 to 2 PI */
  azimuth: number;
  /** The pencil hovers above the display (hover preview) */
  hover: boolean;
  t: number;
}

export function inputKind(e: PointerEvent): InputKind {
  return e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
}

const RAD = Math.PI / 180;

/** Altitude and azimuth angle from tiltX/tiltY (conversion from Pointer Events Level 3). */
export function anglesFromTilt(tiltX: number, tiltY: number): { altitude: number; azimuth: number } {
  if (!tiltX && !tiltY) return { altitude: Math.PI / 2, azimuth: 0 };
  const tx = Math.tan(tiltX * RAD);
  const ty = Math.tan(tiltY * RAD);
  let azimuth = Math.atan2(ty, tx);
  if (azimuth < 0) azimuth += 2 * Math.PI;
  const altitude = Math.atan(1 / Math.sqrt(tx * tx + ty * ty));
  return { altitude, azimuth };
}

/** The pencil hovers: a pointer of type pen without contact. */
export const isPenHover = (e: PointerEvent) => e.pointerType === 'pen' && e.buttons === 0 && (e.pressure || 0) === 0;

export function sample(e: PointerEvent): PenSample {
  const kind = inputKind(e);
  const ext = e as PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };
  const tiltX = e.tiltX || 0;
  const tiltY = e.tiltY || 0;
  const fromTilt = anglesFromTilt(tiltX, tiltY);
  const hover = kind === 'pen' ? isPenHover(e) : kind === 'mouse' ? e.buttons === 0 : false;
  let pressure = e.pressure || 0;
  if (kind !== 'pen' && !hover && !pressure) pressure = 0.5;
  // The pen's own evidence decides: a pen that always reports 0.5 (Apple Pencil USB-C, Logitech Crayon)
  // gets a pressure simulated from its speed, so strokes are not one flat width (src/ipados/pen-calibration.ts)
  if (kind === 'pen') pressure = penCal.observe({ pressure: e.pressure || 0, twist: e.twist || 0, contact: !hover, x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now() });
  return {
    kind,
    x: e.clientX,
    y: e.clientY,
    pressure: hover ? 0 : pressure,
    tiltX,
    tiltY,
    twist: e.twist || 0,
    altitude: typeof ext.altitudeAngle === 'number' ? ext.altitudeAngle : fromTilt.altitude,
    azimuth: typeof ext.azimuthAngle === 'number' ? ext.azimuthAngle : fromTilt.azimuth,
    hover,
    t: e.timeStamp || performance.now(),
  };
}

/** All intermediate points of an event (up to 240 Hz with the Apple Pencil, 120 Hz ProMotion). */
export function coalesced(e: PointerEvent): PointerEvent[] {
  const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  return list.length ? list : [e];
}

/** Capture the pointer. Does not throw when the pointer has already ended (quick taps, tests). */
export function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointer no longer active */
  }
}

// ---------------------------------------------------------------- Last used input device

let penDownCount = 0;
let penSeenAt = 0;
let penLiftedAt = -Infinity;
let penEverUsed = false;
let tracking = false;
/** Last pen position and the document it was seen in (a frame has its own coordinate space) */
let penHover: { x: number; y: number; t: number; doc: Document } | null = null;

/** Pen and eraser, shared by every surface. Barrel button and eraser end switch it for one stroke. */
export const penTools = new PenToolState((tool, why) => {
  for (const fn of toolListeners) fn(tool, why);
});
type ToolListener = (tool: PenTool, why: 'manual' | 'barrel' | 'eraser-end' | 'toggle' | 'release') => void;
const toolListeners = new Set<ToolListener>();
/** Listen for tool changes (feedback, toolbar state). Returns the unsubscribe function. */
export function onToolChange(fn: ToolListener): () => void {
  toolListeners.add(fn);
  return () => toolListeners.delete(fn);
}

/** Remembers globally whether the pencil is writing or hovering (palm rejection, tool switching). */
export function trackInput(root: Document = document): void {
  if (tracking && root === document) return;
  if (root === document) tracking = true;
  const html = root.documentElement;
  const note = (e: PointerEvent) => {
    const k = inputKind(e);
    if (html.dataset.input !== k) html.dataset.input = k;
    if (k === 'pen') {
      penSeenAt = performance.now();
      penHover = { x: e.clientX, y: e.clientY, t: penSeenAt, doc: root };
      if (!penEverUsed) {
        penEverUsed = true;
        document.documentElement.classList.add('has-pencil');
      }
    }
  };
  root.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    note(pe);
    if (pe.pointerType === 'pen') {
      penDownCount++;
      penTools.down(pe.buttons, pe.button);
    }
  }, true);
  root.addEventListener('pointermove', (e) => note(e as PointerEvent), { capture: true, passive: true });
  const up = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'pen') {
      penDownCount = Math.max(0, penDownCount - 1);
      penSeenAt = performance.now();
      if (!penDownCount) penLiftedAt = penSeenAt;
      penTools.up();
    }
  };
  root.addEventListener('pointerup', up, true);
  root.addEventListener('pointercancel', up, true);
  // A finger tap does not raise the keyboard while the Apple Pencil is the writing tool (src/ipados/finger-keyboard.ts)
  installFingerKeyboardGuard(root);
}

/** The pencil touches the display right now or was active in the last 600 ms (hovering too). */
export const penActive = () => penDownCount > 0 || performance.now() - penSeenAt < 600;
/** Was a pencil used in this session? Then the finger pans by default. */
export const pencilSeen = () => penEverUsed;
/** Milliseconds since the last pencil event of this session (Infinity if none). */
export const sinceLastPen = () => (penEverUsed ? performance.now() - penSeenAt : Infinity);

/** What the pencil is doing, for the palm rules. Coordinates are those of `doc` (a frame has its own). */
export function penContext(doc: Document = document): PenContext {
  const now = performance.now();
  return {
    down: penDownCount > 0,
    sinceLiftMs: penDownCount > 0 ? 0 : now - penLiftedAt,
    hover: penHover && penHover.doc === doc ? { x: penHover.x, y: penHover.y, ageMs: now - penHover.t } : null,
  };
}

/** Contact radius of a touch pointer in CSS px, when the browser reports a believable one. */
function contactRadius(e: PointerEvent): number | undefined {
  const r = Math.max(e.width || 0, e.height || 0) / 2;
  return r > 2 ? r : undefined;
}

/** A touch that is a resting palm: large contact, the pencil writing, or the hand next to a hovering pencil. */
export function palmTouch(e: PointerEvent, doc?: Document): boolean {
  if (e.pointerType !== 'touch') return false;
  const d = doc || (e.target as Node | null)?.ownerDocument || document;
  const info: TouchInfo = { x: e.clientX, y: e.clientY, radius: contactRadius(e) };
  return isPalm(info, penContext(d));
}

// ---------------------------------------------------------------- Protect surfaces

export interface GuardOptions {
  /** The finger may scroll here (pan in one direction) */
  pan?: 'x' | 'y';
  /** Ignore the palm while the pencil is active (default: yes) */
  palm?: boolean;
}

/**
 * Drag bars, drawing surfaces and move grips: no browser scrolling and zooming,
 * no text selection, no context callout and no Scribble handwriting recognition.
 */
export function guardSurface(el: HTMLElement, opt: GuardOptions = {}): () => void {
  el.dataset.pencilSurface = '';
  el.style.touchAction = opt.pan === 'x' ? 'pan-x' : opt.pan === 'y' ? 'pan-y' : 'none';
  el.style.userSelect = 'none';
  el.style.setProperty('-webkit-user-select', 'none');
  el.style.setProperty('-webkit-touch-callout', 'none');
  // WebKit starts Scribble and text selection when the pencil touches down. preventDefault on
  // touchstart with touchType "stylus" prevents both, Pointer Events keep running.
  const onTouch = (e: TouchEvent) => {
    const stylus = [...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus');
    if (stylus && e.cancelable) e.preventDefault();
  };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'pen' && e.cancelable) e.preventDefault();
    else if (e.pointerType === 'touch' && opt.palm !== false && palmTouch(e, el.ownerDocument)) {
      // Palm: a large contact, a touch while the pencil writes, or right next to a hovering pencil
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  el.addEventListener('touchstart', onTouch, { passive: false });
  el.addEventListener('pointerdown', onPointer, true);
  return () => {
    el.removeEventListener('touchstart', onTouch);
    el.removeEventListener('pointerdown', onPointer, true);
  };
}

/**
 * Inputs where the Apple Pencil should turn handwriting into text (Scribble):
 * AI chat, search fields, code editor. No locks, text selection allowed.
 */
export function allowScribble(el: HTMLElement): void {
  el.dataset.scribble = 'on';
  el.style.touchAction = 'manipulation';
  el.style.userSelect = 'text';
  el.style.setProperty('-webkit-user-select', 'text');
  el.style.removeProperty('-webkit-touch-callout');
  if (!el.getAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'sentences');
}

// ---------------------------------------------------------------- Doppeltipp

export function onDoubleTap(el: HTMLElement, fn: (e: PointerEvent) => void, kinds: InputKind[] = ['touch', 'pen']): () => void {
  let last: { t: number; x: number; y: number; kind: InputKind } | null = null;
  let down: { t: number; x: number; y: number } | null = null;
  const pd = (e: PointerEvent) => {
    if (!kinds.includes(inputKind(e))) return;
    down = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  };
  const pu = (e: PointerEvent) => {
    const k = inputKind(e);
    if (!kinds.includes(k) || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = e.timeStamp - down.t < 350;
    down = null;
    if (moved > 12 || !quick) {
      last = null;
      return;
    }
    if (last && e.timeStamp - last.t < 380 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 28) {
      last = null;
      fn(e);
    } else last = { t: e.timeStamp, x: e.clientX, y: e.clientY, kind: k };
  };
  el.addEventListener('pointerdown', pd);
  el.addEventListener('pointerup', pu);
  return () => {
    el.removeEventListener('pointerdown', pd);
    el.removeEventListener('pointerup', pu);
  };
}

// ---------------------------------------------------------------- Striche

export type InkStyle = 'ink' | 'highlight' | 'rect' | 'redact';

export interface InkPoint {
  x: number;
  y: number;
  p: number;
  tiltX: number;
  tiltY: number;
}
export interface InkStroke {
  style: InkStyle;
  color: string;
  width: number;
  points: InkPoint[];
}

/** Stroke width from pressure and tilt: a pencil held flat draws wider (like a real pencil). */
export function strokeWidth(base: number, p: number, tiltX = 0, tiltY = 0): number {
  const tilt = Math.min(1, Math.hypot(tiltX, tiltY) / 70);
  return base * (0.35 + Math.min(1, p) * 1.1) * (1 + tilt * 0.6);
}

/**
 * Drawing layer in CSS pixels. Renders at most at twice the pixel density (WebKit memory
 * limits) and keeps every stroke as vector data, so it can be written into documents
 * without loss.
 */
export class InkLayer {
  readonly strokes: InkStroke[] = [];
  private current: InkStroke | null = null;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  /** Undo steps in order: a stroke was added, or strokes were erased (with their old positions) */
  private history: ({ t: 'add' } | { t: 'erase'; removed: { i: number; s: InkStroke }[] })[] = [];
  private erasing = false;
  private openErase: { t: 'erase'; removed: { i: number; s: InkStroke }[] } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    // desynchronized: the browser may draw ahead of the compositor (lower latency where supported, ignored elsewhere)
    this.ctx = (canvas.getContext('2d', { desynchronized: true }) || canvas.getContext('2d'))!;
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = width;
    this.h = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  get size() {
    return { width: this.w, height: this.h };
  }

  begin(style: InkStyle, color: string, width: number, pt: InkPoint): void {
    this.current = { style, color, width, points: [pt] };
    this.strokes.push(this.current);
    this.history.push({ t: 'add' });
    if (style === 'ink' || style === 'highlight') this.drawSegment(this.current, 0);
    else this.redraw();
  }
  extend(pt: InkPoint): void {
    if (!this.current) return;
    this.current.points.push(pt);
    if (this.current.style === 'ink' || this.current.style === 'highlight') this.drawSegment(this.current, this.current.points.length - 1);
    else this.redraw();
  }
  end(): InkStroke | null {
    const s = this.current;
    this.current = null;
    // The curve is drawn up to the middle of the last segment; finish it to the last point
    if (s && (s.style === 'ink' || s.style === 'highlight')) this.tail(this.ctx, s);
    return s;
  }
  /** The stroke being drawn right now */
  get running(): InkStroke | null {
    return this.current;
  }
  /** Takes the running stroke out again (a scratch-out or an eraser pass is not ink). */
  discard(): void {
    if (!this.current) return;
    const i = this.strokes.lastIndexOf(this.current);
    if (i >= 0) this.strokes.splice(i, 1);
    this.history.pop();
    this.current = null;
    this.redraw();
  }
  /** Undo the last step: a drawn stroke, or an erase pass (the erased strokes come back). */
  undo(): void {
    const step = this.history.pop();
    if (!step) this.strokes.pop();
    else if (step.t === 'add') this.strokes.pop();
    else for (const r of [...step.removed].reverse()) this.strokes.splice(r.i, 0, r.s);
    this.redraw();
  }
  clear(): void {
    this.strokes.length = 0;
    this.history.length = 0;
    this.current = null;
    this.redraw();
  }
  /** Replaces all strokes (page change, resize). Undo history starts over. */
  load(strokes: InkStroke[]): void {
    this.strokes.splice(0, this.strokes.length, ...strokes);
    this.history.length = 0;
    this.current = null;
    this.redraw();
  }
  /**
   * Eraser: removes every stroke a probe path touches (stroke eraser, like GoodNotes' default).
   * @returns how many strokes went; one undo brings them all back
   */
  erase(probe: { x: number; y: number }[], radius: number): number {
    const hit = strokesHitBy(this.strokes.filter((s) => s !== this.current), probe, radius);
    if (!hit.length) return 0;
    // Remove from the back so the indices stay valid; undo puts them back in the opposite order
    const removed: { i: number; s: InkStroke }[] = [];
    for (const i of [...hit].reverse()) removed.push({ i, s: this.strokes.splice(i, 1)[0]! });
    if (this.openErase) this.openErase.removed.push(...removed);
    else {
      const step = { t: 'erase' as const, removed };
      this.history.push(step);
      if (this.erasing) this.openErase = step;
    }
    this.redraw();
    return hit.length;
  }
  /** One eraser pass (pointer down to up) is one undo step, however many strokes it removes. */
  beginErase(): void {
    this.erasing = true;
    this.openErase = null;
  }
  endErase(): void {
    this.erasing = false;
    this.openErase = null;
  }
  /** Strokes (not the running one) that a probe path touches, for previews. */
  hits(probe: { x: number; y: number }[], radius: number): number[] {
    const done = this.strokes.filter((s) => s !== this.current);
    return strokesHitBy(done, probe, radius);
  }
  get empty(): boolean {
    return !this.strokes.length;
  }

  /** Umrandung aller Striche (CSS-Pixel) */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of this.strokes)
      for (const p of s.points) {
        const r = s.style === 'ink' || s.style === 'highlight' ? s.width : 0;
        x0 = Math.min(x0, p.x - r);
        y0 = Math.min(y0, p.y - r);
        x1 = Math.max(x1, p.x + r);
        y1 = Math.max(y1, p.y + r);
      }
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  redraw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    for (const s of this.strokes) this.drawStroke(c, s);
  }

  /** Draws strokes into any context (export, preview). */
  drawStroke(c: CanvasRenderingContext2D, s: InkStroke): void {
    const pts = s.points;
    if (!pts.length) return;
    if (s.style === 'rect' || s.style === 'redact') {
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const hh = Math.abs(b.y - a.y);
      c.save();
      if (s.style === 'redact') {
        c.fillStyle = '#000000';
        c.fillRect(x, y, w, hh);
        c.strokeStyle = s.color;
        c.lineWidth = 2;
        c.strokeRect(x, y, w, hh);
      } else {
        c.fillStyle = s.color + '22';
        c.fillRect(x, y, w, hh);
        c.strokeStyle = s.color;
        c.lineWidth = 2;
        c.strokeRect(x, y, w, hh);
      }
      c.restore();
      return;
    }
    for (let i = 0; i < pts.length; i++) this.segment(c, s, i);
    this.tail(c, s);
  }

  private drawSegment(s: InkStroke, i: number) {
    this.segment(this.ctx, s, i);
  }

  private style(c: CanvasRenderingContext2D, s: InkStroke, p: InkPoint) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (s.style === 'highlight') {
      c.globalAlpha = 0.35;
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = s.color;
      c.lineWidth = s.width * 3.2;
      c.lineCap = 'butt';
    } else {
      c.strokeStyle = s.color;
      c.lineWidth = strokeWidth(s.width, p.p, p.tiltX, p.tiltY);
    }
  }

  /**
   * One piece of the line: a quadratic curve between the midpoints of the neighbouring segments, with the
   * sample in between as control point. Corners of a fast stroke stay round instead of showing the polygon
   * of the samples, and every piece starts exactly where the previous one ended.
   */
  private segment(c: CanvasRenderingContext2D, s: InkStroke, i: number) {
    const pts = s.points;
    const p = pts[i]!;
    c.save();
    this.style(c, s, p);
    c.beginPath();
    if (i === 0) {
      c.moveTo(p.x, p.y);
      c.lineTo(p.x + 0.01, p.y);
    } else {
      const a = pts[i - 1]!;
      const start = i >= 2 ? { x: (pts[i - 2]!.x + a.x) / 2, y: (pts[i - 2]!.y + a.y) / 2 } : a;
      c.moveTo(start.x, start.y);
      c.quadraticCurveTo(a.x, a.y, (a.x + p.x) / 2, (a.y + p.y) / 2);
    }
    c.stroke();
    c.restore();
  }

  /** The last half segment: from the middle of the final two samples to the final sample. */
  private tail(c: CanvasRenderingContext2D, s: InkStroke) {
    const pts = s.points;
    if (pts.length < 2) return;
    const last = pts[pts.length - 1]!;
    const prev = pts[pts.length - 2]!;
    c.save();
    this.style(c, s, last);
    c.beginPath();
    c.moveTo((prev.x + last.x) / 2, (prev.y + last.y) / 2);
    c.lineTo(last.x, last.y);
    c.stroke();
    c.restore();
  }
}

// ---------------------------------------------------------------- Bridge into the apps

export interface FrameBridgeOptions {
  /** The finger pans instead of editing (GridCraft always, otherwise once a pencil was used) */
  fingerPans(): boolean;
  /** Pencil samples for preview, status and trail (coordinates inside the iframe) */
  onSample?(s: PenSample, phase: 'hover' | 'down' | 'move' | 'up' | 'leave'): void;
  /** Finger movement (for tests and the status display) */
  onGesture?(g: { type: 'tap' | 'pan' | 'pinch' | 'longpress'; dx?: number; dy?: number; scale?: number }): void;
  /** false: the engine reads Pointer Events of type pen itself (capability native-pen); samples are still reported */
  handlePen?: boolean;
  /** false: the engine pans and zooms with fingers itself (capability native-touch) */
  handleTouch?: boolean;
}

type FrameWin = Window & typeof globalThis;
const BRIDGED = '__ocBridged';

/**
 * Installs the input bridge in the window of an app (same origin).
 * The apps (egui/eframe) read pointerdown/pointerup, mousemove, touch events and wheel.
 */
export function bridgeFrame(W: FrameWin, opt: FrameBridgeOptions): () => void {
  const doc = W.document;
  const mark = <T extends Event>(ev: T): T => {
    Object.defineProperty(ev, BRIDGED, { value: true });
    return ev;
  };
  const isBridged = (e: Event) => !!(e as unknown as Record<string, unknown>)[BRIDGED];
  const targetAt = (x: number, y: number): Element => doc.elementFromPoint(x, y) || doc.querySelector('canvas') || doc.body;
  const mods = (e: MouseEvent) => ({ ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey });

  const mouseMove = (x: number, y: number, buttons: number, src?: MouseEvent) => {
    const t = targetAt(x, y);
    t.dispatchEvent(mark(new W.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons, view: W, ...(src ? mods(src) : {}) })));
  };
  const pointer = (type: string, x: number, y: number, button: number, buttons: number, src?: MouseEvent) => {
    const t = targetAt(x, y);
    const init: PointerEventInit = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: buttons ? 0.5 : 0, view: W, ...(src ? mods(src) : {}) };
    t.dispatchEvent(mark(new W.PointerEvent(type, init)));
    const mtype = type === 'pointerdown' ? 'mousedown' : type === 'pointerup' ? 'mouseup' : null;
    if (mtype) t.dispatchEvent(mark(new W.MouseEvent(mtype, init)));
  };
  const wheel = (x: number, y: number, dx: number, dy: number, ctrl = false) => {
    const t = targetAt(x, y);
    t.dispatchEvent(mark(new W.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy, deltaMode: 0, ctrlKey: ctrl, view: W })));
  };

  // ---------- Pencil ----------
  const penMove = (e: PointerEvent) => {
    if (e.pointerType !== 'pen' || isBridged(e)) return;
    if (opt.handlePen !== false) for (const c of coalesced(e)) mouseMove(c.clientX, c.clientY, e.buttons ? 1 : 0, e);
    const s = sample(e);
    opt.onSample?.(s, s.hover ? 'hover' : 'move');
  };
  const penDown = (e: PointerEvent) => {
    if (e.pointerType !== 'pen' || isBridged(e)) return;
    // Set the position before the press, then pointerdown reaches the app as usual
    if (opt.handlePen !== false) mouseMove(e.clientX, e.clientY, 0, e);
    opt.onSample?.(sample(e), 'down');
  };
  const penUp = (e: PointerEvent) => {
    if (e.pointerType !== 'pen' || isBridged(e)) return;
    opt.onSample?.(sample(e), 'up');
  };
  const penLeave = (e: PointerEvent) => {
    if (e.pointerType === 'pen') opt.onSample?.(sample(e), 'leave');
  };

  // ---------- Finger ----------
  type Touchpt = { x: number; y: number; x0: number; y0: number; t0: number };
  const touches = new Map<number, Touchpt>();
  let mode: 'none' | 'tap' | 'pan' | 'pinch' = 'none';
  let lastMid: { x: number; y: number } | null = null;
  let lastDist = 0;
  let longTimer: ReturnType<typeof setTimeout> | undefined;
  let velocity = { x: 0, y: 0, t: 0 };
  let momentum = 0;

  const intercept = (e: PointerEvent) => e.pointerType === 'touch' && !isBridged(e) && opt.handleTouch !== false && (opt.fingerPans() || penActive());
  const stop = (e: Event) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const mid = () => {
    const pts = [...touches.values()];
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  };
  const dist = () => {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const cancelMomentum = () => {
    if (momentum) cancelAnimationFrame(momentum);
    momentum = 0;
  };

  const touchDown = (e: PointerEvent) => {
    if (!intercept(e)) return;
    stop(e);
    // Palm (large contact, pencil writing, hand next to a hovering pencil): discard. The other hand still pans.
    if (palmTouch(e, doc)) return;
    cancelMomentum();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp });
    if (touches.size === 1) {
      mode = 'tap';
      lastMid = { x: e.clientX, y: e.clientY };
      velocity = { x: 0, y: 0, t: e.timeStamp };
      clearTimeout(longTimer);
      longTimer = setTimeout(() => {
        if (mode !== 'tap' || touches.size !== 1) return;
        const p = [...touches.values()][0]!;
        mode = 'none';
        mouseMove(p.x, p.y, 0);
        pointer('pointerdown', p.x, p.y, 2, 2);
        pointer('pointerup', p.x, p.y, 2, 0);
        targetAt(p.x, p.y).dispatchEvent(mark(new W.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2, view: W })));
        opt.onGesture?.({ type: 'longpress' });
      }, 550);
    } else {
      clearTimeout(longTimer);
      mode = 'pinch';
      lastMid = mid();
      lastDist = dist();
    }
  };
  const touchMove = (e: PointerEvent) => {
    if (!intercept(e)) return;
    stop(e);
    const p = touches.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (mode === 'tap' && Math.hypot(p.x - p.x0, p.y - p.y0) > 8) {
      mode = 'pan';
      clearTimeout(longTimer);
    }
    if (mode === 'pan' && lastMid) {
      const dx = lastMid.x - p.x;
      const dy = lastMid.y - p.y;
      const dt = Math.max(1, e.timeStamp - velocity.t);
      velocity = { x: (dx / dt) * 16, y: (dy / dt) * 16, t: e.timeStamp };
      if (dx || dy) wheel(p.x, p.y, dx, dy);
      lastMid = { x: p.x, y: p.y };
      opt.onGesture?.({ type: 'pan', dx, dy });
    } else if (mode === 'pinch' && touches.size >= 2 && lastMid) {
      const m = mid();
      const d = dist();
      if (lastDist > 0 && Math.abs(d - lastDist) > 0.5) {
        const scale = d / lastDist;
        // egui: Ctrl + scrolling zooms. A negative deltaY zooms in.
        wheel(m.x, m.y, 0, -Math.log(scale) * 240, true);
        opt.onGesture?.({ type: 'pinch', scale });
      }
      const dx = lastMid.x - m.x;
      const dy = lastMid.y - m.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) wheel(m.x, m.y, dx, dy);
      lastMid = m;
      lastDist = d;
    }
  };
  const touchUp = (e: PointerEvent) => {
    if (!intercept(e) && !touches.has(e.pointerId)) return;
    stop(e);
    const p = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    clearTimeout(longTimer);
    if (!p) return;
    if (mode === 'tap' && e.type === 'pointerup' && e.timeStamp - p.t0 < 550) {
      // Tell the keyboard guard (src/ipados/pen-ui.ts) that a finger, not the pencil, is about to click here
      doc.documentElement.dataset.ocFingerTap = String(Date.now());
      mouseMove(p.x, p.y, 0);
      pointer('pointerdown', p.x, p.y, 0, 1);
      pointer('pointerup', p.x, p.y, 0, 0);
      targetAt(p.x, p.y).dispatchEvent(mark(new W.MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, view: W })));
      opt.onGesture?.({ type: 'tap' });
    } else if (mode === 'pan' && touches.size === 0 && (Math.abs(velocity.x) > 2 || Math.abs(velocity.y) > 2)) {
      // Momentum like native lists, tuned to 120 Hz (ProMotion)
      let vx = velocity.x;
      let vy = velocity.y;
      let last = performance.now();
      const step = (now: number) => {
        const f = Math.min(4, (now - last) / 8.33);
        last = now;
        vx *= Math.pow(0.94, f);
        vy *= Math.pow(0.94, f);
        if (Math.abs(vx) < 0.3 && Math.abs(vy) < 0.3) return void (momentum = 0);
        wheel(p.x, p.y, vx * f * 0.5, vy * f * 0.5);
        momentum = requestAnimationFrame(step);
      };
      momentum = requestAnimationFrame(step);
    }
    if (touches.size === 0) mode = 'none';
    else if (touches.size === 1) {
      mode = 'pan';
      const only = [...touches.values()][0]!;
      lastMid = { x: only.x, y: only.y };
    }
  };

  // Pencil touches (touchType stylus) and captured fingers do not reach the app as touches:
  // otherwise double input, Scribble and text selection of the browser.
  const touchEv = (e: TouchEvent) => {
    if (isBridged(e)) return;
    const list = [...e.changedTouches] as (Touch & { touchType?: string })[];
    const stylus = list.some((t) => t.touchType === 'stylus');
    if (stylus && opt.handlePen !== false) return stop(e);
    if (opt.handleTouch !== false && (opt.fingerPans() || penActive())) stop(e);
  };

  const L: [string, EventListener, AddEventListenerOptions][] = [
    ['pointermove', penMove as EventListener, { capture: true }],
    ['pointerdown', penDown as EventListener, { capture: true }],
    ['pointerup', penUp as EventListener, { capture: true }],
    ['pointerleave', penLeave as EventListener, { capture: true }],
    ['pointerdown', touchDown as EventListener, { capture: true }],
    ['pointermove', touchMove as EventListener, { capture: true }],
    ['pointerup', touchUp as EventListener, { capture: true }],
    ['pointercancel', touchUp as EventListener, { capture: true }],
    ['touchstart', touchEv as EventListener, { capture: true, passive: false }],
    ['touchmove', touchEv as EventListener, { capture: true, passive: false }],
    ['touchend', touchEv as EventListener, { capture: true, passive: false }],
    ['touchcancel', touchEv as EventListener, { capture: true, passive: false }],
  ];
  for (const [t, fn, o] of L) W.addEventListener(t, fn, o);
  trackInput(doc);
  // No context callout and no magnifier on the drawing surface of the app
  const style = doc.createElement('style');
  style.textContent = 'html,body,canvas{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}canvas{touch-action:none}';
  doc.head?.append(style);
  return () => {
    cancelMomentum();
    clearTimeout(longTimer);
    for (const [t, fn, o] of L) W.removeEventListener(t, fn, o);
    style.remove();
  };
}
