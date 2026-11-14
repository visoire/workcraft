# iPadOS compatibility layer

How WorkCraft keeps its engines (the apps of the catalog, first of all WordCraft, GridCraft, DeckCraft and PdfCraft) and every later engine working on
iPadOS, without editing the engines and without tying any fix to a version number. Read the [iPadOS guide](IPADOS-GUIDE.md)
first for what a user sees. This page is for people who change the layer or drop in a new engine release.

## The idea

An engine is a WebAssembly build in a same-origin iframe. WorkCraft treats it as a black box with two kinds of
surface: what it **says** about itself and what it **does**.

```
 engine page (iframe)                            workspace
 ┌──────────────────────────┐                    ┌───────────────────────────────────────────┐
 │ public/craft-frame.js    │  workcraft:* msgs  │ src/ipados/adapter.ts   (one per engine)  │
 │  runs BEFORE wasm starts │ ─────────────────► │   reads the engine's capability manifest  │
 │  frame layer measures    │                    │   attaches the pointer bridge accordingly │
 │  window.__ocFrameInfo    │ ◄───────────────── │   reacts to signals, checks sharpness     │
 └──────────────────────────┘   (same origin)    │ src/ipados/index.ts   (one per workspace) │
                                                 │   capabilities, plan, memory governor,    │
                                                 │   OPFS storage, isolation on demand       │
                                                 └───────────────────────────────────────────┘
```

Rules the layer follows:

1. **Capabilities, never versions.** A measure runs because the browser lacks something or the engine did something, not
   because the engine is called `0.15.2`. `tests/server/ipados.test.ts` fails when `adapter.ts`, `compat.ts` or
   `craft-frame.js` compare or name an engine version.
2. **An engine can step a measure aside.** It advertises a token (below) and the measure does not run.
3. **Measure, then trust.** After start the adapter compares what the engine drew with what the screen needs
   (`sharpness-check`) and puts the result in the engine report. A new engine release that changes its canvas handling
   shows up as `blurry` in the report instead of silently looking wrong.
4. **Never block the engine.** Every measure is wrapped so that a failure is reported and the engine still starts.
5. **Every measure is in the register** (`src/ipados/compat.ts`) and in the table below. A test keeps both in step.

## Engine contract

All of it is optional. An engine that says nothing gets every measure, which is what the four current engines do.

**Capability manifest**, either a meta tag or a window property (both are merged, tokens are case-insensitive, unknown
tokens are ignored so a newer engine can add tokens):

```html
<meta name="craft-capabilities" content="native-pen native-touch">
<script>window.__craftCapabilities = { 'native-retina': true };</script>
```

| Token | Meaning | Measure that steps aside |
| :--- | :--- | :--- |
| `native-pen` | the engine reads Pointer Events of type `pen` itself | the pencil half of `pointer-bridge` |
| `native-touch` | the engine pans and pinches with fingers itself | the finger half of `pointer-bridge` |
| `native-retina` | the engine sizes its canvas at CSS size times `devicePixelRatio` | `retina-fit` |
| `gesture-lock` | the engine already blocks Safari page gestures | `gesture-lock` |
| `threads` | the engine uses shared WebAssembly memory | (asks for `isolation-on-demand` at load, not at the first failed allocation) |
| `native-audio` | the engine resumes its own Web Audio contexts after a tap | `audio-unlock` |
| `native-sw` | the engine needs its own service worker even inside a panel | `nested-service-worker` |

**Signals** the frame layer posts to the workspace (`window.parent.postMessage`, same origin, `type` starts with
`workcraft:`): `gpu-lost`, `gpu-restored`, `needs-isolation`, and `frame` (size information after every fit). An engine
that handles a situation itself should not post the signal.

**Reports.** `window.__ocFrameInfo` lists the frame measures that ran (`measures`), the pixel ratio, the fit mode and the
canvas sizes. The workspace turns it into the engine report: Settings, Status shows it, the MCP tool `panel-status`
returns it as `engine` for a panel, and `window.__workcraftIpad.ipados.engines` holds it in the browser console.

## Dropping in a new engine release

1. Put the web build under `versions/<set>/`, update `public/releases.json`, run `scripts/pack-web-zips.ps1` and
   `npm run build` (the normal release process, see ARCHITECTURE.md).
2. Open the app on an iPad (or `npm run test:ipad`). Look at the engine report:
   - `sharpness` is `native`, `retina` or `fit`: nothing to do.
   - `oversampled`: the buffer has far more pixels than the screen shows (4x on a 2x screen costs four times the GPU memory). The Retina fix drops itself in the common case; if it persists the engine sizes its canvas in a new way.
   - `blurry`: the engine changed how it sizes its canvas. Add `native-retina` to its manifest if it now does it right,
     or adjust `retina-fit` in `public/craft-frame.js`.
   - a measure shows `failed`: read its reason. The most likely cause is a renamed DOM element the measure looks for.
3. If the engine now does something itself (pencil, touch, gestures), add the matching token to its manifest. The
   measure steps aside by itself.
4. If the engine needs threads, nothing else is needed: the first shared memory allocation (or the `threads` token) makes
   the workspace offer isolation, and the service worker adds the headers.

No file of the iPadOS layer names the version. `public/sw.js` only changes its app cache name with the release
(`appsCache` in `releases.json`), as before.

## The register

| Id | Layer | What goes wrong on iPadOS | What the measure does | Opt-out token |
| :--- | :--- | :--- | :--- | :--- |
| `viewport-meta` | frame | A different viewport tag lays the engine out at 980 px and Safari zooms it. | One viewport tag with `viewport-fit=cover`. | none |
| `pixel-ratio` | frame | The engine window and the workspace disagree on `devicePixelRatio`. | The engine reports the workspace value, at most 2 (WebKit memory limits). | none |
| `retina-fit` | frame | The web builds size the canvas buffer in CSS pixels but render at the pixel ratio: the interface looks twice as large. | Detected by measuring, then the canvas is laid out at physical size and scaled back with `transform`. Checks itself: a buffer about pixel-ratio times wider than the layout means the engine already draws at the pixel ratio, and the fix is dropped for good. | `native-retina` |
| `window-modes` | frame | Stage Manager, Split View, Slide Over and rotation resize the window. | Re-fits on resize, `orientationchange` and `visualViewport` events, no reload. | none |
| `forced-layout` | frame | WordCraft applies its theme option only at one panel size. | `window.__ocFrameForce` lays the engine out at a fixed size for a moment. | none |
| `gesture-lock` | frame | iPadOS ignores `maximum-scale`: pinch and double tap zoom the page, a pan rubber-bands it. | Cancels `gesturestart`, `gesturechange`, `gestureend`; `touch-action: none` and `overscroll-behavior: none` on the page. | `gesture-lock` |
| `gpu-loss-signal` | frame | Safari can lose the GPU device or WebGL context of a tab; the canvas freezes silently. | Posts `workcraft:gpu-lost` and `workcraft:gpu-restored` (an intended `destroy()` is ignored). | none |
| `shared-memory-signal` | frame | A multithreaded engine fails to start without cross-origin isolation. | Posts `workcraft:needs-isolation` before the first shared `WebAssembly.Memory` is built. | `threads` |
| `resource-meter` | frame | The browser does not report the memory of an iframe. | Counts WebAssembly memory and estimates GPU buffers and textures (`window.__ocResources()`). | none |
| `audio-unlock` | frame | Safari and iPadOS start a Web Audio context suspended and resume it only inside a tap or key press, so an engine that plays or records sound (video, motion, audio apps) is silent. | Wraps `AudioContext` and `webkitAudioContext`, remembers each context and resumes suspended or interrupted ones on the next pointer, touch, key or click. | `native-audio` |
| `pointer-bridge` | host | The engines read mouse-like events: the pencil would act like a finger, a finger like a mouse. | Pencil = precise mouse (coalesced events up to 240 Hz, hover, pressure, tilt, roll). Finger = pan, pinch, tap, long press. Palm touches are dropped while the pencil is active. | `native-pen`, `native-touch` |
| `iframe-isolation-allow` | host | A frame inherits cross-origin isolation only when the page allows it. | The engine iframe has `allow="cross-origin-isolated"`. | none |
| `gpu-loss-recovery` | host | After a lost GPU the panel stays dead; unsaved work is at risk. | Waits 2.5 s for a restore, then reloads the engine, or offers Reload in a banner when there are unsaved changes. | none |
| `sharpness-check` | host | An engine release can change its canvas handling and the fixes silently stop working. | Compares drawing buffer with visible size times pixel ratio, re-fits once, reports `native`, `retina`, `fit`, `blurry` (too few pixels) or `oversampled` (more than 1.5x too many: wasted GPU memory). | none |
| `isolation-on-demand` | host | COOP and COEP break cross-origin images and pop-ups; without a backend nothing sends the headers. | The workspace offers isolation when an engine asks; the service worker adds the headers to same-origin documents and workers. HTTPS only. | `threads` |
| `pen-calibration` | workspace | Apple Pencil (USB-C) and third party pens report pressure 0.5 always; hover needs M2 or newer; roll needs Apple Pencil Pro. | The first strokes calibrate the pen. A flat pen gets pressure simulated from stroke speed; hover and roll are reported only after they were seen. | none |
| `finger-keyboard-guard` | workspace | A finger tap raises the on-screen keyboard while the Apple Pencil is the writing tool. | After the pencil was used (setting Finger opens the keyboard: automatic, never, always) a finger tap focuses the field but sets `inputmode="none"` for that focus; Scribble keeps working, the chat keyboard button brings the keyboard up on purpose. Also inside the engine frames. | none |
| `palm-rejection` | workspace | A resting hand pans the canvas or draws marks; blocking all touches while the pencil hovers also stops the other hand. | Palm = large contact, pencil down or lifted under 450 ms ago, or a touch within 210 px of a hovering pencil. Other fingers still pan and zoom. | none |
| `pen-tools` | workspace | Safari reports neither the Apple Pencil double tap nor, as far as tested, the Pencil Pro squeeze. | Shared pen and eraser state: eraser end (`buttons` 32) and barrel button (`buttons` 2) switch to the eraser while held; E, the toolbar and the setting Barrel button switch everywhere; a chip shows the tool. Stroke eraser with one undo step per pass; a scribble over ink deletes it. | none |
| `hover-circle` | workspace | Without a hover preview the tip position and line width are guesses. | A circle follows the hovering pencil: real line width, dashed circle for the eraser, band for the highlighter, stretched along the tilt. Not shown without hover hardware. | none |
| `memory-governor` | workspace | Safari ends a tab silently at roughly 1.5 to 2.5 GB. | Adds up the resource meter against a budget (iPad 640, 800, 1100 MB; other devices a third of the device memory) and watches how late a timer fires, warns, then unloads or offers to unload hidden, saved panels, least recently shown first; unsaved panels are only offered. On every device. | `memoryGovernor` setting (off) |
| `nested-service-worker` | frame | Some engine builds register a service worker of their own. Inside a panel it would sit between the page and the workspace worker, which already caches the app: two caches for one app, and the engine one keeps serving old files after an update. | Refuses the registration inside a panel (a standalone engine page is not touched). | `native-sw` |
| `launch-relief` | workspace | The apps of the other ecosystems (video, 3D, RAW photos) are far heavier than the office apps. Starting one while others sit loaded in the background can push the tab past what Safari allows, before the governor has a number. | Before a heavy app starts (catalog trait `weight`), hidden, saved panels are unloaded first, least recently shown first; a medium app does the same only above the warn line. Visible panels and unsaved work are never touched. | none |
| `stage-by-weight` | workspace | A workspace opens its first two apps side by side; on an iPad two heavy engines (50 to 150 MB of WebAssembly each) can end the tab before the governor has a number. | The stage takes apps in the workspace order while their weights (catalog trait `weight`) fit: two medium apps, or a heavy app with a light one, on an iPad; two heavy apps elsewhere. The others stay one click away in the launcher. | none |
| `start-timeout-by-weight` | workspace | A heavy engine compiles its WebAssembly more slowly on an iPad; a flat timeout reports a healthy app as dead. | An app gets 90 s to take over its canvas, times 1.5 when it is heavy and times 1.5 on an iPad, times 0.75 when it is light (up to 202 s). | none |
| `crash-recovery` | workspace | Safari closes an over-sized tab and reloads it without any event; the next session would end the same way. | A session that never marked itself clean (`pagehide`, page hidden) was ended from outside. The next one says so once and runs with a 20 % lower memory budget. | none |
| `audio-hint` | workspace | Sound is blocked until the first tap and nothing says why an app is silent. | The frame layer posts `workcraft:audio-state` while a Web Audio context is suspended or interrupted; the panel shows "Sound is off. Tap the app once to turn it on." until it runs. | `native-audio` |
| `offline-quota-check` | workspace | Keeping the apps of a workspace offline can need several hundred MB; Safari refuses a cache that does not fit. | Persistent storage is requested and the free quota is compared with the size of the builds (a tenth in reserve) before the service worker caches anything; the launcher says what is needed and what is free. | none |
| `shared-files` | workspace | On a standalone iPad there is no file system to share between apps, and engine builds made for independent app collections save into a browser store the other apps and the AI cannot see. | One storage for every app: the project (IndexedDB and OPFS in browser mode). Engines that call `playgroundFiles` (open, saveAs, write, read, onOpen) are bridged to the project, so one file opens in every app that reads its type. | none |
| `opfs-blob-store` | workspace | A 50 MB file was copied whole into IndexedDB on every save. Synchronous OPFS access exists only in a worker. | Files of 128 KB and more go to OPFS through `opfs.worker.ts`; IndexedDB keeps metadata and a blob id. | none |
| `persistent-storage` | workspace | Safari may delete the data of a site not opened for seven days. | Browser mode asks for persistent storage; the Status page says whether it was granted. | none |
| `https-lan` | workspace | Over `http://192.168.x.x` Safari offers no WebGPU, service worker, OPFS or persistence. | The backend serves HTTPS with an mkcert certificate and checks that it covers the pairing address. | none |
| `touch-keys` | workspace | A video editor (split, ripple delete, in and out marks) and a painter (brush, eraser, eyedropper, brush size) are worked with shortcuts, and an iPad without a Magic Keyboard has none. | A bar of shortcut buttons in the panel of an app whose catalog entry names a key table (`traits.keys`: FilmCraft `video`, ProCraft `paint`). Each button sends the key press a hardware keyboard would to the app's canvas (Cmd on Apple platforms, Ctrl elsewhere), keeps the focus on the editor, and has a Shift latch; the bar docks at the top or the bottom and folds to one button. Setting **Touch keys**: Auto (on a touch screen until a hardware keyboard is used, with no on-screen keyboard up), Always, Never. Idea: the community iPad build of FilmCraft by wildrcat (SOURCES.md). | setting `touchKeys` off |
| `export-share` | workspace | A finished export (a video, a PNG) saved into the project is not where an iPad user wants it: Photos, Files and AirDrop are behind the share sheet, which needs a tap. | When an app saves an export through a download, the "Saved" notice on a touch device carries **Share or save to Files**, which opens the share sheet with the file. The file is in the project either way. Idea: the community iPad build of FilmCraft by wildrcat (SOURCES.md). | none |

## Behaviour worth knowing

### Pen calibration

`penCal.observe()` is called from `sample()` in `src/workspace/pencil.ts`, so every consumer (the PdfCraft pencil view, the
hover ring, the trail) gets the corrected pressure. A pen counts as pressure-less after ten contact events with exactly
0.5. One event with any other pressure above 0 proves a sensor for the rest of the session, so a real Apple Pencil is
never mistaken for a flat one. Hover and roll are never assumed: `has-pencil` and the hover ring appear after the first
real event.

### Memory governor

The governor polls every 2.5 seconds and only acts after two rounds above the `act` line (one at `critical`), so the
peak while a document opens does not unload anything. It never unloads a visible panel. It runs on every device, not only on iPads,
watches two signals and has three modes:

- **Memory:** the resource meter of the apps (WebAssembly plus estimated GPU) plus the JavaScript heap where the browser reports it (Chromium).
  The budget is 640, 800, 1100 MB on an iPad, otherwise a third of `navigator.deviceMemory` (6 GB when unknown) for `act`, 80 % for `warn`, 140 % for `critical`.
- **Lag:** `LagMonitor` times a 500 ms timer; `lagLevel` calls the page `slow` (several rounds over 120 ms late) or `laggy` (most rounds over 250 ms, or one over 1.5 s).
  Hidden tabs are ignored. A laggy page counts one level higher (`escalate`: ok to warn, warn to act, never to critical). With memory below the lines it frees one hidden, saved
  panel per round after three laggy rounds.
- **Mode** (`memoryAction`): `auto` frees hidden, saved apps by itself, `ask` offers them in a notice (nothing is freed without a click), `warn` only warns.
- **Unsaved work:** the governor never saves and frees a panel with unsaved changes by itself where the host can offer (the workspace can). It shows a notice naming the
  panel and why; the **Unload** button saves it into the project first and unloads it only when that worked. (Without an `offer` host method, the old behavior stays:
  at `critical` it asks the panel to save through the app's own save command and unloads it only when that worked.)
- **Feedback:** every action is a line in the event list (what, and why, for example "SolidCraft was unloaded because memory use of the apps passed the limit (1900 MB of 1800 MB)").
  A chip in the top bar appears only while memory is high or the page is slow; its tooltip is the last line, a click opens Settings, Memory and GPU, which also shows the list.
  `launch-relief` on a computer unloads hidden apps for a heavy app only above the warn line (on an iPad always).

When nothing is left to free it says so once ("Memory is full") and points to Settings, Memory and GPU.
Settings, Memory and GPU also holds the on/off switch, the mode and the budget override (`memoryGovernor`, `memoryAction`, `memoryBudgetMb`).
The numbers are estimates: browsers do not report real GPU memory.

### What opens, how long it may take, and after a crash

Three measures keep a heavy workspace from ending the tab (all pure logic, tested in `tests/server/ipados.test.ts`, no browser needed):

- **Stage by weight** (`src/ipados/stage.ts`, `pickStageApps`). A workspace opens its first two apps itself. Each costs 1 (`light`), 2 (`medium`, also an app without a weight) or 3 (`heavy`) points
  by its catalog trait; an iPad has 4 points, other devices 6. An app that does not fit is skipped and a lighter one after it may take its place; a single app always opens.
- **Start timeout by weight** (`startTimeoutMs`). 90 s, times 1.5 when heavy, times 0.75 when light, times 1.5 on an iPad. A start that takes longer is reported as failed with the engine's own message.
- **Crash recovery** (`src/ipados/session.ts`). `beginSession` writes "running" with the time into `localStorage` (`workcraft.session`), `pagehide` and the page becoming hidden write "clean", becoming visible again writes "running".
  A start that finds "running" from less than six hours ago means the last session was ended from outside (Safari closing an over-sized tab, a crash, an empty battery). The workspace says so once and scales
  the memory budget by 0.8 for this session. A page discarded in the background was hidden first, so it is not reported. A blocked `localStorage` reads as empty.

The numbers (4 points, the factors, 0.8) are estimates from Safari's known limit, to be tuned on a real device.

### Storage in browser mode

| Condition | Where files go |
| :--- | :--- |
| HTTPS, OPFS worker confirms synchronous handles | files of 128 KB and more in OPFS, the rest and all metadata in IndexedDB |
| HTTPS, OPFS missing or the probe fails (private mode, old iPadOS) | everything in IndexedDB |
| Plain HTTP | everything in IndexedDB (Safari offers no OPFS) |

Every write gets a new blob id and the record switches in one IndexedDB put; the old blob is deleted afterwards. A crash
leaves either the old or the new file, never half of one. A failed OPFS write falls back to IndexedDB for that file.
If Safari evicts OPFS data while the IndexedDB record survives, the file reads as missing (404) instead of returning
garbage. Apps added to the Home Screen are exempt from Safari's seven day eviction of site data; the Status page says
whether persistence was granted.

### Cross-origin isolation

The four office engines use no shared memory (checked: no `SharedArrayBuffer`, no `shared: true` memory, no workers in their
glue code), so WorkCraft does **not** isolate by default. Isolation has a cost: cross-origin images and frames without a
`Cross-Origin-Resource-Policy` stop loading and pop-ups lose their opener. When an engine asks, a notice offers "Enable
and reload"; WorkCraft saves open documents first, the choice is remembered (`workcraft.coi` in `localStorage`, a flag
in the `workcraft-flags` cache of the service worker) and survives updates. It needs HTTPS because it needs the service
worker. Over a backend-served HTTPS connection the service worker still does the work, so no server change is needed.

### What was deliberately not copied from the specification documents

The documents in `iPadOS/` were the starting point. Four recommendations were adapted on purpose:

- **Blanket COOP and COEP from the service worker** (`CoiServiceWorker.ts`): only on demand, see above.
- **`sandbox="allow-scripts allow-same-origin"` on the engine iframe**: not added. With `allow-same-origin` a sandbox gives
  no isolation, and without `allow-downloads`, `allow-modals` and `allow-popups` it would break saving and file pickers
  that the panel host relies on. The iframe is same-origin and served with `frame-ancestors 'self'`.
- **Engines inside a Web Worker with OPFS sync handles**: the engines need the DOM (they are egui/eframe apps that own a
  canvas), so they cannot move into a worker. The worker holds the project storage instead, which is where large files
  cost the most.
- **Local pointer handling in the engine, no `postMessage`**: this is how it already works. `bridgeFrame` runs in the
  workspace window but attaches listeners directly to the engine's `window` (same origin), so there is no message hop
  and no frame of latency.
