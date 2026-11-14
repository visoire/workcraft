// PdfCraft pencil view: signing, freehand notes, highlights and redaction
// with the Apple Pencil, locally in the browser.
//
// The page is drawn as a preview with pdf.js (through unpdf), above it lies a pressure- and
// tilt-sensitive drawing layer. Applying writes the strokes with pdf-lib into the PDF file
// of the project. PdfCraft shows the new state afterwards without reloading.
//
// Redaction really removes content: a page with redactions is rebuilt as an image
// (rendered, areas blacked out, old page replaced). Text underneath is no longer
// part of the document afterwards.

import { h, basename } from '../app/util.js';
import { icon } from '../app/icons.js';
import { toast } from '../app/notifications.js';
import { fs } from '../project/fs.js';
import { InkLayer, guardSurface, coalesced, sample, pencilSeen, penActive, capture, penTools, onToolChange, palmTouch, type InkStroke, type InkStyle } from './pencil.js';
import { HoverRing, ringKindOf, penFlash } from '../ipados/pen-ui.js';
import { isScratchOut } from '../ipados/pen-input.js';
import { prefs } from '../app/settings.js';
import { t as tr, tn } from '../app/i18n.js';

export type PdfPenTool = 'sign' | 'ink' | 'mark' | 'redact';

export const PDF_ACCENT = '#14B8A6';
const INK_DARK = '#0D0D12';

interface ToolDef {
  id: PdfPenTool;
  label: string;
  icon: string;
  style: InkStyle;
  width: number;
}
const TOOLS: ToolDef[] = [
  { id: 'sign', label: tr('Sign'), icon: 'pen', style: 'ink', width: 2.4 },
  { id: 'ink', label: tr('Freehand'), icon: 'pen', style: 'ink', width: 2 },
  { id: 'mark', label: tr('Highlight'), icon: 'minus', style: 'highlight', width: 4.5 },
  { id: 'redact', label: tr('Redact'), icon: 'stop', style: 'redact', width: 0 },
];

type PdfJsPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: Record<string, unknown>): { promise: Promise<void> };
};
type PdfJsDoc = { numPages: number; getPage(n: number): Promise<PdfJsPage>; destroy?(): Promise<void> };

async function loadPdfJs(bytes: Uint8Array): Promise<PdfJsDoc | null> {
  try {
    const { getDocumentProxy } = await import('unpdf');
    return (await getDocumentProxy(bytes.slice())) as unknown as PdfJsDoc;
  } catch (e) {
    console.warn('PDF preview not available', e);
    return null;
  }
}

async function renderPage(doc: PdfJsDoc, index: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<boolean> {
  try {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    return true;
  } catch (e) {
    console.warn('Page not rendered', e);
    return false;
  }
}

/** Normalized strokes (0 to 1 relative to the page size) */
type NStroke = InkStroke;

const toNorm = (s: InkStroke, w: number, hgt: number): NStroke => ({ ...s, width: s.width / w, points: s.points.map((p) => ({ ...p, x: p.x / w, y: p.y / hgt })) });
const fromNorm = (s: NStroke, w: number, hgt: number): InkStroke => ({ ...s, width: s.width * w, points: s.points.map((p) => ({ ...p, x: p.x * w, y: p.y * hgt })) });

/** Draws normalized strokes into a context of size w × h (without redactions). */
function paintStrokes(ctx: CanvasRenderingContext2D, strokes: NStroke[], w: number, hgt: number, layer: InkLayer, redact: boolean) {
  for (const s of strokes) {
    if ((s.style === 'redact') !== redact) continue;
    const px = fromNorm(s, w, hgt);
    if (redact) {
      const a = px.points[0]!;
      const b = px.points[px.points.length - 1]!;
      ctx.fillStyle = '#000000';
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else layer.drawStroke(ctx, px);
  }
}

export interface PdfPenResult {
  saved: boolean;
  pages: number[];
}

/**
 * Opens the pencil view for a PDF file in the project.
 * @param origin origin of the write (live sync recognises the change)
 */
export async function openPdfPen(path: string, opt: { tool?: PdfPenTool; origin?: string } = {}): Promise<PdfPenResult> {
  const bytes = new Uint8Array(await fs.readBinary(path));
  const { PDFDocument } = await import('pdf-lib');
  const meta = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const sizes = meta.getPages().map((p) => p.getSize());
  const preview = await loadPdfJs(bytes);

  let tool: PdfPenTool = opt.tool || 'sign';
  let signInk = INK_DARK;
  let page = 0;
  const strokes = new Map<number, NStroke[]>();

  return new Promise<PdfPenResult>((resolve) => {
    const pageCanvas = h<'canvas'>('canvas.pp-page');
    const inkCanvas = h<'canvas'>('canvas.pp-ink', { 'aria-label': tr('Drawing surface for the Apple Pencil') });
    const sheet = h('div.pp-sheet', pageCanvas, inkCanvas);
    const hover = new HoverRing(sheet);
    const stage = h('div.pp-stage', sheet);
    const layer = new InkLayer(inkCanvas);
    const info = h('span.pp-info.mono', { role: 'status' });
    const pageLabel = h('span.pp-pagelabel.mono');

    const toolBtns = TOOLS.map((t) =>
      h<'button'>('button.pp-tool', { type: 'button', 'data-tool': t.id, 'aria-pressed': String(t.id === tool), title: t.label, 'aria-label': t.label, html: icon(t.icon, { size: 16 }) + `<span class="lbl">${t.label}</span>`, onclick: () => setTool(t.id) })
    );
    // The eraser is a tool of its own: the pencil's barrel button or eraser end switches to it for one stroke (src/ipados/pen-input.ts)
    const eraserBtn = h<'button'>('button.pp-tool', { type: 'button', 'data-tool': 'erase', 'aria-pressed': 'false', title: tr('Eraser: removes the strokes you touch (E)'), 'aria-label': tr('Eraser'), html: icon('eraser', { size: 16 }) + `<span class="lbl">${tr('Eraser')}</span>`, onclick: () => penTools.set(penTools.tool === 'eraser' ? 'pen' : 'eraser') });
    toolBtns.push(eraserBtn);
    const inkSel = h<'select'>('select.input.pp-inksel', { 'aria-label': tr('Color of the signature') }, h('option', { value: INK_DARK }, tr('Black ink')), h('option', { value: PDF_ACCENT }, tr('Teal ink')));
    inkSel.onchange = () => (signInk = inkSel.value);
    const prev = h<'button'>('button.icon-btn', { type: 'button', 'aria-label': tr('Previous page'), html: icon('back', { size: 18 }), onclick: () => go(page - 1) });
    const next = h<'button'>('button.icon-btn', { type: 'button', 'aria-label': tr('Next page'), html: icon('chevron', { size: 18 }), onclick: () => go(page + 1) });
    const undo = h<'button'>('button.icon-btn', { type: 'button', 'aria-label': tr('Remove the last stroke'), title: tr('Undo'), html: icon('undo', { size: 18 }), onclick: () => (layer.undo(), store(), paintInfo()) });
    const clear = h<'button'>('button.icon-btn', { type: 'button', 'aria-label': tr('Clear the page'), title: tr('Clear the page'), html: icon('trash', { size: 18 }), onclick: () => (layer.clear(), store(), paintInfo()) });
    const cancel = h<'button'>('button.btn.ghost', { type: 'button' }, tr('Discard'));
    const apply = h<'button'>('button.btn.primary.pp-apply', { type: 'button' }, tr('Apply to the PDF'));
    const note = h('p.pp-note.muted', '');

    const box = h(
      'div.frame.lg.pp',
      { style: `--tool:${PDF_ACCENT}` },
      h(
        'div.well.flush.pp-well',
        h('div.pp-head', h('div', h('p.eyebrow', 'PdfCraft · Apple Pencil'), h('h3.duo', basename(path), ' ', h('span.tone', tr('edit with the pencil')))), h('span.spacer'), info),
        h('div.pp-bar', h('div.pp-tools', { role: 'group', 'aria-label': tr('Pencil tool') }, toolBtns), inkSel, h('span.spacer'), undo, clear, h('span.pp-sep'), prev, pageLabel, next),
        stage,
        h('div.pp-foot', note, h('span.spacer'), cancel, apply)
      )
    );
    const dlg = h<'dialog'>('dialog.modal.pp-dialog', { 'aria-label': tr('PdfCraft pencil view') }, box);
    document.body.append(dlg);
    guardSurface(inkCanvas);

    let display = { w: 0, h: 0 };
    let renderSeq = 0;
    let shownPage = -1;

    function store() {
      if (!display.w) return;
      strokes.set(page, layer.strokes.map((s) => toNorm(s, display.w, display.h)));
    }
    function paintInfo() {
      const n = [...strokes.values()].reduce((a, l) => a + l.length, 0);
      pageLabel.textContent = `${page + 1} / ${sizes.length}`;
      prev.disabled = page === 0;
      next.disabled = page >= sizes.length - 1;
      apply.disabled = n === 0;
      note.textContent =
        penTools.tool === 'eraser'
          ? tr('Eraser: touch a stroke to remove it. Undo brings it back.')
          : tool === 'redact'
          ? tr('Redaction rebuilds the affected pages as images. Covered text is no longer in the document afterwards.')
          : tool === 'sign'
            ? tr('Signature with pressure and tilt. The stroke width follows the Apple Pencil.')
            : tool === 'mark'
              ? tr('Highlighter in color {color}.', { color: PDF_ACCENT })
              : tr('Freehand note in color {color}.', { color: PDF_ACCENT });
      // Keep the space, so the page does not jump when the tool changes
      inkSel.style.visibility = tool === 'sign' ? '' : 'hidden';
      inkSel.disabled = tool !== 'sign';
      info.textContent = n ? (n === 1 ? tr('1 stroke') : tr('{n} strokes', { n })) : pencilSeen() ? tr('Apple Pencil ready') : tr('Pencil, finger or mouse');
    }
    function paintTools() {
      const erasing = penTools.tool === 'eraser';
      toolBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === 'erase' ? erasing : !erasing && b.dataset.tool === tool)));
      sheet.dataset.tool = erasing ? 'eraser' : tool;
    }
    function setTool(t: PdfPenTool) {
      tool = t;
      penTools.set('pen');
      paintTools();
      paintInfo();
    }
    // The barrel button, the eraser end and the E key change the tool: the buttons follow
    const offTool = onToolChange(() => {
      paintTools();
      paintInfo();
    });

    async function layout() {
      const sz = sizes[page]!;
      const avail = stage.getBoundingClientRect();
      const maxW = Math.max(200, avail.width - 24);
      const maxH = Math.max(200, avail.height - 24);
      const k = Math.min(maxW / sz.width, maxH / sz.height);
      const w = Math.round(sz.width * k);
      const hgt = Math.round(sz.height * k);
      // Same page, same size: rebuild nothing (otherwise a running stroke loses its target)
      if (w === display.w && hgt === display.h && shownPage === page) return;
      if (drawing !== null) {
        layer.end();
        drawing = null;
        store();
      }
      shownPage = page;
      display = { w, h: hgt };
      sheet.style.width = `${w}px`;
      sheet.style.height = `${hgt}px`;
      pageCanvas.style.width = `${w}px`;
      pageCanvas.style.height = `${hgt}px`;
      layer.resize(w, hgt);
      layer.load((strokes.get(page) || []).map((s) => fromNorm(s, w, hgt)));
      // Render offscreen and keep only the newest result: size changes trigger several
      // passes that would otherwise share one canvas and leave an empty page.
      const seq = ++renderSeq;
      const off = document.createElement('canvas');
      const ok = !!preview && (await renderPage(preview, page, off, w));
      if (seq !== renderSeq) return;
      if (ok) {
        pageCanvas.width = off.width;
        pageCanvas.height = off.height;
        pageCanvas.getContext('2d')!.drawImage(off, 0, 0);
      } else {
        pageCanvas.width = w;
        pageCanvas.height = hgt;
        const c = pageCanvas.getContext('2d')!;
        c.fillStyle = '#FFFFFF';
        c.fillRect(0, 0, w, hgt);
        c.fillStyle = '#666D80';
        c.font = '13px "DM Mono", monospace';
        c.fillText(tr('Page {n} · preview not available', { n: page + 1 }), 16, 28);
      }
      paintInfo();
    }
    function go(n: number) {
      if (n < 0 || n >= sizes.length) return;
      store();
      page = n;
      void layout();
    }

    // ---------- Zeichnen ----------
    let drawing: number | null = null;
    const def = () => TOOLS.find((t) => t.id === tool)!;
    const local = (x: number, y: number) => {
      const r = inkCanvas.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    /** Eraser reach in CSS px: a fingertip-sized circle, and the hover circle shows it */
    const ERASER_WIDTH = 4;
    const eraserReach = () => ERASER_WIDTH * 3.5;
    let erasing = false;
    let probeLast: { x: number; y: number } | null = null;
    const ringFor = (e: PointerEvent, p: { x: number; y: number }, s: ReturnType<typeof sample>) => {
      const d = def();
      const eraser = penTools.tool === 'eraser';
      hover.move(p.x, p.y, { kind: ringKindOf(penTools.tool, d.style), width: eraser ? ERASER_WIDTH : d.width, color: eraser ? undefined : tool === 'sign' ? signInk : PDF_ACCENT, altitude: s.altitude, azimuth: s.azimuth });
      void e;
    };
    inkCanvas.addEventListener('pointerdown', (e) => {
      // The finger does not pan here, it only draws without a pencil. With a pencil it counts as the palm.
      if (e.pointerType === 'touch' && (pencilSeen() || penActive() || palmTouch(e))) return;
      e.preventDefault();
      capture(inkCanvas, e.pointerId);
      drawing = e.pointerId;
      const s = sample(e);
      const p = local(e.clientX, e.clientY);
      if (penTools.tool === 'eraser') {
        // Eraser pass: strokes under the tip go, one undo step for the whole pass
        erasing = true;
        probeLast = p;
        layer.beginErase();
        if (layer.erase([p], eraserReach())) paintInfo();
        ringFor(e, p, s);
        return;
      }
      const d = def();
      const color = tool === 'sign' ? signInk : PDF_ACCENT;
      layer.begin(d.style, color, d.width, { x: p.x, y: p.y, p: s.pressure || 0.5, tiltX: s.tiltX, tiltY: s.tiltY });
    });
    inkCanvas.addEventListener('pointermove', (e) => {
      const s = sample(e);
      const p = local(e.clientX, e.clientY);
      if (e.pointerType === 'pen' && s.hover) {
        // Hover preview: the tip hovers above the page, the circle shows the line width (or the eraser's reach)
        ringFor(e, p, s);
        info.textContent = `${tr('Hover')} · ${tr('tilt')} ${Math.round(90 - (s.altitude * 180) / Math.PI)}° · ${tr('rotation')} ${Math.round(s.twist)}°`;
        return;
      }
      if (drawing !== e.pointerId) return;
      if (erasing) {
        // The probe follows the tip, including the samples in between, so a fast pass does not skip strokes
        const probe: { x: number; y: number }[] = probeLast ? [probeLast] : [];
        for (const c of coalesced(e)) probe.push(local(c.clientX, c.clientY));
        probeLast = probe[probe.length - 1]!;
        if (layer.erase(probe, eraserReach())) paintInfo();
        ringFor(e, p, s);
        return;
      }
      hover.hide();
      for (const c of coalesced(e)) {
        const q = local(c.clientX, c.clientY);
        const cs = sample(c);
        layer.extend({ x: q.x, y: q.y, p: cs.pressure || 0.5, tiltX: cs.tiltX, tiltY: cs.tiltY });
      }
      if (e.pointerType === 'pen') info.textContent = `${tr('Pressure')} ${s.pressure.toFixed(2)} · ${tr('tilt')} ${Math.round(90 - (s.altitude * 180) / Math.PI)}° · ${tr('rotation')} ${Math.round(s.twist)}°`;
    });
    const end = (e: PointerEvent) => {
      if (drawing !== e.pointerId) return;
      drawing = null;
      if (erasing) {
        erasing = false;
        probeLast = null;
        layer.endErase();
        store();
        paintInfo();
        return;
      }
      // Scribble to delete: a tight zig-zag over existing ink removes that ink instead of adding more
      const run = layer.running;
      if (run && run.style === 'ink' && e.type === 'pointerup' && prefs.get('penScratch') && isScratchOut(run.points) && layer.hits(run.points, 4).length) {
        const path = run.points.slice();
        layer.discard();
        layer.beginErase();
        const n = layer.erase(path, 4);
        layer.endErase();
        if (n) penFlash(tn(n, 'Deleted {n} stroke', 'Deleted {n} strokes', { n }), 'eraser');
        store();
        paintInfo();
        return;
      }
      const s = layer.end();
      // Drop redaction frames that are too small
      if (s && s.style === 'redact') {
        const a = s.points[0]!;
        const b = s.points[s.points.length - 1]!;
        if (Math.abs(a.x - b.x) < 4 || Math.abs(a.y - b.y) < 4) layer.undo();
      }
      store();
      paintInfo();
    };
    inkCanvas.addEventListener('pointerup', end);
    inkCanvas.addEventListener('pointercancel', end);
    inkCanvas.addEventListener('pointerleave', (e) => e.pointerType === 'pen' && hover.hide());
    // E switches between pen and eraser, like on a hardware keyboard with GoodNotes
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        penTools.toggle();
      }
    };
    dlg.addEventListener('keydown', onKey);

    // ---------- Apply ----------
    async function save(): Promise<number[]> {
      store();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const touched: number[] = [];
      const order = [...strokes.entries()].filter(([, l]) => l.length).sort((a, b) => a[0] - b[0]);
      for (const [i, list] of order) {
        const pg = doc.getPage(i);
        const { width, height } = pg.getSize();
        const k = 3;
        const W = Math.round(width * k);
        const H = Math.round(height * k);
        const over = document.createElement('canvas');
        over.width = W;
        over.height = H;
        const oc = over.getContext('2d')!;
        paintStrokes(oc, list, W, H, layer, false);
        const redacts = list.some((s) => s.style === 'redact');
        if (redacts) {
          if (!preview) throw new Error(tr('Redaction needs the page preview, which is not available in this browser.'));
          const base = document.createElement('canvas');
          if (!(await renderPage(preview, i, base, W / Math.min(2, window.devicePixelRatio || 1)))) throw new Error(tr('Page {n} could not be rendered.', { n: i + 1 }));
          // Safety: a page rendered empty would lose all its content when rebuilt
          if (isBlank(base) && pg.node.Contents()) throw new Error(tr('Page {n} could not be shown. Redaction stopped so that no content is lost.', { n: i + 1 }));
          const bc = base.getContext('2d')!;
          bc.save();
          bc.scale(base.width / W, base.height / H);
          paintStrokes(bc, list, W, H, layer, true);
          bc.drawImage(over, 0, 0);
          bc.restore();
          const png = await doc.embedPng(await canvasPng(base));
          const fresh = doc.insertPage(i, [width, height]);
          fresh.drawImage(png, { x: 0, y: 0, width, height });
          doc.removePage(i + 1);
        } else {
          const png = await doc.embedPng(await canvasPng(over));
          pg.drawImage(png, { x: 0, y: 0, width, height });
        }
        touched.push(i + 1);
      }
      const out = await doc.save();
      await fs.write(path, out, opt.origin || 'pencil');
      return touched;
    }

    let done = false;
    const finish = (r: PdfPenResult) => {
      if (done) return;
      done = true;
      ro.disconnect();
      offTool();
      penTools.set('pen');
      dlg.close();
      dlg.remove();
      void preview?.destroy?.();
      resolve(r);
    };
    cancel.onclick = () => finish({ saved: false, pages: [] });
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish({ saved: false, pages: [] });
    });
    apply.onclick = async () => {
      apply.disabled = true;
      apply.textContent = tr('Writing …');
      try {
        const pages = await save();
        toast(tr('{file} updated', { file: basename(path) }), 'success', pages.length > 1 ? tr('Pages {list} edited with the pencil.', { list: pages.join(', ') }) : tr('Page {list} edited with the pencil.', { list: pages.join(', ') }));
        finish({ saved: true, pages });
      } catch (e) {
        toast(tr('The PDF could not be written'), 'error', (e as Error).message);
        apply.disabled = false;
        apply.textContent = tr('Apply to the PDF');
      }
    };

    const ro = new ResizeObserver(() => {
      store();
      void layout();
    });
    dlg.showModal();
    ro.observe(stage);
    setTool(tool);
    void layout();
    (window as unknown as { __workcraftPdfPen?: unknown }).__workcraftPdfPen = { layer, setTool, go, get page() { return page; }, pageBlank: () => isBlank(pageCanvas), cancel: () => cancel.click() };
  });
}

/** Only white pixels? (samples in a grid, enough for text and graphics) */
export function isBlank(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext('2d');
  if (!ctx || !c.width || !c.height) return true;
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const step = Math.max(1, Math.floor(Math.sqrt((c.width * c.height) / 250_000)));
  for (let y = 0; y < c.height; y += step)
    for (let x = 0; x < c.width; x += step) {
      const i = (y * c.width + x) * 4;
      if (data[i]! < 235 || data[i + 1]! < 235 || data[i + 2]! < 235) return false;
    }
  return true;
}

function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => {
      if (!b) return reject(new Error(tr('The image could not be created')));
      void b.arrayBuffer().then((a) => resolve(new Uint8Array(a)));
    }, 'image/png')
  );
}
