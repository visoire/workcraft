// Capability probe and the plan derived from it. Pure functions over an injectable environment, so
// the rules are testable without a browser and never depend on a user agent string or a version.
//
// Two questions are answered here:
//   probeCapabilities()  what does this browser offer right now?
//   planFor()            which runtime mode, storage, renderer and degradations follow from that?

export interface ProbeEnv {
  isSecureContext?: boolean;
  crossOriginIsolated?: boolean;
  devicePixelRatio?: number;
  navigator?: {
    gpu?: unknown;
    serviceWorker?: unknown;
    storage?: { getDirectory?: unknown; persist?: unknown };
    maxTouchPoints?: number;
    standalone?: boolean;
    platform?: string;
  };
  matchMedia?: (query: string) => { matches: boolean };
  SharedArrayBuffer?: unknown;
  PointerEvent?: { prototype?: object };
  WebGL2RenderingContext?: unknown;
  Worker?: unknown;
}

export interface Capabilities {
  /** HTTPS or localhost. WebGPU, service workers, OPFS and persistence need it. */
  secure: boolean;
  /** Started from the Home Screen */
  standalonePwa: boolean;
  webgpu: boolean;
  webgl2: boolean;
  serviceWorker: boolean;
  /** navigator.storage.getDirectory exists (the worker still has to confirm sync access) */
  opfs: boolean;
  worker: boolean;
  persist: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  coalescedEvents: boolean;
  /** Some pointer can hover (Apple Pencil on newer iPads, trackpad, mouse). Calibrated by real events later. */
  hover: boolean;
  coarse: boolean;
  fine: boolean;
  touchPoints: number;
  dpr: number;
}

const root = (): ProbeEnv => globalThis as unknown as ProbeEnv;

export function probeCapabilities(env: ProbeEnv = root()): Capabilities {
  const nav = env.navigator;
  const mq = (q: string) => !!env.matchMedia?.(q).matches;
  const secure = !!env.isSecureContext;
  return {
    secure,
    standalonePwa: mq('(display-mode: standalone)') || !!nav?.standalone,
    // navigator.gpu exists only in a secure context in Safari; checking both keeps tests honest
    webgpu: secure && !!nav?.gpu,
    webgl2: typeof env.WebGL2RenderingContext !== 'undefined',
    serviceWorker: secure && !!nav?.serviceWorker,
    opfs: secure && typeof nav?.storage?.getDirectory === 'function',
    worker: typeof env.Worker === 'function',
    persist: secure && typeof nav?.storage?.persist === 'function',
    sharedArrayBuffer: typeof env.SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: !!env.crossOriginIsolated,
    coalescedEvents: !!env.PointerEvent?.prototype && 'getCoalescedEvents' in env.PointerEvent.prototype,
    hover: mq('(any-hover: hover)'),
    coarse: mq('(any-pointer: coarse)'),
    fine: mq('(any-pointer: fine)'),
    touchPoints: nav?.maxTouchPoints || 0,
    dpr: Math.max(1, env.devicePixelRatio || 1),
  };
}

// ---------------------------------------------------------------- runtime mode

/** desktop: the PC itself. hybrid: an iPad paired with a desktop on the home network. standalone: no desktop. */
export type RuntimeMode = 'desktop' | 'hybrid' | 'standalone';

/** The decision of src/app/main.ts (backend.probe) as a mode. */
export function runtimeMode(backend: 'desktop' | 'browser', remote: boolean): RuntimeMode {
  if (backend === 'browser') return 'standalone';
  return remote ? 'hybrid' : 'desktop';
}

export type StorageKind = 'rest' | 'opfs' | 'indexeddb';
export type RendererKind = 'webgpu' | 'webgl2';
export type IsolationState = 'active' | 'available' | 'unavailable';

/** Ids of things that work less well than they could. The interface maps them to plain sentences. */
export type Degradation =
  | 'insecure-context'
  | 'no-offline-cache'
  | 'no-opfs'
  | 'no-webgpu'
  | 'no-webgl2'
  | 'no-persistence'
  | 'no-coalesced-events'
  | 'not-installed';

export interface SystemPlan {
  mode: RuntimeMode;
  storage: StorageKind;
  renderer: RendererKind;
  offlineCache: boolean;
  isolation: IsolationState;
  notes: Degradation[];
}

export function planFor(caps: Capabilities, mode: RuntimeMode, opts: { ipad?: boolean; opfsWorks?: boolean } = {}): SystemPlan {
  const standalone = mode === 'standalone';
  const opfsOk = caps.opfs && caps.worker && opts.opfsWorks !== false;
  const storage: StorageKind = standalone ? (opfsOk ? 'opfs' : 'indexeddb') : 'rest';
  const renderer: RendererKind = caps.webgpu ? 'webgpu' : 'webgl2';
  const isolation: IsolationState = caps.crossOriginIsolated ? 'active' : caps.secure && caps.serviceWorker ? 'available' : 'unavailable';
  const notes: Degradation[] = [];
  if (!caps.secure) notes.push('insecure-context');
  if (!caps.serviceWorker) notes.push('no-offline-cache');
  if (standalone && !opfsOk) notes.push('no-opfs');
  if (!caps.webgpu) notes.push(caps.webgl2 ? 'no-webgpu' : 'no-webgl2');
  if (standalone && caps.secure && !caps.persist) notes.push('no-persistence');
  if (opts.ipad && !caps.coalescedEvents) notes.push('no-coalesced-events');
  if (opts.ipad && !caps.standalonePwa && caps.secure) notes.push('not-installed');
  return { mode, storage, renderer, offlineCache: caps.serviceWorker, isolation, notes };
}
