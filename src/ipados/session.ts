// Did the last session end by itself, or did Safari (or a crash) end it? Pure logic over a tiny store, so it is tested without a browser.
//
// Safari closes a tab that uses too much memory without a message and reloads it ("This webpage was reloaded because a problem
// occurred"). No event fires for that. What does fire is `pagehide` and the page becoming hidden when a user leaves, so a session
// that was never marked clean and has no later start in between was ended from outside. The workspace then says so, once, and
// lowers its memory budget for this session so the same apps do not push it over again.
//
//   beginSession(store, now)  at start: reads the previous mark, writes "running"
//   endSession(store, now)    on pagehide and when the page is hidden: "clean"
//   resumeSession(store, now) when the page is visible again: "running"
//
// A tab kept in the background and discarded by iPadOS is not a crash: the page was hidden (clean) before it went.

export interface SessionStore {
  get(): string | null;
  set(value: string): void;
}

interface Mark {
  at: number;
  clean: boolean;
}

/** A mark older than this is not reported (a session from last week that nobody closed properly says nothing about now). */
export const RECENT_MS = 6 * 60 * 60 * 1000;

/** The memory budget of a session that followed an unexpected end: 20 % lower. */
export const RECOVERY_BUDGET_SCALE = 0.8;

const read = (store: SessionStore): Mark | null => {
  try {
    const m = JSON.parse(store.get() ?? 'null') as Partial<Mark> | null;
    return m && typeof m.at === 'number' && typeof m.clean === 'boolean' ? { at: m.at, clean: m.clean } : null;
  } catch {
    return null;
  }
};

const write = (store: SessionStore, mark: Mark): void => {
  try {
    store.set(JSON.stringify(mark));
  } catch {
    /* storage blocked: nothing to remember, nothing to report */
  }
};

export function beginSession(store: SessionStore, now: number): { recovered: boolean; previousAt: number | null } {
  const prev = read(store);
  write(store, { at: now, clean: false });
  const recovered = !!prev && !prev.clean && now - prev.at >= 0 && now - prev.at < RECENT_MS;
  return { recovered, previousAt: prev?.at ?? null };
}

export const endSession = (store: SessionStore, now: number): void => write(store, { at: now, clean: true });
export const resumeSession = (store: SessionStore, now: number): void => write(store, { at: now, clean: false });

/** The store the workspace uses (localStorage); a blocked storage reads as empty and writes nowhere. */
export const localSessionStore = (key = 'workcraft.session'): SessionStore => ({
  get: () => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* blocked */
    }
  },
});

/** Scales a budget (warn, act, critical) for a recovered session. Pure. */
export const scaleBudget = <B extends { warn: number; act: number; critical: number }>(b: B, scale: number): B => ({ ...b, warn: Math.round(b.warn * scale), act: Math.round(b.act * scale), critical: Math.round(b.critical * scale) });
