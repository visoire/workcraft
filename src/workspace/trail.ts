// The trail of the pencil in an app (WordCraft, GridCraft, PdfCraft ...): the colored line that follows the tip while you draw, and fades
// when you lift it. It is feedback only; the app draws the real mark. Before, every sample was a separate piece with the width of its own
// pressure, so a fast swipe looked like a chain of blobs (a "snake"), and the highlighter showed dark joints where the pieces overlapped.
// Now the whole stroke is ONE smooth path (quadratic curves between the midpoints of the samples) at one width, drawn again for every
// new sample. A short trail makes that cheap, and a single path has no overlaps, so the highlighter is an even band.
//
// Same small interface as InkLayer (resize, size, clear, begin, extend, end), so the panel does not change.

export interface TrailPoint {
  x: number;
  y: number;
}
export type TrailStyle = 'ink' | 'highlight' | 'rect';

const MIN_STEP = 0.8; // CSS px: samples closer than this add nothing but noise

/** The points that make a stroke smooth: drops samples that are almost on top of each other. Pure (unit-tested). */
export function thin(points: readonly TrailPoint[], min = MIN_STEP): TrailPoint[] {
  const out: TrailPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= min) out.push(p);
  }
  // keep the true end of the stroke, so the line reaches the tip
  const end = points[points.length - 1];
  if (end && out[out.length - 1] !== end) out[out.length - 1] = end;
  return out;
}

export class TrailLayer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private style: TrailStyle = 'ink';
  private color = '#3B82F6';
  private width = 2.4;
  private pts: TrailPoint[] = [];
  private raf = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
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
    this.paint();
  }

  get size() {
    return { width: this.w, height: this.h };
  }

  begin(style: string, color: string, width: number, pt: TrailPoint): void {
    this.style = style === 'highlight' || style === 'rect' ? style : 'ink';
    this.color = color;
    this.width = style === 'highlight' ? Math.max(10, width * 2.6) : Math.min(3.2, Math.max(2, width));
    this.pts = [{ x: pt.x, y: pt.y }];
    this.schedule();
  }
  extend(pt: TrailPoint): void {
    this.pts.push({ x: pt.x, y: pt.y });
    this.schedule();
  }
  end(): void {
    this.paint();
  }
  clear(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pts = [];
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  // one repaint per frame, however many samples a fast pencil sent (coalesced events arrive in bursts)
  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paint();
    });
  }

  private paint(): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    const pts = thin(this.pts);
    if (!pts.length) return;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (this.style === 'rect') {
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      c.fillStyle = this.color + '1f';
      c.strokeStyle = this.color;
      c.lineWidth = 1.5;
      c.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      c.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      c.restore();
      return;
    }
    c.strokeStyle = this.color;
    c.lineWidth = this.width;
    c.globalAlpha = this.style === 'highlight' ? 0.32 : 0.9;
    if (this.style === 'highlight') c.lineCap = 'butt';
    c.beginPath();
    const first = pts[0]!;
    c.moveTo(first.x, first.y);
    if (pts.length === 1) c.lineTo(first.x + 0.01, first.y);
    else {
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const n = pts[i + 1]!;
        c.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
      }
      const last = pts[pts.length - 1]!;
      c.lineTo(last.x, last.y);
    }
    c.stroke();
    c.restore();
  }
}
