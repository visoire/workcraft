// Separate windows for panels.
//
// A panel can leave the workspace page and live in a browser window of its own, for example on a second
// display. The window is a second WorkCraft page (?popout=1&tool=...&id=...) that shows only that panel in
// full screen mode. Both pages talk to the same backend, so files, live sync and saves work as everywhere
// else. Moving a running iframe into another window would restart the app (and lose what is not saved), so the
// app is saved, unloaded in the workspace and started again in the new window; the workspace shows a card
// "open in its own window" with Bring back, and loads the app again when the window closes.
//
// The two pages coordinate through a BroadcastChannel:
//   window -> workspace   hello (every 2 s, with the file now open), bye (closing)
//   workspace -> window   close (bring back), focus, flush (save what is unsaved before the AI reads a file)
// A window that stops answering for a few seconds counts as closed. No DOM here except window handles.

import type { ToolId } from './registry.js';

const CHANNEL = 'workcraft-popout';
/** The window says hello this often; the workspace waits three times as long before it gives up. */
const BEAT = 2000;
const GONE = BEAT * 3 + 1500;
/** A new window needs time to start (page, backend, app) before its first hello. */
const STARTUP = 20_000;

export type PopoutMsg =
  | { type: 'hello'; id: string; path: string | null }
  | { type: 'bye'; id: string; path: string | null }
  | { type: 'close'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'flush'; id: string; req: string }
  | { type: 'flushed'; id: string; req: string; failed: string[] };

export interface PopoutParams {
  id: string;
  tool: ToolId;
  path: string | null;
}

/** The parameters of this page when it is a separate window of one panel, otherwise null. */
export function popoutParams(search: string = location.search): PopoutParams | null {
  const q = new URLSearchParams(search);
  if (q.get('popout') !== '1') return null;
  const id = q.get('id') || '';
  const tool = q.get('tool') || '';
  if (!/^[\w-]{1,60}$/.test(id) || !/^[a-z]{3,20}$/.test(tool)) return null;
  const path = q.get('path');
  return { id, tool: tool as ToolId, path: path && path.startsWith('/') ? path : null };
}

export function popoutUrl(p: PopoutParams): string {
  const q = new URLSearchParams({ popout: '1', tool: p.tool, id: p.id });
  if (p.path) q.set('path', p.path);
  return `${location.origin}/?${q.toString()}`;
}

function open(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Placement (second display)

interface ScreenInfo {
  left: number;
  top: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}
type ScreenWindow = Window & { screen: Screen & { isExtended?: boolean }; getScreenDetails?: () => Promise<{ screens: ScreenInfo[]; currentScreen: ScreenInfo }> };

/** Is a second display connected, and can the browser tell where it is (Window Management, Chrome and Edge)? */
export const hasOtherDisplay = (): boolean => {
  const w = window as ScreenWindow;
  return !!w.screen.isExtended && typeof w.getScreenDetails === 'function';
};

async function otherScreen(): Promise<ScreenInfo | null> {
  const w = window as ScreenWindow;
  if (!hasOtherDisplay()) return null;
  try {
    const d = await w.getScreenDetails!();
    const cur = d.currentScreen;
    return d.screens.find((s) => s.left !== cur.left || s.top !== cur.top) || null;
  } catch {
    return null; // permission denied: the window opens next to the workspace
  }
}

export interface OpenOptions {
  /** Size of the panel in the workspace, used for the window on the same display */
  w: number;
  h: number;
  /** Use the other display when there is one (the window fills it) */
  other?: boolean;
}

/**
 * Step one: an empty window, created at once inside the click that asked for it (pop-up blockers allow only
 * that). Returns null when the browser blocked it.
 */
export function openBlank(id: string, o: Pick<OpenOptions, 'w' | 'h'>): Window | null {
  const w = Math.max(720, Math.min(o.w + 40, screen.availWidth - 80));
  const h = Math.max(520, Math.min(o.h + 60, screen.availHeight - 80));
  const win = window.open('about:blank', `workcraft-popout-${id}`, `popup=yes,width=${w},height=${h},left=${(window.screenX || 0) + 40},top=${(window.screenY || 0) + 40}`);
  if (win) {
    try {
      win.document.title = 'WorkCraft';
      win.document.body.style.cssText = 'margin:0;background:#111;color:#bbb;font:14px system-ui;display:grid;place-items:center;height:100vh';
      win.document.body.textContent = 'Saving …';
    } catch {
      /* ignore */
    }
  }
  return win;
}

/** Step two: place the window (the other display needs a permission the first time) and load the panel in it. */
export async function placeAndLoad(win: Window, p: PopoutParams, o: OpenOptions): Promise<void> {
  const s = o.other ? await otherScreen() : null;
  try {
    if (s) {
      win.moveTo(s.availLeft, s.availTop);
      win.resizeTo(s.availWidth, s.availHeight);
    }
  } catch {
    /* the browser refused to move it: it stays where it opened */
  }
  win.location.href = popoutUrl(p);
}

// ---------------------------------------------------------------- Workspace side

interface Entry {
  win: Window | null;
  seen: number;
  path: string | null;
}

const entries = new Map<string, Entry>();
let bc: BroadcastChannel | null = null;
let ended: ((id: string, path: string | null) => void) | null = null;
const flushWaiters = new Map<string, (failed: string[]) => void>();

function finish(id: string, path: string | null) {
  const e = entries.get(id);
  if (!e) return;
  entries.delete(id);
  ended?.(id, path ?? e.path);
}

export const popouts = {
  /** Starts listening. `end` runs when a window closes (or stopped answering): the workspace loads the panel again. */
  init(end: (id: string, path: string | null) => void): void {
    ended = end;
    bc ||= open();
    if (bc) {
      bc.onmessage = (ev: MessageEvent<PopoutMsg>) => {
        const m = ev.data;
        const e = entries.get(m.id);
        if (m.type === 'hello' && e) {
          e.seen = Date.now();
          e.path = m.path;
        } else if (m.type === 'bye') finish(m.id, m.path);
        else if (m.type === 'flushed') flushWaiters.get(m.req)?.(m.failed);
      };
    }
    setInterval(() => {
      for (const [id, e] of entries) {
        if (e.win?.closed) finish(id, e.path);
        else if (Date.now() - e.seen > GONE) finish(id, e.path);
      }
    }, 1000);
  },
  /** A window is (or is about to be) open for this panel. */
  track(id: string, win: Window | null, path: string | null): void {
    entries.set(id, { win, seen: Date.now() + STARTUP, path });
  },
  has: (id: string) => entries.has(id),
  ids: () => [...entries.keys()],
  focus(id: string): void {
    const e = entries.get(id);
    try {
      e?.win?.focus();
    } catch {
      /* no handle after a reload of the workspace */
    }
    bc?.postMessage({ type: 'focus', id } satisfies PopoutMsg);
  },
  /** Asks the window to save and close (Bring back). */
  close(id: string): void {
    bc?.postMessage({ type: 'close', id } satisfies PopoutMsg);
    const e = entries.get(id);
    // A window that does not answer (blocked, frozen) is closed from here after a moment
    setTimeout(() => {
      if (entries.has(id)) {
        try {
          e?.win?.close();
        } catch {
          /* ignore */
        }
        if (!e?.win || e.win.closed) finish(id, e?.path ?? null);
      }
    }, 4000);
  },
  /** Saves what is unsaved in the separate windows, so the AI reads what the user sees. Returns the files that could not be saved. */
  async flush(): Promise<string[]> {
    if (!bc || !entries.size) return [];
    const failed: string[] = [];
    await Promise.all(
      [...entries.keys()].map(
        (id) =>
          new Promise<void>((resolve) => {
            const req = `${id}:${Date.now().toString(36)}`;
            const timer = setTimeout(() => {
              flushWaiters.delete(req);
              resolve();
            }, 4000);
            flushWaiters.set(req, (f) => {
              clearTimeout(timer);
              flushWaiters.delete(req);
              failed.push(...f);
              resolve();
            });
            bc!.postMessage({ type: 'flush', id, req } satisfies PopoutMsg);
          })
      )
    );
    return failed;
  },
};

// ---------------------------------------------------------------- Window side

/**
 * Runs in the separate window: heartbeat, answers to the workspace, and the goodbye. `flush` saves the
 * panel, `path` is the file open now. Returns `back`, which saves, tells the workspace and closes the window.
 */
export function runPopoutWindow(o: { id: string; path: () => string | null; flush: () => Promise<string[]> }): { back: () => Promise<void> } {
  const ch = open();
  const send = (m: PopoutMsg) => ch?.postMessage(m);
  const beat = () => send({ type: 'hello', id: o.id, path: o.path() });
  beat();
  setInterval(beat, BEAT);
  let leaving = false;
  const leave = async () => {
    if (leaving) return;
    leaving = true;
    await o.flush().catch(() => []);
    send({ type: 'bye', id: o.id, path: o.path() });
  };
  ch &&
    (ch.onmessage = (ev: MessageEvent<PopoutMsg>) => {
      const m = ev.data;
      if (m.id !== o.id) return;
      if (m.type === 'close') void leave().then(() => window.close());
      else if (m.type === 'focus') window.focus();
      else if (m.type === 'flush') void o.flush().then((failed) => send({ type: 'flushed', id: o.id, req: m.req, failed }));
    });
  // Closing the window with the X: tell the workspace at once (it also notices after a few seconds by itself)
  addEventListener('pagehide', () => send({ type: 'bye', id: o.id, path: o.path() }));
  return { back: () => leave().then(() => window.close()) };
}
