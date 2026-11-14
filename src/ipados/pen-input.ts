// Pen input decisions as pure functions: no DOM, no timers, so every rule can be tested.
//
//   isPalm()              finger or palm? (contact size, pencil writing, pencil hovering nearby)
//   blockFingerKeyboard() should a finger tap open the on-screen keyboard?
//   PenToolState          pen and eraser, temporary switch while a barrel button or the eraser end is held
//   isScratchOut()        a scribble over existing ink means "delete this" (like Scribble in text fields)
//   strokesHitBy()        which strokes does a probe path (eraser, scratch-out) touch?
//   ringSpec()            size, shape and style of the hover circle
//
// src/ipados/pen-ui.ts and src/workspace/pencil.ts wire these to real events.

export interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- Palm rejection

export interface TouchInfo extends Pt {
  /** Contact radius in CSS pixels when the browser reports it (Touch.radiusX, PointerEvent.width / 2) */
  radius?: number;
}

export interface PenContext {
  /** The pencil touches the display */
  down: boolean;
  /** ms since the pencil last left the display (Infinity when it never touched) */
  sinceLiftMs: number;
  /** Last hover position in the same coordinate space as the touch, and its age */
  hover: (Pt & { ageMs: number }) | null;
}

export const PALM = {
  /** A contact patch with a radius from here is a palm (a fingertip is about 8 to 20 px) */
  radius: 34,
  /** Quiet time after the pencil lifts: the hand is still resting */
  liftMs: 450,
  /** A hovering pencil shields the area around its tip (the hand writing is right there) */
  hoverMs: 500,
  hoverRadius: 210,
} as const;

/**
 * True when a touch is a resting palm or knuckle and must be ignored. A finger far from a hovering pencil is
 * a deliberate gesture (the other hand pans and zooms while the pencil hovers), like in GoodNotes.
 */
export function isPalm(t: TouchInfo, pen: PenContext): boolean {
  if (t.radius !== undefined && t.radius >= PALM.radius) return true;
  if (pen.down) return true;
  if (pen.sinceLiftMs < PALM.liftMs) return true;
  if (pen.hover && pen.hover.ageMs < PALM.hoverMs && Math.hypot(t.x - pen.hover.x, t.y - pen.hover.y) < PALM.hoverRadius) return true;
  return false;
}

// ---------------------------------------------------------------- Finger and keyboard

/** auto: a finger types until the Apple Pencil was used (then the pencil writes). never: the finger never opens the keyboard. always: it always does. */
export type FingerTyping = 'auto' | 'never' | 'always';

/** How long after the last pencil event the finger still counts as "pencil user" in auto mode. */
export const PENCIL_SESSION_MS = 15 * 60_000;

export function blockFingerKeyboard(mode: FingerTyping, penSeen: boolean, sinceLastPenMs: number): boolean {
  if (mode === 'always') return false;
  if (mode === 'never') return true;
  return penSeen && sinceLastPenMs < PENCIL_SESSION_MS;
}

// ---------------------------------------------------------------- Tools

export type PenTool = 'pen' | 'eraser';
/** What the barrel button (and the Apple Pencil Pro squeeze, where the browser reports it as a button) does. */
export type BarrelAction = 'eraser' | 'toggle' | 'off';

export const POINTER_BUTTON = { barrel: 2, eraser: 32, eraserButton: 5 } as const;

export class PenToolState {
  private current: PenTool = 'pen';
  private sticky: PenTool = 'pen';
  private held = false;

  constructor(
    private readonly onChange: (tool: PenTool, why: 'manual' | 'barrel' | 'eraser-end' | 'toggle' | 'release') => void = () => {},
    private barrel: BarrelAction = 'eraser'
  ) {}

  get tool(): PenTool {
    return this.current;
  }
  /** The tool is only switched for as long as a button is held */
  get temporary(): boolean {
    return this.held;
  }
  setBarrel(a: BarrelAction): void {
    this.barrel = a;
  }

  set(tool: PenTool): void {
    this.sticky = tool;
    this.held = false;
    if (tool !== this.current) {
      this.current = tool;
      this.onChange(tool, 'manual');
    }
  }
  toggle(): void {
    const next: PenTool = this.current === 'pen' ? 'eraser' : 'pen';
    this.sticky = next;
    this.held = false;
    this.current = next;
    this.onChange(next, 'toggle');
  }

  /** A pencil contact starts. The eraser end and the barrel button decide the tool for this stroke. */
  down(buttons: number, button = 0): void {
    const eraserEnd = (buttons & POINTER_BUTTON.eraser) !== 0 || button === POINTER_BUTTON.eraserButton;
    const barrel = (buttons & POINTER_BUTTON.barrel) !== 0;
    if (eraserEnd) return this.hold('eraser', 'eraser-end');
    if (barrel && this.barrel === 'eraser') return this.hold('eraser', 'barrel');
    if (barrel && this.barrel === 'toggle') return this.toggle();
  }
  /** The contact ends: a held switch returns to the chosen tool. */
  up(): void {
    if (!this.held) return;
    this.held = false;
    if (this.current !== this.sticky) {
      this.current = this.sticky;
      this.onChange(this.sticky, 'release');
    }
  }
  private hold(tool: PenTool, why: 'barrel' | 'eraser-end'): void {
    if (this.current === tool) return;
    this.held = true;
    this.current = tool;
    this.onChange(tool, why);
  }
}

// ---------------------------------------------------------------- Scratch-out

/** Turning points of a series where the swing between two extremes is at least minSwing. */
export function reversals(values: number[], minSwing: number): number {
  if (values.length < 2) return 0;
  let dir = 0;
  let ext = values[0]!;
  let count = 0;
  for (const v of values) {
    if (dir === 0) {
      if (Math.abs(v - ext) >= minSwing) {
        dir = v > ext ? 1 : -1;
        ext = v;
      }
    } else if (dir === 1) {
      if (v > ext) ext = v;
      else if (ext - v >= minSwing) {
        dir = -1;
        ext = v;
        count++;
      }
    } else if (v < ext) ext = v;
    else if (v - ext >= minSwing) {
      dir = 1;
      ext = v;
      count++;
    }
  }
  return count;
}

export interface ScratchOptions {
  /** Smallest swing between two turns, CSS px */
  minSwing?: number;
  /** Turns needed (3 turns = four strokes back and forth) */
  minTurns?: number;
  /** Largest extent of the scribble: bigger movements are drawings, not scratches */
  maxExtent?: number;
}

/** A tight zig-zag: many direction changes in a small area, with a long path compared with its size. */
export function isScratchOut(points: Pt[], opt: ScratchOptions = {}): boolean {
  const { minSwing = 9, minTurns = 3, maxExtent = 320 } = opt;
  if (points.length < 8) return false;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let path = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
    if (i) path += Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y);
  }
  const w = x1 - x0;
  const hgt = y1 - y0;
  const diag = Math.hypot(w, hgt);
  if (diag < minSwing * 2 || Math.max(w, hgt) > maxExtent) return false;
  if (path < diag * 3) return false;
  const turns = Math.max(reversals(points.map((p) => p.x), minSwing), reversals(points.map((p) => p.y), minSwing));
  return turns >= minTurns;
}

// ---------------------------------------------------------------- Hit testing

export interface HitStroke {
  style: 'ink' | 'highlight' | 'rect' | 'redact';
  width: number;
  points: Pt[];
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Does a probe path (eraser trail, scratch-out) touch this stroke? radius = reach of the probe in CSS px. */
export function strokeHitBy(s: HitStroke, probe: Pt[], radius: number): boolean {
  if (!probe.length || !s.points.length) return false;
  if (s.style === 'rect' || s.style === 'redact') {
    const a = s.points[0]!;
    const b = s.points[s.points.length - 1]!;
    const x0 = Math.min(a.x, b.x) - radius;
    const x1 = Math.max(a.x, b.x) + radius;
    const y0 = Math.min(a.y, b.y) - radius;
    const y1 = Math.max(a.y, b.y) + radius;
    return probe.some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
  }
  const reach = radius + (s.style === 'highlight' ? s.width * 1.6 : s.width * 0.6);
  for (const p of probe) {
    if (s.points.length === 1) {
      if (Math.hypot(p.x - s.points[0]!.x, p.y - s.points[0]!.y) <= reach) return true;
      continue;
    }
    for (let i = 1; i < s.points.length; i++) if (distToSegment(p, s.points[i - 1]!, s.points[i]!) <= reach) return true;
  }
  return false;
}

/** Indices of the strokes a probe path touches. */
export function strokesHitBy(strokes: HitStroke[], probe: Pt[], radius: number): number[] {
  const out: number[] = [];
  strokes.forEach((s, i) => strokeHitBy(s, probe, radius) && out.push(i));
  return out;
}

// ---------------------------------------------------------------- Hover circle

export type RingKind = 'pen' | 'highlight' | 'redact' | 'eraser' | 'select';

export interface RingSpec {
  /** Diameter in CSS px */
  size: number;
  /** Stretch along the tilt direction (1 = round) */
  stretch: number;
  /** Rotation in degrees (pencil azimuth) */
  rotate: number;
  dashed: boolean;
}

/**
 * The hover circle shows what the next touch will do: the real width of the line for the pen (so you can
 * place it), a dashed larger circle for the eraser, a wide band for the highlighter. A tilted pencil
 * stretches the circle like a real pencil lead.
 * @param width base line width of the tool in CSS px
 * @param zoom how much the content is magnified (1 = as drawn)
 */
export function ringSpec(kind: RingKind, width: number, zoom = 1, altitudeRad = Math.PI / 2, azimuthRad = 0): RingSpec {
  const z = Math.max(0.25, zoom);
  const tilt = 1 - Math.max(0, Math.min(1, altitudeRad / (Math.PI / 2))); // 0 upright, 1 flat
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let size: number;
  let dashed = false;
  switch (kind) {
    case 'eraser':
      size = clamp(width * 7 * z, 18, 72);
      dashed = true;
      break;
    case 'highlight':
      size = clamp(width * 3.2 * z, 14, 64);
      break;
    case 'redact':
      size = 14;
      break;
    case 'select':
      size = 10;
      break;
    default:
      // A line is thin: keep the circle visible (at least 8 px) and a little larger than the line
      size = clamp(width * 1.15 * z + 3, 8, 40);
  }
  return { size, stretch: 1 + tilt * 0.8, rotate: (azimuthRad * 180) / Math.PI, dashed };
}
