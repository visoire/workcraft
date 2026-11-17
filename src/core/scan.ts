// The maths and the file format of the document scanner (src/project/doc-scanner.ts). No DOM, so it is unit-tested
// (tests/server/scan.test.ts): finding the paper in a photo, the perspective transform that makes it a straight page, and a small PDF writer.
//
// Why our own: a web page cannot call the Scan Documents of iPadOS (that is VisionKit, only for native apps). Safari gives a page the camera,
// and that is enough: take the picture, find the corners of the paper, straighten it, clean it up, put the pages into a PDF.

export interface Pt {
  x: number;
  y: number;
}
/** Corners in the order top left, top right, bottom right, bottom left. */
export type Quad = [Pt, Pt, Pt, Pt];

// ---------------------------------------------------------------- finding the paper

/** Otsu's threshold of a grey image (0 to 255). */
export function otsu(gray: Uint8Array | Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]!++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** A quad inset from the edges of the image: the start when nothing was found. */
export function insetQuad(w: number, h: number, f = 0.07): Quad {
  const dx = w * f;
  const dy = h * f;
  return [{ x: dx, y: dy }, { x: w - dx, y: dy }, { x: w - dx, y: h - dy }, { x: dx, y: h - dy }];
}

/**
 * The corners of the biggest bright area (the paper) of a grey image, or the inset quad when there is no clear one. The paper is
 * brighter than the table: threshold with Otsu, take the largest connected bright region and its four extreme points
 * (smallest and largest x + y, x - y). A good first guess; the person can drag every corner.
 */
export function findPaper(gray: Uint8Array | Uint8ClampedArray, w: number, h: number): Quad {
  const fallback = insetQuad(w, h);
  if (w * h < 400) return fallback;
  // a light blur, so print and texture do not break the region
  const blur = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
            s += gray[yy * w + xx]!;
            n++;
          }
        }
      blur[y * w + x] = s / n;
    }
  const t = otsu(blur);
  const bin = new Uint8Array(w * h);
  let bright = 0;
  for (let i = 0; i < bin.length; i++) {
    if (blur[i]! > t) {
      bin[i] = 1;
      bright++;
    }
  }
  const share = bright / bin.length;
  if (share < 0.08 || share > 0.93) return fallback;
  // largest connected region (4 neighbours, iterative)
  const label = new Int32Array(w * h);
  let bestLabel = 0;
  let bestSize = 0;
  let current = 0;
  const stack: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || label[i]) continue;
    current++;
    let size = 0;
    stack.push(i);
    label[i] = current;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && bin[p - 1] && !label[p - 1]) (label[p - 1] = current), stack.push(p - 1);
      if (x < w - 1 && bin[p + 1] && !label[p + 1]) (label[p + 1] = current), stack.push(p + 1);
      if (y > 0 && bin[p - w] && !label[p - w]) (label[p - w] = current), stack.push(p - w);
      if (y < h - 1 && bin[p + w] && !label[p + w]) (label[p + w] = current), stack.push(p + w);
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = current;
    }
  }
  if (bestSize < w * h * 0.12) return fallback;
  let tl: Pt = { x: 0, y: 0 }, tr: Pt = { x: 0, y: 0 }, br: Pt = { x: 0, y: 0 }, bl: Pt = { x: 0, y: 0 };
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== bestLabel) continue;
    const x = i % w;
    const y = (i - x) / w;
    const s = x + y;
    const d = x - y;
    if (s < minS) ((minS = s), (tl = { x, y }));
    if (s > maxS) ((maxS = s), (br = { x, y }));
    if (d > maxD) ((maxD = d), (tr = { x, y }));
    if (d < minD) ((minD = d), (bl = { x, y }));
  }
  const q: Quad = [tl, tr, br, bl];
  // a sliver or a triangle is not a page
  if (quadArea(q) < w * h * 0.1) return fallback;
  return q;
}

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const n = q[(i + 1) % 4]!;
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

// ---------------------------------------------------------------- straightening

/** The 3 x 3 matrix (row-major, last entry 1) that maps four points to four points, solved by Gaussian elimination. */
export function homography(src: Quad, dst: Quad): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const piv = A[c]![c]!;
    if (Math.abs(piv) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let k = c; k < 9; k++) A[c]![k]! /= piv;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (!f) continue;
      for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return [A[0]![8]!, A[1]![8]!, A[2]![8]!, A[3]![8]!, A[4]![8]!, A[5]![8]!, A[6]![8]!, A[7]![8]!, 1];
}

export function applyH(m: number[], p: Pt): Pt {
  const d = m[6]! * p.x + m[7]! * p.y + m[8]!;
  return { x: (m[0]! * p.x + m[1]! * p.y + m[2]!) / d, y: (m[3]! * p.x + m[4]! * p.y + m[5]!) / d };
}

/** The size of the straight page: the longer of each pair of opposite edges, the long side at most `maxSide` pixels. */
export function pageSize(q: Quad, maxSide = 2200): { w: number; h: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(d(q[0], q[1]), d(q[3], q[2]));
  let h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const s = Math.min(1, maxSide / Math.max(w, h, 1));
  w = Math.max(16, Math.round(w * s));
  h = Math.max(16, Math.round(h * s));
  return { w, h };
}

/** Straightens the paper: for every pixel of the page, the point of the photo it comes from (bilinear). RGBA in, RGBA out. */
export function warp(src: Uint8ClampedArray, sw: number, sh: number, quad: Quad, out: { w: number; h: number }): Uint8ClampedArray {
  const dst: Quad = [{ x: 0, y: 0 }, { x: out.w, y: 0 }, { x: out.w, y: out.h }, { x: 0, y: out.h }];
  const inv = homography(dst, quad); // from the page to the photo
  const res = new Uint8ClampedArray(out.w * out.h * 4);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const p = applyH(inv, { x: x + 0.5, y: y + 0.5 });
      const fx = Math.min(sw - 1, Math.max(0, p.x - 0.5));
      const fy = Math.min(sh - 1, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const o = (y * out.w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[(y0 * sw + x0) * 4 + c]! * (1 - ax) + src[(y0 * sw + x1) * 4 + c]! * ax;
        const bot = src[(y1 * sw + x0) * 4 + c]! * (1 - ax) + src[(y1 * sw + x1) * 4 + c]! * ax;
        res[o + c] = top * (1 - ay) + bot * ay;
      }
    }
  return res;
}

export type ScanLook = 'color' | 'gray' | 'bw';

/** Cleans the page in place: grey with automatic levels (the 2nd and 98th percentile), or black and white, or colour with a light stretch. */
export function enhance(px: Uint8ClampedArray, look: ScanLook): void {
  const n = px.length / 4;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    lum[j] = (px[i]! * 299 + px[i + 1]! * 587 + px[i + 2]! * 114) / 1000;
    hist[lum[j]!]!++;
  }
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]!) < n * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]!) < n * 0.02; hi--);
  const span = Math.max(24, hi - lo);
  const level = (v: number) => Math.max(0, Math.min(255, ((v - lo) * 255) / span));
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    if (look === 'color') {
      px[i] = level(px[i]!);
      px[i + 1] = level(px[i + 1]!);
      px[i + 2] = level(px[i + 2]!);
    } else {
      const v = level(lum[j]!);
      const o = look === 'bw' ? (v > 150 ? 255 : 0) : v;
      px[i] = px[i + 1] = px[i + 2] = o;
    }
    px[i + 3] = 255;
  }
}

// ---------------------------------------------------------------- the PDF

export interface PdfPage {
  jpeg: Uint8Array;
  /** Pixel size of the picture */
  w: number;
  h: number;
}

/** A PDF with one picture per page (DCTDecode, the JPEG as it is). The page is the size of the picture at 150 dpi. */
export function buildPdf(pages: readonly PdfPage[], dpi = 150): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (d: Uint8Array | string) => {
    const b = typeof d === 'string' ? enc.encode(d) : d;
    parts.push(b);
    len += b.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    body();
    push('endobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const total = 2 + pages.length * 3; // catalog, pages, then (page, contents, image) per page
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>\n'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>\n`));
  pages.forEach((p, i) => {
    const page = 3 + i * 3;
    const w = ((p.w * 72) / dpi).toFixed(2);
    const h = ((p.h * 72) / dpi).toFixed(2);
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>\n`));
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
    obj(page + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`));
    obj(page + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream\n');
    });
  });
  const xref = len;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
