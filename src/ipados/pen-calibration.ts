// Pen calibration: what this pen can really do, learned from its own events.
//
// Hardware reality on iPadOS:
//   - Apple Pencil (1st, 2nd generation, Pro) report pressure from 0 to 1.
//   - Apple Pencil (USB-C) and third party pens (Logitech Crayon) have no pressure sensor: every
//     contact event reports exactly 0.5.
//   - Hover exists on iPad Pro / Air with M2 or newer. Older iPads never send a pen move without contact.
//   - Barrel roll (twist) exists on Apple Pencil Pro only.
// Code must not assume any of these, so the calibrator watches the events and answers from evidence.

export interface PenInput {
  /** PointerEvent.pressure as reported */
  pressure: number;
  /** PointerEvent.twist, degrees */
  twist: number;
  /** The pen touches the display */
  contact: boolean;
  x: number;
  y: number;
  /** ms */
  t: number;
}

/** Contact events with the exact pressure 0.5 before the pen counts as pressure-less. */
const FLAT_SAMPLES = 10;
const FLAT = 0.001;

export class PenCalibrator {
  /** true: real pressure seen. false: constant 0.5 seen. null: not enough evidence yet. */
  hasPressure: boolean | null = null;
  hasHover = false;
  hasTwist = false;
  private flat = 0;
  private confirmed = false;
  private simulated = 0.5;
  private last: { x: number; y: number; t: number } | null = null;
  private lastOut = 0.5;

  /** Feeds one event and returns the pressure to use: reported, or simulated from speed. */
  observe(i: PenInput): number {
    if (Math.abs(i.twist) > 0.5) this.hasTwist = true;
    if (!i.contact) {
      this.hasHover = true;
      this.endStroke();
      return 0;
    }
    // The same event can be read twice (preview and stroke); a repeat must not count as movement
    if (this.last && this.last.t === i.t && this.last.x === i.x && this.last.y === i.y) return this.lastOut;

    if (Math.abs(i.pressure - 0.5) <= FLAT) {
      if (!this.confirmed && ++this.flat >= FLAT_SAMPLES) this.hasPressure = false;
    } else if (i.pressure > 0) {
      // Any other value proves a sensor, and one real stroke is enough for the rest of the session
      this.confirmed = true;
      this.hasPressure = true;
      this.flat = 0;
    }

    let out = i.pressure;
    if (this.hasPressure === false) out = this.simulate(i);
    else if (!(out > 0)) out = 0.5;
    this.last = { x: i.x, y: i.y, t: i.t };
    this.lastOut = out;
    return out;
  }

  /** Pressure from speed: slow strokes are heavy, fast strokes light (what perfect-freehand does too). */
  private simulate(i: PenInput): number {
    if (this.last) {
      const dt = Math.max(1, i.t - this.last.t);
      const speed = Math.hypot(i.x - this.last.x, i.y - this.last.y) / dt; // px per ms
      const target = Math.min(0.85, Math.max(0.25, 0.8 - speed * 0.22));
      this.simulated += (target - this.simulated) * 0.3;
    }
    return this.simulated;
  }

  endStroke(): void {
    this.last = null;
    this.simulated = 0.5;
    this.lastOut = 0.5;
  }

  reset(): void {
    this.hasPressure = null;
    this.hasHover = false;
    this.hasTwist = false;
    this.flat = 0;
    this.confirmed = false;
    this.endStroke();
  }

  /** For the Status page and tests */
  // (the shared instance of the workspace is `pen` below)
  summary(): { pressure: 'real' | 'simulated' | 'unknown'; hover: boolean; twist: boolean } {
    return { pressure: this.hasPressure === true ? 'real' : this.hasPressure === false ? 'simulated' : 'unknown', hover: this.hasHover, twist: this.hasTwist };
  }
}

/** The pen of this session. src/workspace/pencil.ts feeds it from every pen event. */
export const pen = new PenCalibrator();
