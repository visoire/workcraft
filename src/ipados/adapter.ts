// Engine adapter: the one place where the workspace meets an embedded engine on iPadOS.
//
// An engine (WordCraft, GridCraft, DeckCraft, PdfCraft, or a later one) runs in a same-origin iframe.
// This module attaches the host side measures to its window and listens to its signals. It never
// looks at a version number. It asks the engine what it can do (capability manifest, see
// src/ipados/compat.ts) and it measures what the engine actually produced (canvas size, signals).
// Everything that has to run before the engine starts lives in public/craft-frame.js and reports back
// through window.__ocFrameInfo.measures.
//
// Dropping in a new engine release (public/releases.json plus versions/<set>/) needs no change here:
//   - an engine that does the work itself says so with a token and the measure steps aside;
//   - an engine that changes its canvas handling is caught by the sharpness check (engine report);
//   - an engine that needs shared memory triggers the isolation prompt by itself.

import { bridgeFrame, type FrameBridgeOptions } from '../workspace/pencil.js';
import { COMPAT, readManifest, type ManifestSource } from './compat.js';

type FrameWin = Window & typeof globalThis & { __ocFrameInfo?: FrameInfo; __ocFit?: () => void };

interface FrameInfo {
  dpr?: number;
  nativeDpr?: number;
  scale?: number;
  mode?: 'retina' | 'fit' | 'native';
  measures?: string[];
  canvas?: { width: number; height: number; pixelWidth: number; pixelHeight: number };
}

export interface MeasureReport {
  id: string;
  layer: 'frame' | 'host' | 'workspace';
  state: 'applied' | 'skipped' | 'failed';
  reason?: string;
}

export type Sharpness = 'native' | 'retina' | 'fit' | 'blurry' | 'oversampled' | 'unknown';

export interface EngineReport {
  tool: string;
  /** Tokens the engine advertised */
  manifest: string[];
  measures: MeasureReport[];
  sharpness: Sharpness;
  /** Drawing buffer width / (visible width * pixel ratio); about 1 is sharp */
  density: number | null;
  gpuLost: number;
}

export interface AttachOptions {
  tool: string;
  bridge: FrameBridgeOptions;
  /** The GPU device or WebGL context was lost and did not come back in time */
  onGpuLost?(): void;
  /** The engine asked for cross-origin isolation (shared memory) */
  onNeedsIsolation?(): void;
  /** Sound is blocked until a tap (true) or runs (false): a Web Audio context of the engine is suspended */
  onAudioState?(blocked: boolean): void;
}

export interface Attached {
  report: EngineReport;
  /** Run once the engine drew its first frames: checks sharpness and refreshes the report */
  verify(): EngineReport;
  detach(): void;
}

/** How long a lost GPU context gets to come back before the panel is reloaded. */
export const GPU_RESTORE_MS = 2500;

/** Sharpness from the numbers of the frame layer. Pure. */
export function judgeSharpness(info: FrameInfo | undefined, dpr: number): { sharpness: Sharpness; density: number | null } {
  const c = info?.canvas;
  if (!c || !c.width || !c.pixelWidth) return { sharpness: 'unknown', density: null };
  const density = c.pixelWidth / (c.width * Math.max(1, dpr));
  // Below 1x the buffer is smaller than the pixels it covers: soft text and lines
  if (dpr > 1.05 && density < 0.85) return { sharpness: 'blurry', density };
  // Far above 1x: a buffer at twice the screen's pixels costs four times the GPU memory and looks no better
  if (dpr > 1.05 && density > 1.5) return { sharpness: 'oversampled', density };
  return { sharpness: info?.mode === 'retina' ? 'retina' : info?.mode === 'fit' ? 'fit' : 'native', density };
}

export function attachEngine(win: FrameWin, opt: AttachOptions): Attached {
  const manifest = readManifest(win as unknown as ManifestSource);
  const report: EngineReport = { tool: opt.tool, manifest: [...manifest], measures: [], sharpness: 'unknown', density: null, gpuLost: 0 };
  const cleanups: (() => void)[] = [];

  const mark = (id: string, state: MeasureReport['state'], reason?: string) => {
    const m = COMPAT.find((x) => x.id === id);
    const i = report.measures.findIndex((x) => x.id === id);
    const entry: MeasureReport = { id, layer: m?.layer || 'host', state, ...(reason ? { reason } : {}) };
    if (i >= 0) report.measures[i] = entry;
    else report.measures.push(entry);
  };

  // ---------- frame layer: report what public/craft-frame.js did ----------
  // Some frame measures only run once the engine has a canvas (retina-fit, forced-layout), so the list is
  // read again in verify().
  const syncFrame = () => {
    const done = new Set(win.__ocFrameInfo?.measures || []);
    for (const m of COMPAT.filter((x) => x.layer === 'frame')) {
      if (done.has(m.id)) mark(m.id, 'applied');
      else if (m.optOut && manifest.has(m.optOut)) mark(m.id, 'skipped', `engine advertises ${m.optOut}`);
      else mark(m.id, 'skipped', done.size ? 'not needed here' : 'frame layer did not report');
    }
  };
  syncFrame();

  // ---------- pointer-bridge ----------
  const handlePen = !manifest.has('native-pen');
  const handleTouch = !manifest.has('native-touch');
  try {
    const off = bridgeFrame(win, { ...opt.bridge, handlePen, handleTouch });
    cleanups.push(off);
    mark('pointer-bridge', 'applied', handlePen && handleTouch ? undefined : `engine handles ${[!handlePen && 'pen', !handleTouch && 'touch'].filter(Boolean).join(' and ')} itself`);
  } catch (e) {
    mark('pointer-bridge', 'failed', (e as Error).message);
  }

  // ---------- signals from the frame layer ----------
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== win || ev.origin !== location.origin) return;
    const type = (ev.data as { type?: string } | null)?.type;
    if (type === 'workcraft:gpu-lost') {
      report.gpuLost++;
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => opt.onGpuLost?.(), GPU_RESTORE_MS);
    } else if (type === 'workcraft:gpu-restored') {
      clearTimeout(restoreTimer);
    } else if (type === 'workcraft:needs-isolation') {
      opt.onNeedsIsolation?.();
    } else if (type === 'workcraft:audio-state') {
      opt.onAudioState?.(!!(ev.data as { detail?: { blocked?: boolean } }).detail?.blocked);
    }
  };
  window.addEventListener('message', onMessage);
  cleanups.push(() => {
    clearTimeout(restoreTimer);
    window.removeEventListener('message', onMessage);
  });
  mark('gpu-loss-recovery', 'applied');
  mark('isolation-on-demand', 'applied');

  // ---------- sharpness-check ----------
  const verify = (): EngineReport => {
    syncFrame();
    try {
      const dpr = win.devicePixelRatio || 1;
      let j = judgeSharpness(win.__ocFrameInfo, dpr);
      if ((j.sharpness === 'blurry' || j.sharpness === 'oversampled') && win.__ocFit) {
        // One more fit: the engine may have resized its canvas after the last one
        win.__ocFit();
        j = judgeSharpness(win.__ocFrameInfo, dpr);
      }
      report.sharpness = j.sharpness;
      report.density = j.density === null ? null : Math.round(j.density * 100) / 100;
      mark('sharpness-check', 'applied', j.sharpness === 'blurry' ? 'canvas is softer than the screen: report it with the engine version' : j.sharpness === 'oversampled' ? 'canvas has more pixels than the screen needs: wasted GPU memory' : undefined);
    } catch (e) {
      mark('sharpness-check', 'failed', (e as Error).message);
    }
    return report;
  };

  return {
    report,
    verify,
    detach() {
      for (const f of cleanups.splice(0)) f();
    },
  };
}
