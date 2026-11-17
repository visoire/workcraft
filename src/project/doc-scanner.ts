// Scan a document: the camera, the corners of the paper (found for you, drag them to correct), a straight and clean page, several pages
// into one PDF in /Scans. The maths and the PDF writer are in src/core/scan.ts. It is our own scanner on purpose: a web page cannot use the
// Scan Documents of iPadOS (VisionKit is for native apps), but Safari lets a page use the camera, and that is all this needs.
//   Camera blocked or missing? The same steps work with a photo from the camera sheet or the library ("Take or choose a photo").
// Apple's own scanner is still one tap away through "Upload files": Choose Files, then the ... menu, then Scan Documents.

import { h } from '../app/util.js';
import { icon } from '../app/icons.js';
import { t } from '../app/i18n.js';
import { toast, notifyError } from '../app/notifications.js';
import { fs } from './fs.js';
import { workspace } from '../workspace/layout.js';
import { buildPdf, enhance, findPaper, insetQuad, pageSize, warp, type PdfPage, type Quad, type ScanLook } from '../core/scan.js';

const MAX_PHOTO = 3000; // the longest side of the photo we keep in memory (an iPad has little of it)
const LOOKS: { id: ScanLook; label: () => string }[] = [
  { id: 'gray', label: () => t('Grey') },
  { id: 'bw', label: () => t('Black and white') },
  { id: 'color', label: () => t('Colour') },
];

interface Page extends PdfPage {
  thumb: string;
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
};

/** Opens the scanner. Resolves with the path of the PDF when pages were saved, else null. */
export function openScanner(): Promise<string | null> {
  return new Promise((resolve) => {
    const pages: Page[] = [];
    let look: ScanLook = 'gray';
    let stream: MediaStream | null = null;
    let photo: { data: ImageData; quad: Quad } | null = null;
    let done = false;

    const video = h<'video'>('video.scan-video', { autoplay: true, playsinline: true, muted: true });
    video.setAttribute('playsinline', '');
    const shot = h<'canvas'>('canvas.scan-shot');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('scan-quad');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    svg.append(poly);
    const handles = [0, 1, 2, 3].map((i) => h('button.scan-handle', { type: 'button', 'aria-label': t('Corner {n}', { n: i + 1 }), 'data-corner': String(i) }));
    const stage = h('div.scan-stage', video, shot, svg, ...handles);
    const hint = h('p.scan-hint');
    const count = h('span.scan-count.mono');
    const strip = h('div.scan-strip', { 'aria-label': t('Pages') });
    const pick = h<'input'>('input', { type: 'file', accept: 'image/*', hidden: true });
    pick.setAttribute('capture', 'environment');
    const pickOnly = h<'input'>('input', { type: 'file', accept: 'image/*', hidden: true });

    const btn = (cls: string, label: string, ic: string | null, run: () => void) => h<'button'>(`button.${cls}`, { type: 'button', onclick: run, 'aria-label': label }, ic ? h('span', { html: icon(ic, { size: 18 }) }) : null, h('span', label));
    const shutter = h<'button'>('button.scan-shutter', { type: 'button', 'aria-label': t('Take the picture'), onclick: () => capture() });
    const choose = btn('btn.ghost.scan-btn', t('Take or choose a photo'), 'image', () => pickOnly.click());
    const retake = btn('btn.ghost.scan-btn', t('Retake'), 'back', () => live());
    const keep = btn('btn.primary.scan-btn', t('Keep this page'), 'check', () => void keepPage());
    const save = btn('btn.primary.scan-btn', t('Save as PDF'), 'archive', () => void savePdf());
    const looks = h('div.seg.scan-looks', { role: 'group', 'aria-label': t('Look of the page') }, ...LOOKS.map((l) => h('button.seg-btn', { type: 'button', 'data-look': l.id, 'aria-pressed': String(look === l.id), onclick: () => ((look = l.id), paintLooks()) }, l.label())));
    const close = h<'button'>('button.scan-close', { type: 'button', 'aria-label': t('Close the scanner'), onclick: () => finish(null), html: icon('close', { size: 20 }) });
    const top = h('div.scan-top', close, h('strong', t('Scan a document')), count);
    const bottom = h('div.scan-bottom');
    const root = h('div.scan', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Scan a document') }, top, stage, hint, strip, bottom, pick, pickOnly);

    const paintLooks = () => looks.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.look === look)));
    const paintCount = () => {
      count.textContent = pages.length ? t(pages.length === 1 ? '{n} page' : '{n} pages', { n: pages.length }) : '';
      strip.replaceChildren(...pages.map((p, i) => h('div.scan-thumb', h('img', { src: p.thumb, alt: t('Page {n}', { n: i + 1 }) }), h('button', { type: 'button', 'aria-label': t('Remove page {n}', { n: i + 1 }), onclick: () => (pages.splice(i, 1), paintCount(), mode('live')), html: icon('close', { size: 12 }) }))));
      strip.hidden = !pages.length;
    };

    function mode(m: 'live' | 'adjust') {
      root.dataset.mode = m;
      video.hidden = m !== 'live';
      shot.hidden = m !== 'adjust';
      svg.style.display = m === 'adjust' ? '' : 'none';
      handles.forEach((hd) => (hd.hidden = m !== 'adjust'));
      if (m === 'live') {
        hint.textContent = stream ? t('Lay the page flat and fill the screen with it. The corners are found for you.') : t('The camera is not available. Take or choose a photo of the page instead.');
        bottom.replaceChildren(choose, stream ? shutter : h('span'), pages.length ? save : h('span'));
      } else {
        hint.textContent = t('Drag the four corners onto the corners of the page.');
        bottom.replaceChildren(retake, looks, keep);
      }
    }

    function live() {
      photo = null;
      mode('live');
    }

    /** Puts a picture on the stage as the photo to adjust: scaled down to what the device can handle, with the paper already found. */
    function show(src: CanvasImageSource, sw: number, sh: number) {
      const s = Math.min(1, MAX_PHOTO / Math.max(sw, sh));
      const w = Math.round(sw * s);
      const hh = Math.round(sh * s);
      shot.width = w;
      shot.height = hh;
      const g = shot.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0, w, hh);
      const data = g.getImageData(0, 0, w, hh);
      // the paper is looked for on a small copy (fast, and the print does not matter at that size)
      const k = Math.min(1, 320 / Math.max(w, hh));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(w * k));
      small.height = Math.max(1, Math.round(hh * k));
      small.getContext('2d')!.drawImage(shot, 0, 0, small.width, small.height);
      const sd = small.getContext('2d')!.getImageData(0, 0, small.width, small.height).data;
      const gray = new Uint8Array(small.width * small.height);
      for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (sd[i]! * 299 + sd[i + 1]! * 587 + sd[i + 2]! * 114) / 1000;
      const q = findPaper(gray, small.width, small.height).map((p) => ({ x: p.x / k, y: p.y / k })) as Quad;
      photo = { data, quad: q.length === 4 ? q : insetQuad(w, hh) };
      mode('adjust');
      layout();
    }

    /** The picture and the overlay are drawn in CSS pixels of the stage; the quad lives in picture pixels. */
    function layout() {
      if (!photo) return;
      const r = stage.getBoundingClientRect();
      const scale = Math.min(r.width / shot.width, r.height / shot.height);
      const w = shot.width * scale;
      const hh = shot.height * scale;
      const ox = (r.width - w) / 2;
      const oy = (r.height - hh) / 2;
      shot.style.cssText = `width:${w}px;height:${hh}px;left:${ox}px;top:${oy}px`;
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      const pts = photo.quad.map((p) => ({ x: ox + p.x * scale, y: oy + p.y * scale }));
      poly.setAttribute('points', pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      handles.forEach((hd, i) => (hd.style.transform = `translate(${pts[i]!.x - 22}px, ${pts[i]!.y - 22}px)`));
    }

    handles.forEach((hd, i) => {
      hd.onpointerdown = (e) => {
        e.preventDefault();
        hd.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          if (!photo) return;
          const r = stage.getBoundingClientRect();
          const scale = Math.min(r.width / shot.width, r.height / shot.height);
          const ox = (r.width - shot.width * scale) / 2;
          const oy = (r.height - shot.height * scale) / 2;
          photo.quad[i] = { x: Math.max(0, Math.min(shot.width, (ev.clientX - r.left - ox) / scale)), y: Math.max(0, Math.min(shot.height, (ev.clientY - r.top - oy) / scale)) };
          layout();
        };
        const up = () => {
          hd.removeEventListener('pointermove', move);
          hd.removeEventListener('pointerup', up);
          hd.removeEventListener('pointercancel', up);
        };
        hd.addEventListener('pointermove', move);
        hd.addEventListener('pointerup', up);
        hd.addEventListener('pointercancel', up);
      };
    });

    function capture() {
      if (!video.videoWidth) return;
      show(video, video.videoWidth, video.videoHeight);
    }

    async function fromFile(f: File | undefined) {
      if (!f) return;
      try {
        const bmp = await createImageBitmap(f);
        show(bmp, bmp.width, bmp.height);
        bmp.close?.();
      } catch (e) {
        notifyError(e);
      }
    }
    pick.onchange = () => void fromFile(pick.files?.[0]).finally(() => (pick.value = ''));
    pickOnly.onchange = () => void fromFile(pickOnly.files?.[0]).finally(() => (pickOnly.value = ''));

    async function keepPage() {
      if (!photo) return;
      const q = photo.quad;
      const size = pageSize(q);
      const src = photo.data;
      const px = warp(src.data, src.width, src.height, q, size);
      enhance(px, look);
      const c = document.createElement('canvas');
      c.width = size.w;
      c.height = size.h;
      const out = new ImageData(size.w, size.h);
      out.data.set(px);
      c.getContext('2d')!.putImageData(out, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) return void toast(t('The page could not be made.'), 'error');
      const k = 96 / Math.max(size.w, size.h);
      const th = document.createElement('canvas');
      th.width = Math.round(size.w * k);
      th.height = Math.round(size.h * k);
      th.getContext('2d')!.drawImage(c, 0, 0, th.width, th.height);
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: size.w, h: size.h, thumb: th.toDataURL('image/jpeg', 0.7) });
      paintCount();
      live();
    }

    async function savePdf() {
      if (!pages.length) return;
      try {
        const path = fs.uniquePath(`/Scans/Scan ${stamp()}.pdf`);
        await fs.write(path, buildPdf(pages));
        toast(t(pages.length === 1 ? 'Saved: {name}' : 'Saved {n} pages: {name}', { n: pages.length, name: path.split('/').pop() || path }), 'success');
        finish(path);
        await workspace.openFile(path);
      } catch (e) {
        notifyError(e);
      }
    }

    function finish(path: string | null) {
      if (done) return;
      done = true;
      stream?.getTracks().forEach((tr) => tr.stop());
      removeEventListener('keydown', onKey);
      removeEventListener('resize', layout);
      root.remove();
      resolve(path);
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish(null);
    addEventListener('keydown', onKey);
    addEventListener('resize', layout);

    document.body.append(root);
    paintCount();
    mode('live');
    // the camera, the back one where there is one; without it (or without permission) a photo does the same job
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
        if (done) return stream.getTracks().forEach((tr) => tr.stop());
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      } catch {
        stream = null;
      }
      if (!done && root.dataset.mode === 'live') mode('live');
    })();
  });
}
