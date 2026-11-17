// Panel host for WordCraft, GridCraft, DeckCraft and PdfCraft.
//
// The apps are WebAssembly builds (wgpu: WebGPU, otherwise WebGL2) and run in an iframe of the
// same origin. The bridge to the project:
// - Save/Export in the app (download through <a download>) writes the file into the project.
// - Open in the app (<input type=file>) lists the project files first.
// - Files reach the app as a drop event on its canvas. When the AI or another program changes
//   the open file, it is handed over again: the app shows the new state
//   without reloading the page.
// - Pausing stops the render loop (requestAnimationFrame is held back). The document stays
//   in memory. Resuming runs the held frames.
// - iPadOS: one pixel ratio with the main window, CSS compensation of different sizes
//   (transform: scale with an adjusted container size), WebGL2 without a secure context
//   (home network over HTTP), adapts to Stage Manager, Split View, Slide Over and rotation without
//   reloading the WebAssembly instance.
// - Apple Pencil: a precise mouse in the app (select, drag, place, reshape); pressure, tilt,
//   rotation and hover as a preview in the color of the tool. The finger pans and zooms.

import { h, basename, dirname, extname, normPath, clock, modKey, formatBytes } from '../../app/util.js';
import { icon } from '../../app/icons.js';
import { bus } from '../../app/bus.js';
import { prefs } from '../../app/settings.js';
import { dialog } from '../../app/ui.js';
import { toast, banner, notify } from '../../app/notifications.js';
import { installTouchKeys } from '../touch-keys-ui.js';
import { play } from '../../app/sounds.js';
import { fs } from '../../project/fs.js';
import { TOOLS, toolMark, type PanelContext, type PanelInstance, type PanelResources, type ToolId } from '../registry.js';
import { device } from '../../app/device.js';
import { startTimeoutMs } from '../../ipados/stage.js';
import { InkLayer, pencilSeen, penTools, type InkStyle, type PenSample } from '../pencil.js';
import { HoverRing, ringKindOf } from '../../ipados/pen-ui.js';
import { attachEngine, type Attached } from '../../ipados/adapter.js';
import { ipados } from '../../ipados/index.js';
import type { PdfPenTool } from '../pdf-pen.js';
import { t as tr } from '../../app/i18n.js';
import { blankFor, needsBlank } from '../../core/blank.js';
import { createBridge, type Bridge } from '../../storage/app-files-bridge.js';
import { OFFICE_IDS, appById } from '../../ecosystems/catalog.js';
import { bindPanelLook } from '../app-theme.js';
import { validName, withType } from '../../storage/paths.js';

// playgroundFiles of the engine pages (public/craft-files.js asks here): one bridge per engine window
const bridges = new WeakMap<Window, Bridge>();
(window as unknown as { __workcraftFiles?: unknown }).__workcraftFiles ??= { forWindow: (w: Window) => bridges.get(w)?.api ?? null };

interface PenMode {
  id: string;
  label: string;
  color: string;
  style: InkStyle;
  /** PdfCraft: opens the pencil view with this tool */
  pdf?: PdfPenTool;
}

const BLUE = '#3B82F6';
const GREEN = '#10B981';
const ORANGE = '#F97316';
const TEAL = '#14B8A6';

/** Pencil modes per app, with the color codes of the tools. */
export const PEN_MODES: Partial<Record<ToolId, PenMode[]>> = {
  wordcraft: [
    { id: 'text', label: tr('Select text'), color: BLUE, style: 'highlight' },
    { id: 'vector', label: tr('Vector'), color: ORANGE, style: 'ink' },
  ],
  deckcraft: [
    { id: 'vector', label: tr('Place vector'), color: ORANGE, style: 'ink' },
    { id: 'text', label: tr('Select text'), color: BLUE, style: 'highlight' },
  ],
  gridcraft: [
    { id: 'range', label: tr('Cell range'), color: GREEN, style: 'rect' },
    { id: 'fill', label: tr('Fill handle'), color: GREEN, style: 'ink' },
  ],
  pdfcraft: [
    { id: 'sign', label: tr('Sign'), color: TEAL, style: 'ink', pdf: 'sign' },
    { id: 'ink', label: tr('Freehand'), color: TEAL, style: 'ink', pdf: 'ink' },
    { id: 'mark', label: tr('Highlight'), color: TEAL, style: 'highlight', pdf: 'mark' },
    { id: 'redact', label: tr('Redact'), color: TEAL, style: 'redact', pdf: 'redact' },
  ],
};

/** Renderer of the apps: WebGPU only in a secure context (HTTPS, localhost), otherwise WebGL2. */
export function wantsWebgl(): boolean {
  const nav = navigator as Navigator & { gpu?: unknown };
  return prefs.get('renderer') === 'webgl' || !window.isSecureContext || !nav.gpu;
}

// The time an engine gets to take over its canvas: startTimeoutMs(weight, ipad) in src/ipados/stage.ts (90 s, more for a heavy app and on an iPad)

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pdf: 'application/pdf',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const mimeOf = (p: string) => MIME[extname(p)] || 'application/octet-stream';

type AppWindow = Window & typeof globalThis & { wasmBindings?: unknown };

export async function mount(el: HTMLElement, ctx: PanelContext): Promise<PanelInstance> {
  const t = TOOLS[ctx.tool];
  const root = h('div.ca', { style: `--tool:${t.accent}` });
  el.append(root);
  // The frame around the app follows the workspace switch when the app does, and shows the app's own look when it cannot
  // (src/workspace/app-theme.ts, docs/THEMING.md): no light frame around a dark-only app, no dark frame around a light-only one
  const unbindLook = bindPanelLook(root, ctx.tool);

  let iframe: HTMLIFrameElement | null = null;
  let win: AppWindow | null = null;
  let started = false;
  /** The app did not save when asked to (flushUnsaved); not asked again until the next edit */
  let flushFailed = false;
  let dirty = false;
  let paused = false;
  let panelWebgl = false;
  let renderer = '';
  let loadMs = 0;
  let t0 = 0;
  let lastSave = '';
  let lastSync = '';
  let pendingOpen: string | null = ctx.path;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((r) => (readyResolve = r));
  const blobs = new Map<string, Blob>();
  const cleanups: (() => void)[] = [];
  const frames = { held: new Map<number, FrameRequestCallback>(), next: -1, raf: null as null | ((cb: FrameRequestCallback) => number) };
  let closeBanner: (() => void) | null = null;
  let unbridge: (() => void) | null = null;
  /** iPadOS layer: measures around this engine and its report (src/ipados/adapter.ts) */
  let attached: Attached | null = null;
  const modes = PEN_MODES[ctx.tool] || [];
  let penMode: PenMode | null = modes[0] || null;
  let fingerMode: 'auto' | 'pan' | 'edit' = 'auto';
  const gestures: string[] = [];
  let lastPen: PenSample | null = null;
  let fitScale = 1;
  /** The engine tells its own unsaved state (playgroundFiles.setUnsaved): the key and pointer guess stops */
  let reportsUnsaved = false;

  // ---------- playgroundFiles: the independent apps storage contract on top of the project (src/storage) ----------
  const bridge: Bridge = createBridge({
    files: () => fs.files().map((e) => e.path),
    exists: (p) => fs.exists(p),
    async read(p) {
      const data = await fs.readBinary(p);
      // A 0-byte office file or PDF becomes a valid empty package first (same rule as projectFile)
      if (!data.byteLength && needsBlank(extname(p))) return blankFor(extname(p)) as Uint8Array;
      return data;
    },
    async write(p, bytes) {
      const target = await fs.write(p, bytes, ctx.origin);
      if (t.exts.includes(extname(target)) || (t.imports || []).includes(extname(target))) ctx.setPath(target);
      dirty = false;
      flushFailed = false;
      lastSave = clock();
      closeBanner?.();
      status();
    },
    remove: (p) => fs.remove(p),
    async pick({ types }) {
      const W = win;
      if (!W) return null;
      const input = W.document.createElement('input');
      input.type = 'file';
      if (types.length) input.accept = types.map((e) => '.' + e).join(',');
      const picked = await pickFor(input);
      return picked?.length ? { path: picked[0]! } : null;
    },
    async ask({ name, types }) {
      let download = false;
      let closeAsk = () => {};
      const dir = ctx.path ? dirname(ctx.path) : t.folder || '/';
      const other = h<'button'>('button.btn.ghost', { type: 'button', onclick: () => ((download = true), closeAsk()) }, tr('Download instead'));
      const r = await dialog({
        title: tr('Save {name}', { name: t.name }),
        tone: tr('in the project'),
        body: h('div.dlg-text', h('small.muted', `${tr('Folder')}: ${dir}`), h('div', other)),
        fields: [{ name: 'file', label: tr('File name'), value: basename(withType(name, types)) }],
        ok: tr('Save'),
        validate: (v) => (validName(v.file || '') ? null : tr('That name cannot be used.')),
        onOpen: (close) => (closeAsk = close),
      });
      if (download) return { download: true as const };
      if (!r) return null;
      const wanted = normPath(`${dir}/${withType(r.file!.trim(), types)}`);
      // The file this panel already has is saved over; a different existing file is never overwritten silently
      return { path: wanted === ctx.path ? wanted : fs.uniquePath(wanted) };
    },
    download(name, bytes) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
    unsaved(flag) {
      reportsUnsaved = true;
      dirty = flag;
      flushFailed = false;
      status();
    },
    failed(p, err, bytes) {
      closeBanner?.();
      closeBanner = banner(bannerHost, {
        level: 'error',
        title: tr('Saving {file} failed', { file: basename(p) }),
        message: err.message,
        timeout: 0,
        actions: [{ label: tr('Download instead'), primary: true, run: () => bridge.api.download(basename(p), bytes) }],
      });
    },
  });

  // ---------- Ladeanzeige ----------
  const elapsed = h('span.mono');
  const slowActions = h(
    'div.ca-actions',
    { hidden: true, style: 'margin-top:8px' },
    h('button.btn.sm', { type: 'button', onclick: () => ((panelWebgl = true), reload()) }, tr('Load with WebGL2')),
    h('button.btn.sm.ghost', { type: 'button', onclick: () => reload() }, tr('Reload'))
  );
  const overlay = h(
    'div.ca-loading',
    h('div.frame', h('div.well.ca-loading-well', h('img', { src: t.logo, width: 48, height: 48, alt: '' }), h('p.duo', t.name, ' ', h('span.tone', tr('loading'))), h('small.muted.mono', `v${t.version} · WebAssembly`), elapsed, slowActions))
  );
  const errorBox = h('div.ca-error', { hidden: true });
  const bannerHost = h('div.ca-banner');
  // Sound is blocked until the first tap inside the app (iPadOS and Safari rule): the frame layer says so, this chip tells the user what to do
  const audioHint = h('div.ca-audio-hint', { hidden: true, role: 'status' }, h('span', { html: icon('volume', { size: 14 }) }), h('span', tr('Sound is off. Tap the app once to turn it on.')));
  root.append(overlay, errorBox, bannerHost, audioHint);

  // ---------- Pencil: trail, hover preview and toolbar ----------
  const trailCanvas = h<'canvas'>('canvas.ca-trail', { 'aria-hidden': 'true' });
  const trail = new InkLayer(trailCanvas);
  const hoverRing = h('div.ca-hover', { hidden: true, 'aria-hidden': 'true' });
  /** The circle that follows the hovering pencil: real line width, eraser style while the eraser is active (src/ipados/pen-ui.ts) */
  const ring = new HoverRing(root, hoverRing);
  const penInfo = h('span.ca-pen-info.mono', { role: 'status' });
  const penBar = h('div.ca-pen.frame.sm', { role: 'toolbar', 'aria-label': `Apple Pencil in ${t.name}` });
  root.append(trailCanvas, hoverRing, penBar);
  // Touch keys: FilmCraft and ProCraft are worked with shortcuts (src/ipados/touch-keys.ts; null for every other app)
  const touchKeys = installTouchKeys(root, ctx.tool, () => win);
  let trailFade: ReturnType<typeof setTimeout> | undefined;
  // Collapsed: only the pencil icon and the active mode, so the status line of the app stays free
  let penOpen = false;

  function paintPenBar() {
    const modeBtns = modes.map((m) =>
      h<'button'>('button.ca-pen-mode', {
        type: 'button',
        style: `--pen:${m.color}`,
        'data-mode': m.id,
        'aria-pressed': String(penMode?.id === m.id),
        title: m.pdf ? tr('{label}: open the pencil view', { label: m.label }) : tr('{label} (color {color})', { label: m.label, color: m.color }),
        onclick: () => {
          penMode = m;
          paintPenBar();
          if (m.pdf) void openPdfSheet(m.pdf);
        },
      }, h('i.ca-pen-dot', { 'aria-hidden': 'true' }), h('span', m.label))
    );
    const finger = h<'button'>('button.ca-pen-finger', {
      type: 'button',
      'data-finger': fingerMode,
      title: tr('Finger: move or edit'),
      onclick: () => {
        fingerMode = fingerMode === 'auto' ? 'edit' : fingerMode === 'edit' ? 'pan' : 'auto';
        paintPenBar();
      },
    }, fingerMode === 'pan' ? tr('Finger moves') : fingerMode === 'edit' ? tr('Finger edits') : tr('Finger automatic'));
    const toggle = h<'button'>('button.ca-pen-ic', {
      type: 'button',
      'aria-expanded': String(penOpen),
      'aria-label': penOpen ? tr('Collapse the pencil bar') : tr('Expand the pencil bar'),
      title: 'Apple Pencil',
      html: icon('pen', { size: 16 }),
      onclick: () => {
        penOpen = !penOpen;
        paintPenBar();
      },
    });
    penBar.classList.toggle('is-open', penOpen);
    penBar.replaceChildren(h('div.well.ca-pen-well', toggle, ...(penOpen ? [...modeBtns, finger, penInfo] : modeBtns.filter((b) => b.getAttribute('aria-pressed') === 'true'))));
  }
  paintPenBar();

  /** Coordinates in the app window to coordinates of the panel (with the compensation scale). */
  const toRoot = (x: number, y: number) => ({ x: x * fitScale, y: y * fitScale });

  function onPen(s: PenSample, phase: 'hover' | 'down' | 'move' | 'up' | 'leave') {
    lastPen = s;
    const p = toRoot(s.x, s.y);
    const color = penMode?.color || t.accent;
    const tiltDeg = Math.round(90 - (s.altitude * 180) / Math.PI);
    bus.emit('pencil:sample', { panel: ctx.id, kind: s.kind, pressure: s.pressure, tiltX: s.tiltX, tiltY: s.tiltY, twist: s.twist, hover: s.hover });
    if (phase === 'leave') {
      ring.hide();
      return;
    }
    if (phase === 'hover') {
      ring.move(p.x, p.y, { kind: ringKindOf(penTools.tool, penMode?.style || 'ink'), width: penMode?.style === 'highlight' ? 5 : 2.2, zoom: fitScale, color, altitude: s.altitude, azimuth: s.azimuth });
      penInfo.textContent = `${tr('hovering')} · ${tiltDeg}°`;
      return;
    }
    ring.hide();
    const pt = { x: p.x, y: p.y, p: s.pressure || 0.5, tiltX: s.tiltX, tiltY: s.tiltY };
    if (phase === 'down') {
      clearTimeout(trailFade);
      trailCanvas.classList.remove('is-fading');
      trail.clear();
      const r = root.getBoundingClientRect();
      if (trail.size.width !== Math.round(r.width) || trail.size.height !== Math.round(r.height)) trail.resize(Math.round(r.width), Math.round(r.height));
      trail.begin(penMode?.style === 'redact' ? 'rect' : penMode?.style || 'ink', color, penMode?.style === 'highlight' ? 5 : 2.2, pt);
    } else if (phase === 'move') trail.extend(pt);
    else if (phase === 'up') {
      trail.end();
      trailCanvas.classList.add('is-fading');
      trailFade = setTimeout(() => {
        trail.clear();
        trailCanvas.classList.remove('is-fading');
      }, 650);
    }
    penInfo.textContent = `${tr('Pressure')} ${s.pressure.toFixed(2)} · ${tiltDeg}° · ${Math.round(s.twist)}°`;
  }

  /** PdfCraft: pencil view for signature, freehand, highlight and redaction. */
  async function openPdfSheet(tool: PdfPenTool) {
    const path = ctx.path;
    if (!path || extname(path) !== 'pdf') return toast(tr('Open a PDF file first'), 'warning', tr('The pencil view works with the open file.'));
    if (dirty) {
      const ok = await dialog({ title: t.name, tone: tr('unsaved changes'), body: tr('The pencil view works with the saved state of the file. Unsaved changes in PdfCraft are lost when you apply.'), ok: tr('Open anyway') });
      if (!ok) return;
    }
    const { openPdfPen } = await import('../pdf-pen.js');
    const r = await openPdfPen(path, { tool, origin: 'pencil' });
    if (r.saved) {
      dirty = false;
      status();
    }
  }

  // ---------- Size: compensate different measures (Retina, iPadOS iframes) ----------
  /**
   * Measures the width the app uses for its layout and compensates differences to the
   * visible panel size with transform: scale and an adjusted iframe size.
   */
  function fitFrame() {
    const f = iframe;
    if (!f) return;
    const box = root.getBoundingClientRect();
    if (!box.width || !box.height) return;
    f.style.transform = '';
    f.style.minWidth = '';
    f.style.minHeight = '';
    f.style.width = `${box.width}px`;
    f.style.height = `${box.height}px`;
    let inner = 0;
    try {
      inner = f.contentWindow?.innerWidth || 0;
    } catch {
      inner = 0;
    }
    const ratio = inner > 0 ? inner / box.width : 1;
    if (Math.abs(ratio - 1) > 0.02 && isFinite(ratio)) {
      fitScale = 1 / ratio;
      f.style.minWidth = '0';
      f.style.minHeight = '0';
      f.style.width = `${box.width * ratio}px`;
      f.style.height = `${box.height * ratio}px`;
      f.style.transformOrigin = '0 0';
      f.style.transform = `scale(${fitScale.toFixed(5)})`;
    } else fitScale = 1;
    root.dataset.fit = fitScale.toFixed(3);
    try {
      f.contentWindow?.postMessage({ type: 'workcraft:refit' }, location.origin);
    } catch {
      /* not loaded yet */
    }
  }
  const ro = new ResizeObserver(() => fitFrame());
  ro.observe(root);
  cleanups.push(() => ro.disconnect());
  cleanups.push(bus.on('device:change', () => fitFrame()));
  cleanups.push(bus.on('workspace:resize', () => fitFrame()));

  const tick = setInterval(() => {
    if (!started && t0) {
      const sec = (performance.now() - t0) / 1000;
      elapsed.textContent = sec.toFixed(1) + ' s';
      if (sec >= 8 && slowActions.hidden) slowActions.hidden = false;
    }
  }, 100);
  cleanups.push(() => clearInterval(tick));

  function status() {
    const parts = [started ? renderer : tr('loading')];
    if (paused) parts.push(tr('paused'));
    if (dirty) parts.push(tr('unsaved changes'));
    if (lastSave) parts.push(tr('saved {time}', { time: lastSave }));
    if (lastSync) parts.push(tr('updated {time}', { time: lastSync }));
    ctx.setStatus(parts.join(' · '));
    ctx.setDirty(dirty);
  }

  // ---------- iframe ----------
  function create() {
    const webgl = panelWebgl || wantsWebgl();
    started = false;
    t0 = performance.now();
    slowActions.hidden = true;
    overlay.hidden = false;
    errorBox.hidden = true;
    iframe = h<'iframe'>('iframe.ca-frame', {
      src: t.src + (webgl ? '?webgl' : ''),
      title: `${t.name} ${t.version}`,
      // cross-origin-isolated: an isolated workspace passes SharedArrayBuffer on to a multithreaded engine
      allow: 'fullscreen; clipboard-read; clipboard-write; cross-origin-isolated',
      scrolling: 'no',
    });
    iframe.addEventListener('load', onLoad);
    root.prepend(iframe);
    fitFrame();
    status();
  }

  function destroy() {
    unbridge?.();
    unbridge = null;
    attached = null;
    ipados.engines.delete(ctx.id);
    if (!iframe) return;
    try {
      iframe.src = 'about:blank';
    } catch {
      /* bereits entfernt */
    }
    iframe.remove();
    iframe = null;
    win = null;
    started = false;
    frames.held.clear();
  }

  function onLoad() {
    try {
      win = iframe?.contentWindow as AppWindow | null;
      if (!win || win.location.href === 'about:blank') return;
      void win.document;
    } catch {
      return fail(tr('The app runs on another origin. The project connection only works on the same origin.'));
    }
    installHooks(win);
    const w = win;
    const startTimeout = startTimeoutMs(t.traits?.weight, device.info.ipad);
    // An engine with shared memory (catalog `isolated`: Lemon Studio) draws its own "needs COOP and COEP" page on a page that is not
    // cross-origin isolated and never starts. Say so at once, and offer the switch (the service worker adds the headers, HTTPS or
    // localhost, then a reload), instead of waiting for the start timeout.
    if (appById(ctx.tool)?.isolated && !ipados.isolation.active) {
      ipados.offerIsolation(t.name);
      return fail(tr('{name} needs shared memory, which a browser allows only on a cross-origin isolated page. Turn isolation on when asked (it needs HTTPS or localhost and the service worker), then reload.', { name: t.name }));
    }
    // A Rust panic ends in `RuntimeError: unreachable`; the engine is dead after it. Without this the panel would stay a black
    // canvas that looks like a slow start (MailCraft 0.12.0 panicked at startup on `std::time`, checked on the unmodified
    // upstream build too). Only that one error counts, a failing file or a network error of the app does not.
    const handleStartupError = (raw: string) => {
      if (win !== w || started) return;
      if (/wgpu|webgpu|requestDevice|requestAdapter|surface|limits/i.test(raw) && !panelWebgl && !wantsWebgl()) {
        panelWebgl = true;
        toast(tr('Switching {name} to WebGL2', { name: t.name }), 'info', tr('WebGPU initialization did not complete; reloading with WebGL2.'));
        reload();
        return;
      }
      if (/RuntimeError: unreachable|panicked at|CompileError|LinkError/i.test(raw)) {
        fail(tr('{name} {version} stopped with an error in its own WebAssembly code (a Rust panic). This comes from that build, not from WorkCraft. Look for a newer build with npm run versions.', { name: t.name, version: t.version ?? '' }));
      }
    };
    const onPanic = (ev: ErrorEvent) => handleStartupError(String(ev.message || ev.error?.message || ''));
    const onReject = (ev: PromiseRejectionEvent) => handleStartupError(String(ev.reason?.message || ev.reason || ''));
    w.addEventListener('error', onPanic);
    w.addEventListener('unhandledrejection', onReject);
    cleanups.push(() => {
      w.removeEventListener('error', onPanic);
      w.removeEventListener('unhandledrejection', onReject);
    });
    const done = async () => {
      if (started || win !== w) return;
      started = true;
      // public/craft-theme.js may still set the app's own theme option (WordCraft), keep the overlay until then
      const themeReady = (w as unknown as { __ocThemeReady?: Promise<void> }).__ocThemeReady;
      if (themeReady) await Promise.race([themeReady, new Promise((r) => setTimeout(r, 15000))]);
      if (win !== w) return;
      loadMs = performance.now() - t0;
      bus.emit('metric', { name: `app:${ctx.tool}`, value: loadMs });
      renderer = !panelWebgl && !wantsWebgl() && (w.navigator as Navigator & { gpu?: unknown }).gpu ? 'WebGPU' : 'WebGL2';
      fitFrame();
      overlay.hidden = true;
      status();
      readyResolve();
      // The app accepts drop events only after its first drawn frames
      void settle(w).then(() => {
        if (win === w && attached) ipados.engines.set(ctx.id, attached.verify());
        if (pendingOpen && win === w) openPath(pendingOpen).catch((e: Error) => toast(e.message, 'error'));
      });
    };
    // The four office engines announce themselves (wasmBindings, TrunkApplicationStarted). The other apps start in other
    // ways: a split build (PhotoCraft) fires the Trunk event for its small boot module long before the app runs, and
    // FilmCraft, EffectCraft and LightCraft never fire it. What a started app does have in common is that it takes over its
    // canvas (an eframe app sizes it, the page's default is 300 x 150) or mounts its UI container and removes its loading element.
    const loading = () => w.document.getElementById(`${ctx.tool}_loading`) || w.document.getElementById('loading');
    const hadLoading = !(OFFICE_IDS as readonly string[]).includes(ctx.tool) && !!loading();
    const canvasStarted = () => {
      const c = w.document.querySelector('canvas');
      return !!c && c.width > 0 && (c.width !== 300 || c.height !== 150);
    };
    const loadingRemoved = () => {
      const el = loading();
      return !el || !el.isConnected;
    };
    const domMounted = () => {
      if (w.document.readyState !== 'complete') return false;
      const host = w.document.querySelector('#root, #app, main, .app, .excalidraw');
      return !!host && host.children.length > 0;
    };
    const engineReady = () => {
      if ((w as unknown as { filmcraftLoad?: { readyMs?: number } }).filmcraftLoad?.readyMs) return true;
      if (hadLoading) return canvasStarted() || loadingRemoved();
      return !!w.wasmBindings || canvasStarted() || domMounted();
    };
    if (engineReady()) done();
    else {
      if (!hadLoading) w.addEventListener('TrunkApplicationStarted', done, { once: true });
      const poll = setInterval(() => {
        if (win !== w) return clearInterval(poll);
        // A one-window app (a Web Lock on its library) refuses a second window. In a workspace the other window is often another
        // panel: LightCraft and LightCraft Classic hold the same lock, checked on both builds. Say so instead of waiting for a timeout.
        let page = '';
        try {
          page = w.document.body?.innerText?.slice(0, 400) ?? '';
        } catch {
          /* the frame is navigating */
        }
        if (/already open in another (tab|window)/i.test(page)) {
          clearInterval(poll);
          return fail(tr('{name} says it is already open in another tab or window. In a workspace that is usually another panel that holds the same library lock (LightCraft and LightCraft Classic share one). Close that panel, then reload this one.', { name: t.name }));
        }
        // Some engines catch their own panic and draw an error page instead of a canvas (Chromaforge 26.46.2: "stopped after an internal
        // error: no pids on this platform"). Show that text as the panel's error instead of waiting for the start timeout.
        const own = /(stopped after an internal error|could not start)\s*:?\s*([^\n]{0,160})/i.exec(page);
        if (own) {
          clearInterval(poll);
          return fail(tr('{name} {version} stopped at startup: {why}. This comes from that build, not from WorkCraft. Look for a newer build with npm run versions.', { name: t.name, version: t.version ?? '', why: own[2]!.trim() || own[1]! }));
        }
        if (engineReady()) {
          clearInterval(poll);
          done();
        } else if (performance.now() - t0 > startTimeout) {
          clearInterval(poll);
          fail(tr('{name} did not start within {s} s.', { name: t.name, s: Math.round(startTimeout / 1000) }));
        }
      }, 200);
      cleanups.push(() => clearInterval(poll));
    }
  }

  /** Waits a few frames of the app (at most 2.5 s), so its event handling is ready. */
  function settle(W: AppWindow, frameCount = 12): Promise<void> {
    return new Promise((resolve) => {
      let n = 0;
      const timer = setTimeout(resolve, 2500);
      const raf = frames.raf || W.requestAnimationFrame.bind(W);
      const step = () => {
        if (++n >= frameCount) {
          clearTimeout(timer);
          setTimeout(resolve, 120);
        } else raf(step);
      };
      raf(step);
    });
  }

  function fail(msg: string) {
    overlay.hidden = true;
    errorBox.hidden = false;
    readyResolve();
    errorBox.replaceChildren(
      h(
        'div.frame',
        h(
          'div.well',
          h('p.eyebrow', t.name),
          h('h3.duo', tr('Start') + ' ', h('span.tone', tr('failed'))),
          h('p.muted', msg),
          h(
            'div.ca-actions',
            h('button.btn.primary', { type: 'button', onclick: () => reload() }, tr('Reload')),
            h('button.btn', { type: 'button', onclick: () => ((panelWebgl = true), reload()) }, tr('Load with WebGL2'))
          )
        )
      )
    );
  }

  function reload() {
    destroy();
    create();
  }

  // ---------- Bridge to the app ----------
  function installHooks(W: AppWindow) {
    // playgroundFiles (public/craft-files.js): this window talks to the bridge of this panel. An engine that already
    // registered its onOpen callback before the bridge existed is connected now.
    bridges.set(W, bridge);
    touchKeys?.watch(W);
    reportsUnsaved = false;
    const early = (W as unknown as { __pgOnOpen?: unknown }).__pgOnOpen;
    if (typeof early === 'function') bridge.api.onOpen(early as Parameters<typeof bridge.api.onOpen>[0]);
    // Render loop: hold frames back while the panel is paused
    const origRaf = W.requestAnimationFrame.bind(W);
    const origCancel = W.cancelAnimationFrame.bind(W);
    frames.raf = origRaf;
    W.requestAnimationFrame = (cb: FrameRequestCallback) => {
      if (!paused) return origRaf(cb);
      const id = frames.next--;
      frames.held.set(id, cb);
      return id;
    };
    W.cancelAnimationFrame = (id: number) => {
      if (id < 0) frames.held.delete(id);
      else origCancel(id);
    };

    const proto = W.HTMLElement.prototype;
    const origClick = proto.click;
    const origPicker = W.HTMLInputElement.prototype.showPicker;
    const origCreate = W.URL.createObjectURL.bind(W.URL);
    const origRevoke = W.URL.revokeObjectURL.bind(W.URL);

    W.URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = origCreate(obj);
      if (obj instanceof W.Blob) blobs.set(url, obj);
      return url;
    };
    W.URL.revokeObjectURL = (url: string) => {
      setTimeout(() => {
        blobs.delete(url);
        origRevoke(url);
      }, 30_000);
    };

    proto.click = function (this: HTMLElement) {
      if (this instanceof W.HTMLInputElement && this.type === 'file') return void pickFor(this);
      if (this instanceof W.HTMLAnchorElement && this.hasAttribute('download') && /^(blob|data):/.test(this.href)) {
        void captureDownload(this.href, this.getAttribute('download'));
        if (prefs.get('appDownloads') === 'both') return origClick.call(this);
        return;
      }
      return origClick.call(this);
    };
    if (origPicker) {
      W.HTMLInputElement.prototype.showPicker = function (this: HTMLInputElement) {
        if (this.type === 'file') return void pickFor(this);
        return origPicker.call(this);
      };
    }

    const doc = W.document;
    let down: { x: number; y: number } | null = null;
    doc.addEventListener(
      'keydown',
      (e) => {
        const mod = e.metaKey || e.ctrlKey;
        const k = e.key.toLowerCase();
        if (mod && (k === 'k' || k === 'j')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (k === 'k') bus.emit('palette:open', undefined);
          else bus.emit('ai:toggle', undefined);
          return;
        }
        if (!['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab'].includes(e.key) && !(mod && ['c', 's', 'p', 'f'].includes(k)) && !e.key.startsWith('Arrow')) markDirty();
      },
      true
    );
    doc.addEventListener('paste', markDirty, true);
    doc.addEventListener(
      'pointerdown',
      (e) => {
        down = { x: e.clientX, y: e.clientY };
        ctx.focus();
      },
      true
    );
    doc.addEventListener(
      'pointerup',
      (e) => {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) markDirty();
        down = null;
      },
      true
    );
    // Apple Pencil, finger and trackpad: the pencil works precisely, the finger pans
    // The iPadOS adapter asks the engine what it can do (capability manifest), attaches the pointer
    // bridge accordingly and listens to the engine's signals (lost GPU, shared memory).
    unbridge?.();
    attached = attachEngine(W, {
      tool: ctx.tool,
      bridge: {
        fingerPans: () => fingerMode === 'pan' || (fingerMode === 'auto' && (ctx.tool === 'gridcraft' || pencilSeen())),
        onSample: (smp, phase) => onPen(smp, phase),
        onGesture: (g) => {
          gestures.push(g.type);
          if (gestures.length > 50) gestures.shift();
        },
      },
      onGpuLost: () => {
        if (win !== W) return;
        if (!dirty) {
          toast(tr('The graphics of {name} were lost', { name: t.name }), 'warning', tr('The app reloads.'));
          reload();
          return;
        }
        closeBanner?.();
        closeBanner = banner(bannerHost, {
          level: 'warning',
          title: tr('The graphics of {name} were lost', { name: t.name }),
          message: tr('The canvas may be frozen. Save your changes if the app still reacts, then reload.'),
          timeout: 0,
          actions: [{ label: tr('Reload'), primary: true, run: () => reload() }],
        });
      },
      onNeedsIsolation: () => ipados.offerIsolation(t.name),
      onAudioState: (blocked) => (audioHint.hidden = !blocked),
    });
    unbridge = attached.detach;
    ipados.engines.set(ctx.id, attached.report);
    // Files dragged from the device onto the app also land in the project
    doc.addEventListener(
      'drop',
      (e) => {
        if (!e.isTrusted || !e.dataTransfer?.files?.length) return;
        for (const f of e.dataTransfer.files) void importIntoProject(f).then((p) => p && ctx.setPath(p));
      },
      true
    );
  }

  function markDirty() {
    if (dirty || reportsUnsaved) return;
    dirty = true;
    flushFailed = false;
    status();
  }

  async function importIntoProject(file: File): Promise<string> {
    const target = fs.uniquePath(normPath(`${t.folder}/${file.name}`));
    await fs.write(target, await file.arrayBuffer(), ctx.origin);
    return target;
  }

  /** Save in the app: write the file into the project. */
  async function captureDownload(href: string, rawName: string | null) {
    try {
      const blob = blobs.get(href) || (await (await fetch(href)).blob());
      const name = (rawName || 'export').replace(/[\\/]/g, '-');
      const cur = ctx.path;
      const dir = cur ? dirname(cur) : t.folder || '/';
      const target = cur && basename(cur) === name ? cur : normPath(`${dir}/${name}`);
      const existed = fs.exists(target);
      await fs.write(target, blob, ctx.origin);
      if (t.exts.includes(extname(target))) ctx.setPath(target);
      dirty = false;
      lastSave = clock();
      closeBanner?.();
      status();
      play('notify');
      const title = existed ? tr('Updated: {path}', { path: target }) : tr('Saved: {path}', { path: target });
      // On an iPad a finished export is usually wanted in Photos, Files or AirDrop, not only inside the project: the share sheet
      // offers Save Video, Save to Files and AirDrop (idea from the community iPad build of FilmCraft, SOURCES.md). It needs a tap,
      // so it is an action on the notice, and the file is already saved in the project either way.
      const file = new File([blob], basename(target), { type: blob.type || mimeOf(target) });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (device.touchUi && nav.canShare?.({ files: [file] })) {
        notify({
          level: 'success',
          title,
          timeout: 12_000,
          actions: [
            {
              label: tr('Share or save to Files'),
              primary: true,
              run: async () => {
                try {
                  await navigator.share({ files: [file], title: file.name });
                } catch (e) {
                  if ((e as Error).name !== 'AbortError') toast(tr('The share sheet did not open'), 'warning', (e as Error).message);
                }
              },
            },
          ],
        });
      } else toast(title, 'success');
    } catch (e) {
      toast(tr('Saving into the project failed'), 'error', (e as Error).message);
    }
  }

  function acceptsPath(input: HTMLInputElement, path: string) {
    const accept = (input.accept || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const ext = extname(path);
    if (!accept.length) return t.exts.includes(ext) || (t.imports || []).includes(ext);
    return accept.some((a) => (a.startsWith('.') ? a.slice(1) === ext : a.endsWith('/*') ? mimeOf(path).startsWith(a.slice(0, -1)) : mimeOf(path) === a));
  }

  /** File picker of the app: project files, drag and drop, or the device. */
  async function pickFor(input: HTMLInputElement): Promise<string[] | null> {
    const W = win;
    if (!W) return null;
    const files = fs.files().filter((e) => acceptsPath(input, e.path));
    let chosen: string[] | null = null;
    let closeDlg = () => {};
    const pick = (paths: string[]) => {
      if (!paths.length) return;
      chosen = input.multiple ? paths : [paths[0]!];
      closeDlg();
    };

    // Filter and list of the project files of this app
    const filter = h<'input'>('input.input.ca-pick-filter', { type: 'search', placeholder: tr('Filter files'), 'aria-label': tr('Filter files'), autocomplete: 'off', spellcheck: 'false' });
    const list = h('div.ca-pick-list', { role: 'listbox', 'aria-label': tr('Files in the project') });
    const paintList = () => {
      const q = filter.value.trim().toLowerCase();
      const shown = files.filter((f) => !q || f.path.toLowerCase().includes(q));
      list.replaceChildren(
        ...(shown.length
          ? shown.map((f) =>
              h(
                'button.ca-pick-item',
                { type: 'button', role: 'option', onclick: () => pick([f.path]) },
                h('span.ca-pick-mark', { html: toolMark(ctx.tool, 20) }),
                h('span.ca-pick-name', h('strong', basename(f.path)), h('small.mono.muted', dirname(f.path) === '/' ? '/' : dirname(f.path))),
                h('span.ca-pick-meta.mono.muted', `${formatBytes(f.size)} · ${new Date(f.mtime).toLocaleDateString()}`)
              )
            )
          : [
              h(
                'div.ca-pick-empty',
                h('span.ca-pick-empty-ic', { html: icon(files.length ? 'search' : 'folder', { size: 20 }) }),
                h('strong', files.length ? tr('No file matches “{q}”', { q: filter.value.trim() }) : tr('No matching file in the project.')),
                h('small.muted', files.length ? tr('Try another word, or drop a file above.') : tr('Drop a file above or choose one from this device.'))
              ),
            ])
      );
    };
    filter.oninput = paintList;
    paintList();

    // Drop zone and the device button
    const device = h<'button'>('button.btn', { type: 'button', html: icon('upload', { size: 16 }) + `<span>${tr('Choose from the device')}</span>` });
    const drop = h(
      'div.ca-drop',
      h('span.ca-drop-ic', { html: icon('upload', { size: 22 }) }),
      h('div.ca-drop-text', h('strong', tr('Drop files here')), h('small.muted', tr('From your computer or from the project tree. Files from the device are copied into the project.'))),
      device
    );
    const root = h('div.ca-pick', drop, h('div.ca-pick-head', h('p.eyebrow', tr('In the project')), files.length ? filter : null), list);

    const importAll = async (arr: File[]) => {
      const usable = arr.filter((f) => acceptsPath(input, f.name));
      if (arr.length > usable.length) toast(tr('Some files do not fit {name}', { name: t.name }), 'warning', arr.filter((f) => !usable.includes(f)).map((f) => f.name).join(', '));
      const paths: string[] = [];
      for (const f of input.multiple ? usable : usable.slice(0, 1)) paths.push(await importIntoProject(f));
      pick(paths);
    };
    let depth = 0;
    const over = (e: DragEvent) => !!e.dataTransfer && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/x-workcraft-path'));
    root.addEventListener('dragenter', (e) => {
      if (!over(e)) return;
      e.preventDefault();
      depth++;
      root.classList.add('is-over');
    });
    root.addEventListener('dragover', (e) => {
      if (!over(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) root.classList.remove('is-over');
    });
    root.addEventListener('drop', (e) => {
      if (!over(e)) return;
      e.preventDefault();
      depth = 0;
      root.classList.remove('is-over');
      const dt = e.dataTransfer!;
      const internal = dt.getData('text/x-workcraft-path');
      if (internal) {
        if (acceptsPath(input, internal)) pick([internal]);
        else toast(tr('That file does not fit {name}', { name: t.name }), 'warning', basename(internal));
        return;
      }
      void importAll([...dt.files]).catch((err) => toast(tr('Saving into the project failed'), 'error', (err as Error).message));
    });

    const dlg = dialog({
      title: tr('Open in {name}', { name: t.name }),
      tone: tr('from the project'),
      body: root,
      ok: false,
      wide: true,
      onOpen: (close) => (closeDlg = close),
    });
    device.onclick = () => {
      const picker = h<'input'>('input', { type: 'file', accept: input.accept || t.exts.map((e) => '.' + e).join(','), hidden: true });
      picker.multiple = input.multiple;
      picker.onchange = async () => {
        const arr = [...(picker.files || [])];
        picker.remove();
        if (!arr.length) return;
        const paths: string[] = [];
        for (const f of arr) paths.push(await importIntoProject(f));
        pick(paths);
      };
      document.body.append(picker);
      picker.click();
    };
    await dlg;
    const picked = chosen as string[] | null;
    if (!picked) {
      input.dispatchEvent(new W.Event('cancel'));
      return null;
    }
    const dt = new W.DataTransfer();
    for (const p of picked) {
      const f = await projectFile(W, p);
      if (!f) return null;
      dt.items.add(f);
    }
    input.files = dt.files;
    input.dispatchEvent(new W.Event('input', { bubbles: true }));
    input.dispatchEvent(new W.Event('change', { bubbles: true }));
    ctx.setPath(picked[0]!);
    dirty = false;
    status();
    return picked;
  }

  async function projectFile(W: AppWindow, path: string): Promise<File | null> {
    let data = await fs.readBinary(path);
    // A 0-byte .xlsx, .docx, .pptx or .pdf (made by an older version or another program) cannot be opened by an app:
    // give it the valid empty package first, so it opens as a new, empty file instead of an error.
    if (!data.byteLength && needsBlank(extname(path))) {
      const blank = blankFor(extname(path)) as Uint8Array;
      await fs.write(path, blank, 'ui').catch(() => undefined);
      data = blank.buffer.slice(blank.byteOffset, blank.byteOffset + blank.byteLength) as ArrayBuffer;
    }
    if (win !== W || !W.File) return null;
    return new W.File([data], basename(path), { type: mimeOf(path), lastModified: fs.stat(path)?.mtime || Date.now() });
  }

  /** Hands a project file to the app canvas as a drop. */
  async function openPath(path: string): Promise<string> {
    pendingOpen = path;
    ctx.setPath(path);
    const W = win;
    if (!started || !W) return tr('The file opens after the start.');
    // The iframe may be unloaded while waiting (project switch, closing)
    const gone = () => win !== W || !W.File;
    if (!fs.exists(path)) await fs.reload();
    if (gone()) return tr('The panel was unloaded.');
    if (!fs.exists(path)) throw new Error(tr('File not found: {path}', { path }));
    // An engine with its own onOpen (playgroundFiles) takes the file natively: other documents stay open in it
    const delivered = bridge.hasHandler() ? await bridge.deliver(path).catch(() => false) : false;
    if (!delivered) {
      const file = await projectFile(W, path);
      if (gone() || !file) return tr('The panel was unloaded.');
      const canvas = W.document.getElementById(t.canvas || '') || W.document.querySelector('canvas');
      if (!canvas) throw new Error(tr('{name}: drawing surface not found', { name: t.name }));
      const dt = new W.DataTransfer();
      dt.items.add(file);
      const r = canvas.getBoundingClientRect();
      const opts: DragEventInit = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      for (const type of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new W.DragEvent(type, opts));
    }
    // Trigger a frame even when the panel is paused right now
    if (paused) kick();
    pendingOpen = null;
    dirty = false;
    closeBanner?.();
    status();
    return tr('{file} passed to {name}.', { file: basename(path), name: t.name });
  }

  function kick() {
    if (!frames.raf) return;
    const held = [...frames.held.values()];
    frames.held.clear();
    for (const cb of held) frames.raf(cb);
  }

  function pause() {
    if (paused) return;
    paused = true;
    status();
  }
  function resume() {
    if (!paused) return;
    paused = false;
    kick();
    status();
  }

  // iPadOS `launch-relief`: a heavy app finds room first (hidden, saved panels are unloaded before it allocates)
  await ipados.makeRoom(t.traits?.weight).catch(() => 0);
  create();
  status();

  return {
    ready,
    open: (path) => openPath(normPath(path)),
    pause,
    resume,
    canUnload: () => !dirty,
    /**
     * Writes unsaved changes into the project through the app's own save command, so the AI reads the
     * version the user sees. Resolves true when nothing is left unsaved.
     */
    async flushUnsaved() {
      if (!dirty) return true;
      const W = win;
      // One try per round of edits: an app that ignores the key does not hold up every message
      if (!W || !started || flushFailed) return false;
      const wasPaused = paused;
      if (wasPaused) resume();
      try {
        const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        const target: EventTarget = W.document.querySelector('canvas') || W.document.activeElement || W.document.body;
        for (const type of ['keydown', 'keyup']) target.dispatchEvent(new W.KeyboardEvent(type, { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));
        for (let i = 0; i < 15 && dirty; i++) await new Promise((r) => setTimeout(r, 100));
      } finally {
        if (wasPaused) pause();
      }
      if (dirty) flushFailed = true;
      return !dirty;
    },
    externalChange(path, kind) {
      if (path !== ctx.path) return;
      if (kind === 'delete') {
        closeBanner?.();
        closeBanner = banner(bannerHost, { level: 'warning', title: tr('{file} was deleted', { file: basename(path) }), message: tr('The app shows the last state. Saving creates the file again.'), timeout: 0 });
        return;
      }
      const apply = async () => {
        await openPath(path);
        lastSync = clock();
        status();
        ctx.setBadge(tr('new'));
        setTimeout(() => ctx.setBadge(null), 2500);
      };
      if (!dirty) return void apply().catch((e: Error) => toast(e.message, 'error'));
      closeBanner?.();
      closeBanner = banner(bannerHost, {
        level: 'warning',
        title: tr('{file} was changed outside', { file: basename(path) }),
        message: tr('The app has unsaved changes. Reload takes the file as it is now and discards your changes.'),
        timeout: 0,
        actions: [
          { label: tr('Reload'), primary: true, run: () => apply() },
          { label: tr('Keep my version'), run: () => {} },
        ],
      });
    },
    resources: () => {
      try {
        const w = iframe?.contentWindow as (Window & { __ocResources?: () => PanelResources }) | null;
        return w?.__ocResources?.() || null;
      } catch {
        return null;
      }
    },
    status: () => ({
      app: t.name,
      version: t.version,
      loaded: started,
      paused: paused,
      renderer: renderer || null,
      file: ctx.path,
      files_bridge: bridge.hasHandler() ? 'engine onOpen' : 'drop',
      unsaved: dirty,
      start_ms: Math.round(loadMs),
      last_saved: lastSave || null,
      last_synced: lastSync || null,
      scale: Number(fitScale.toFixed(3)),
      pixel_ratio: device.info.renderDpr,
      engine: attached ? { sharpness: attached.report.sharpness, density: attached.report.density, capabilities: attached.report.manifest, gpu_lost: attached.report.gpuLost, measures: attached.report.measures.filter((m) => m.state !== 'applied').map((m) => `${m.id}: ${m.state}${m.reason ? ' (' + m.reason + ')' : ''}`) } : null,
      pen_mode: penMode?.id || null,
      finger: fingerMode,
      last_gestures: gestures.slice(-5),
      last_pen: lastPen ? { pressure: lastPen.pressure, tilt_x: lastPen.tiltX, tilt_y: lastPen.tiltY, twist: lastPen.twist, hover: lastPen.hover } : null,
    }),
    /** Pencil view for PdfCraft (tests and command palette) */
    pen: (tool?: string) => (ctx.tool === 'pdfcraft' ? openPdfSheet((tool as PdfPenTool) || 'sign') : undefined),
    async beforeClose() {
      if (!dirty) return true;
      return !!(await dialog({ title: t.name, tone: tr('close'), body: tr('Unsaved changes will be lost. Save in the app first ({key} S or File, Save).', { key: modKey }), ok: tr('Close anyway'), danger: true }));
    },
    unmount() {
      cleanups.splice(0).forEach((f) => f());
      unbindLook();
      touchKeys?.dispose();
      closeBanner?.();
      destroy();
      root.remove();
    },
  };
}
