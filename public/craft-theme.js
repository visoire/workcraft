/*
 * WorkCraft: light and dark mode for the four WebAssembly apps (WordCraft, GridCraft, DeckCraft, PdfCraft).
 * Replaces the craft-theme-sync.js of the releases (scripts/releases.mjs swaps the script tag).
 *
 * Two independent choices (same rules as src/app/theme-store.js, the newer of localStorage and cookie wins):
 *   inside a workspace panel   scope 'ide':  oc-ide-theme (+ -at), cookie oc_ide_theme=<theme>.<ms>;
 *                         the parent window's choice comes first and arrives by postMessage
 *   opened on its own     scope 'home': oc-home-theme (+ -at), cookie oc_home_theme=<theme>.<ms>
 *                         (the website's choice, apps/<app>/ launched from the homepage)
 * The apps never write it back, so there is no feedback loop.
 *
 * How the apps follow:
 *   GridCraft, PdfCraft  eframe reads (prefers-color-scheme: dark) and listens for changes;
 *                        window.matchMedia answers with the WorkCraft theme instead of the OS.
 *                        PdfCraft keeps its own theme setting, which is pinned to "System".
 *   WordCraft            its own Options, Interface theme starts at "Light" and is not stored on the
 *                        web. Right after the start the script sets it to "Use system setting"
 *                        (laid out at 1024 x 800 for a moment, invisible), then it follows like the others.
 *   DeckCraft            always starts light and has its own switch (palette icon in the title bar);
 *                        the script tracks its state and presses the switch.
 *   PhotoCraft, FilmCraft, EffectCraft
 *                        start on Dark; a moon button in the top bar cycles Dark, Auto, Light. The script presses it to Auto
 *                        once, then they follow matchMedia like the others.
 * Updates arrive by storage event, BroadcastChannel, postMessage from the workspace and, for another
 * origin on the same host, the cookie when the tab comes back to the front.
 * window.__ocThemeReady resolves when the app is ready for a file (the workspace waits for it).
 */
(function () {
  'use strict';
  var w = window;
  var doc = document;
  // Inside a workspace panel the parent window says so (src/app/main.ts sets __ocThemeScope = 'ide')
  var SCOPE = (function () {
    try {
      if (w.parent && w.parent !== w && (w.parent.__ocThemeScope === 'ide' || w.parent.__workcraftTheme)) return 'ide';
    } catch (_) {
      /* other origin */
    }
    return 'home';
  })();
  var KEY = 'oc-' + SCOPE + '-theme';
  var AT = KEY + '-at';
  var COOKIE = 'oc_' + SCOPE + '_theme';
  var CHANNEL = KEY + '-channel';
  var LEGACY = 'workcraft-theme';
  var BG = {
    wordcraft: ['#e6e6e6', '#121214'],
    gridcraft: ['#f3f3f3', '#121214'],
    deckcraft: ['#262626', '#121214'],
    pdfcraft: ['#f1f1f3', '#121214'],
  };

  // What each app does with the theme: [modes, via, look]. Written by scripts/sync-themes.mjs from src/ecosystems/catalog.json
  // ("theme" of each app); tests/server/theme.test.ts fails when it is stale. See docs/THEMING.md.
  /*THEMES:begin*/
  var THEMES = {
    "wordcraft": ["both","switch",""],
    "gridcraft": ["both","media",""],
    "deckcraft": ["both","switch",""],
    "pdfcraft": ["both","media",""],
    "photocraft": ["both","switch",""],
    "lightcraft": ["both","own","dark"],
    "vectorcraft": ["both","own","dark"],
    "filmcraft": ["both","switch",""],
    "effectcraft": ["both","switch",""],
    "soundcraft": ["both","own","dark"],
    "designcraft": ["both","own","dark"],
    "figcraft": ["both","media",""],
    "cadcraft": ["both","own","dark"],
    "texturecraft": ["both","own","dark"],
    "materialcraft": ["both","own","dark"],
    "solidcraft": ["both","own","dark"],
    "mailcraft": ["both","media",""],
    "anicraft": ["dark","fixed",""],
    "craft-anything": ["dark","fixed",""],
    "tracedraw": ["both","own","light"],
    "lightcraft-classic": ["both","own","dark"],
    "firecraft": ["dark","fixed",""],
    "paintcraft": ["both","own","dark"],
    "paintrs": ["both","media",""],
    "procraft": ["dark","fixed",""],
    "pixelcraft": ["both","media",""],
    "notecraft": ["both","media",""],
    "textcraft": ["both","own","dark"],
    "matcraft": ["light","fixed",""],
    "picasso-suite": ["both","own","dark"],
    "align": ["both","css",""],
    "subcraft": ["dark","fixed",""],
    "clothcraft": ["both","own","light"],
    "humanmotioncraft": ["both","own","dark"],
    "oxybrush": ["both","own","dark"],
    "retake": ["dark","fixed",""],
    "lemon-studio": ["dark","fixed",""],
    "honeydew": ["dark","fixed",""],
    "suhina": ["dark","fixed",""],
    "prowave": ["dark","fixed",""],
    "oxiguitar": ["both","media",""],
    "transit": ["both","media",""],
    "mixstudio": ["dark","fixed",""],
    "earthcraft": ["dark","fixed",""],
  };
  /*THEMES:end*/

  var path = location.pathname.toLowerCase();
  var app = /deckcraft/.test(path) ? 'deckcraft' : /gridcraft/.test(path) ? 'gridcraft' : /pdfcraft/.test(path) ? 'pdfcraft' : /wordcraft/.test(path) ? 'wordcraft' : '';
  // Any app of the catalog: /apps/<id>/ (the id may have hyphens)
  var appId = (path.match(/\/apps\/([a-z0-9-]+)\//) || [])[1] || '';
  var spec = appId ? THEMES[appId] : null;
  // An app with one look only is told that look, whatever the workspace shows (a dark-only app must never see "light")
  var FORCED = spec && spec[1] === 'fixed' && (spec[0] === 'light' || spec[0] === 'dark') ? spec[0] : null;

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }
  var valid = function (v) {
    return v === 'system' || v === 'light' || v === 'dark';
  };

  function parentTheme() {
    try {
      if (w.parent && w.parent !== w && valid(w.parent.__workcraftTheme)) return w.parent.__workcraftTheme;
    } catch (_) {
      /* other origin */
    }
    return null;
  }
  function pref() {
    var p = parentTheme();
    if (p) return p;
    var t = read(KEY);
    var at = Number(read(AT)) || 0;
    if (!valid(t)) {
      t = read(LEGACY);
      at = Number(read(LEGACY + '-at')) || 0;
    }
    var m = doc.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=(system|light|dark)\\.(\\d+)'));
    if (m && (Number(m[2]) > at || !valid(t))) {
      t = m[1];
      // Copy the newer choice from the cookie, so the other apps of this origin see it too
      if (read(KEY) !== t) write(KEY, t);
      write(AT, m[2]);
    }
    return valid(t) ? t : 'system';
  }

  var nativeMatchMedia = w.matchMedia ? w.matchMedia.bind(w) : null;
  function osDark() {
    try {
      return !!nativeMatchMedia && nativeMatchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) {
      return false;
    }
  }
  function resolved() {
    if (FORCED) return FORCED;
    var p = pref();
    return p === 'system' ? (osDark() ? 'dark' : 'light') : p;
  }

  // ---------- CSS bridge: @media (prefers-color-scheme) rules follow the WorkCraft theme, not the operating system ----------
  // matchMedia (above) cannot reach CSS: the browser evaluates the media queries of a stylesheet itself. An app that styles its dark
  // mode that way (Align, for example) would follow the OS and clash with the workspace. A media rule that names the color scheme
  // is rewritten: the clause becomes (min-width: 0px) when it should apply and (max-width: 0px) when not, the other clauses stay.
  var cssRules = []; // { rule, orig }
  var seenSheets = [];
  var SCHEME = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;
  function collectRules(list, out) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.media && r.media.mediaText && /prefers-color-scheme/i.test(r.media.mediaText) && r.cssRules) out.push({ rule: r, orig: r.media.mediaText });
      if (r.cssRules && r.cssRules.length) collectRules(r.cssRules, out);
    }
  }
  function scanSheets() {
    var sheets = doc.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var s = sheets[i];
      if (seenSheets.indexOf(s) >= 0) continue;
      var rules;
      try {
        rules = s.cssRules;
      } catch (_) {
        continue; // another origin: cannot be read, and not rewritten
      }
      seenSheets.push(s);
      collectRules(rules, cssRules);
    }
  }
  function bridgeCss() {
    scanSheets();
    var cur = resolved();
    for (var i = 0; i < cssRules.length; i++) {
      var e = cssRules[i];
      var text = e.orig.replace(SCHEME, function (_, which) {
        return which.toLowerCase() === cur ? '(min-width: 0px)' : '(max-width: 0px)';
      });
      try {
        if (e.rule.media.mediaText !== text) e.rule.media.mediaText = text;
      } catch (_) {}
    }
  }
  var bridgeTimer = 0;
  function bridgeSoon() {
    clearTimeout(bridgeTimer);
    bridgeTimer = setTimeout(bridgeCss, 60);
  }

  // ---------- matchMedia: the apps see the WorkCraft theme as the system theme ----------
  var tracked = [];
  if (nativeMatchMedia) {
    w.matchMedia = function (query) {
      var q = String(query || '');
      var mql = nativeMatchMedia(q);
      var dark = /prefers-color-scheme\s*:\s*dark/i.test(q);
      var light = /prefers-color-scheme\s*:\s*light/i.test(q);
      if (!dark && !light) return mql;
      var entry = { dark: dark, mql: mql, listeners: [], onchange: null };
      var proxy = new Proxy(mql, {
        get: function (target, prop) {
          if (prop === 'matches') return dark ? resolved() === 'dark' : resolved() === 'light';
          if (prop === 'addEventListener')
            return function (type, fn) {
              if (type === 'change' && typeof fn === 'function' && entry.listeners.indexOf(fn) < 0) entry.listeners.push(fn);
            };
          if (prop === 'removeEventListener')
            return function (type, fn) {
              if (type === 'change') entry.listeners = entry.listeners.filter(function (x) { return x !== fn; });
            };
          if (prop === 'addListener')
            return function (fn) {
              if (typeof fn === 'function' && entry.listeners.indexOf(fn) < 0) entry.listeners.push(fn);
            };
          if (prop === 'removeListener')
            return function (fn) {
              entry.listeners = entry.listeners.filter(function (x) { return x !== fn; });
            };
          if (prop === 'onchange') return entry.onchange;
          var v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
        set: function (target, prop, value) {
          if (prop === 'onchange') {
            entry.onchange = typeof value === 'function' ? value : null;
            return true;
          }
          target[prop] = value;
          return true;
        },
      });
      entry.proxy = proxy;
      tracked.push(entry);
      return proxy;
    };
  }

  function fireMediaChange() {
    for (var i = 0; i < tracked.length; i++) {
      var e = tracked[i];
      var matches = e.proxy.matches;
      var ev;
      try {
        ev = new MediaQueryListEvent('change', { matches: matches, media: e.mql.media });
      } catch (_) {
        ev = new Event('change');
        ev.matches = matches;
        ev.media = e.mql.media;
      }
      var fns = e.listeners.slice();
      if (e.onchange) fns.push(e.onchange);
      for (var j = 0; j < fns.length; j++) {
        try {
          fns[j].call(e.proxy, ev);
        } catch (err) {
          console.warn('[craft-theme]', err);
        }
      }
    }
  }

  // ---------- Synthetic clicks on the app canvas ----------
  function canvasEl() {
    return doc.getElementById(app + '_canvas') || doc.querySelector('canvas');
  }
  // Waits for real frames of the app (and a little time). While a panel is paused its frames are held.
  function later(frames, ms, fn) {
    var t0 = Date.now();
    var n = 0;
    var raf = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : function (f) { return setTimeout(f, 16); };
    var step = function () {
      if (++n >= frames && Date.now() - t0 >= ms) fn();
      else raf(step);
    };
    raf(step);
  }
  var pressing = false;
  // egui reads pointer input once per frame: hover, press and release need frames in between.
  // The warm-up (pointer enters and moves first) keeps the first click after loading from getting lost.
  function press(x, y, done) {
    var c = canvasEl();
    if (!c) return done(false);
    var r = c.getBoundingClientRect();
    var px = r.left + x;
    var py = r.top + y;
    var o = { clientX: px, clientY: py, screenX: px, screenY: py, bubbles: true, cancelable: true, view: w, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 };
    var fire = function (type, Ctor) {
      c.dispatchEvent(new Ctor(type, o));
    };
    pressing = true;
    fire('pointerover', PointerEvent);
    fire('pointerenter', PointerEvent);
    fire('mouseenter', MouseEvent);
    fire('pointermove', PointerEvent);
    fire('mousemove', MouseEvent);
    later(3, 200, function () {
      fire('pointermove', PointerEvent);
      later(3, 100, function () {
        o.buttons = 1;
        fire('pointerdown', PointerEvent);
        fire('mousedown', MouseEvent);
        later(3, 80, function () {
          o.buttons = 0;
          fire('pointerup', PointerEvent);
          fire('mouseup', MouseEvent);
          fire('click', MouseEvent);
          later(3, 120, function () {
            fire('pointerout', PointerEvent);
            fire('pointerleave', PointerEvent);
            fire('mouseleave', MouseEvent);
            pressing = false;
            done(true);
          });
        });
      });
    });
  }

  // ---------- PdfCraft: own setting pinned to "System", so it follows matchMedia ----------
  function pinPdfCraft() {
    if (app !== 'pdfcraft') return;
    try {
      var raw = read('pdfcraft');
      // First visit: PdfCraft fills in the other settings with its defaults
      if (!raw) write('pdfcraft', JSON.stringify({ theme: 'System' }));
      else {
        var cfg = JSON.parse(raw);
        if (cfg && cfg.theme !== 'System') {
          cfg.theme = 'System';
          write('pdfcraft', JSON.stringify(cfg));
        }
      }
    } catch (_) {}
    var ron = read('egui_memory_ron');
    if (ron && /theme_preference:\s*(Light|Dark)/.test(ron)) write('egui_memory_ron', ron.replace(/theme_preference:\s*(Light|Dark)/g, 'theme_preference:System'));
  }

  // ---------- DeckCraft: track and press its own switch ----------
  var deck = { dark: false, started: false, busy: false };
  // The switch sits in the title bar, 167 points from the right edge and 18 points from the top
  function deckPoint() {
    var c = canvasEl();
    if (!c) return null;
    var r = c.getBoundingClientRect();
    return r.width > 400 && r.height > 120 ? { x: r.width - 167, y: 18 } : null;
  }
  function syncDeck() {
    if (app !== 'deckcraft' || !deck.started || deck.busy || pressing) return;
    var want = resolved() === 'dark';
    if (deck.dark === want) return;
    var p = deckPoint();
    // Hidden or too narrow (the switch would be somewhere else): try again later
    if (doc.visibilityState === 'hidden' || !p) return void setTimeout(syncDeck, 500);
    deck.busy = true;
    press(p.x, p.y, function () {
      deck.busy = false;
      deck.dark = !deck.dark;
      syncDeck();
    });
  }

  // ---------- WordCraft: set Options, Interface theme to "Use system setting" once ----------
  // Positions in points at the fixed layout of 1024 x 800 (start screen of WordCraft 0.8.0)
  var WORD = { options: [48, 500], themeBox: [610, 120], system: [612, 153], home: [42, 81] };
  function wordcraftSystem(done) {
    var c = canvasEl();
    if (!c) return done();
    w.__ocFrameForce = { width: 1024, height: 800 };
    c.style.opacity = '0';
    if (w.__ocFit) w.__ocFit();
    var steps = [WORD.options, WORD.themeBox, WORD.system, WORD.home];
    var next = function (i) {
      if (i >= steps.length) {
        return later(4, 200, function () {
          w.__ocFrameForce = null;
          if (w.__ocFit) w.__ocFit();
          try {
            w.dispatchEvent(new Event('resize'));
          } catch (_) {}
          later(3, 120, function () {
            c.style.opacity = '';
            done();
          });
        });
      }
      later(6, i === 0 ? 500 : 350, function () {
        press(steps[i][0], steps[i][1], function () {
          next(i + 1);
        });
      });
    };
    next(0);
  }

  // ---------- Apps with a theme button of their own: press it until the app is on "Auto" (it follows matchMedia from then on) ----------
  // PhotoCraft, LightCraft, FilmCraft and EffectCraft share one design (LightCraft is left out: its Welcome dialog covers the button at the first start): a moon button in the top bar cycles Dark, Auto, Light and the app
  // starts on Dark every time (nothing is stored between starts). The button sits at a fixed distance from the right edge of the window
  // (measured at 1200 points wide in Edge, see docs/THEMING.md): right, y in points; min is the narrowest canvas the top bar keeps its
  // layout at (narrower: wait for more room, full screen brings it). PhotoCraft mirrors its choice into localStorage
  // "photocraft.preferences" (interface.appearanceMode), so the script knows where it is and presses until "auto"; the others have no
  // readable state, so one press from the Dark start is all it does. Never pressed again after that: the user's own press stays.
  var OWN_BUTTONS = {
    photocraft: { right: 193, y: 16, min: 600, mirror: true },
    filmcraft: { right: 218, y: 19, min: 1000 },
    effectcraft: { right: 176, y: 44, min: 1000 },
  };
  var ownBtn = OWN_BUTTONS[appId] || null;
  var own = { tries: 0, busy: false, done: false };
  function ownMode() {
    try {
      return JSON.parse(read('photocraft.preferences')).interface.appearanceMode;
    } catch (_) {
      return null;
    }
  }
  function syncOwn() {
    if (!ownBtn || own.busy || own.done || pressing) return;
    if (ownBtn.mirror ? ownMode() === 'auto' : own.tries >= 1) return void (own.done = true);
    if (own.tries >= 4) return void (own.done = true);
    var c = canvasEl();
    var r = c && c.getBoundingClientRect();
    // Hidden or too narrow (the top bar looks different): try again later
    if (doc.visibilityState === 'hidden' || !r || r.width < ownBtn.min) return void setTimeout(syncOwn, 700);
    own.busy = true;
    own.tries++;
    press(r.width - ownBtn.right, ownBtn.y, function () {
      own.busy = false;
      setTimeout(syncOwn, 500);
    });
  }

  // ---------- Start ----------
  var readyResolve;
  w.__ocThemeReady = new Promise(function (r) {
    readyResolve = r;
  });
  var started = false;
  var onStart = function () {
    if (started) return;
    started = true;
    if (app === 'wordcraft') {
      // Let the start screen draw a few frames first
      later(10, 700, function () {
        wordcraftSystem(function () {
          readyResolve();
          apply(true);
        });
      });
    } else {
      readyResolve();
      if (ownBtn) setTimeout(syncOwn, 3500);
      if (app === 'deckcraft') {
        // Give DeckCraft time to start and to open the file the workspace hands over, then press its switch
        setTimeout(function () {
          deck.started = true;
          syncDeck();
        }, 3500);
      }
    }
  };
  // Only the four office apps have a theme switch to press, so only they have anything to wait for. Any other Craft app is
  // ready as soon as the workspace asks (its own start signal is the loading element, see panels/craftapp.ts).
  if (!app) readyResolve();
  w.addEventListener('TrunkApplicationStarted', onStart);
  setTimeout(onStart, 8000);
  // Never block the workspace longer than this
  setTimeout(function () {
    readyResolve();
  }, 15000);

  // The user pressed DeckCraft's switch inside the app: remember the new state
  if (app === 'deckcraft') {
    w.addEventListener(
      'pointerup',
      function (e) {
        if (pressing || !deck.started || !e.isTrusted) return;
        var p = deckPoint();
        var c = canvasEl();
        if (!p || !c) return;
        var r = c.getBoundingClientRect();
        if (Math.abs(e.clientX - r.left - p.x) <= 12 && Math.abs(e.clientY - r.top - p.y) <= 12) deck.dark = !deck.dark;
      },
      true
    );
  }

  // ---------- Apply ----------
  var last = '';
  function apply(force) {
    var r = resolved();
    var root = doc.documentElement;
    root.setAttribute('data-theme', r);
    root.style.colorScheme = r;
    if (doc.body && BG[app]) doc.body.style.backgroundColor = BG[app][r === 'dark' ? 1 : 0];
    bridgeCss();
    if (!force && r === last) return;
    last = r;
    fireMediaChange();
    try {
      w.dispatchEvent(new Event('resize'));
    } catch (_) {}
    syncDeck();
    try {
      w.dispatchEvent(new CustomEvent('craft-theme-changed', { detail: { theme: pref(), resolved: r } }));
    } catch (_) {}
  }

  pinPdfCraft();
  last = resolved();
  doc.documentElement.setAttribute('data-theme', last);
  doc.documentElement.style.colorScheme = last;

  w.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === AT) apply(false);
  });
  try {
    var themeChannel = new BroadcastChannel(CHANNEL);
    themeChannel.onmessage = function (e) {
      if (e.data && e.data.type === 'theme-change') setTimeout(function () { apply(false); }, 0);
    };
  } catch (_) {}
  // The workspace switches the loaded apps in place (no reload, the open document is kept)
  w.addEventListener('message', function (e) {
    if (SCOPE === 'ide' && e.origin === location.origin && e.data && e.data.type === 'workcraft:theme') apply(false);
  });
  // Another origin on the same host (cookie): check when the tab comes back to the front
  w.addEventListener('focus', function () {
    apply(false);
  });
  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'visible') apply(false);
  });
  if (nativeMatchMedia) {
    try {
      nativeMatchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (pref() === 'system') apply(false);
      });
    } catch (_) {}
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { apply(true); }, { once: true });
  else apply(true);
  // Stylesheets that arrive later (links, injected style elements) are bridged as they load
  w.addEventListener('load', bridgeSoon);
  try {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        for (var j = 0; j < list[i].addedNodes.length; j++) {
          var n = list[i].addedNodes[j];
          if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') {
            if (n.nodeName === 'LINK') n.addEventListener('load', bridgeSoon, { once: true });
            bridgeSoon();
          }
        }
      }
    }).observe(doc.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  // Same API as the release script, without writing back from inside the app (setTheme is explicit)
  w.CraftTheme = {
    /** 'ide' inside a workspace panel, 'home' when opened on its own */
    scope: SCOPE,
    getTheme: pref,
    getResolvedTheme: resolved,
    setTheme: function (t) {
      if (!valid(t)) return;
      var at = String(Date.now());
      write(KEY, t);
      write(AT, at);
      doc.cookie = COOKIE + '=' + t + '.' + at + '; Path=/; Max-Age=31536000; SameSite=Lax';
      try {
        var ch = new BroadcastChannel(CHANNEL);
        ch.postMessage({ type: 'theme-change', scope: SCOPE, theme: t });
        ch.close();
      } catch (_) {}
      apply(false);
    },
    toggle: function () {
      w.CraftTheme.setTheme(resolved() === 'dark' ? 'light' : 'dark');
    },
    /** DeckCraft: tracked state of its own dark mode switch (for diagnosis) */
    deck: deck,
    /** What the catalog says this app does with the theme: { id, modes, via, look, forced } (null outside /apps/<id>/) */
    spec: spec ? { id: appId, modes: spec[0], via: spec[1], look: spec[2] || null, forced: FORCED } : null,
  };
})();
