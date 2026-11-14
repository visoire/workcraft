/*
 * WorkCraft: environment of the four WebAssembly apps (WordCraft, GridCraft, DeckCraft, PdfCraft)
 * for iPadOS, Retina displays and embedded panels. Runs before the WebAssembly module starts.
 *
 * 1. Exact viewport metadata: width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover
 * 2. One pixel ratio with the main window: window.devicePixelRatio inside the app window equals the
 *    value of the workspace (at most 2, WebKit memory limits).
 * 3. Canvas compensation: when the drawn size of the canvas differs from the visible area (for
 *    example twice the size because of a pixel value instead of CSS pixels), a CSS transform
 *    (scale) with an adjusted size corrects it exactly.
 * 4. Window modes (Stage Manager, Split View, Slide Over, rotation): adjusts without reloading.
 * 5. window.__ocFrameForce = { width, height } lays the app out at a fixed size for a moment
 *    (public/craft-theme.js uses it to set WordCraft's theme option at any panel size).
 * 6. Resource meter: WebAssembly memory and GPU memory estimate (window.__ocResources()).
 * 7. Gesture lock: Safari page gestures (pinch zoom, rubber band) are cancelled.
 * 8. Signals to the workspace (same origin): workcraft:gpu-lost, workcraft:gpu-restored,
 *    workcraft:needs-isolation (shared WebAssembly memory without cross-origin isolation),
 *    workcraft:audio-state ({ blocked }: a Web Audio context is suspended until a tap).
 *
 * Added to apps/<app>/index.html by scripts/releases.mjs (development) and scripts/copy-apps.mjs
 * (build). Without an embedding workspace only 1, 3, 4, 5 and 7 apply.
 *
 * Every step is a "compatibility measure" with an id (docs/IPADOS-COMPAT.md, src/ipados/compat.ts).
 * The ids that ran are listed in window.__ocFrameInfo.measures, and the workspace shows them in the
 * engine report. An engine can switch a step off with a capability token (meta tag
 * craft-capabilities or window.__craftCapabilities), see manifest() below. Nothing here looks at a
 * version number of the engine.
 */
(function () {
  'use strict';
  var w = window;
  var doc = document;
  var MAX_DPR = 2;

  // ---------- 0. Measures, engine manifest, signals ----------
  var measures = [];
  function applied(id) {
    if (measures.indexOf(id) < 0) measures.push(id);
  }
  // What the engine says about itself: <meta name="craft-capabilities" content="native-retina gesture-lock">
  // or window.__craftCapabilities = { 'native-retina': true }. Read on demand, the engine may set it late.
  function manifest() {
    var m = {};
    try {
      var c = w.__craftCapabilities;
      var add = function (s) {
        String(s).split(/[\s,;]+/).forEach(function (t) {
          if (t) m[t.toLowerCase()] = true;
        });
      };
      if (typeof c === 'string') add(c);
      else if (c && typeof c === 'object') for (var key in c) if (c[key]) add(key);
      var meta = doc.querySelector('meta[name="craft-capabilities"]');
      if (meta) add(meta.getAttribute('content') || '');
    } catch (_) {}
    return m;
  }
  function signal(type, detail) {
    try {
      if (w.parent && w.parent !== w) w.parent.postMessage({ type: 'workcraft:' + type, detail: detail || null }, location.origin);
    } catch (_) {}
  }
  function ready(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  // ---------- 1. Viewport ----------
  var VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
  try {
    var metas = doc.querySelectorAll('meta[name="viewport"]');
    var meta = metas[0];
    for (var i = 1; i < metas.length; i++) metas[i].remove();
    if (!meta) {
      meta = doc.createElement('meta');
      meta.name = 'viewport';
      (doc.head || doc.documentElement).appendChild(meta);
    }
    meta.setAttribute('content', VIEWPORT);
    applied('viewport-meta');
  } catch (_) {}

  // ---------- 2. Pixel ratio ----------
  function hostDpr() {
    var q = /[?&]dpr=([\d.]+)/.exec(location.search);
    if (q) return parseFloat(q[1]);
    try {
      if (w.parent && w.parent !== w && typeof w.parent.__workcraftDpr === 'number') return w.parent.__workcraftDpr;
    } catch (_) {
      /* other origin */
    }
    return 0;
  }
  var nativeDesc = Object.getOwnPropertyDescriptor(w, 'devicePixelRatio') || Object.getOwnPropertyDescriptor(Window.prototype, 'devicePixelRatio');
  var nativeDpr = function () {
    try {
      return nativeDesc && nativeDesc.get ? nativeDesc.get.call(w) : 1;
    } catch (_) {
      return 1;
    }
  };
  function effectiveDpr() {
    var h = hostDpr();
    var n = nativeDpr() || 1;
    return Math.min(MAX_DPR, h > 0 ? h : n);
  }
  try {
    Object.defineProperty(w, 'devicePixelRatio', { configurable: true, get: effectiveDpr });
    applied('pixel-ratio');
  } catch (_) {}

  // ---------- 3. Canvas compensation ----------
  var info = { dpr: effectiveDpr(), nativeDpr: nativeDpr(), scale: 1, viewport: { width: 0, height: 0 }, canvas: { width: 0, height: 0, pixelWidth: 0, pixelHeight: 0 }, measures: measures };
  w.__ocFrameInfo = info;

  function viewportSize() {
    var f = w.__ocFrameForce;
    if (f && f.width > 0 && f.height > 0) return { width: f.width, height: f.height };
    var vv = w.visualViewport;
    var de = doc.documentElement;
    return { width: Math.round((vv && vv.width) || de.clientWidth || w.innerWidth), height: Math.round((vv && vv.height) || de.clientHeight || w.innerHeight) };
  }

  var pending = 0;
  // Retina bug of the apps: the drawing buffer follows the CSS size instead of CSS size times the
  // pixel ratio, but rendering uses the pixel ratio, so the interface looked twice as large (iPad,
  // Retina Mac). Fix: lay the canvas out at physical size and scale it back with
  // transform: scale(1 / pixel ratio) onto the visible area.
  var retinaFix = false;
  var wasFixed = false;
  // The engine was seen drawing at the pixel ratio itself: the fix never comes back
  var nativeLocked = false;
  var wasForced = false;
  function fit() {
    pending = 0;
    var canvas = doc.querySelector('canvas');
    var vp = viewportSize();
    var k = effectiveDpr();
    info.viewport = vp;
    info.dpr = k;
    var body = doc.body;
    if (body) {
      body.style.width = vp.width + 'px';
      body.style.height = vp.height + 'px';
      body.style.overflow = 'hidden';
    }
    if (!canvas) return;
    var forced = !!(w.__ocFrameForce && w.__ocFrameForce.width > 0);
    var layoutW = canvas.offsetWidth;
    // Self-check of the fix: with the canvas laid out at physical size, an engine that still has the bug
    // draws a buffer as wide as the layout. A buffer about pixel-ratio times wider means the engine
    // multiplies by the pixel ratio itself (a newer release, or the first measurement caught the canvas
    // before the engine resized it). Keeping the fix would draw at 4x on a 2x screen (four times the GPU
    // memory), so drop it for good.
    if (retinaFix && !nativeLocked && k > 1.05 && layoutW > 0 && canvas.width >= layoutW * k * 0.9) {
      retinaFix = false;
      nativeLocked = true;
    }
    // Detection: buffer about as wide as the layout although the pixel ratio is above 1
    // (an engine that sizes its canvas correctly says native-retina and is left alone)
    if (!retinaFix && !nativeLocked && !manifest()['native-retina'] && k > 1.05 && layoutW > 0 && canvas.width > 0 && Math.abs(canvas.width - layoutW) <= Math.max(2, layoutW * 0.02)) retinaFix = true;
    if (forced) applied('forced-layout');
    if (retinaFix && k > 1.05) {
      wasFixed = true;
      applied('retina-fit');
      canvas.style.width = Math.round(vp.width * k) + 'px';
      canvas.style.height = Math.round(vp.height * k) + 'px';
      canvas.style.transformOrigin = '0 0';
      canvas.style.transform = 'scale(' + (1 / k).toFixed(5) + ')';
      info.scale = 1 / k;
      info.mode = 'retina';
    } else {
      if (forced) {
        // The apps place the canvas with position: absolute; inset: 0, so a forced layout needs explicit sizes
        canvas.style.right = 'auto';
        canvas.style.bottom = 'auto';
        canvas.style.width = vp.width + 'px';
        canvas.style.height = vp.height + 'px';
      } else if (wasFixed || wasForced) {
        wasFixed = false;
        canvas.style.width = '';
        canvas.style.height = '';
        canvas.style.right = '';
        canvas.style.bottom = '';
      }
      // General compensation: the drawn size differs from the visible area
      canvas.style.transform = 'none';
      var r0 = canvas.getBoundingClientRect();
      var s = Math.min(r0.width > 0 ? vp.width / r0.width : 1, r0.height > 0 ? vp.height / r0.height : 1);
      if (Math.abs(s - 1) > 0.01 && isFinite(s) && s > 0) {
        canvas.style.transformOrigin = '0 0';
        canvas.style.transform = 'scale(' + s.toFixed(5) + ')';
        info.scale = s;
        info.mode = 'fit';
      } else {
        canvas.style.transform = '';
        info.scale = 1;
        info.mode = 'native';
      }
    }
    wasForced = forced;
    var r = canvas.getBoundingClientRect();
    info.canvas = { width: Math.round(r.width), height: Math.round(r.height), pixelWidth: canvas.width, pixelHeight: canvas.height };
    try {
      if (w.parent && w.parent !== w) w.parent.postMessage({ type: 'workcraft:frame', info: info }, location.origin);
    } catch (_) {}
  }
  function schedule() {
    if (!pending) pending = (w.requestAnimationFrame || setTimeout)(fit);
  }
  w.__ocFit = fit;

  function watch() {
    var canvas = doc.querySelector('canvas');
    if (canvas && w.ResizeObserver) new w.ResizeObserver(schedule).observe(canvas);
    if (w.ResizeObserver) new w.ResizeObserver(schedule).observe(doc.documentElement);
    if (canvas && w.MutationObserver) new w.MutationObserver(schedule).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    schedule();
  }

  // ---------- 4. Window modes ----------
  w.addEventListener('resize', schedule);
  w.addEventListener('orientationchange', schedule);
  if (w.visualViewport) w.visualViewport.addEventListener('resize', schedule);
  applied('window-modes');
  w.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.type === 'workcraft:refit') schedule();
  });

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();

  // ---------- 6. Resource meter (memory and GPU monitor of the workspace) ----------
  // Counts the WebAssembly memory of the app and estimates its GPU memory (WebGPU buffers and
  // textures, WebGL buffers and textures). Read by the workspace through window.__ocResources().
  var res = { memories: [], gpuApi: '', gpuBytes: 0, textures: 0, buffers: 0 };
  try {
    var WA = w.WebAssembly;
    if (WA) {
      var keep = function (m) {
        if (m && res.memories.indexOf(m) < 0 && res.memories.length < 16) res.memories.push(m);
      };
      var fromInstance = function (inst) {
        try {
          var ex = inst && inst.exports;
          for (var k in ex) if (ex[k] instanceof WA.Memory) keep(ex[k]);
        } catch (_) {}
      };
      var OrigMemory = WA.Memory;
      var isoSignaled = false;
      var MemoryProxy = function (d) {
        // Shared memory needs cross-origin isolation. Tell the workspace BEFORE constructing: without
        // isolation the constructor throws, and the workspace can offer to switch isolation on.
        if (d && d.shared && !w.crossOriginIsolated && !isoSignaled) {
          isoSignaled = true;
          signal('needs-isolation', { reason: 'shared-memory' });
        }
        var m = new OrigMemory(d);
        keep(m);
        return m;
      };
      MemoryProxy.prototype = OrigMemory.prototype;
      WA.Memory = MemoryProxy;
      applied('shared-memory-signal');
      var wrap = function (name) {
        var orig = WA[name];
        if (typeof orig !== 'function') return;
        WA[name] = function () {
          return orig.apply(this, arguments).then(function (r) {
            fromInstance(r && r.instance ? r.instance : r);
            return r;
          });
        };
      };
      wrap('instantiate');
      wrap('instantiateStreaming');
    }
  } catch (_) {}

  var FORMAT_BYTES = { r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1, rg8unorm: 2, r16float: 2, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4, rgba16float: 8, rgba32float: 16, r32float: 4, depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4, rg16float: 4, rg32float: 8 };
  function texBytes(d) {
    var size = d.size || {};
    var wd = size.width || size[0] || 1;
    var ht = size.height || size[1] || 1;
    var layers = size.depthOrArrayLayers || size[2] || 1;
    var px = FORMAT_BYTES[d.format] || 4;
    var mips = d.mipLevelCount || 1;
    return Math.round(wd * ht * layers * px * (mips > 1 ? 1.34 : 1) * (d.sampleCount || 1));
  }
  try {
    var forceWebgl = /[?&]webgl(?==|&|$)/i.test(location.search);
    if (forceWebgl && w.navigator && 'gpu' in w.navigator) {
      try {
        Object.defineProperty(w.navigator, 'gpu', { value: undefined, configurable: true });
        res.gpuApi = 'webgl2';
        applied('webgl2-fallback');
      } catch (_) {}
    }
    // Lazy WebGPU compute pipeline compilation so engines with many shaders do not block startup
    if (!forceWebgl && w.GPUDevice && w.GPUComputePassEncoder && !w.GPUDevice.prototype.__ocLazy) {
      var origCreateCP = w.GPUDevice.prototype.createComputePipeline;
      var origCreateCPAsync = w.GPUDevice.prototype.createComputePipelineAsync;
      var origSetCP = w.GPUComputePassEncoder.prototype.setPipeline;
      var cpPending = new WeakMap();
      var cpCompiled = new WeakMap();
      var cpDone = function (stub, pipe) {
        cpCompiled.set(stub, pipe);
        cpPending.delete(stub);
        return pipe;
      };
      var cpCompile = function (stub) {
        if (cpCompiled.has(stub)) return cpCompiled.get(stub);
        var pair = cpPending.get(stub);
        return cpDone(stub, origCreateCP.call(pair[0], pair[1]));
      };
      var LazyCP = function () {};
      LazyCP.prototype.getBindGroupLayout = function (idx) {
        return cpCompile(this).getBindGroupLayout(idx);
      };
      w.GPUDevice.prototype.createComputePipeline = function (desc) {
        var stub = new LazyCP();
        var copy = Object.assign({}, desc, { compute: Object.assign({}, desc && desc.compute) });
        cpPending.set(stub, [this, copy]);
        if (origCreateCPAsync) {
          origCreateCPAsync.call(this, copy).then(
            function (p) { if (!cpCompiled.has(stub)) cpDone(stub, p); },
            function () {}
          );
        }
        return stub;
      };
      w.GPUComputePassEncoder.prototype.setPipeline = function (pipe) {
        return origSetCP.call(this, pipe instanceof LazyCP ? cpCompile(pipe) : pipe);
      };
      w.GPUDevice.prototype.__ocLazy = true;
      applied('lazy-compute-pipelines');
    }
    var gpu = !forceWebgl && w.navigator && w.navigator.gpu;
    if (gpu && gpu.requestAdapter) {
      var origReq = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = function (o) {
        return origReq(o).then(function (adapter) {
          if (!adapter) return adapter;
          var origDev = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = function (d) {
            var clamped = d;
            try {
              if (d && typeof d === 'object') {
                clamped = Object.assign({}, d);
                if (d.requiredLimits && adapter.limits) {
                  var lim = {};
                  for (var lk in d.requiredLimits) {
                    var want = d.requiredLimits[lk];
                    var cap = adapter.limits[lk];
                    lim[lk] = typeof want === 'number' && typeof cap === 'number' ? Math.min(want, cap) : want;
                  }
                  clamped.requiredLimits = lim;
                }
                if (Array.isArray(d.requiredFeatures) && adapter.features && typeof adapter.features.has === 'function') {
                  clamped.requiredFeatures = d.requiredFeatures.filter(function (f) { return adapter.features.has(f); });
                }
              }
            } catch (_) {}
            return origDev(clamped).catch(function () {
              return origDev({});
            }).then(function (dev) {
              res.gpuApi = 'webgpu';
              // Safari can lose the device (memory pressure, GPU process restart). 'destroyed' is our own
              // or the engine's intended teardown, anything else leaves a frozen canvas.
              try {
                if (dev.lost && dev.lost.then)
                  dev.lost.then(function (li) {
                    if (li && li.reason !== 'destroyed') signal('gpu-lost', { api: 'webgpu', reason: li.reason, message: li.message });
                  });
              } catch (_) {}
              var cb = dev.createBuffer.bind(dev);
              dev.createBuffer = function (desc) {
                var b = cb(desc);
                var n = desc.size || 0;
                res.gpuBytes += n;
                res.buffers++;
                var od = b.destroy.bind(b);
                b.destroy = function () {
                  res.gpuBytes -= n;
                  res.buffers--;
                  b.destroy = od;
                  return od();
                };
                return b;
              };
              var ct = dev.createTexture.bind(dev);
              dev.createTexture = function (desc) {
                var t = ct(desc);
                var n = texBytes(desc);
                res.gpuBytes += n;
                res.textures++;
                var od = t.destroy.bind(t);
                t.destroy = function () {
                  res.gpuBytes -= n;
                  res.textures--;
                  t.destroy = od;
                  return od();
                };
                return t;
              };
              return dev;
            });
          };
          return adapter;
        });
      };
    }
  } catch (_) {}
  try {
    var G2 = w.WebGL2RenderingContext;
    if (G2) {
      var sizes = new WeakMap();
      var bound = { buf: null, tex: null };
      var account = function (obj, n) {
        if (!obj) return;
        var old = sizes.get(obj) || 0;
        sizes.set(obj, n);
        res.gpuBytes += n - old;
      };
      var P = G2.prototype;
      var oBindBuffer = P.bindBuffer;
      P.bindBuffer = function (t, b) {
        bound.buf = b;
        return oBindBuffer.apply(this, arguments);
      };
      var oBufferData = P.bufferData;
      P.bufferData = function (t, data) {
        if (!res.gpuApi) res.gpuApi = 'webgl2';
        account(bound.buf, typeof data === 'number' ? data : (data && data.byteLength) || 0);
        return oBufferData.apply(this, arguments);
      };
      var oBindTexture = P.bindTexture;
      P.bindTexture = function (t, tex) {
        bound.tex = tex;
        return oBindTexture.apply(this, arguments);
      };
      var oTexStorage2D = P.texStorage2D;
      P.texStorage2D = function (t, levels, fmt, wd, ht) {
        if (!res.gpuApi) res.gpuApi = 'webgl2';
        account(bound.tex, Math.round(wd * ht * 4 * (levels > 1 ? 1.34 : 1)));
        return oTexStorage2D.apply(this, arguments);
      };
      var oTexImage2D = P.texImage2D;
      P.texImage2D = function (t, level, ifmt, wd, ht) {
        if (level === 0 && typeof wd === 'number' && typeof ht === 'number') account(bound.tex, wd * ht * 4);
        else if (level === 0 && wd && typeof wd === 'object' && arguments.length >= 6) {
          var src = arguments[5];
          if (src && src.width) account(bound.tex, src.width * src.height * 4);
        }
        return oTexImage2D.apply(this, arguments);
      };
      var oDelB = P.deleteBuffer;
      P.deleteBuffer = function (b) {
        account(b, 0);
        return oDelB.apply(this, arguments);
      };
      var oDelT = P.deleteTexture;
      P.deleteTexture = function (tx) {
        account(tx, 0);
        return oDelT.apply(this, arguments);
      };
    }
  } catch (_) {}
  applied('resource-meter');

  // ---------- 7. Gesture lock ----------
  // iPadOS ignores maximum-scale (accessibility), so a pinch or a double tap would zoom the engine page and a
  // pan would rubber-band it. The gesture events are Safari's own; cancelling them leaves Pointer Events alone.
  try {
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      doc.addEventListener(
        t,
        function (e) {
          if (!manifest()['gesture-lock'] && e.cancelable) e.preventDefault();
        },
        { passive: false }
      );
    });
    ready(function () {
      if (manifest()['gesture-lock']) return;
      var st = doc.createElement('style');
      st.textContent = 'html,body{touch-action:none;overscroll-behavior:none;-webkit-text-size-adjust:100%}';
      (doc.head || doc.documentElement).appendChild(st);
    });
    applied('gesture-lock');
  } catch (_) {}

  // ---------- 7b. Audio unlock ----------
  // Safari and iPadOS start a Web Audio context suspended and resume it only inside a user gesture, and suspend it again
  // when the page is hidden ("interrupted"). An engine that plays or records sound (video, motion, audio apps) creates its
  // context at start, so it stays silent. The constructors are wrapped to remember each context; the first tap, key or
  // click after that (and after every interruption) resumes them.
  try {
    if (!manifest()['native-audio']) {
      var audioContexts = [];
      var audioBlocked = null;
      // Tells the workspace once per change whether sound is blocked, so the panel can say "tap the app once" (iPadOS and Safari start
      // a context suspended and resume it only inside a tap)
      var reportAudio = function () {
        var blocked = audioContexts.some(function (c) { return c.state === 'suspended' || c.state === 'interrupted'; });
        if (blocked !== audioBlocked) {
          audioBlocked = blocked;
          signal('audio-state', { blocked: blocked });
        }
      };
      w.__ocAudioBlocked = function () { return !!audioBlocked; };
      ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
        var Orig = w[name];
        if (!Orig || Orig.__ocWrapped) return;
        var Wrapped = function () {
          var ctx = new (Function.prototype.bind.apply(Orig, [null].concat(Array.prototype.slice.call(arguments))))();
          audioContexts.push(ctx);
          try {
            ctx.addEventListener('statechange', reportAudio);
          } catch (_) {}
          setTimeout(reportAudio, 0);
          return ctx;
        };
        Wrapped.prototype = Orig.prototype;
        Wrapped.__ocWrapped = true;
        w[name] = Wrapped;
      });
      var resumeAudio = function () {
        audioContexts.forEach(function (c) {
          if (c.state !== 'running' && c.state !== 'closed' && c.resume) c.resume().then(reportAudio, function () {});
        });
      };
      ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (t) { doc.addEventListener(t, resumeAudio, true); });
      applied('audio-unlock');
    }
  } catch (_) {}
  // ---------- 7c. Nested service workers ----------
  // Some engine builds register a service worker of their own (EffectCraft, SolidCraft: sw.js in their folder). Inside a
  // workspace panel that worker would sit between the page and the workspace's own worker (public/sw.js), which already
  // caches the app: two caches for one app, and the engine's would keep serving its files after the app was updated.
  // The registration is refused inside a panel (a standalone engine page is left alone); the engine keeps working, it
  // just has one cache instead of two.
  try {
    if (w.parent !== w && w.navigator.serviceWorker && !manifest()['native-sw']) {
      var swReg = w.navigator.serviceWorker.register;
      if (typeof swReg === 'function') {
        w.navigator.serviceWorker.register = function () {
          return Promise.reject(new Error('WorkCraft caches this app itself (a service worker of its own is not needed in a panel)'));
        };
        applied('nested-service-worker');
      }
    }
  } catch (_) {}
  // ---------- 8. Signals: lost WebGL context, engine that wants threads, runtime errors ----------
  try {
    // Canvas events do not bubble, the capture phase on the document still sees them
    doc.addEventListener('webglcontextlost', function () { signal('gpu-lost', { api: 'webgl2', reason: 'contextlost' }); }, true);
    doc.addEventListener('webglcontextrestored', function () { signal('gpu-restored', { api: 'webgl2' }); }, true);
    w.addEventListener('error', function (ev) {
      var msg = (ev && (ev.message || (ev.error && ev.error.message))) ? String(ev.message || ev.error.message) : '';
      if (msg) signal('runtime-error', { message: msg });
    });
    w.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      var msg = r ? String(r.message || r) : '';
      if (msg) signal('runtime-error', { message: msg });
    });
    applied('gpu-loss-signal');
  } catch (_) {}
  ready(function () {
    // An engine that declares threads asks at load, before its first allocation fails
    if (manifest().threads && !w.crossOriginIsolated) signal('needs-isolation', { reason: 'manifest' });
  });

  w.__ocResources = function () {
    var wasm = 0;
    for (var i = 0; i < res.memories.length; i++) {
      try {
        wasm += res.memories[i].buffer.byteLength;
      } catch (_) {}
    }
    var pm = w.performance && w.performance.memory;
    return { wasm: wasm, wasmMemories: res.memories.length, gpu: Math.max(0, res.gpuBytes), gpuApi: res.gpuApi || '', gpuBuffers: res.buffers, gpuTextures: res.textures, heap: pm ? pm.usedJSHeapSize : null };
  };
})();
