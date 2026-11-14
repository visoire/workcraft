// iPadOS compatibility register: every measure that WorkCraft applies between the workspace and the
// embedded engines (WordCraft, GridCraft, DeckCraft, PdfCraft and later ones), in one list.
//
// Why a register:
//   - Measures are keyed by what an engine DOES (capabilities, signals), never by its version number.
//     A new engine release drops in through public/releases.json; nothing here names a version.
//   - An engine can switch a measure off by advertising a capability token (see "Engine contract").
//   - docs/IPADOS-COMPAT.md is checked against this list by tests/server/ipados.test.ts, so a measure
//     that is not documented fails the test run.
//
// Engine contract (all parts optional, an engine that says nothing gets every measure):
//   <meta name="craft-capabilities" content="native-pen native-touch">   or
//   window.__craftCapabilities = { 'native-pen': true }
//   Tokens:
//     native-pen      the engine reads Pointer Events of type pen itself (no mouse bridge for the pencil)
//     native-touch    the engine handles finger pan and pinch itself (no wheel bridge for the finger)
//     native-retina   the engine sizes its canvas at CSS size times devicePixelRatio (no Retina fit)
//     gesture-lock    the engine already blocks Safari page gestures (pinch zoom, rubber band)
//     threads         the engine uses shared WebAssembly memory (asks for cross-origin isolation at load)
//   Unknown tokens are kept and ignored, so a newer engine can add tokens without breaking an older
//   workspace.
//   Signals (public/craft-frame.js posts them to the workspace, same origin): workcraft:needs-isolation,
//   workcraft:gpu-lost, workcraft:gpu-restored, workcraft:frame.

export type Layer =
  /** public/craft-frame.js, runs inside the engine page before WebAssembly starts */
  | 'frame'
  /** src/ipados/adapter.ts and src/workspace/panels/craftapp.ts, runs in the workspace around the iframe */
  | 'host'
  /** the workspace itself (shell, storage, server) */
  | 'workspace';

export interface CompatMeasure {
  id: string;
  layer: Layer;
  /** File that implements it */
  where: string;
  /** What goes wrong on iPadOS without it */
  problem: string;
  /** What the measure does */
  fix: string;
  /** Capability token that switches it off (see Engine contract) */
  optOut?: string;
}

export const COMPAT: readonly CompatMeasure[] = [
  // ---------------------------------------------------------------- frame layer
  {
    id: 'viewport-meta',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'An engine page with a different viewport tag lays out at 980 px and Safari zooms it.',
    fix: 'One viewport tag: width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover.',
  },
  {
    id: 'pixel-ratio',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'The engine window and the workspace report different devicePixelRatio values (iframe zoom, Stage Manager), so canvases are sized differently from the interface around them.',
    fix: 'window.devicePixelRatio inside the engine equals the workspace value, capped at 2 (WebKit memory limits).',
  },
  {
    id: 'retina-fit',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'The web builds size the canvas buffer in CSS pixels but render at the pixel ratio, so the interface appears twice as large on Retina screens.',
    fix: 'Detected by measuring (buffer width equals layout width while the ratio is above 1). The canvas is laid out at physical size and scaled back with transform: scale(1 / ratio).',
    optOut: 'native-retina',
  },
  {
    id: 'window-modes',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'Stage Manager, Split View, Slide Over and rotation resize the window; an engine that reads its size once stays at the old size.',
    fix: 'ResizeObserver, orientationchange and visualViewport events re-fit the canvas without reloading the WebAssembly instance.',
  },
  {
    id: 'forced-layout',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'WordCraft applies its theme option only at a fixed panel size.',
    fix: 'window.__ocFrameForce lays the engine out at a fixed size for a moment (public/craft-theme.js uses it).',
  },
  {
    id: 'gesture-lock',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'iPadOS ignores maximum-scale for accessibility, so a two finger pinch or a double tap zooms the whole engine page, and a pan rubber-bands it.',
    fix: 'Cancels the Safari gesturestart, gesturechange and gestureend events and sets touch-action: none and overscroll-behavior: none on the page. Pinch still zooms the document through the wheel bridge.',
    optOut: 'gesture-lock',
  },
  {
    id: 'gpu-loss-signal',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'Safari can lose the GPU device or WebGL context of a tab (memory pressure, GPU process restart). The engine then shows a frozen or black canvas and nothing tells the workspace.',
    fix: 'Listens to GPUDevice.lost (ignoring an intended destroy) and to webglcontextlost / webglcontextrestored, and posts workcraft:gpu-lost / workcraft:gpu-restored to the workspace.',
  },
  {
    id: 'shared-memory-signal',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'A multithreaded engine needs SharedArrayBuffer, which Safari offers only when the page is cross-origin isolated. Without it the engine fails at start with an unhelpful error.',
    fix: 'Wraps WebAssembly.Memory; a descriptor with shared: true posts workcraft:needs-isolation. The current engines use no shared memory, so nothing is asked of the user today.',
    optOut: 'threads',
  },
  {
    id: 'resource-meter',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'Browsers do not report the memory of an iframe, so the workspace cannot tell which panel is heavy.',
    fix: 'Counts WebAssembly memory and estimates WebGPU and WebGL buffers and textures. window.__ocResources() hands the numbers to the memory monitor and to the memory governor.',
  },
  {
    id: 'audio-unlock',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'Safari and iPadOS start a Web Audio context suspended and resume it only inside a tap or key press. An engine that plays or records sound (video, motion, audio apps) is silent until something resumes it.',
    fix: 'Wraps AudioContext and webkitAudioContext, remembers each context, and resumes the suspended or interrupted ones on the next pointer, touch, key or click.',
    optOut: 'native-audio',
  },  {
    id: 'nested-service-worker',
    layer: 'frame',
    where: 'public/craft-frame.js',
    problem: 'Some engine builds register a service worker of their own. Inside a panel it would sit between the page and the workspace worker, which already caches the app: two caches for one app, and the engine one keeps serving old files after an update.',
    fix: 'Refuses the registration inside a panel (a standalone engine page is not touched). The engine keeps working with the workspace cache.',
    optOut: 'native-sw',
  },  // ---------------------------------------------------------------- host layer
  {
    id: 'pointer-bridge',
    layer: 'host',
    where: 'src/workspace/pencil.ts, src/ipados/adapter.ts',
    problem: 'The engines read mouse-like events. The Apple Pencil would act like a finger and a finger would act like a mouse.',
    fix: 'Pencil: a precise mouse (coalesced events up to 240 Hz, hover, pressure, tilt, twist for the preview). Finger: pan, pinch and tap through wheel and click events, long press opens the context menu. Palm touches are dropped while the pencil is active.',
    optOut: 'native-pen / native-touch',
  },
  {
    id: 'iframe-isolation-allow',
    layer: 'host',
    where: 'src/workspace/panels/craftapp.ts',
    problem: 'A frame inherits cross-origin isolation only when the embedding page allows it.',
    fix: 'The engine iframe carries allow="cross-origin-isolated", so an isolated workspace passes SharedArrayBuffer on to a multithreaded engine.',
  },
  {
    id: 'gpu-loss-recovery',
    layer: 'host',
    where: 'src/ipados/adapter.ts',
    problem: 'After a lost GPU device the panel stays dead until the user finds the reload button, and unsaved work is at risk.',
    fix: 'On workcraft:gpu-lost the panel waits for a restore, then reloads the engine when nothing is unsaved, or offers Reload in a banner when there is.',
  },
  {
    id: 'sharpness-check',
    layer: 'host',
    where: 'src/ipados/adapter.ts',
    problem: 'An engine release can change how it sizes its canvas. The fixes above would then silently stop working.',
    fix: 'After start the adapter compares the drawing buffer with the visible size times the pixel ratio, re-fits once, and reports blurry, oversampled, native, retina or fit in the engine report (Settings, Status).',
  },
  {
    id: 'isolation-on-demand',
    layer: 'host',
    where: 'src/ipados/isolation.ts, public/sw.js',
    problem: 'Cross-origin isolation (COOP and COEP) breaks cross-origin images and pop-ups, so it must not be on for engines that do not need it. Without a backend there is no server to send the headers.',
    fix: 'When an engine signals shared memory, the workspace offers to switch isolation on; the service worker then adds the headers to same-origin documents and workers. Needs HTTPS (secure context).',
  },
  // ---------------------------------------------------------------- workspace layer
  {
    id: 'pen-calibration',
    layer: 'workspace',
    where: 'src/ipados/pen-calibration.ts, src/workspace/pencil.ts',
    problem: 'Apple Pencil (USB-C) and third party pens report a constant pressure of 0.5; hover exists only on newer iPads; twist only on Apple Pencil Pro. Code that assumes all three draws lines of one width or hides a hover preview that never comes.',
    fix: 'The first strokes calibrate the pen. A pen with constant pressure gets a pressure simulated from stroke speed; hover and twist are reported only after they were seen.',
  },
  {
    id: 'finger-keyboard-guard',
    layer: 'workspace',
    where: 'src/ipados/finger-keyboard.ts, src/ipados/pen-ui.ts, src/ipados/pen-input.ts',
    problem: 'A finger resting on or tapping a text field raises the on-screen keyboard while the Apple Pencil is the writing tool, and covers half the page.',
    fix: 'After the pencil was used (setting Finger opens the keyboard: automatic, never, always) a finger tap still focuses the field, but the field is switched to inputmode none for that focus. The pencil writes with Scribble; the keyboard button of the chat input brings the keyboard up on purpose. Also applied to the fields inside the engine frames.',
  },
  {
    id: 'palm-rejection',
    layer: 'workspace',
    where: 'src/ipados/pen-input.ts, src/workspace/pencil.ts',
    problem: 'A resting hand next to the pencil pans the canvas or draws stray marks; blocking every touch while the pencil hovers also stops the other hand from panning.',
    fix: 'A touch is a palm when its contact is large, the pencil is down or lifted less than 450 ms ago, or it lands within 210 px of a hovering pencil. A finger far from the pencil still pans and zooms.',
  },
  {
    id: 'pen-tools',
    layer: 'workspace',
    where: 'src/ipados/pen-input.ts, src/workspace/pencil.ts, src/workspace/pdf-pen.ts',
    problem: 'Native apps switch between pen and eraser from the pencil itself. Safari reports neither the Apple Pencil double tap nor, as far as tested, the Apple Pencil Pro squeeze.',
    fix: 'One shared tool state. The eraser end (buttons 32) and the barrel button (buttons 2, or a squeeze where the browser reports it as one) switch to the eraser while held; E, the toolbar and the setting Barrel button switch it everywhere; a chip shows the tool. The eraser removes whole strokes (one undo step per pass), a scribble over ink deletes it.',
  },
  {
    id: 'hover-circle',
    layer: 'workspace',
    where: 'src/ipados/pen-ui.ts, src/ipados/pen-input.ts',
    problem: 'Without a hover preview the tip position and line width are guesses before the pencil touches.',
    fix: 'A circle follows the hovering pencil (iPad Pro and Air with M2 or newer): the real line width for the pen, a dashed larger circle for the eraser, a band for the highlighter, stretched along the tilt. Nothing is shown on iPads without hover.',
  },
  {
    id: 'memory-governor',
    layer: 'workspace',
    where: 'src/ipados/memory.ts',
    problem: 'Safari ends a tab without a message when it uses roughly 1.5 to 2.5 GB. Four engines at Retina resolution can get there.',
    fix: 'Adds up the resource meter of all panels (and the JavaScript heap) against a budget and watches how late a timer fires; warns, then unloads (or, in ask mode, offers to unload) the panels that are hidden and have no unsaved changes, least recently shown first. A panel with unsaved changes is only ever offered, the click saves it first. Never touches a visible panel. On every device.',
  },
  {
    id: 'stage-by-weight',
    layer: 'workspace',
    where: 'src/ipados/stage.ts, src/ecosystems/ui.ts',
    problem: 'A workspace opens its first two apps side by side. On an iPad two heavy engines (video, 3D, RAW, DAWs: 50 to 150 MB of WebAssembly each) can end the tab before the memory governor has a number.',
    fix: 'The stage takes apps in the workspace order while their weights (catalog trait weight) fit: two medium apps, or a heavy app with a light one, on an iPad; two heavy apps elsewhere. The others stay one click away in the launcher.',
  },
  {
    id: 'start-timeout-by-weight',
    layer: 'workspace',
    where: 'src/ipados/stage.ts, src/workspace/panels/craftapp.ts',
    problem: 'A heavy engine compiles its WebAssembly more slowly on an iPad; a flat start timeout reports a healthy app as dead.',
    fix: 'The time an app gets to take over its canvas is 90 s, times 1.5 for a heavy app and 1.5 on an iPad, times 0.75 for a light app (up to 202 s).',
  },
  {
    id: 'crash-recovery',
    layer: 'workspace',
    where: 'src/ipados/session.ts, src/ipados/index.ts',
    problem: 'Safari closes a tab that uses too much memory and reloads it without any event. The next session would load the same apps and end the same way.',
    fix: 'A session that never marked itself clean (pagehide, page hidden) was ended from outside. The next one says so once and runs with a 20 % lower memory budget.',
  },
  {
    id: 'audio-hint',
    layer: 'workspace',
    where: 'public/craft-frame.js, src/ipados/adapter.ts, src/workspace/panels/craftapp.ts',
    problem: 'Sound is blocked until the first tap, and nothing tells the user why a video or audio app is silent.',
    fix: 'The frame layer posts workcraft:audio-state when a Web Audio context is suspended or interrupted; the panel shows "Sound is off. Tap the app once to turn it on." until it runs.',
    optOut: 'native-audio',
  },
  {
    id: 'offline-quota-check',
    layer: 'workspace',
    where: 'src/ecosystems/offline-apps.ts',
    problem: 'Keeping the apps of a workspace offline can need several hundred MB (nine music apps, five 3D apps); Safari refuses a cache that does not fit or later deletes non-persistent storage.',
    fix: 'Before the service worker caches an ecosystem, persistent storage is requested and the free quota (navigator.storage.estimate) is compared with the size of the builds; if it does not fit (with a tenth in reserve) nothing is cached and the launcher says how much is needed and free.',
  },
  {
    id: 'opfs-blob-store',
    layer: 'workspace',
    where: 'src/ipados/opfs.ts, src/ipados/opfs.worker.ts, src/app/offline.ts',
    problem: 'Browser mode kept every file as one IndexedDB value; a 50 MB file was copied whole on every save. Safari offers synchronous OPFS access only inside a dedicated worker.',
    fix: 'Files of 128 KB and more go to the Origin Private File System through a worker (synchronous access handles). IndexedDB keeps the metadata and a reference. Without OPFS everything stays in IndexedDB as before.',
  },
  {
    id: 'persistent-storage',
    layer: 'workspace',
    where: 'src/ipados/index.ts',
    problem: 'Safari may delete the data of a site that was not opened for seven days. Apps added to the Home Screen are exempt.',
    fix: 'Browser mode asks for persistent storage once, and the Status page says whether it was granted and recommends Add to Home Screen.',
  },
  {
    id: 'https-lan',
    layer: 'workspace',
    where: 'src/server/tls.ts, src/server/index.ts, scripts/lan-cert.mjs',
    problem: 'Over http://192.168.x.x Safari treats the page as insecure: no WebGPU, no service worker, no OPFS, no offline use.',
    fix: 'The backend serves HTTPS with a certificate from mkcert (npm run lan:cert, then --https), checks that the certificate covers the pairing address, and prints https pairing addresses.',
  },
  {
    id: 'launch-relief',
    layer: 'workspace',
    where: 'src/ipados/memory.ts, src/ipados/index.ts, src/workspace/panels/craftapp.ts',
    problem: 'The apps of the other ecosystems (video, 3D, RAW photos) are far heavier than the office apps. Starting one while others sit loaded in the background can push the tab past what Safari allows, before the governor has seen a number.',
    fix: 'Before a heavy app starts (catalog trait weight), the hidden, saved panels are unloaded first, least recently shown first; a medium app does the same only when memory is already above the warn line. Visible panels and unsaved work are never touched.',
  },
  {
    id: 'shared-files',
    layer: 'workspace',
    where: 'src/storage/app-files-bridge.ts, public/craft-files.js, src/workspace/panels/craftapp.ts',
    problem: 'On a standalone iPad there is no file system to share between apps, and engine builds made for independent app collections save into a browser store of their own that the other apps and the AI cannot see.',
    fix: 'One storage for every app: the project (IndexedDB and OPFS in browser mode). Engines that call playgroundFiles (open, saveAs, write, read, onOpen) are bridged to the project, so the same file opens in every app that reads its type.',
  },
  {
    id: 'touch-keys',
    layer: 'workspace',
    where: 'src/ipados/touch-keys.ts, src/workspace/touch-keys-ui.ts, src/workspace/panels/craftapp.ts',
    problem: 'A video editor and a painter are worked with shortcuts (split, ripple delete, brush, eraser, brush size), and an iPad without a Magic Keyboard has none.',
    fix: 'A bar of shortcut buttons in the panel of an app whose catalog entry names a key table (traits.keys). Each button sends the key press a hardware keyboard would to the app canvas (Cmd on Apple platforms), keeps the focus on the editor and has a Shift latch. The setting Touch keys: Auto (a touch screen until a hardware keyboard is used), Always, Never.',
  },
  {
    id: 'export-share',
    layer: 'workspace',
    where: 'src/workspace/panels/craftapp.ts',
    problem: 'A finished export saved into the project is not where an iPad user wants it: Photos, Files and AirDrop are behind the share sheet, which needs a tap.',
    fix: 'On a touch device the notice after an app saved an export carries Share or save to Files, which opens the share sheet with the file. The file is in the project either way.',
  },
] as const;

export const COMPAT_IDS: readonly string[] = COMPAT.map((m) => m.id);

// ---------------------------------------------------------------- engine capability manifest

/** Tokens of a manifest given as text ("a b, c"), an array, or an object with truthy values. */
export function parseManifest(input: unknown): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    for (const tok of v.split(/[\s,;]+/)) if (tok) out.add(tok.toLowerCase());
  };
  if (typeof input === 'string') add(input);
  else if (Array.isArray(input)) input.forEach(add);
  else if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) if (v) add(k);
  }
  return out;
}

/** Minimal shape of an engine window, so the reader can be tested without a browser. */
export interface ManifestSource {
  __craftCapabilities?: unknown;
  document?: { querySelector(sel: string): { getAttribute(name: string): string | null } | null };
}

/** What the engine says about itself: meta tag and window property, merged. Never throws. */
export function readManifest(win: ManifestSource | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!win) return out;
  try {
    for (const t of parseManifest(win.__craftCapabilities)) out.add(t);
    const meta = win.document?.querySelector('meta[name="craft-capabilities"]');
    if (meta) for (const t of parseManifest(meta.getAttribute('content'))) out.add(t);
  } catch {
    /* another origin or a closed window: no manifest */
  }
  return out;
}
