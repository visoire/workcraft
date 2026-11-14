// iPadOS support layer: the hub the workspace talks to.
//
//   capabilities.ts   what the browser offers, and the plan that follows (mode, storage, renderer)
//   compat.ts         the register of every compatibility measure, and the engine capability manifest
//   adapter.ts        host side measures around an engine iframe, signals from its frame layer
//   pen-calibration   pressure, hover and twist learned from the pen's own events
//   memory.ts         the governor that keeps the tab below Safari's limit
//   opfs.ts           large files of browser mode on the Origin Private File System
//   isolation.ts      cross-origin isolation on demand (SharedArrayBuffer)
//
// Reading order for a new contributor: docs/IPADOS-COMPAT.md, then compat.ts.

import { bus } from '../app/bus.js';
import { backend } from '../app/backend.js';
import { device } from '../app/device.js';
import { prefs } from '../app/settings.js';
import { notify, toast } from '../app/notifications.js';
import { t } from '../app/i18n.js';
import { probeCapabilities, planFor, runtimeMode, type Capabilities, type SystemPlan, type RuntimeMode } from './capabilities.js';
import { LagMonitor, MemoryGovernor, budgetFor, planLaunchRelief, type Budget, type GovernorPanel, type HealthEvent, type LagLevel, type MemoryAction, type MemoryLevel } from './memory.js';
import { blobs, requestPersistence } from './opfs.js';
import { isolation, setIsolation, restoreIsolation } from './isolation.js';
import { pen } from './pen-calibration.js';
import { RECOVERY_BUDGET_SCALE, beginSession, endSession, localSessionStore, resumeSession, scaleBudget } from './session.js';
import { installPencilUi } from './pen-ui.js';
import type { EngineReport } from './adapter.js';

export interface IpadosHost {
  /** The desktop answered from another device (home network) */
  remote: boolean;
  panels(): GovernorPanel[];
  unload(id: string): Promise<boolean>;
  /** Saves one panel's open document; true when nothing is left unsaved */
  save(id: string): Promise<boolean>;
  /** Saves every panel with unsaved changes; returns the files that failed */
  saveAll(): Promise<string[]>;
}

export interface IpadosState {
  caps: Capabilities;
  mode: RuntimeMode;
  plan: SystemPlan;
  persisted: boolean | null;
  memory: { level: MemoryLevel; usage: number; budget: Budget; lag: LagLevel; events: HealthEvent[] } | null;
  governor: 'on' | 'off';
  /** The previous session ended from outside (Safari closed the tab, a crash): the memory budget is 20 % lower now */
  recovered: boolean;
}

const probe = probeCapabilities();
const state: IpadosState = {
  caps: probe,
  mode: 'desktop',
  plan: planFor(probe, 'desktop'),
  persisted: null,
  memory: null,
  governor: 'off',
  recovered: false,
};

/** Engine reports of the open panels, filled by the panel host (craftapp.ts). */
const engines = new Map<string, EngineReport>();

export const ipados = {
  get state(): Readonly<IpadosState> {
    return state;
  },
  engines,
  pen,
  isolation,
  /** One-line summary for the Status page */
  summary(): { mode: RuntimeMode; storage: string; renderer: string; isolation: string; pen: string } {
    const s = pen.summary();
    return {
      mode: state.mode,
      storage: state.plan.storage,
      renderer: state.plan.renderer,
      isolation: isolation.active ? 'active' : state.plan.isolation,
      pen: `${s.pressure === 'real' ? 'pressure' : s.pressure === 'simulated' ? 'simulated pressure' : 'pressure unknown'}${s.hover ? ', hover' : ''}${s.twist ? ', roll' : ''}`,
    };
  },
  /**
   * `launch-relief`: before an engine starts, frees hidden, saved panels according to the weight of the app (catalog
   * trait). Only where the governor is on (iPad, or the setting); resolves when the room is made.
   */
  async makeRoom(weight: 'light' | 'medium' | 'heavy' | undefined): Promise<number> {
    const host = hostRef;
    if (!host || !weight || state.governor !== 'on') return 0;
    const dev = device.info;
    const b0 = budgetFor({ ipad: dev.ipad, deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, overrideMb: prefs.get('memoryBudgetMb') });
    const b = state.recovered ? scaleBudget(b0, RECOVERY_BUDGET_SCALE) : b0;
    const now = performance.now();
    const list = host.panels();
    // On a computer a heavy app makes room only when memory is already above the warn line (it has more of it); on an iPad always
    const w = dev.ipad ? weight : weight === 'heavy' ? 'medium' : 'light';
    const plan = planLaunchRelief(
      list.map((p, i) => ({ id: p.id, active: p.status === 'active', visible: p.visible, unsaved: p.unsaved, bytes: p.res ? p.res.wasm + p.res.gpu : 0, lastShown: p.visible ? now : i })),
      w,
      b
    );
    let freed = 0;
    for (const r of plan) if (await host.unload(r.id)) freed++;
    if (freed) toast(t('Made room for a heavy app'), 'info', t('{n} hidden, saved apps were unloaded. Click one to load it again.', { n: freed }));
    return freed;
  },
  /** Asks for cross-origin isolation for an engine that needs shared memory. */
  offerIsolation(appName: string): void {
    const host = hostRef;
    if (isolation.active || !host) return;
    if (!isolation.possible) {
      notify({ level: 'warning', title: t('{name} needs multithreading', { name: appName }), message: t('Safari offers it only over HTTPS. Open WorkCraft over HTTPS (see the iPadOS guide) and try again.'), timeout: 0 });
      return;
    }
    notify({
      level: 'info',
      title: t('{name} asks for multithreading', { name: appName }),
      message: t('This needs a different security mode of the page. WorkCraft saves your open documents, then reloads once.'),
      timeout: 0,
      actions: [
        {
          label: t('Enable and reload'),
          primary: true,
          run: async () => {
            const failed = await host.saveAll();
            if (failed.length) return void toast(t('Not reloaded'), 'warning', t('Could not save {list}. Save in the app first.', { list: failed.join(', ') }));
            await setIsolation(true);
            location.reload();
          },
        },
      ],
    });
  },
};

let installed = false;
let hostRef: IpadosHost | null = null;

/** Starts the layer once the backend mode is known (after backend.probe in main.ts). */
export function installIpados(host: IpadosHost): void {
  if (installed) return;
  installed = true;
  hostRef = host;
  const dev = device.info;
  state.caps = probeCapabilities();
  state.mode = runtimeMode(backend.mode, host.remote);
  state.plan = planFor(state.caps, state.mode, { ipad: dev.ipad });
  const root = document.documentElement.dataset;
  root.runtime = state.mode;
  root.storage = state.plan.storage;
  bus.emit('ipados:plan', state.plan);

  // Browser mode: find out whether the worker really gets synchronous OPFS access, and keep the data
  if (state.mode === 'standalone' && state.caps.secure) {
    void blobs.available().then((ok) => {
      state.plan = planFor(state.caps, state.mode, { ipad: dev.ipad, opfsWorks: ok });
      root.storage = state.plan.storage;
      bus.emit('ipados:plan', state.plan);
    });
    void requestPersistence().then((p) => {
      state.persisted = p;
      bus.emit('ipados:plan', state.plan);
    });
  }

  restoreIsolation();
  // Pencil: finger/keyboard rule, barrel button, tool feedback (hover circles are created by the surfaces)
  installPencilUi();

  // Memory governor: on everywhere unless the setting says off ('auto' used to mean iPads only)
  const setting = prefs.get('memoryGovernor');
  const enabled = setting !== 'off';
  state.governor = enabled ? 'on' : 'off';
  // Did the last session end from outside? No event says so; a session that never marked itself clean was. Then the budget is lower for this one
  const store = localSessionStore();
  const session = beginSession(store, Date.now());
  state.recovered = session.recovered;
  const mark = () => (document.visibilityState === 'hidden' ? endSession(store, Date.now()) : resumeSession(store, Date.now()));
  window.addEventListener('pagehide', () => endSession(store, Date.now()));
  document.addEventListener('visibilitychange', mark);
  const budget = (): Budget => {
    const b = budgetFor({ ipad: dev.ipad, deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, overrideMb: prefs.get('memoryBudgetMb') });
    return state.recovered ? scaleBudget(b, RECOVERY_BUDGET_SCALE) : b;
  };
  if (session.recovered) {
    setTimeout(
      () =>
        notify({
          level: 'warning',
          title: t('The page was reloaded'),
          message: t('The last session ended unexpectedly, usually because the device ran out of memory. The memory limit is 20 % lower for this session. Close apps you do not need, and open heavy apps one at a time.'),
          timeout: 0,
          actions: [{ label: t('Open the memory monitor'), run: () => bus.emit('open-settings', 'monitor') }],
        }),
      1500
    );
  }
  let lastWarn = 0;
  const lagMon = new LagMonitor();
  const publish = () => {
    if (!governor) return;
    state.memory = { level: governor.level, usage: governor.usage, budget: budget(), lag: governor.lag, events: [...governor.events] };
    bus.emit('ipados:memory', state.memory);
  };
  // eslint-disable-next-line prefer-const
  let governor: MemoryGovernor;
  governor = new MemoryGovernor({
    panels: () => host.panels(),
    lag: () => lagMon.level,
    heap: () => (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize ?? 0,
    mode: () => prefs.get('memoryAction') as MemoryAction,
    onEvent: () => publish(),
    offer(items, why) {
      // Never frees by itself what holds unsaved work: the buttons do, and the unsaved ones save first
      const names = items.map((i) => i.name).join(', ');
      const dirty = items.filter((i) => i.unsaved);
      notify({
        level: 'warning',
        title: t('Free memory?'),
        message: dirty.length ? t('{list} can be unloaded to keep the workspace fast ({why}). {dirty} have unsaved changes: they are saved into the project first.', { list: names, why, dirty: dirty.map((d) => d.name).join(', ') }) : t('{list} can be unloaded to keep the workspace fast ({why}). Click a panel to load it again.', { list: names, why }),
        timeout: 0,
        actions: [
          {
            label: t('Unload'),
            primary: true,
            run: async () => {
              for (const i of items) {
                if (i.unsaved && !(await host.save(i.id))) {
                  toast(t('{name} was not unloaded', { name: i.name }), 'warning', t('It could not be saved. Save in the app first.'));
                  continue;
                }
                if (await host.unload(i.id)) toast(t('{name} unloaded to save memory', { name: i.name }), 'info', t('Click the panel to load it again.'));
              }
              publish();
            },
          },
          { label: t('Not now'), run: () => {} },
        ],
      });
    },
    unload: (id) => host.unload(id),
    save: (id) => host.save(id),
    budget,
    onLevel(level, usage, b) {
      state.memory = { level, usage, budget: b, lag: governor?.lag ?? 'ok', events: governor ? [...governor.events] : [] };
      bus.emit('ipados:memory', state.memory);
      // The name follows the iPadOS guide: other code can listen on the window as well
      window.dispatchEvent(new CustomEvent('workcraft:memory-pressure', { detail: { level, usageMb: Math.round(usage / 1048576) } }));
      if (level === 'warn' && performance.now() - lastWarn > 60_000) {
        lastWarn = performance.now();
        const slow = governor?.lag === 'laggy';
        toast(slow ? t('The workspace is slow') : t('Memory is getting full'), 'info', slow ? t('Close or unload apps you do not need. Hidden, saved apps are unloaded if it lasts.') : prefs.get('memoryAction') === 'warn' ? t('Close apps you do not need.') : t('Apps that are hidden and saved are unloaded when it gets tighter.'));
      }
    },
    onFreed: (name) => toast(t('{name} unloaded to save memory', { name }), 'info', t('Click the panel to load it again.')),
    onStuck: () =>
      notify({
        level: 'warning',
        title: t('Memory is full'),
        message: t('Safari ends a tab that uses too much memory. Unload or close an app you do not need.'),
        timeout: 0,
        actions: [{ label: t('Open the memory monitor'), run: () => bus.emit('open-settings', 'monitor') }],
      }),
  });
  if (enabled) {
    governor.start();
    lagMon.start();
  }
  bus.on('settings:change', ({ key }) => {
    if (key !== 'memoryGovernor') return;
    const on = prefs.get('memoryGovernor') !== 'off';
    state.governor = on ? 'on' : 'off';
    if (on) {
      governor.start();
      lagMon.start();
    } else {
      governor.stop();
      lagMon.stop();
    }
  });
  // For tests and the console: window.__workcraftIpad.ipados.state, .engines, .governor.tick(), .blobs
  (window as unknown as { __workcraftIpad: unknown }).__workcraftIpad = { ipados, governor, lagMon, blobs };
}
