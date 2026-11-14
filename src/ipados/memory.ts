// Memory governor: keeps the tab below the limit at which Safari ends it without a message.
//
// Safari on iPadOS closes a tab ("This webpage was reloaded because a problem occurred") when its
// memory use reaches roughly 1.5 to 2.5 GB, depending on the iPad. The apps' WebAssembly memory and
// their GPU buffers count. public/craft-frame.js meters both in every engine (resource-meter), the
// workspace adds them up here and acts before the limit:
//
//   ok        below warn
//   warn      one notice, nothing is unloaded
//   act       unload the panels that are hidden and have no unsaved changes, least recently shown first
//   critical  as act, and ask hidden panels with unsaved changes to save first, then unload them
//
// A visible panel is never unloaded and unsaved work is never discarded. The policy is a pure
// function (planRelief); the governor around it only polls and calls back.
//
// The governor watches two things and acts on every device, not only on iPads:
//   memory   the WebAssembly and GPU numbers of the apps (plus the JavaScript heap where the browser tells it)
//   lag      how late a 500 ms timer fires (LagMonitor): a main thread that is busy or starved by heavy apps
// and has three modes (pref memoryAction): auto (free hidden, saved apps by itself), ask (offer them in a notice, nothing is freed
// without a click), warn (notices only). A panel with unsaved changes is never freed without the user's say: where the host can
// offer, the offer names the panel and the click saves it first; every action leaves a line in the event list, with the reason.

export type MemoryLevel = 'ok' | 'warn' | 'act' | 'critical';
export type LagLevel = 'ok' | 'slow' | 'laggy';
export type MemoryAction = 'auto' | 'ask' | 'warn';

/** Lateness of the timer (ms beyond its interval), newest last. laggy: most of the recent rounds are far behind, or one was very late.
 *  slow: several are noticeably behind. Pure. */
export function lagLevel(samples: readonly number[]): LagLevel {
  const recent = samples.slice(-6);
  if (recent.length < 3) return 'ok';
  if (recent.filter((v) => v > 250).length >= 4 || recent.some((v) => v > 1500)) return 'laggy';
  if (recent.filter((v) => v > 120).length >= 3) return 'slow';
  return 'ok';
}

/** A slow page is a reason to act one step earlier: ok becomes warn, warn becomes act. Never beyond act: lag alone is not critical. */
export function escalate(level: MemoryLevel, lag: LagLevel): MemoryLevel {
  if (lag !== 'laggy') return level;
  return level === 'ok' ? 'warn' : level === 'warn' ? 'act' : level;
}

/** Times a 500 ms timer and keeps how late it fires. Skips rounds while the tab is hidden (the browser slows timers there). */
export class LagMonitor {
  samples: number[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = 0;
  constructor(private now: () => number = () => performance.now(), private visible: () => boolean = () => typeof document === 'undefined' || document.visibilityState === 'visible', private every = 500) {}
  get level(): LagLevel {
    return lagLevel(this.samples);
  }
  start(): void {
    if (this.timer) return;
    this.last = this.now();
    this.timer = setInterval(() => this.sample(), this.every);
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  /** One round (exposed for tests). */
  sample(): void {
    const t = this.now();
    if (!this.visible()) {
      this.samples = [];
    } else {
      this.samples.push(Math.max(0, t - this.last - this.every));
      if (this.samples.length > 12) this.samples.shift();
    }
    this.last = t;
  }
}

export type HealthEventKind = 'freed' | 'offered' | 'stuck' | 'lag' | 'warn';
export interface HealthEvent {
  /** Date.now() */
  at: number;
  kind: HealthEventKind;
  /** One plain sentence: what happened and why */
  text: string;
}

const mbText = (n: number) => `${Math.round(n / MB)} MB`;
/** Why the governor acts, in words for the user. Pure. */
export function reasonText(level: MemoryLevel, usage: number, b: Budget, lag: LagLevel): string {
  if (lag === 'laggy' && (level === 'ok' || level === 'warn')) return 'the workspace was responding slowly';
  const lead = level === 'critical' ? 'memory use of the apps is critical' : 'memory use of the apps passed the limit';
  return `${lead} (${mbText(usage)} of ${mbText(b.act)}${lag === 'laggy' ? ', and the page was slow' : ''})`;
}

export interface Budget {
  warn: number;
  act: number;
  critical: number;
}

const MB = 1024 * 1024;

export interface BudgetEnv {
  ipad: boolean;
  /** navigator.deviceMemory in GB (not available in Safari) */
  deviceMemoryGB?: number;
  /** Override in MB from the settings (prefs memoryBudgetMb), 0 or undefined = automatic */
  overrideMb?: number;
}

/**
 * Budget in bytes for WebAssembly plus estimated GPU memory of all panels.
 * iPad: 640 / 800 / 1100 MB, from the guidance that an iPad tab is in danger from about 1.5 GB in total
 * (the page, the workers and the browser need the rest). Other devices: a third of the device memory,
 * or 2 GB when unknown, so the governor stays quiet on a desktop.
 */
export function budgetFor(env: BudgetEnv): Budget {
  if (env.overrideMb && env.overrideMb > 0) {
    const act = env.overrideMb * MB;
    return { warn: Math.round(act * 0.8), act, critical: Math.round(act * 1.4) };
  }
  if (env.ipad) return { warn: 640 * MB, act: 800 * MB, critical: 1100 * MB };
  const act = Math.round(((env.deviceMemoryGB || 6) * 1024 * MB) / 3);
  return { warn: Math.round(act * 0.8), act, critical: Math.round(act * 1.4) };
}

export function levelOf(usage: number, b: Budget): MemoryLevel {
  return usage >= b.critical ? 'critical' : usage >= b.act ? 'act' : usage >= b.warn ? 'warn' : 'ok';
}

export interface PanelMem {
  id: string;
  /** Loaded (status active) */
  active: boolean;
  visible: boolean;
  unsaved: boolean;
  /** WebAssembly memory plus estimated GPU memory in bytes */
  bytes: number;
  /** When the panel was last visible (ms, performance.now()) */
  lastShown: number;
}

export type Relief = { id: string; action: 'unload' | 'save-then-unload' };

/**
 * Which panels to free to get back under the warn line. Pure: same input, same answer.
 * Largest-first would free memory faster, but least recently shown is the panel the user needs last.
 */
export function planRelief(panels: readonly PanelMem[], level: MemoryLevel, b: Budget, opts: { lag?: boolean } = {}): Relief[] {
  if (level === 'ok' || level === 'warn') return [];
  let usage = panels.reduce((n, p) => n + (p.active ? p.bytes : 0), 0);
  const out: Relief[] = [];
  const hidden = panels.filter((p) => p.active && !p.visible && p.bytes > 0).sort((a, c) => a.lastShown - c.lastShown);
  for (const p of hidden) {
    // Slowness without memory pressure frees one panel per round, the one shown least recently
    if (usage <= b.warn && !opts.lag) break;
    if (opts.lag && out.length) break;
    if (!p.unsaved) out.push({ id: p.id, action: 'unload' });
    else if (level === 'critical') out.push({ id: p.id, action: 'save-then-unload' });
    else continue;
    usage -= p.bytes;
  }
  return out;
}

/**
 * Panels to free before an app starts (measure `launch-relief`). The apps of the other ecosystems differ a lot in weight
 * (catalog trait `weight`): a heavy one (video, 3D, RAW) should find room before it allocates, not after the governor has
 * seen a number. light: nothing. medium: only when memory is already above the warn line. heavy: always.
 * Only hidden panels without unsaved work, least recently shown first. Pure.
 */
export function planLaunchRelief(panels: readonly PanelMem[], incoming: 'light' | 'medium' | 'heavy', b: Budget): Relief[] {
  if (incoming === 'light') return [];
  const usage = panels.reduce((n, p) => n + (p.active ? p.bytes : 0), 0);
  if (incoming === 'medium' && usage < b.warn) return [];
  return panels
    .filter((p) => p.active && !p.visible && !p.unsaved)
    .sort((a, c) => a.lastShown - c.lastShown)
    .map((p) => ({ id: p.id, action: 'unload' as const }));
}

// ---------------------------------------------------------------- governor

export interface GovernorPanel {
  id: string;
  name: string;
  status: string;
  visible: boolean;
  unsaved: boolean;
  res: { wasm: number; gpu: number } | null;
}

export interface GovernorHost {
  panels(): GovernorPanel[];
  /** Frees the panel; false when it refused (unsaved changes) */
  unload(id: string): Promise<boolean>;
  /** Saves the panel's open document into the project; true when nothing is left unsaved */
  save(id: string): Promise<boolean>;
  budget(): Budget;
  /** The level changed or a panel was freed */
  onLevel(level: MemoryLevel, usage: number, budget: Budget): void;
  onFreed(name: string): void;
  /** Still above the limit and nothing left to free: the user has to decide */
  onStuck(usage: number, budget: Budget): void;
  now?(): number;
  /** How responsive the page is (LagMonitor). Without it only memory counts. */
  lag?(): LagLevel;
  /** JavaScript heap in bytes where the browser reports it (Chromium), added to the apps' numbers. */
  heap?(): number;
  /** auto (default): free by itself; ask: offer instead of freeing; warn: notices only. */
  mode?(): MemoryAction;
  /**
   * The host can show a notice with buttons. Panels with unsaved changes are then never saved and freed by the governor itself:
   * they are offered (the click saves, then frees), and in ask mode the saved ones are offered too.
   */
  offer?(items: { id: string; name: string; unsaved: boolean }[], why: string): void;
  /** A line for the event list (what was freed or offered, and why). */
  onEvent?(e: HealthEvent): void;
}

export class MemoryGovernor {
  level: MemoryLevel = 'ok';
  usage = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private shown = new Map<string, number>();
  private strikes = 0;
  private busy = false;
  private cooldownUntil = 0;
  private stuckNotified = false;
  private lagStrikes = 0;
  private offeredAt = -Infinity;
  /** Newest last, 20 at most: what the governor did and why (shown by the status chip and the monitor) */
  events: HealthEvent[] = [];
  lag: LagLevel = 'ok';

  private log(kind: HealthEventKind, text: string): void {
    const e: HealthEvent = { at: Date.now(), kind, text };
    this.events.push(e);
    if (this.events.length > 20) this.events.shift();
    this.host.onEvent?.(e);
  }

  constructor(private host: GovernorHost) {}

  start(intervalMs = 2500): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One round. Exposed for tests and for the Status page ("Check now"). */
  async tick(): Promise<MemoryLevel> {
    if (this.busy) return this.level;
    this.busy = true;
    try {
      const now = this.host.now?.() ?? performance.now();
      const list = this.host.panels();
      const mem: PanelMem[] = list.map((p) => {
        if (p.visible) this.shown.set(p.id, now);
        return { id: p.id, active: p.status === 'active', visible: p.visible, unsaved: p.unsaved, bytes: p.res ? p.res.wasm + p.res.gpu : 0, lastShown: this.shown.get(p.id) ?? 0 };
      });
      const budget = this.host.budget();
      this.usage = mem.reduce((n, p) => n + (p.active ? p.bytes : 0), 0) + (this.host.heap?.() ?? 0);
      const lag = this.host.lag?.() ?? 'ok';
      const lagChanged = lag !== this.lag;
      this.lag = lag;
      const level = escalate(levelOf(this.usage, budget), lag);
      if (level !== this.level || lagChanged) {
        this.level = level;
        this.host.onLevel(level, this.usage, budget);
      }
      const mode = this.host.mode?.() ?? 'auto';
      this.lagStrikes = lag === 'laggy' ? this.lagStrikes + 1 : 0;
      // Two rounds in a row above the line: a short peak while a document opens is not a reason to unload
      this.strikes = level === 'act' || level === 'critical' ? this.strikes + 1 : 0;
      const pressure = this.strikes >= (level === 'critical' ? 1 : 2);
      // Slowness alone (memory below the lines) frees one hidden, saved panel per round once it has lasted three rounds
      const slowOnly = !pressure && this.lagStrikes >= 3;
      if ((pressure || slowOnly) && now >= this.cooldownUntil && mode !== 'warn') {
        const plan = planRelief(mem, pressure ? level : 'act', budget, { lag: slowOnly });
        const why = reasonText(level, this.usage, budget, lag);
        const named = plan.map((r) => ({ id: r.id, name: list.find((p) => p.id === r.id)?.name || r.id, unsaved: r.action === 'save-then-unload' }));
        if (!plan.length) {
          if (pressure && !this.stuckNotified) {
            this.stuckNotified = true;
            this.log('stuck', `Nothing left to free: ${why}. Close an app you do not need.`);
            this.host.onStuck(this.usage, budget);
          }
        } else if (this.host.offer && (mode === 'ask' || named.some((n) => n.unsaved))) {
          // Offer instead of acting: everything in ask mode, and always what has unsaved changes. A notice at most every 60 s.
          if (now - this.offeredAt >= 60_000) {
            this.offeredAt = now;
            const items = mode === 'ask' ? named : named.filter((n) => n.unsaved);
            if (items.length) {
              this.log('offered', `${items.map((i) => i.name).join(', ')} could be unloaded: ${why}.`);
              this.host.offer(items, why);
            }
            // In auto mode the saved panels of the plan are still freed below
          }
          if (mode !== 'ask') {
            for (const n of named.filter((x) => !x.unsaved)) {
              if (await this.host.unload(n.id)) {
                this.log('freed', `${n.name} was unloaded because ${why}.`);
                this.host.onFreed(n.name);
              }
            }
            this.cooldownUntil = now + 4000;
          }
        } else {
          for (const r of plan) {
            const name = list.find((p) => p.id === r.id)?.name || r.id;
            if (r.action === 'save-then-unload' && !(await this.host.save(r.id))) continue;
            if (await this.host.unload(r.id)) {
              this.log('freed', `${name} was unloaded because ${why}.`);
              this.host.onFreed(name);
            }
          }
          this.cooldownUntil = now + 4000;
        }
      }
      if (level === 'ok' || level === 'warn') this.stuckNotified = false;
      if (lag === 'ok') this.lagStrikes = 0;
      return this.level;
    } finally {
      this.busy = false;
    }
  }
}
