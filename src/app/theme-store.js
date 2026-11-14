// Light or dark: two independent choices, one per system.
//
//   'ide'   the workspace, Full Chat Mode, picture in picture and the four apps
//           running inside workspace panels
//   'home'  the website: homepage, portal, panel, dashboard, contact, terms, privacy, docs,
//           error pages and the apps opened on their own (apps/<app>/)
//
// Each scope is stored twice, with a timestamp, and the newer one wins:
//   localStorage  oc-ide-theme  + oc-ide-theme-at     |  oc-home-theme  + oc-home-theme-at
//   cookie        oc_ide_theme=<theme>.<ms>; Path=/   |  oc_home_theme=<theme>.<ms>; Path=/
// localStorage is per origin, the cookie is per host. So the website under XAMPP
// (http://localhost/workcraft/) and the workspace on another port (http://localhost:5175/) each keep
// their own choice across ports. Changing one scope never touches the other.
// The same logic is inlined in scripts/partials.mjs (head), scripts/error-pages.mjs and
// public/craft-theme.js, which cannot import modules.

export const THEMES = ['system', 'light', 'dark'];
export const SCOPES = {
  ide: { key: 'oc-ide-theme', at: 'oc-ide-theme-at', cookie: 'oc_ide_theme', channel: 'oc-ide-theme-channel' },
  home: { key: 'oc-home-theme', at: 'oc-home-theme-at', cookie: 'oc_home_theme', channel: 'oc-home-theme-channel' },
};
// Before the split both systems shared these. They seed both scopes once, then are never written.
const LEGACY = { key: 'workcraft-theme', at: 'workcraft-theme-at' };

const valid = (t) => THEMES.includes(t);
const cfg = (scope) => SCOPES[scope] || SCOPES.home;

function fromStorage(c) {
  try {
    let t = localStorage.getItem(c.key);
    let at = Number(localStorage.getItem(c.at)) || 0;
    if (!valid(t)) {
      const old = localStorage.getItem(LEGACY.key);
      if (valid(old)) {
        t = old;
        at = Number(localStorage.getItem(LEGACY.at)) || 0;
        localStorage.setItem(c.key, t);
        localStorage.setItem(c.at, String(at));
      }
    }
    return { theme: valid(t) ? t : null, at };
  } catch {
    return { theme: null, at: 0 };
  }
}

function fromCookie(c) {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${c.cookie}=(system|light|dark)\\.(\\d+)`));
  return m ? { theme: m[1], at: Number(m[2]) } : { theme: null, at: 0 };
}

function store(c, theme, at) {
  try {
    localStorage.setItem(c.key, theme);
    localStorage.setItem(c.at, String(at));
  } catch {
    /* no storage */
  }
}

/** The current choice of a scope: the newer of localStorage and cookie ('system' when nothing is stored). */
export function readTheme(scope = 'home') {
  const c = cfg(scope);
  const s = fromStorage(c);
  const k = fromCookie(c);
  if (k.theme && (k.at > s.at || !s.theme)) {
    store(c, k.theme, k.at);
    return k.theme;
  }
  return s.theme || 'system';
}

/** Saves a new choice of a scope in both places and tells the other tabs of this origin. */
export function writeTheme(theme, scope = 'home') {
  if (!valid(theme)) return;
  const c = cfg(scope);
  const at = Date.now();
  store(c, theme, at);
  document.cookie = `${c.cookie}=${theme}.${at}; Path=/; Max-Age=31536000; SameSite=Lax`;
  try {
    const ch = new BroadcastChannel(c.channel);
    ch.postMessage({ type: 'theme-change', scope, theme });
    ch.close();
  } catch {
    /* not supported */
  }
}

/** 'light' or 'dark' for a choice (system follows the operating system). */
export const resolveTheme = (theme) => (theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme);

/**
 * Calls fn(theme) when the choice of a scope changed elsewhere: another tab of this origin (storage
 * event, BroadcastChannel) or another origin on the same host (cookie, checked when the page comes
 * back to the front).
 */
export function watchTheme(fn, scope = 'home') {
  const c = cfg(scope);
  let last = readTheme(scope);
  const check = () => {
    const t = readTheme(scope);
    if (t !== last) {
      last = t;
      fn(t);
    }
  };
  addEventListener('storage', (e) => {
    if (e.key === c.key || e.key === c.at) check();
  });
  try {
    const ch = new BroadcastChannel(c.channel);
    ch.onmessage = (e) => e.data && e.data.type === 'theme-change' && setTimeout(check, 0);
  } catch {
    /* not supported */
  }
  addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  return { set: (t) => (last = t) };
}
