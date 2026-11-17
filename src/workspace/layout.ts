// Window system of the workspace.
//
// Zones: left (project tree), middle (stage with a split tree), right (AI chat).
// Every panel has the same header: full screen, minimize (dock), maximize (whole workspace),
// hide, close, unload. Gutters change width and height.
//
// Resources: a panel loads its module only when it becomes visible for the first time or an
// MCP command asks for it. Apps (WebAssembly/WebGPU) start one after another through a queue.
// Minimized, hidden or covered panels are paused (render loop stops, the document
// stays in memory). Unloading happens only on request or after a configurable time.
//
// Layout, sizes, modes and scroll positions are stored per project (backend + localStorage).

import { TOOLS, toolMark, toolForPath, isApp, type ToolId, type PanelInstance, type PanelContext } from './registry.js';
import { bus, type BusEvents } from '../app/bus.js';
import { api, backend } from '../app/backend.js';
import { prefs } from '../app/settings.js';
import { h, uid, basename, clamp, debounce, nodes, esc } from '../app/util.js';
import { icon } from '../app/icons.js';
import { dialog, menu, type MenuEntry, type MenuItem } from '../app/ui.js';
import { onContextAction } from '../app/long-press.js';
import { panelActions, infoRows, type PanelAction } from './panel-menu.js';
import { canLocate, copyProjectPath, revealInFileManager } from '../project/locate.js';
import { desktopAppCached, desktopApps, openInDesktop } from '../project/desktop.js';
import { notifyError, toast } from '../app/notifications.js';
import { play } from '../app/sounds.js';
import { device } from '../app/device.js';
import { guardSurface, onDoubleTap, inputKind, capture } from './pencil.js';
import { attachPip, clampRect, defaultRect, type PipRect } from './pip.js';
import { popouts, openBlank, placeAndLoad, runPopoutWindow, hasOtherDisplay, type PopoutParams } from './popout.js';
import { t as tr } from '../app/i18n.js';
import { activeApps, activeEcosystem } from '../ecosystems/ecosystems.js';
import { tabBelongs } from '../ecosystems/stage-plan.js';
import { recentList } from '../storage/recent-view.js';
import { noteOpened } from '../storage/recent.js';
import { fs } from '../project/fs.js';

export type Mode = 'normal' | 'minimized' | 'hidden';
type Side = 'left' | 'right' | 'top' | 'bottom';
type LayoutNode = { t: 'leaf'; id: string } | { t: 'split'; dir: 'row' | 'col'; sizes: number[]; kids: LayoutNode[] };

interface PanelState {
  id: string;
  tool: ToolId;
  path: string | null;
  mode: Mode;
  scroll?: { top: number; left: number };
  prev?: { target: string | null; side: Side };
  /** Floating picture-in-picture window (viewport coordinates). Set: the panel floats. */
  pip?: PipRect;
  /** The panel runs in a window of its own (second display); here it is a card with "Bring back" */
  popout?: boolean;
}

interface LayoutState {
  v: 2;
  panels: Record<string, PanelState>;
  order: string[];
  tree: LayoutNode | null;
  focused: string | null;
  maximized: string | null;
  sides: { left: number; right: number };
}

type Status = 'idle' | 'queued' | 'loading' | 'active' | 'unloaded' | 'error';

interface Runtime {
  el: HTMLElement;
  host: HTMLElement;
  placeholder: HTMLElement;
  pathEl: HTMLElement;
  stateEl: HTMLElement;
  badgeEl: HTMLElement;
  statusText: HTMLElement;
  engineText: HTMLElement;
  btn: Record<'full' | 'min' | 'max' | 'hide' | 'close' | 'unload' | 'pip' | 'pop', HTMLButtonElement>;
  status: Status;
  instance: PanelInstance | null;
  paused: boolean;
  disposers: (() => void)[];
  error?: Error;
  loadStarted?: number;
  loadMs?: number;
  unloadTimer?: ReturnType<typeof setTimeout>;
  waiters: { resolve: (i: PanelInstance) => void; reject: (e: Error) => void }[];
}

const MIN = 0.1;
/** Header height follows the CSS variable (touch: 50 px). */
const cssPx = (name: string, fallback: number) => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return isFinite(v) && v > 0 ? v : fallback;
};
let HEAD = 38;
function readMetrics() {
  HEAD = cssPx('--panel-head-h', 38);
}
/** Snap points of the gutters: 50 to 50, 70 to 30, 30 to 70, then full screen */
const SNAPS = [0.5, 0.7, 0.3] as const;
const SIDE_IDS = { left: 'tree', right: 'chat' } as const;

let state: LayoutState = emptyState();
const rt = new Map<string, Runtime>();
let project = '';
/** The panel that fills the whole window (full screen mode). Not saved with the layout. */
let fullscreenId: string | null = null;
/** The panel that was maximized before full screen began, restored when it ends */
let fsBefore: string | null = null;
/** This page is a separate window of one panel (?popout=1): it never saves a layout of its own */
let standalone: { back: () => Promise<void> } | null = null;
let dom: { ws: HTMLElement; stage: HTMLElement; layout: HTMLElement; layer: HTMLElement; left: HTMLElement; right: HTMLElement; gl: HTMLElement; gr: HTMLElement; tabs: HTMLElement; dock: HTMLElement } | null = null;

function emptyState(): LayoutState {
  return { v: 2, panels: {}, order: [], tree: null, focused: null, maximized: null, sides: { left: 260, right: 400 } };
}

// ---------------------------------------------------------------- Persistenz

function snapshotForSave(): LayoutState {
  for (const [id, r] of rt) {
    const s = r.instance?.getScroll?.();
    if (s && state.panels[id]) state.panels[id]!.scroll = s;
  }
  const snap = structuredClone(state);
  // Full screen is never saved: the layout keeps what it was before (a panel that was maximized stays maximized)
  if (fullscreenId) snap.maximized = fsBefore && snap.panels[fsBefore] ? fsBefore : null;
  return snap;
}

async function putLayout(): Promise<void> {
  if (!project || standalone) return;
  const snap = snapshotForSave();
  try {
    localStorage.setItem(`workcraft.layout.${project}`, JSON.stringify(snap));
  } catch {
    /* storage full */
  }
  await api.send('PUT', '/api/meta/layout', snap).catch(() => {});
}
const persist = debounce(() => void putLayout(), 600);

function validState(s: unknown): s is LayoutState {
  const x = s as LayoutState;
  return !!x && x.v === 2 && typeof x.panels === 'object' && Array.isArray(x.order);
}

function prune(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null;
  if (node.t === 'leaf') {
    const p = state.panels[node.id];
    return p && TOOLS[p.tool]?.zone === 'stage' && p.mode === 'normal' ? node : null;
  }
  const kids: LayoutNode[] = [];
  const sizes: number[] = [];
  node.kids.forEach((k, i) => {
    const n = prune(k);
    if (n) {
      kids.push(n);
      sizes.push(node.sizes[i] || 1);
    }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0]!;
  const sum = sizes.reduce((a, b) => a + b, 0);
  return { t: 'split', dir: node.dir, kids, sizes: sizes.map((s) => s / sum) };
}

// ---------------------------------------------------------------- Baum-Operationen

interface Located {
  node: LayoutNode;
  parent: Extract<LayoutNode, { t: 'split' }> | null;
  idx: number;
}
function locate(pred: (n: LayoutNode) => boolean, node: LayoutNode | null = state.tree, parent: Located['parent'] = null, idx = -1): Located | null {
  if (!node) return null;
  if (pred(node)) return { node, parent, idx };
  if (node.t === 'split') {
    for (let i = 0; i < node.kids.length; i++) {
      const r = locate(pred, node.kids[i]!, node, i);
      if (r) return r;
    }
  }
  return null;
}
const locateLeaf = (id: string) => locate((n) => n.t === 'leaf' && n.id === id);

function replaceNode(oldNode: LayoutNode, newNode: LayoutNode) {
  const r = locate((n) => n === oldNode);
  if (!r) return;
  if (!r.parent) {
    state.tree = newNode;
    return;
  }
  if (newNode.t === 'split' && newNode.dir === r.parent.dir) {
    const share = r.parent.sizes[r.idx]!;
    r.parent.kids.splice(r.idx, 1, ...newNode.kids);
    r.parent.sizes.splice(r.idx, 1, ...newNode.sizes.map((s) => s * share));
  } else r.parent.kids[r.idx] = newNode;
}

/** Removes a leaf and remembers neighbour and side for restoring it. */
function removeLeaf(id: string): PanelState['prev'] {
  const r = locateLeaf(id);
  if (!r) return undefined;
  if (!r.parent) {
    state.tree = null;
    return { target: null, side: 'right' };
  }
  const p = r.parent;
  const before = r.idx > 0;
  const sib = p.kids[before ? r.idx - 1 : r.idx + 1]!;
  const firstLeaf = (n: LayoutNode): string | null => (n.t === 'leaf' ? n.id : n.kids[0] ? firstLeaf(n.kids[0]) : null);
  const prev: PanelState['prev'] = { target: firstLeaf(sib), side: p.dir === 'row' ? (before ? 'right' : 'left') : before ? 'bottom' : 'top' };
  p.kids.splice(r.idx, 1);
  p.sizes.splice(r.idx, 1);
  const sum = p.sizes.reduce((a, b) => a + b, 0);
  p.sizes = p.sizes.map((s) => s / sum);
  if (p.kids.length === 1) replaceNode(p, p.kids[0]!);
  return prev;
}

function insertLeaf(id: string, targetId: string | null, side: Side = 'right') {
  const leaf: LayoutNode = { t: 'leaf', id };
  if (!state.tree) {
    state.tree = leaf;
    return;
  }
  const dir = side === 'left' || side === 'right' ? 'row' : 'col';
  const before = side === 'left' || side === 'top';
  const r = (targetId && locateLeaf(targetId)) || { node: state.tree, parent: null, idx: -1 };
  if (r.node === state.tree && state.tree.t === 'split' && state.tree.dir === dir) {
    const n = state.tree.kids.length + 1;
    state.tree.sizes = state.tree.sizes.map((s) => (s * (n - 1)) / n);
    if (before) {
      state.tree.kids.unshift(leaf);
      state.tree.sizes.unshift(1 / n);
    } else {
      state.tree.kids.push(leaf);
      state.tree.sizes.push(1 / n);
    }
    return;
  }
  if (r.parent && r.parent.dir === dir) {
    const half = r.parent.sizes[r.idx]! / 2;
    r.parent.sizes[r.idx] = half;
    const at = r.idx + (before ? 0 : 1);
    r.parent.kids.splice(at, 0, leaf);
    r.parent.sizes.splice(at, 0, half);
    return;
  }
  const split: LayoutNode = { t: 'split', dir, sizes: [0.5, 0.5], kids: before ? [leaf, r.node] : [r.node, leaf] };
  if (!r.parent) state.tree = split;
  else r.parent.kids[r.idx] = split;
}

function leafIds(node: LayoutNode | null = state.tree, out: string[] = []): string[] {
  if (!node) return out;
  if (node.t === 'leaf') out.push(node.id);
  else node.kids.forEach((k) => leafIds(k, out));
  return out;
}

function autoSide(target: string | null): Side {
  const r = target && locateLeaf(target);
  if (r && r.parent?.dir === 'row' && r.parent.kids.length >= 3) return 'bottom';
  return 'right';
}

// ---------------------------------------------------------------- Visibility and resources

const zoneOf = (id: string) => TOOLS[state.panels[id]?.tool as ToolId]?.zone || 'stage';

export function isVisible(id: string): boolean {
  const p = state.panels[id];
  if (!p || p.mode !== 'normal' || document.visibilityState === 'hidden') return false;
  // In a separate window it runs there; full screen shows only its own panel
  if (p.popout || (fullscreenId && fullscreenId !== id)) return false;
  // A floating window stays visible above everything (also above a maximized panel)
  if (p.pip) return true;
  if (zoneOf(id) === 'stage' && !locateLeaf(id)) return false;
  if (state.maximized && state.maximized !== id) return false;
  return true;
}

/** Apps and the code editor can run in a window of their own, with the desktop backend (the files live there). */
const canPopOut = (tool: ToolId) => (isApp(tool) || tool === 'code') && !backend.browser;

// ---------------------------------------------------------------- Full screen
// One stage panel fills the whole window: no top bar, tool rail, side bars, tabs or other panels, and the panel's
// own header is hidden too. The browser goes to full screen as well when it allows it (Esc leaves both). A thin
// strip at the top edge brings an "Exit full screen" button back for a moment. Not saved with the layout.

let fsBar: HTMLElement | null = null;
let fsShow: (() => void) | null = null;

function syncFsBar() {
  if (!fullscreenId) {
    fsBar?.remove();
    fsBar = null;
    fsShow = null;
    return;
  }
  if (fsBar) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const label = standalone ? tr('Back to WorkCraft') : tr('Exit full screen');
  const exit = h<'button'>('button.fs-btn', { type: 'button', html: icon(standalone ? 'popout' : 'exitFullscreen', { size: 16 }) + `<span>${esc(label)}</span>`, onclick: () => (standalone ? void standalone.back() : workspace.setFullscreen(null)) });
  const pill = h('div.fs-pill', exit);
  const zone = h('div.fs-zone', { 'aria-hidden': 'true' });
  const bar = h('div.fs-bar', zone, pill);
  // Stays open while the pointer is on the strip or the button, closes a moment after it left
  let over = 0;
  const hide = () => {
    clearTimeout(timer);
    if (!over) timer = setTimeout(() => bar.classList.remove('is-open'), 2600);
  };
  fsShow = () => {
    bar.classList.add('is-open');
    hide();
  };
  for (const el of [zone, pill]) {
    el.addEventListener('pointerenter', () => {
      over++;
      fsShow?.();
    });
    el.addEventListener('pointerleave', () => {
      over = Math.max(0, over - 1);
      hide();
    });
  }
  zone.addEventListener('pointerdown', fsShow);
  exit.addEventListener('focus', () => bar.classList.add('is-open'));
  document.body.append(bar);
  fsBar = bar;
  // Shown once when it starts, so the way out is known
  bar.classList.add('is-open');
  setTimeout(hide, 800);
}

function requestBrowserFullscreen() {
  if (standalone || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  void document.documentElement.requestFullscreen().catch(() => {});
}

/** Ends full screen without drawing (the caller renders). */
function leaveFullscreen() {
  if (!fullscreenId) return;
  fullscreenId = null;
  state.maximized = fsBefore && state.panels[fsBefore] ? fsBefore : null;
  fsBefore = null;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

const queue: string[] = [];
let pumping = false;

function requestMount(id: string, priority = false) {
  const r = rt.get(id);
  if (!r || r.status === 'loading' || r.status === 'active' || state.panels[id]?.popout) return;
  if (!isApp(state.panels[id]!.tool)) return void mount(id);
  const at = queue.indexOf(id);
  if (at >= 0) queue.splice(at, 1);
  if (priority) queue.unshift(id);
  else queue.push(id);
  r.status = 'queued';
  renderPanelState(id);
  void pump();
}

/** Loads apps one after another, so WebAssembly start and GPU setup do not slow each other down. */
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const r = rt.get(id);
      if (!r || r.status !== 'queued') continue;
      if (!isVisible(id) && !r.waiters.length) {
        r.status = 'idle';
        renderPanelState(id);
        continue;
      }
      await mount(id);
      const inst = rt.get(id)?.instance;
      // Wait for the app to be ready, but not for an app nobody sees while a visible one waits
      // (for example WordCraft behind Full Chat Mode and GridCraft in a floating window)
      if (inst?.ready) {
        let iv: ReturnType<typeof setInterval> | undefined;
        await Promise.race([
          inst.ready.catch(() => {}),
          new Promise<void>((res) => {
            const t0 = Date.now();
            iv = setInterval(() => {
              if (Date.now() - t0 > 25000 || (!isVisible(id) && queue.some((q) => isVisible(q)))) res();
            }, 300);
          }),
        ]);
        clearInterval(iv);
      }
    }
  } finally {
    pumping = false;
  }
}

function syncResources() {
  for (const [id, r] of rt) {
    const v = isVisible(id);
    if (v) {
      clearTimeout(r.unloadTimer);
      r.unloadTimer = undefined;
      if (r.status === 'idle') requestMount(id, id === state.focused);
      if (r.status === 'active' && r.paused) {
        r.paused = false;
        r.instance?.resume?.();
        renderPanelState(id);
      }
    } else if (r.status === 'active' && !r.paused) {
      r.paused = true;
      r.instance?.pause?.();
      const mins = prefs.get('autoUnloadMinutes');
      if (mins > 0 && isApp(state.panels[id]!.tool)) {
        r.unloadTimer = setTimeout(() => {
          if (!isVisible(id) && (r.instance?.canUnload?.() ?? true)) void unloadInstance(id);
        }, mins * 60_000);
      }
      renderPanelState(id);
    }
  }
  bus.emit('workspace:resources');
}

function makeCtx(id: string, r: Runtime): PanelContext {
  return {
    id,
    tool: state.panels[id]!.tool,
    get path() {
      return state.panels[id]?.path ?? null;
    },
    setPath(path) {
      const p = state.panels[id];
      if (!p) return;
      const changed = p.path !== path;
      p.path = path;
      updateHead(id);
      renderTabs();
      persist();
      bus.emit('workspace:change');
      // Recent files (src/storage/recent.ts): a panel got a file, by opening it or by saving it under a new name
      if (path && changed && (TOOLS[p.tool].kind === 'app' || p.tool === 'code')) {
        noteOpened(path, p.tool, fs.project);
        bus.emit('file:opened', { path, tool: p.tool });
      }
    },
    setStatus(text) {
      r.statusText.textContent = text;
    },
    setDirty(d) {
      r.el.classList.toggle('is-dirty', d);
    },
    setBadge(text) {
      r.badgeEl.textContent = text || '';
      r.badgeEl.hidden = !text;
    },
    focus: () => workspace.focus(id, false),
    openFile: (path, tool) => workspace.openFile(path, tool),
    restore: state.panels[id]?.scroll ? { scroll: state.panels[id]!.scroll } : null,
    onDispose(fn) {
      r.disposers.push(fn);
    },
    origin: `panel:${id}`,
  };
}

async function mount(id: string) {
  const p = state.panels[id];
  const r = rt.get(id);
  if (!p || !r || r.status === 'loading' || r.status === 'active') return;
  r.status = 'loading';
  r.loadStarted = performance.now();
  renderPanelState(id);
  try {
    const mod = await TOOLS[p.tool].load();
    if (!rt.has(id)) return;
    r.host.replaceChildren();
    r.instance = await mod.mount(r.host, makeCtx(id, r));
    r.status = 'active';
    r.paused = false;
    renderPanelState(id);
    for (const w of r.waiters.splice(0)) w.resolve(r.instance);
    void r.instance.ready?.then(() => {
      r.loadMs = Math.round(performance.now() - (r.loadStarted || 0));
      renderPanelState(id);
    });
    if (state.panels[id]?.scroll) r.instance.setScroll?.(state.panels[id]!.scroll!);
    syncResources();
  } catch (e) {
    console.error(e);
    r.status = 'error';
    r.error = e as Error;
    renderPanelState(id);
    for (const w of r.waiters.splice(0)) w.reject(e as Error);
  }
}

async function unloadInstance(id: string) {
  const r = rt.get(id);
  if (!r || r.status !== 'active') return;
  for (const fn of r.disposers.splice(0)) {
    try {
      fn();
    } catch (e) {
      console.warn(e);
    }
  }
  try {
    await r.instance?.unmount();
  } catch (e) {
    console.warn(e);
  }
  r.instance = null;
  r.host.replaceChildren();
  r.status = 'unloaded';
  r.paused = false;
  renderPanelState(id);
  bus.emit('workspace:resources');
}

export function stats() {
  const all = [...rt.values()];
  return {
    total: all.length,
    active: all.filter((r) => r.status === 'active' && !r.paused).length,
    paused: all.filter((r) => r.status === 'active' && r.paused).length,
    unloaded: all.filter((r) => r.status === 'unloaded' || r.status === 'idle').length,
    apps: [...rt.entries()].filter(([id, r]) => isApp(state.panels[id]?.tool || '') && r.status === 'active').length,
  };
}

// ---------------------------------------------------------------- Panel-DOM

const STATE_LABEL: Record<Status, string> = { idle: tr('not loaded'), queued: tr('waiting'), loading: tr('loading'), active: tr('active'), unloaded: tr('unloaded'), error: tr('error') };

function headButton(ic: string, label: string, run: () => void): HTMLButtonElement {
  const b = h<'button'>('button.icon-btn', { type: 'button', title: label, 'aria-label': label, html: icon(ic, { size: 16 }) });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    run();
  });
  return b;
}

// ---------------------------------------------------------------- Team Mode: agent badge on panels

let agentSeq = 0;
const agentTimers = new Map<string, ReturnType<typeof setTimeout>>();
const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/**
 * Status badge in the sub-agent's accent on every panel that shows the file: "writing" while the
 * write runs, "updated" when it is done (the app reloads the file through live sync). Panels the
 * write opens a moment later get the badge too.
 */
function flashAgent(e: BusEvents['agent:file'] & { seq: number }, round = 0) {
  for (const [id, r] of rt) {
    const p = state.panels[id];
    if (!p?.path || !samePath(p.path, e.path) || r.el.dataset.agentSeq === String(e.seq)) continue;
    let tag = r.el.querySelector<HTMLElement>('.panel-agent');
    if (!tag) {
      tag = h('span.panel-agent.mono', { role: 'status' });
      r.badgeEl.after(tag);
    }
    tag.hidden = false;
    tag.style.setProperty('--agent', e.accent);
    tag.dataset.state = e.state;
    tag.dataset.role = e.role;
    tag.innerHTML = `<i aria-hidden="true"></i><span>${esc(e.label)} · ${e.state === 'writing' ? tr('writing') : e.state === 'written' ? tr('updated') : tr('error')}</span>`;
    tag.title = tr('Team Mode: {label} {state} {path}', { label: e.label, state: e.state, path: e.path });
    tag.classList.remove('is-flash');
    void tag.offsetWidth;
    tag.classList.add('is-flash');
    r.el.dataset.agentSeq = String(e.seq);
    r.el.dataset.agent = e.role;
    r.el.style.setProperty('--agent', e.accent);
    if (e.state === 'written') r.el.dataset.agentWrites = String(Number(r.el.dataset.agentWrites || 0) + 1);
    clearTimeout(agentTimers.get(id));
    if (e.state !== 'writing')
      agentTimers.set(
        id,
        setTimeout(() => {
          tag!.hidden = true;
          delete r.el.dataset.agent;
        }, 4500)
      );
  }
  if (e.state !== 'writing' && round < 3) setTimeout(() => flashAgent(e, round + 1), 700 * (round + 1));
}

function createPanelDom(id: string) {
  const p = state.panels[id]!;
  const t = TOOLS[p.tool];
  const side = t.zone !== 'stage';
  const el = h('section.panel.frame.sm', { 'data-tool': t.id, 'data-id': id, 'data-zone': t.zone, style: `--tool:${t.accent}`, 'aria-label': t.name, tabindex: '-1' });
  const pathEl = h('span.panel-path.mono');
  const stateEl = h('span.panel-state.mono');
  const badgeEl = h('span.panel-badge.mono', { hidden: true });
  const btn = {
    unload: headButton('power', tr('Unload and free memory'), () => void workspace.unload(id)),
    full: headButton('fullscreen', tr('Full screen'), () => workspace.setFullscreen(id)),
    min: headButton('minimize', tr('Minimize to the dock'), () => workspace.minimize(id)),
    pip: headButton('pip', tr('Picture in picture'), () => workspace.togglePip(id)),
    pop: headButton('popout', tr('Open in a separate window'), () => void workspace.popOut(id)),
    max: headButton('expand', tr('Maximize'), () => workspace.toggleMaximize(id)),
    hide: headButton('eyeOff', tr('Hide'), () => workspace.hide(id)),
    // X only hides: the panel keeps its state and its tab, and comes back with one click. Closing for good (and freeing the memory)
    // is a red entry in the panel menu.
    close: headButton('close', tr('Hide'), () => workspace.hide(id)),
  };
  // The header has two buttons: Maximize and X. In the side zones (project tree, chat) X hides the panel, since
  // they are never closed. Everything else (full screen, floating, separate window, hide, file actions ...) sits
  // behind a right click, a pencil barrel button or a long press on the header, and is built from the state of
  // the buttons below, which are not shown.
  // Only apps and the code editor can run in a window of their own (the chat has its own pop-out)
  if (side || !canPopOut(p.tool)) btn.pop.hidden = true;
  for (const [k, b] of Object.entries(btn)) b.dataset.btn = k;
  const head = h(
    'header.panel-head',
    side ? null : h('span.panel-grip', { html: icon('grip', { size: 14 }), 'aria-hidden': 'true' }),
    h('span.panel-mark', { html: toolMark(t.id, 18) }),
    h('span.panel-name', t.name),
    t.version ? h('span.panel-ver.mono', { title: tr('{name} version {v}', { name: t.name, v: t.version }) }, `v${t.version}`) : null,
    pathEl,
    h('span.panel-dirty', { title: tr('Unsaved changes'), 'aria-hidden': 'true' }),
    badgeEl,
    h('span.spacer'),
    stateEl,
    btn.max,
    btn.close
  );
  head.addEventListener('dblclick', (e) => {
    if (!(e.target as Element).closest('button')) workspace.toggleMaximize(id);
  });
  // Right click, the pencil's barrel button or a long press with a finger on the header (not on its buttons)
  onContextAction(head, (x, y) => panelMenu(id, x, y), { accept: (el) => !el.closest('button') });
  const host = h('div.panel-host');
  const placeholder = h('div.panel-placeholder');
  const statusText = h('span.panel-status-text');
  const engineText = h('span.panel-engine');
  el.append(head, h('div.panel-body.well.flush', host, placeholder), h('footer.panel-status.mono', h('span.tool-chip', t.version ? `${t.name} ${t.version}` : t.name), statusText, h('span.spacer'), engineText));
  el.addEventListener('pointerdown', () => workspace.focus(id, false), true);
  el.addEventListener('focusin', () => workspace.focus(id, false));
  if (!side) enableDrag(head, id);
  // Floating window: the header moves it, the edges resize it
  attachPip(el, head, {
    active: () => !!state.panels[id]?.pip,
    get: () => state.panels[id]?.pip,
    set: (r) => {
      const p = state.panels[id];
      if (!p?.pip) return;
      p.pip = r;
      placePip(id);
    },
    end: () => {
      persist();
      bus.emit('workspace:resize');
    },
  });
  // Header: move grip without scrolling, text selection and Scribble
  guardSurface(head);
  const r: Runtime = { el, host, placeholder, pathEl, stateEl, badgeEl, statusText, engineText, btn, status: 'idle', instance: null, paused: false, disposers: [], waiters: [] };
  rt.set(id, r);
  if (side) (t.zone === 'left' ? dom!.left : dom!.right).append(el);
  else dom!.layer.append(el);
  updateHead(id);
  renderPanelState(id);
}

/**
 * The menu of a panel (right click or long press on the header, the tab or the app's icon in the rail): window actions, the file (desktop app, project tree, file manager, copy path), the engine
 * (reload, unload, info) and how it goes away. What is offered is decided by panelActions() (panel-menu.ts); the
 * window actions follow their (not shown) header buttons, so a state change in one place shows in the other.
 */
function panelMenu(id: string, x: number, y: number, opt: { alignRight?: boolean; anchor?: HTMLElement; extra?: MenuEntry[] } = {}) {
  void desktopApps();
  const r = rt.get(id);
  const p = state.panels[id];
  if (!r || !p) return;
  const t = TOOLS[p.tool];
  const side = t.zone !== 'stage';
  const desk = p.path ? desktopAppCached(p.tool) : null;
  const plan = panelActions({
    shown: p.mode === 'normal',
    app: isApp(p.tool),
    side,
    status: r.status,
    hasPath: !!p.path,
    popped: !!p.popout,
    canPopOut: !r.btn.pop.hidden,
    canMinimize: !r.btn.min.hidden,
    hasDesktopApp: !!desk,
    canLocate: canLocate(),
  });
  const press = (b: HTMLButtonElement) => b.getAttribute('aria-pressed') === 'true' || undefined;
  const label = (b: HTMLButtonElement) => b.getAttribute('aria-label') || b.title;
  const entries: Record<PanelAction, () => MenuItem> = {
    show: () => ({ label: tr('Show {name}', { name: t.name }), icon: 'eye', run: () => workspace.show(id) }),
    maximize: () => ({ label: label(r.btn.max), icon: state.maximized === id ? 'collapse' : 'expand', run: () => r.btn.max.click() }),
    fullscreen: () => ({ label: label(r.btn.full), icon: fullscreenId === id ? 'exitFullscreen' : 'fullscreen', hint: 'Alt ↵', checked: press(r.btn.full), run: () => r.btn.full.click() }),
    minimize: () => ({ label: label(r.btn.min), icon: 'minimize', run: () => r.btn.min.click() }),
    pip: () => ({ label: label(r.btn.pip), icon: 'pip', checked: press(r.btn.pip), run: () => r.btn.pip.click() }),
    popout: () => ({ label: label(r.btn.pop), icon: 'popout', checked: press(r.btn.pop), run: () => r.btn.pop.click() }),
    desktop: () => ({ label: tr('Open in {name} for desktop', { name: desk!.name }), icon: 'external', run: () => void openInDesktop(desk!.id, p.path ?? undefined) }),
    tree: () => ({ label: tr('Show in the project tree'), icon: 'folder', run: () => void revealInTree(p.path!) }),
    reveal: () => ({ label: tr('Show in the file manager'), icon: 'folderOpen', run: () => void revealInFileManager(p.path!) }),
    'copy-path': () => ({ label: tr('Copy path'), icon: 'copy', run: () => void copyProjectPath(p.path!) }),
    reload: () => ({ label: tr('Reload'), icon: 'refresh', run: () => void workspace.reload(id) }),
    unload: () => ({ label: label(r.btn.unload), icon: 'power', danger: true, run: () => r.btn.unload.click() }),
    info: () => ({ label: tr('Panel info'), icon: 'info', run: () => void showPanelInfo(id) }),
    hide: () => ({ label: tr('Hide'), icon: 'eyeOff', run: () => workspace.hide(id) }),
    close: () => ({ label: tr('Close and free memory'), icon: 'close', danger: true, run: () => void workspace.close(id) }),
  };
  const items: MenuEntry[] = plan.map((a) => (a === '-' ? a : entries[a]()));
  if (opt.extra?.length) items.push('-', ...opt.extra);
  menu(items, x, y, { alignRight: opt.alignRight, anchor: opt.anchor });
}

/** Opens the project tree (it may be hidden or not started yet) and selects the file in it. */
async function revealInTree(path: string) {
  try {
    await workspace.ensureInstance('tree');
    bus.emit('tree:reveal', { path });
  } catch (e) {
    notifyError(e);
  }
}

/** What the panel is doing: window, state, start time, memory, and what the engine itself reports. */
async function showPanelInfo(id: string) {
  const r = rt.get(id);
  const p = state.panels[id];
  if (!r || !p) return;
  const t = TOOLS[p.tool];
  let memory = null;
  let report: Record<string, unknown> | null = null;
  if (r.status === 'active') {
    try {
      memory = r.instance?.resources?.() || null;
      report = r.instance?.status?.() || null;
    } catch {
      /* an engine that cannot answer right now has nothing to show */
    }
  }
  const rows = infoRows(
    { name: t.name, version: t.version, status: STATE_LABEL[r.status], mode: p.popout ? tr('separate window') : p.pip ? tr('floating') : fullscreenId === id ? tr('full screen') : p.mode === 'normal' ? (state.maximized === id ? tr('maximized') : tr('on the stage')) : p.mode === 'minimized' ? tr('minimized') : tr('hidden'), path: p.path, loadMs: r.loadMs || 0, paused: !!r.paused, memory, report, error: r.error?.message },
    { app: tr('App'), status: tr('State'), window: tr('Window'), file: tr('File'), start: tr('Start time'), wasm: tr('WebAssembly memory'), gpu: tr('GPU memory (estimate)'), heap: tr('JS heap'), error: tr('Error') }
  );
  const list = h('dl.panel-info', ...rows.flatMap(([k, v]) => [h('dt.eyebrow', k), h('dd.mono', v)]));
  await dialog({ title: t.name, tone: tr('Panel info'), body: list, ok: false, cancel: tr('Close') });
}

function updateHead(id: string) {
  const r = rt.get(id);
  const p = state.panels[id];
  if (!r || !p) return;
  r.pathEl.textContent = p.path || '';
  r.pathEl.title = p.path || '';
  r.el.classList.toggle('is-focused', state.focused === id);
  r.el.classList.toggle('is-max', state.maximized === id);

  r.el.classList.toggle('is-pip', !!p.pip && p.mode === 'normal');
  r.el.classList.toggle('is-fs', fullscreenId === id);
  r.el.classList.toggle('is-popped', !!p.popout);
  r.btn.pop.hidden = !canPopOut(p.tool) || zoneOf(id) !== 'stage' || !!standalone;
  r.btn.pop.title = p.popout ? tr('Show the separate window') : tr('Open in a separate window');
  r.btn.pop.setAttribute('aria-label', r.btn.pop.title);
  r.btn.pop.setAttribute('aria-pressed', String(!!p.popout));
  r.el.dataset.mode = p.mode;
  r.btn.pip.setAttribute('aria-pressed', String(!!p.pip));
  r.btn.pip.setAttribute('aria-label', p.pip ? tr('Back into the layout') : tr('Picture in picture'));
  r.btn.pip.title = r.btn.pip.getAttribute('aria-label')!;
  const max = state.maximized === id;
  r.btn.max.innerHTML = icon(max ? 'collapse' : 'expand', { size: 16 });
  r.btn.max.setAttribute('aria-label', max ? tr('Restore') : tr('Maximize'));
  r.btn.max.title = r.btn.max.getAttribute('aria-label')!;
  const full = fullscreenId === id;
  r.btn.full.innerHTML = icon(full ? 'exitFullscreen' : 'fullscreen', { size: 16 });
  r.btn.full.setAttribute('aria-label', full ? tr('Exit full screen') : tr('Full screen'));
  r.btn.full.title = r.btn.full.getAttribute('aria-label')!;
  r.btn.full.setAttribute('aria-pressed', String(full));
}

function renderPanelState(id: string) {
  const r = rt.get(id);
  const p = state.panels[id];
  if (!r || !p) return;
  const t = TOOLS[p.tool];
  // No text while running (also when paused): room for the file path. Only loading and errors show.
  const label = r.status === 'active' || p.popout ? '' : STATE_LABEL[r.status];
  r.stateEl.textContent = label;
  r.stateEl.hidden = !label;
  r.el.dataset.state = r.status;
  r.el.classList.toggle('is-paused', r.paused);
  r.btn.unload.hidden = !(r.status === 'active' && isApp(p.tool));
  const popped = !!p.popout;
  const showPh = popped || r.status !== 'active';
  r.placeholder.hidden = !showPh;
  r.host.hidden = showPh;
  if (popped) {
    r.placeholder.replaceChildren(
      ...nodes(
        h('div.ph-mark', { html: toolMark(t.id, 32) }),
        h('p.duo', t.name, ' ', h('span.tone', tr('in its own window'))),
        h('small.muted', p.path ? tr('{file} is open in a separate window. It works there and is saved into the project like here.', { file: basename(p.path) }) : tr('It works in a separate window and is saved into the project like here.')),
        h('div.ph-actions', h('button.btn', { type: 'button', onclick: () => popouts.focus(id) }, tr('Show window')), h('button.btn.primary', { type: 'button', onclick: () => popouts.close(id) }, tr('Bring back')))
      )
    );
  } else if (showPh) {
    const txt: Record<Status, string> = {
      idle: tr('Loads as soon as the panel is visible.'),
      queued: tr('Waits until the previous app has started.'),
      loading: tr('Loading the module.'),
      active: '',
      unloaded: tr('Memory freed. Click to load again.'),
      error: tr('Loading failed: {message}', { message: r.error?.message || tr('unknown error') }),
    };
    r.placeholder.replaceChildren(
      ...nodes(
      h('div.ph-mark', { html: toolMark(t.id, 32) }),
      h('p.duo', t.name, ' ', h('span.tone', STATE_LABEL[r.status])),
      h('small.muted', txt[r.status]),
      r.status === 'unloaded' || r.status === 'error' || r.status === 'idle'
        ? h('button.btn', { type: 'button', onclick: () => requestMount(id, true) }, r.status === 'error' ? tr('Load again') : tr('Load now'))
        : null
      )
    );
  }
  r.engineText.textContent = r.status === 'active' ? `${r.paused ? tr('paused') : tr('running')}${r.loadMs ? ` · ${tr('start {s} s', { s: (r.loadMs / 1000).toFixed(1) })}` : ''}` : '';
}

// ---------------------------------------------------------------- Rendern

/** flex-grow scaled: sums below 1 would only share part of the free space. */
const grow = (size: number) => `${(size * 1000).toFixed(2)} 1 0`;

function renderTree(node: LayoutNode): HTMLElement {
  if (node.t === 'leaf') return h('div.slot', { 'data-slot': node.id });
  const box = h('div.split', { 'data-dir': node.dir });
  node.kids.forEach((k, i) => {
    const cell = h('div.split-cell', { style: { flex: grow(node.sizes[i]!) } });
    cell.append(renderTree(k));
    box.append(cell);
    if (i < node.kids.length - 1) box.append(makeGutter(node, i, box));
  });
  return box;
}

function makeGutter(node: Extract<LayoutNode, { t: 'split' }>, i: number, box: HTMLElement): HTMLElement {
  const g = h('div.gutter', { role: 'separator', 'aria-orientation': node.dir === 'row' ? 'vertical' : 'horizontal', tabindex: '0', title: tr('Drag to resize. Double click evens out, a double tap with finger or pencil cycles 50:50, 70:30, 30:70 and full screen') });
  const label = h('span.gutter-label.mono', { hidden: true, 'aria-hidden': 'true' });
  g.append(label);
  guardSurface(g);
  const apply = () => {
    const cells = [...box.children].filter((c) => c.classList.contains('split-cell')) as HTMLElement[];
    cells.forEach((c, j) => (c.style.flex = grow(node.sizes[j]!)));
    positionPanels();
  };
  let labelTimer: ReturnType<typeof setTimeout> | undefined;
  const showLabel = (ratio: number | 'full') => {
    label.hidden = false;
    label.textContent = ratio === 'full' ? tr('Full screen') : `${Math.round(ratio * 100)} : ${Math.round((1 - ratio) * 100)}`;
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => (label.hidden = true), 900);
  };
  const setRatio = (ratio: number) => {
    const sum = node.sizes[i]! + node.sizes[i + 1]!;
    node.sizes[i] = clamp(sum * ratio, MIN, sum - MIN);
    node.sizes[i + 1] = sum - node.sizes[i]!;
  };
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(g, e.pointerId);
    const kind = inputKind(e);
    const rect = box.getBoundingClientRect();
    const total = node.dir === 'row' ? rect.width : rect.height;
    const start = node.dir === 'row' ? e.clientX : e.clientY;
    const a0 = node.sizes[i]!;
    const b0 = node.sizes[i + 1]!;
    document.body.classList.add('is-resizing', node.dir === 'row' ? 'resize-x' : 'resize-y');
    g.classList.add('is-active');
    g.dataset.input = kind;
    const move = (ev: PointerEvent) => {
      const d = ((node.dir === 'row' ? ev.clientX : ev.clientY) - start) / total;
      node.sizes[i] = clamp(a0 + d, MIN, a0 + b0 - MIN);
      node.sizes[i + 1] = a0 + b0 - node.sizes[i]!;
      // Finger and pencil snap at 30, 50 and 70 percent
      if (kind !== 'mouse') {
        const ratio = node.sizes[i]! / (a0 + b0);
        const snap = SNAPS.find((x) => Math.abs(ratio - x) < 0.025);
        if (snap) {
          setRatio(snap);
          showLabel(snap);
        }
      }
      apply();
    };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      g.removeEventListener('pointercancel', up);
      g.classList.remove('is-active');
      document.body.classList.remove('is-resizing', 'resize-x', 'resize-y');
      persist();
      bus.emit('workspace:resize');
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  });
  g.addEventListener('dblclick', (e) => {
    // A double tap with finger or pencil also fires dblclick: the snap points apply there
    if ((e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
    if (document.documentElement.dataset.input && document.documentElement.dataset.input !== 'mouse') return;
    node.sizes = node.sizes.map(() => 1 / node.sizes.length);
    apply();
    persist();
  });
  onDoubleTap(g, () => {
    const sum = node.sizes[i]! + node.sizes[i + 1]!;
    const ratio = node.sizes[i]! / sum;
    const at = SNAPS.findIndex((x) => Math.abs(ratio - x) < 0.02);
    if (at === SNAPS.length - 1) {
      // Full screen: maximize the larger side of the last snap point (30:70, so the second one)
      const firstLeaf = (n: LayoutNode): string | null => (n.t === 'leaf' ? n.id : n.kids[0] ? firstLeaf(n.kids[0]) : null);
      const target = firstLeaf(node.kids[i + 1]!);
      showLabel('full');
      setRatio(0.5);
      if (target) workspace.toggleMaximize(target);
      return;
    }
    const next = SNAPS[at + 1] ?? SNAPS[0];
    setRatio(next);
    showLabel(next);
    apply();
    persist();
    bus.emit('workspace:resize');
  });
  g.addEventListener('keydown', (e) => {
    const back = (node.dir === 'row' && e.key === 'ArrowLeft') || (node.dir === 'col' && e.key === 'ArrowUp');
    const fwd = (node.dir === 'row' && e.key === 'ArrowRight') || (node.dir === 'col' && e.key === 'ArrowDown');
    if (!back && !fwd) return;
    e.preventDefault();
    const sum = node.sizes[i]! + node.sizes[i + 1]!;
    node.sizes[i] = clamp(node.sizes[i]! + (fwd ? 0.03 : -0.03) * (e.shiftKey ? 3 : 1), MIN, sum - MIN);
    node.sizes[i + 1] = sum - node.sizes[i]!;
    apply();
    persist();
  });
  return g;
}

/** Floating window: fixed position from the stored rectangle, kept inside the visible area. */
function placePip(id: string) {
  const r = rt.get(id);
  const p = state.panels[id];
  if (!r || !p?.pip) return;
  p.pip = clampRect(p.pip, HEAD);
  r.el.hidden = p.mode !== 'normal' || (!!fullscreenId && fullscreenId !== id);
  r.el.style.setProperty('--pip-x', `${p.pip.x}px`);
  r.el.style.setProperty('--pip-y', `${p.pip.y}px`);
  r.el.style.setProperty('--pip-w', `${p.pip.w}px`);
  r.el.style.setProperty('--pip-h', `${p.pip.h}px`);
}

/** Places every stage panel over its slot. Panels stay in the DOM: iframes never reload. */
function positionPanels() {
  if (!dom) return;
  const base = dom.ws.getBoundingClientRect();
  for (const [id, r] of rt) {
    if (state.panels[id]?.pip) {
      placePip(id);
      continue;
    }
    if (zoneOf(id) !== 'stage') continue;
    if (state.maximized === id) {
      r.el.hidden = false;
      const inset = fullscreenId === id ? 0 : 6;
      Object.assign(r.el.style, { left: `${inset}px`, top: `${inset}px`, width: `${base.width - 2 * inset}px`, height: `${base.height - 2 * inset}px` });
      continue;
    }
    const slot = dom.layout.querySelector(`.slot[data-slot="${CSS.escape(id)}"]`);
    if (!slot) {
      r.el.hidden = true;
      continue;
    }
    const b = slot.getBoundingClientRect();
    r.el.hidden = false;
    Object.assign(r.el.style, { left: `${b.left - base.left}px`, top: `${b.top - base.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  }
}

function renderSides() {
  if (!dom) return;
  // Drawers lie on top of the stage: a saved layout with both side bars open keeps the chat and closes the tree
  const t = state.panels.tree;
  const c = state.panels.chat;
  if (device.compact && t?.mode === 'normal' && c?.mode === 'normal' && !t.pip && !c.pip && state.maximized !== 'tree') t.mode = 'hidden';
  // iPad in portrait and medium window widths: both side bars together at most 48 %
  const wsW = dom.ws.clientWidth;
  const open = (['left', 'right'] as const).filter((z) => state.panels[SIDE_IDS[z]]?.mode === 'normal');
  const sum = open.reduce((a, z) => a + state.sides[z], 0);
  const budget = wsW < 1180 ? wsW * 0.48 : Infinity;
  const shrink = sum > budget ? budget / sum : 1;
  dom.ws.dataset.chatSide = prefs.get('chatSide');
  for (const zone of ['left', 'right'] as const) {
    const id = SIDE_IDS[zone];
    const p = state.panels[id];
    const box = zone === 'left' ? dom.left : dom.right;
    const gutter = zone === 'left' ? dom.gl : dom.gr;
    const mode = p?.mode || 'hidden';
    const maxed = state.maximized === id;
    box.dataset.mode = mode;
    box.classList.toggle('is-max', maxed);
    // The panel floats: the zone keeps no width, the panel stays in it (no reload, drafts stay)
    const floating = !!p?.pip && mode === 'normal';
    box.classList.toggle('has-pip', floating);
    if (floating) {
      box.hidden = false;
      box.classList.remove('is-drawer');
      gutter.hidden = true;
      box.style.width = '0px';
      continue;
    }
    const shown = mode === 'normal';
    // Narrow windows (Slide Over, Split View 1/3): side bars as drawers over the stage
    const drawer = device.compact && mode === 'normal' && !maxed;
    box.classList.toggle('is-drawer', drawer);
    box.hidden = !shown;
    gutter.hidden = !shown || maxed || drawer;
    const maxSide = Math.max(220, Math.round(dom.ws.clientWidth * (drawer ? 0.88 : 0.5)));
    box.style.width = `${Math.round(Math.max(drawer ? 220 : 180, Math.min(state.sides[zone] * (drawer ? 1 : shrink), maxSide)))}px`;
  }
}

function render() {
  if (!dom) return;
  const stageMax = state.maximized && zoneOf(state.maximized) === 'stage' && locateLeaf(state.maximized);
  dom.ws.dataset.max = state.maximized ? zoneOf(state.maximized) : '';
  document.documentElement.classList.toggle('is-panel-full', !!fullscreenId);
  syncFsBar();
  // Full Chat Mode: the AI chat fills the window (also ?mode=chat)
  const fullChat = state.maximized === 'chat';
  if (document.documentElement.classList.contains('is-chat-full') !== fullChat) {
    document.documentElement.classList.toggle('is-chat-full', fullChat);
    bus.emit('chat:view', { full: fullChat });
  }
  dom.layer.classList.toggle('has-pip', Object.values(state.panels).some((p) => p.pip && p.mode === 'normal' && zoneOf(p.id) === 'stage'));
  dom.ws.classList.toggle('is-compact', device.compact);
  if (!state.tree) dom.layout.replaceChildren(emptyStage());
  else dom.layout.replaceChildren(renderTree(state.tree));
  dom.layer.classList.toggle('has-max', !!stageMax);
  // Gutters of the split tree sit above the panels (z-index 3): hide them behind a maximized panel
  dom.layout.classList.toggle('has-max', !!stageMax);
  renderSides();
  positionPanels();
  for (const id of Object.keys(state.panels)) updateHead(id);
  renderTabs();
  renderDock();
  syncResources();
  persist();
  bus.emit('workspace:change');
  requestAnimationFrame(() => {
    positionPanels();
    bus.emit('workspace:resize');
  });
}

/**
 * The welcome page: what the stage shows when no panel is visible, which is how a new workspace and a new project start (nothing opens by
 * itself, src/ecosystems/enter.ts). It says which workspace it is, brings back what you hid in one click, lists the apps, and offers
 * "Open the first apps" as a choice. Start-up and a workspace switch used to arrange the stage themselves, so
 * this is what remains after you hid or closed the last panel, or when no app of the workspace has a web build here. It says
 * which workspace it is, brings back what you hid in one click, and lists the apps of the workspace.
 */
function emptyStage(): HTMLElement {
  const eco = activeEcosystem();
  const openOf = (tool: ToolId) => {
    const ex = Object.values(state.panels).find((p) => p.tool === tool);
    if (ex) workspace.show(ex.id);
    else workspace.openPanel(tool);
  };
  const card = (tool: ToolId, line: string, on: () => void) => {
    const t = TOOLS[tool];
    return h('button.empty-tool' + (t.available ? '' : '.is-missing'), { type: 'button', style: `--tool:${t.accent}`, onclick: on }, h('span.empty-mark', { html: toolMark(tool, 28) }), h('strong', t.name), h('small.muted', line));
  };
  // What you hid: the panels keep their state, one click shows them again
  const hidden = state.order.filter((id) => zoneOf(id) === 'stage' && state.panels[id]!.mode !== 'normal' && !state.panels[id]!.pip);
  const back = hidden.map((id) => {
    const p = state.panels[id]!;
    return card(p.tool, p.path ? basename(p.path) : tr('Hidden. Shows as you left it.'), () => workspace.show(id));
  });
  // The apps of the workspace that are not already in the list above (a hidden WordCraft is not offered twice)
  const listed = new Set(hidden.map((id) => state.panels[id]!.tool));
  const apps = eco.apps
    .filter((id) => !listed.has(id))
    .map((id) => {
      const t = TOOLS[id];
      return card(id, t.available ? t.blurb : tr('No web build here yet'), () => openOf(id));
    });
  const recent = recentList(fs.project, (e) => void workspace.openFile(e.path, e.tool as ToolId), 5);
  const switchBtn = h<'button'>('button.btn.sm', { type: 'button', html: icon('shuffle', { size: 15 }) + `<span>${tr('Switch workspace')}</span>`, onclick: () => void import('../ecosystems/ui.js').then((m) => m.openEcosystemPicker()) });
  // An explicit choice: the first apps of the workspace side by side (two on a wide stage, one in a small window; weights on an iPad)
  const firstBtn = h<'button'>('button.btn.sm', { type: 'button', 'data-act': 'open-first', title: tr('Opens the first apps of this workspace side by side'), html: icon('grid', { size: 15 }) + `<span>${tr('Open the first apps')}</span>`, onclick: () => void import('../ecosystems/enter.js').then((m) => m.openFirstApps(eco)) });
  return h(
    'div.empty-stage',
    h(
      'div.frame.lg',
      h(
        'div.well',
        h('div.empty-head', h('div', h('p.eyebrow', tr('Workspace')), h('h2.duo', tr('Welcome') + ' ', h('span.tone', eco.name))), h('span.empty-eco', { title: tr('The workspace in use') }, tr('Nothing is running'))),
        h('p.muted', tr('Nothing starts by itself: choose an app to open it, so the workspace stays fast and light. Anything you hid is still here as you left it.')),
        back.length ? h('p.eyebrow.empty-group', tr('Hidden panels')) : null,
        back.length ? h('div.empty-grid', back) : null,
        apps.length ? h('p.eyebrow.empty-group', back.length ? tr('More apps of this workspace') : tr('Apps of this workspace')) : null,
        apps.length ? h('div.empty-grid', apps) : null,
        recent,
        h('div.empty-foot', firstBtn, switchBtn)
      )
    )
  );
}

function renderTabs() {
  if (!dom) return;
  const mine = new Set<string>(activeApps());
  dom.tabs.replaceChildren(
    ...state.order
      // A hidden panel of an app that belongs to another workspace and never started stays off the strip (it is not gone)
      .filter((id) => zoneOf(id) === 'stage' && tabBelongs({ app: TOOLS[state.panels[id]!.tool].kind === 'app', tool: state.panels[id]!.tool, mode: state.panels[id]!.mode, live: rt.get(id)?.status === 'active' }, mine))
      .map((id) => {
        const p = state.panels[id]!;
        const t = TOOLS[p.tool];
        const r = rt.get(id);
        const cls = ['tab', p.mode !== 'normal' ? 'is-' + p.mode : '', state.focused === id ? 'is-focused' : '', r?.status === 'active' ? (r.paused ? 'is-paused' : 'is-live') : ''].filter(Boolean).join(' ');
        const main = h<'button'>('button.tab-main', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(state.focused === id),
          title: `${t.name}${p.path ? ' · ' + p.path : ''} · ${p.mode === 'normal' ? tr('visible') : p.mode === 'minimized' ? tr('minimized') : tr('hidden')}`,
          html: toolMark(t.id, 16) + `<span class="tab-name">${t.name}</span>` + (p.path ? `<span class="tab-file mono">${basename(p.path)}</span>` : ''),
        });
        main.onclick = () => workspace.show(id);
        main.onauxclick = (e) => e.button === 1 && void workspace.close(id);
        const eye = h<'button'>('button.tab-eye', { type: 'button', 'aria-pressed': String(p.mode === 'normal'), 'aria-label': p.mode === 'normal' ? tr('Hide {name}', { name: t.name }) : tr('Show {name}', { name: t.name }), title: p.mode === 'normal' ? tr('Hide') : tr('Show'), html: icon(p.mode === 'normal' ? 'eye' : 'eyeOff', { size: 15 }) });
        eye.onclick = () => (p.mode === 'normal' ? workspace.hide(id) : workspace.show(id));
        const tab = h('div', { class: cls, style: `--tool:${t.accent}`, 'data-id': id, role: 'presentation' }, main, eye);
        onContextAction(tab, (x, y) => panelMenu(id, x, y));
        return tab;
      })
  );
}

function renderDock() {
  if (!dom) return;
  const items = state.order.filter((id) => state.panels[id]?.mode === 'minimized');
  dom.dock.hidden = !items.length;
  dom.dock.replaceChildren(
    h('span.dock-label.eyebrow', 'Dock'),
    ...items.map((id) => {
      const p = state.panels[id]!;
      const t = TOOLS[p.tool];
      return h(
        'button.dock-chip',
        { type: 'button', style: `--tool:${t.accent}`, title: tr('Restore {name}', { name: t.name }), onclick: () => workspace.show(id) },
        h('span', { html: toolMark(t.id, 16) }),
        h('span', t.name),
        p.path ? h('span.mono.dock-file', basename(p.path)) : null,
        rt.get(id)?.status === 'active' ? h('span.dock-state.mono', tr('paused')) : null
      );
    })
  );
}

// ---------------------------------------------------------------- Side bar width

function enableSideGutter(g: HTMLElement, zone: 'left' | 'right') {
  guardSurface(g);
  onDoubleTap(g, () => {
    state.sides[zone] = zone === 'left' ? 260 : 400;
    renderSides();
    positionPanels();
    persist();
    bus.emit('workspace:resize');
  });
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(g, e.pointerId);
    const start = e.clientX;
    const w0 = state.sides[zone];
    // The chat docked on the left grows to the right
    const growsRight = zone === 'left' || prefs.get('chatSide') === 'left';
    document.body.classList.add('is-resizing', 'resize-x');
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - start;
      state.sides[zone] = clamp(growsRight ? w0 + d : w0 - d, 200, Math.min(760, innerWidth * 0.5));
      renderSides();
      positionPanels();
    };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      g.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing', 'resize-x');
      persist();
      bus.emit('workspace:resize');
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  });
  g.addEventListener('dblclick', () => {
    state.sides[zone] = zone === 'left' ? 260 : 400;
    renderSides();
    positionPanels();
    persist();
  });
}

// ---------------------------------------------------------------- Drag and drop

function enableDrag(head: HTMLElement, id: string) {
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button') || state.maximized || state.panels[id]?.mode !== 'normal' || state.panels[id]?.pip) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    let hint: HTMLElement | null = null;
    let ghost: HTMLElement | null = null;
    let drop: { target: string; side: Side | 'center' } | null = null;
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        dragging = true;
        document.body.classList.add('is-dragging');
        hint = document.body.appendChild(h('div.drop-hint'));
        const t = TOOLS[state.panels[id]!.tool];
        ghost = document.body.appendChild(h('div.drag-ghost', { style: `--tool:${t.accent}`, html: toolMark(t.id, 16) + t.name }));
      }
      ghost!.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList?.contains('panel') && (n as HTMLElement).dataset.zone === 'stage') as HTMLElement | undefined;
      const target = under?.dataset.id;
      if (!target || target === id) {
        hint!.hidden = true;
        drop = null;
        return;
      }
      const r = under!.getBoundingClientRect();
      const fx = (ev.clientX - r.left) / r.width;
      const fy = (ev.clientY - r.top) / r.height;
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const side: Side | 'center' = edge >= 0.28 ? 'center' : edge === fx ? 'left' : edge === 1 - fx ? 'right' : edge === fy ? 'top' : 'bottom';
      drop = { target, side };
      const box = { left: r.left, top: r.top, width: r.width, height: r.height };
      if (side === 'left' || side === 'right') box.width /= 2;
      if (side === 'right') box.left += r.width / 2;
      if (side === 'top' || side === 'bottom') box.height /= 2;
      if (side === 'bottom') box.top += r.height / 2;
      hint!.hidden = false;
      Object.assign(hint!.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (!dragging) return;
      document.body.classList.remove('is-dragging');
      hint?.remove();
      ghost?.remove();
      if (drop) workspace.move(id, drop.target, drop.side);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------- Public API

export interface PanelSummary {
  id: string;
  tool: ToolId;
  path: string | null;
  mode: Mode;
  status: Status;
  paused: boolean;
  visible: boolean;
  /** Floats as a picture-in-picture window */
  pip: boolean;
}

export const workspace = {
  init(d: { ws: HTMLElement; stage: HTMLElement; left: HTMLElement; right: HTMLElement; gl: HTMLElement; gr: HTMLElement; tabs: HTMLElement; dock: HTMLElement }) {
    const layout = h('div.stage-layout');
    const layer = h('div.stage-panels');
    d.stage.replaceChildren(layout);
    d.ws.append(layer);
    dom = { ...d, layout, layer };
    readMetrics();
    new ResizeObserver(() => positionPanels()).observe(d.ws);
    new ResizeObserver(() => positionPanels()).observe(layout);
    // Rotation, Stage Manager, Split View, Slide Over, keyboard: re-arrange, reload nothing
    let lastCompact = device.compact;
    bus.on('device:change', () => {
      readMetrics();
      if (device.compact !== lastCompact) {
        lastCompact = device.compact;
        render();
        return;
      }
      renderSides();
      positionPanels();
      bus.emit('workspace:resize');
    });
    // Close the drawers when the stage is tapped
    layer.addEventListener('pointerdown', () => {
      if (!device.compact) return;
      for (const id of ['tree', 'chat'] as const) if (state.panels[id]?.mode === 'normal') workspace.hide(id);
    });
    bus.on('settings:change', ({ key }) => key === 'chatSide' && render());
    // A new workspace: the tab strip follows it, and an empty stage names the right one
    bus.on('ecosystem:change', () => (state.tree ? renderTabs() : render()));
    enableSideGutter(d.gl, 'left');
    enableSideGutter(d.gr, 'right');
    document.addEventListener('visibilitychange', syncResources);
    // Live sync: report changes by the AI, the terminal or other programs to open panels.
    // Writes of a panel itself (origin panel:<id>) are skipped.
    bus.on('fs:file', (e) => {
      for (const [id, r] of rt) {
        const p = state.panels[id];
        if (!p || p.path !== e.path || e.origin === `panel:${id}`) continue;
        if (r.status === 'active') r.instance?.externalChange?.(e.path, e.kind);
      }
    });
    // Team Mode: a sub-agent writes a file; the panels that show it flash its accent and name
    bus.on('agent:file', (e) => flashAgent({ ...e, seq: ++agentSeq }));
    addEventListener('beforeunload', () => persist.flush());
    // Esc (or the browser's own control) leaves full screen: the panel returns to the layout
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && fullscreenId && !standalone) {
        leaveFullscreen();
        render();
      }
    });
    // A separate window closed or stopped answering: the panel loads again here
    popouts.init((id, path) => {
      const p = state.panels[id];
      if (!p?.popout) return;
      delete p.popout;
      if (path) p.path = path;
      render();
      if (isVisible(id)) requestMount(id, true);
      toast(tr('{name} is back in the workspace', { name: TOOLS[p.tool].name }), 'success');
    });
  },

  /** Loads the layout of the project (backend, otherwise localStorage, otherwise the default). */
  async load(projectId: string, fallback: () => void) {
    project = projectId;
    let saved: unknown = null;
    try {
      saved = await api.get('/api/meta/layout');
    } catch {
      /* offline: lokale Kopie */
    }
    if (!validState(saved)) {
      try {
        saved = JSON.parse(localStorage.getItem(`workcraft.layout.${projectId}`) || 'null');
      } catch {
        saved = null;
      }
    }
    state = emptyState();
    if (validState(saved)) {
      for (const [id, p] of Object.entries(saved.panels)) if (TOOLS[p.tool]) state.panels[id] = p;
      // Layouts saved before full screen replaced collapsing: a collapsed panel is a normal one again
      for (const p of Object.values(state.panels)) {
        if ((p.mode as string) === 'collapsed') p.mode = 'normal';
        if (p.pip) delete (p.pip as { collapsed?: boolean }).collapsed;
      }
      state.order = saved.order.filter((id) => state.panels[id]);
      state.tree = prune(saved.tree);
      state.focused = saved.focused && state.panels[saved.focused] ? saved.focused : null;
      state.maximized = saved.maximized && state.panels[saved.maximized] ? saved.maximized : null;
      state.sides = { ...state.sides, ...saved.sides };
      // Stage panels that should be normal but are missing from the tree are kept as hidden
      for (const p of Object.values(state.panels)) if (TOOLS[p.tool].zone === 'stage' && p.mode === 'normal' && !p.pip && !locateLeaf(p.id)) p.mode = 'hidden';
    }
    for (const side of ['tree', 'chat'] as const) {
      if (!state.panels[side]) {
        state.panels[side] = { id: side, tool: side, path: null, mode: 'normal' };
        state.order.push(side);
      }
    }
    for (const id of state.order) createPanelDom(id);
    if (!validState(saved)) fallback();
    render();
  },

  openPanel(tool: ToolId, opt: { path?: string | null; focus?: boolean; target?: string | null; side?: Side; silent?: boolean; mode?: Mode } = {}): string {
    const t = TOOLS[tool];
    if (t.single || t.zone !== 'stage') {
      const ex = Object.values(state.panels).find((p) => p.tool === tool);
      if (ex) {
        if (opt.path !== undefined) ex.path = opt.path;
        this.show(ex.id);
        return ex.id;
      }
    }
    const id = uid(tool);
    state.panels[id] = { id, tool, path: opt.path ?? null, mode: opt.mode || 'normal' };
    state.order.push(id);
    createPanelDom(id);
    if (state.panels[id]!.mode === 'normal') {
      const target = opt.target ?? (state.focused && locateLeaf(state.focused) ? state.focused : null);
      // Terminal classically below the focused panel, otherwise next to it
      insertLeaf(id, target, opt.side || (tool === 'terminal' ? 'bottom' : autoSide(target)));
      if (opt.focus !== false) state.focused = id;
      state.maximized = null;
    }
    play('open');
    if (!opt.silent) render();
    return id;
  },

  /** Opens a file in the matching panel (an existing panel of the tool is reused). */
  async openFile(path: string, toolId?: ToolId): Promise<string | undefined> {
    const tool = toolId || toolForPath(path);
    if (TOOLS[tool].kind === 'app' || tool === 'code') noteOpened(path, tool, fs.project);
    const same = Object.values(state.panels).find((p) => p.path === path && p.tool === tool);
    if (same) {
      this.show(same.id);
      return same.id;
    }
    const candidates = state.order.map((id) => state.panels[id]!).filter((p) => p.tool === tool);
    const reuse = candidates.find((p) => p.id === state.focused) || candidates.find((p) => p.mode === 'normal') || candidates[0];
    if (reuse) {
      reuse.path = path;
      this.show(reuse.id);
      const r = rt.get(reuse.id);
      if (r?.status === 'active' && r.instance?.open) await r.instance.open(path);
      updateHead(reuse.id);
      renderTabs();
      persist();
      return reuse.id;
    }
    return this.openPanel(tool, { path });
  },

  show(id: string) {
    const p = state.panels[id];
    if (!p) return;
    if (zoneOf(id) === 'stage' && !locateLeaf(id) && !p.pip) {
      const prev = p.prev;
      const target = prev?.target && locateLeaf(prev.target) ? prev.target : state.focused && state.focused !== id && locateLeaf(state.focused) ? state.focused : null;
      insertLeaf(id, target, prev?.target && target === prev.target ? prev.side : autoSide(target));
    }
    p.mode = 'normal';
    p.prev = undefined;
    // Drawers (narrow windows, iPad in portrait): one at a time, otherwise the project tree and the chat lie on top of each other
    if (device.compact && (id === 'tree' || id === 'chat')) {
      const other = state.panels[id === 'tree' ? 'chat' : 'tree'];
      if (other && other.mode === 'normal' && !other.pip && state.maximized !== other.id) other.mode = 'hidden';
    }
    // Something else is shown (a file opened by the AI, a tab): full screen ends, the window of a popped panel comes forward
    if (fullscreenId && fullscreenId !== id && !standalone) leaveFullscreen();
    if (p.popout) popouts.focus(id);
    if (state.maximized && state.maximized !== id) state.maximized = null;
    state.focused = id;
    const r = rt.get(id);
    if (r && (r.status === 'unloaded' || r.status === 'error')) requestMount(id, true);
    render();
    r?.el.focus({ preventScroll: true });
  },

  hide(id: string) {
    this.setMode(id, 'hidden');
    play('close');
  },

  minimize(id: string) {
    this.setMode(id, 'minimized');
  },

  setMode(id: string, mode: Mode) {
    const p = state.panels[id];
    if (!p || p.mode === mode) return;
    if (mode === 'normal') return this.show(id);
    if (zoneOf(id) === 'stage') {
      if ((mode === 'hidden' || mode === 'minimized') && locateLeaf(id)) p.prev = removeLeaf(id);
    }
    if (fullscreenId === id) leaveFullscreen();
    p.mode = mode;
    if (state.maximized === id) state.maximized = null;
    if (state.focused === id) state.focused = leafIds().find((x) => state.panels[x]?.mode === 'normal') || null;
    render();
  },

  async close(id: string) {
    const r = rt.get(id);
    if (!state.panels[id] || zoneOf(id) !== 'stage') return;
    try {
      if ((await r?.instance?.beforeClose?.()) === false) return;
    } catch (e) {
      console.warn(e);
    }
    if (fullscreenId === id) leaveFullscreen();
    if (state.panels[id]!.popout) popouts.close(id);
    await unloadInstance(id);
    removeLeaf(id);
    r?.el.remove();
    rt.delete(id);
    delete state.panels[id];
    state.order = state.order.filter((x) => x !== id);
    const qi = queue.indexOf(id);
    if (qi >= 0) queue.splice(qi, 1);
    if (state.maximized === id) state.maximized = null;
    if (state.focused === id) state.focused = leafIds()[0] || null;
    play('close');
    render();
  },

  focus(id: string, rerender = true) {
    if (state.focused === id) return;
    state.focused = id;
    for (const pid of Object.keys(state.panels)) updateHead(pid);
    renderTabs();
    persist();
    bus.emit('workspace:focus', { id, tool: state.panels[id]?.tool || null });
    if (rerender) render();
  },

  toggleMaximize(id: string | null = state.focused) {
    if (!id || !state.panels[id]) return;
    if (fullscreenId === id) return this.setFullscreen(null);
    if (fullscreenId && !standalone) leaveFullscreen();
    if (state.panels[id]!.pip) this.togglePip(id, false, true);
    if (state.panels[id]!.mode !== 'normal') this.show(id);
    state.maximized = state.maximized === id ? null : id;
    state.focused = id;
    render();
  },

  /**
   * Picture in picture: the panel floats above the workspace (and above Full Chat Mode) or goes back
   * to its place in the layout. The WebAssembly instance of an app keeps running.
   */
  togglePip(id: string, force?: boolean, silent = false) {
    const p = state.panels[id];
    const r = rt.get(id);
    if (!p || !r) return;
    const on = force ?? !p.pip;
    if (on === !!p.pip) return;
    if (on) {
      if (fullscreenId === id) leaveFullscreen();
      const kind = id === 'chat' ? 'chat' : isApp(p.tool) ? 'app' : 'tool';
      if (zoneOf(id) === 'stage' && locateLeaf(id)) p.prev = removeLeaf(id);
      if (state.maximized === id) state.maximized = null;
      p.mode = 'normal';
      p.pip = defaultRect(kind);
      state.focused = id;
    } else {
      delete p.pip;
      if (zoneOf(id) === 'stage' && p.mode !== 'hidden' && p.mode !== 'minimized') {
        const prev = p.prev;
        const target = prev?.target && locateLeaf(prev.target) ? prev.target : state.focused && state.focused !== id && locateLeaf(state.focused) ? state.focused : null;
        insertLeaf(id, target, prev?.target && target === prev.target ? prev.side : autoSide(target));
        p.prev = undefined;
      }
    }
    play(on ? 'open' : 'close');
    if (!silent) render();
    if (r.status === 'unloaded' || r.status === 'error') requestMount(id, true);
  },

  /** Full Chat Mode: the AI chat fills the window (sidebar mode otherwise). */
  setFullChat(on?: boolean) {
    const p = state.panels.chat;
    if (!p) return;
    const want = on ?? state.maximized !== 'chat';
    if (want === (state.maximized === 'chat')) return;
    if (fullscreenId && !standalone) leaveFullscreen();
    if (want) {
      if (p.pip) delete p.pip;
      p.mode = 'normal';
      state.maximized = 'chat';
      state.focused = 'chat';
    } else state.maximized = null;
    render();
  },

  get fullChat() {
    return state.maximized === 'chat';
  },

  /**
   * Full screen: the panel fills the whole window (no top bar, rail, side bars, chat or other panels) and the
   * browser goes to full screen too. Without an id it ends full screen; with one it toggles that panel.
   */
  setFullscreen(id: string | null | undefined, force?: boolean) {
    if (standalone) return;
    if (!id) return void (fullscreenId && (leaveFullscreen(), render()));
    const p = state.panels[id];
    if (!p || zoneOf(id) !== 'stage') return;
    const on = force ?? fullscreenId !== id;
    if (!on) return void (fullscreenId && (leaveFullscreen(), render()));
    if (p.popout) return void popouts.focus(id);
    if (fullscreenId && fullscreenId !== id) leaveFullscreen();
    if (p.pip) this.togglePip(id, false, true);
    if (p.mode !== 'normal') this.show(id);
    if (!fullscreenId) fsBefore = state.maximized;
    fullscreenId = id;
    state.maximized = id;
    state.focused = id;
    play('open');
    render();
    requestBrowserFullscreen();
  },

  get fullscreen(): string | null {
    return fullscreenId;
  },

  /**
   * Moves a panel into a browser window of its own (second display). The app is saved and unloaded here, started
   * in the new window, and loaded again here when that window closes. `other`: the other display, when there is one.
   */
  async popOut(id: string, opt: { other?: boolean } = {}) {
    const p = state.panels[id];
    const r = rt.get(id);
    if (!p || !r || zoneOf(id) !== 'stage') return;
    if (p.popout) return void popouts.focus(id);
    if (!canPopOut(p.tool)) return void toast(tr('Separate windows need the desktop backend.'), 'info');
    const box = r.el.getBoundingClientRect();
    // The window is created inside this click, the rest (saving, placing) happens after it
    const win = openBlank(id, { w: Math.round(box.width), h: Math.round(box.height) });
    if (!win) return void toast(tr('The browser blocked the new window.'), 'warning', tr('Allow pop-up windows for this address, then try again.'));
    if (r.status === 'active' && r.instance?.flushUnsaved && !(await r.instance.flushUnsaved().catch(() => false))) {
      const ok = await dialog({ title: TOOLS[p.tool].name, tone: tr('separate window'), body: tr('The app has changes it could not save by itself. Save in the app first, or open the window anyway and lose them.'), ok: tr('Open anyway'), danger: true });
      if (!ok) return void win.close();
    }
    if (fullscreenId === id) leaveFullscreen();
    if (p.pip) delete p.pip;
    p.popout = true;
    popouts.track(id, win, p.path);
    await unloadInstance(id);
    render();
    const params: PopoutParams = { id, tool: p.tool, path: p.path };
    await placeAndLoad(win, params, { w: Math.round(box.width), h: Math.round(box.height), other: !!opt.other });
  },

  /** A second display is connected (and the browser can place windows on it). */
  get hasOtherDisplay() {
    return hasOtherDisplay();
  },

  /** This page is a separate window of one panel. */
  get isPopoutWindow() {
    return !!standalone;
  },

  /** Brings a panel back from its separate window (the window saves and closes). */
  popBack(id: string) {
    if (state.panels[id]?.popout) popouts.close(id);
  },

  /**
   * Starts a separate window page: only this panel, in full screen, with no layout of its own saved. Used when
   * the page is opened with ?popout=1 (see src/workspace/popout.ts).
   */
  async loadPopout(projectId: string, o: PopoutParams) {
    const t = TOOLS[o.tool];
    if (!t || t.zone !== 'stage' || !canPopOut(o.tool)) throw new Error(tr('This panel cannot open in a window of its own.'));
    project = projectId;
    // Set before the first draw: this page must never write the layout of the project
    standalone = { back: async () => {} };
    state = emptyState();
    for (const side of ['tree', 'chat'] as const) {
      state.panels[side] = { id: side, tool: side, path: null, mode: 'hidden' };
      state.order.push(side);
    }
    state.panels[o.id] = { id: o.id, tool: o.tool, path: o.path, mode: 'normal' };
    state.order.push(o.id);
    for (const id of state.order) createPanelDom(id);
    insertLeaf(o.id, null, 'right');
    state.focused = o.id;
    state.maximized = o.id;
    fullscreenId = o.id;
    document.documentElement.classList.add('is-popout');
    const run = runPopoutWindow({ id: o.id, path: () => state.panels[o.id]?.path ?? null, flush: () => workspace.flushUnsaved() });
    standalone.back = run.back;
    render();
    // Closing the window with the X: the browser asks when the app has unsaved changes
    addEventListener('beforeunload', (e) => {
      const inst = rt.get(o.id)?.instance;
      if (inst?.canUnload && !inst.canUnload()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    // Another project became active: this window belongs to the old one
    bus.on('project:changed', () => window.close());
  },

  /** Floating windows and their rectangles (tests, Status page). */
  pips(): { id: string; rect: PipRect }[] {
    return Object.values(state.panels)
      .filter((p) => p.pip && p.mode === 'normal')
      .map((p) => ({ id: p.id, rect: { ...p.pip! } }));
  },

  move(id: string, targetId: string, side: Side | 'center') {
    if (side === 'center') {
      const a = locateLeaf(id);
      const b = locateLeaf(targetId);
      if (a && b && a.node.t === 'leaf' && b.node.t === 'leaf') {
        a.node.id = targetId;
        b.node.id = id;
      }
    } else {
      removeLeaf(id);
      insertLeaf(id, targetId, side);
    }
    state.focused = id;
    render();
  },

  applyPreset(kind: 'single' | 'columns' | 'rows' | 'grid') {
    const ids = leafIds();
    if (!ids.length) return;
    if (fullscreenId && !standalone) leaveFullscreen();
    state.maximized = null;

    const leaves: LayoutNode[] = ids.map((id) => ({ t: 'leaf', id }));
    const even = (n: number) => Array<number>(n).fill(1 / n);
    if (kind === 'single') state.maximized = state.focused && ids.includes(state.focused) ? state.focused : ids[0]!;
    else if (kind === 'columns' || ids.length === 1) state.tree = leaves.length === 1 ? leaves[0]! : { t: 'split', dir: 'row', sizes: even(leaves.length), kids: leaves };
    else if (kind === 'rows') state.tree = { t: 'split', dir: 'col', sizes: even(leaves.length), kids: leaves };
    else {
      const cols = Math.ceil(Math.sqrt(leaves.length));
      const rows: LayoutNode[] = [];
      for (let i = 0; i < leaves.length; i += cols) {
        const chunk = leaves.slice(i, i + cols);
        rows.push(chunk.length === 1 ? chunk[0]! : { t: 'split', dir: 'row', sizes: even(chunk.length), kids: chunk });
      }
      state.tree = rows.length === 1 ? rows[0]! : { t: 'split', dir: 'col', sizes: even(rows.length), kids: rows };
    }
    render();
  },

  /** Unloads an app (frees memory, WebAssembly, GPU). Asks when there are unsaved changes, unless forced (emergency stop). */
  async unload(id: string, opt: { force?: boolean } = {}) {
    const r = rt.get(id);
    if (!r || r.status !== 'active') return;
    if (!opt.force && r.instance?.canUnload && !r.instance.canUnload()) {
      const ok = await dialog({ title: TOOLS[state.panels[id]!.tool].name, tone: tr('unload'), body: tr('Unsaved changes will be lost. Save in the app first.'), ok: tr('Unload anyway'), danger: true });
      if (!ok) return;
    }
    await unloadInstance(id);
  },

  /**
   * Starts an app again from its file: unloads the engine (asks when there are unsaved changes) and loads it anew.
   * The panel, its place and its file stay. Used by the panel menu.
   */
  async reload(id: string) {
    const r = rt.get(id);
    const p = state.panels[id];
    if (!r || !p || !isApp(p.tool) || p.popout || r.status === 'loading' || r.status === 'queued') return;
    if (r.status === 'active') {
      if (r.instance?.canUnload && !r.instance.canUnload()) {
        const ok = await dialog({ title: TOOLS[p.tool].name, tone: tr('reload'), body: tr('Unsaved changes will be lost. Save in the app first.'), ok: tr('Reload anyway'), danger: true });
        if (!ok) return;
      }
      await unloadInstance(id);
    }
    requestMount(id, true);
  },

  /** The context menu of a panel at a position (right click on its tab or the app's icon in the tool rail). */
  /** `extra` entries are appended after a separator (the tool rail adds Move up and Move down) */
  panelMenu(id: string, x: number, y: number, extra: MenuEntry[] = []) {
    panelMenu(id, x, y, { extra });
  },

  /** Returns the instance of a panel. Shows it and loads it first (for MCP commands). */
  ensureInstance(id: string): Promise<PanelInstance> {
    const r = rt.get(id);
    if (!r) return Promise.reject(new Error(tr('Panel not found')));
    if (r.status === 'active' && r.instance) return Promise.resolve(r.instance);
    if (state.panels[id]?.popout) return Promise.reject(new Error(tr('This panel is open in a separate window.')));
    const p = new Promise<PanelInstance>((resolve, reject) => r.waiters.push({ resolve, reject }));
    if (state.panels[id]!.mode !== 'normal') this.show(id);
    requestMount(id, true);
    return p;
  },

  async instanceForTool(tool: ToolId, path?: string): Promise<{ id: string; instance: PanelInstance }> {
    let id: string | undefined;
    if (path) id = await this.openFile(path, tool);
    else {
      const list = state.order.map((x) => state.panels[x]!).filter((p) => p.tool === tool);
      const pick = list.find((p) => p.id === state.focused) || list.find((p) => p.mode === 'normal') || list[0];
      id = pick ? pick.id : this.openPanel(tool);
      if (pick && pick.mode !== 'normal') this.show(pick.id);
    }
    return { id: id!, instance: await this.ensureInstance(id!) };
  },

  panels(): PanelSummary[] {
    return state.order.map((id) => {
      const p = state.panels[id]!;
      const r = rt.get(id);
      return { id, tool: p.tool, path: p.path, mode: p.mode, status: r?.status || 'idle', paused: !!r?.paused, visible: isVisible(id), pip: !!p.pip };
    });
  },
  /** Everything the Status page shows per panel (the footer texts live here when footers are off). */
  details() {
    return state.order.map((id) => {
      const p = state.panels[id]!;
      const r = rt.get(id);
      return { id, tool: p.tool, name: TOOLS[p.tool].name, path: p.path, mode: p.mode, status: r?.status || 'idle', paused: !!r?.paused, visible: isVisible(id), pip: !!p.pip, text: r?.statusText.textContent || '', loadMs: r?.loadMs || 0, error: r?.error?.message || '' };
    });
  },
  /** Memory per loaded panel for the memory and GPU monitor. */
  resources() {
    return state.order.map((id) => {
      const p = state.panels[id]!;
      const r = rt.get(id);
      let res = null;
      try {
        res = r?.status === 'active' ? r.instance?.resources?.() || null : null;
      } catch {
        res = null;
      }
      return { id, tool: p.tool, name: TOOLS[p.tool].name, path: p.path, status: r?.status || 'idle', paused: !!r?.paused, visible: isVisible(id), loadMs: r?.loadMs || 0, res, unsaved: r?.status === 'active' && !!r.instance?.canUnload && !r.instance.canUnload() };
    });
  },
  panel: (id: string) => state.panels[id] || null,
  instance: (id: string) => rt.get(id)?.instance || null,
  panelsWithPath: (path: string) => Object.values(state.panels).filter((p) => p.path === path).map((p) => p.id),
  /**
   * Saves unsaved app panels (of one file, or all of them) into the project, so the AI works with what the
   * user sees and not only with the last saved file. Returns the files that could not be saved.
   */
  async flushUnsaved(path?: string): Promise<string[]> {
    const failed: string[] = [];
    for (const p of Object.values(state.panels)) {
      if (path && p.path !== path) continue;
      const r = rt.get(p.id);
      if (r?.status !== 'active' || !r.instance?.flushUnsaved) continue;
      try {
        if (!(await r.instance.flushUnsaved())) failed.push(p.path || p.id);
      } catch {
        failed.push(p.path || p.id);
      }
    }
    // Panels in separate windows save themselves too
    failed.push(...(await popouts.flush()));
    return failed;
  },
  get focused() {
    return state.focused;
  },
  get focusedTool(): ToolId | null {
    return state.focused ? state.panels[state.focused]?.tool || null : null;
  },
  /** Unloads all panels and clears the state (project switch). The layout is saved first. */
  async teardown() {
    persist.cancel();
    queue.length = 0;
    for (const id of [...rt.keys()]) {
      const r = rt.get(id)!;
      if (r.status === 'active') await unloadInstance(id);
      clearTimeout(r.unloadTimer);
      for (const w of r.waiters.splice(0)) w.reject(new Error(tr('Project switched')));
      r.el.remove();
      rt.delete(id);
    }
    state = emptyState();
    project = '';
    if (dom) dom.layout.replaceChildren();
  },
  stats,
  isVisible,
  /** Save the layout right away (await it before switching projects). */
  async save() {
    persist.cancel();
    await putLayout();
  },
  render,
};

if (typeof window !== 'undefined') (window as unknown as { __workcraftWorkspace: typeof workspace }).__workcraftWorkspace = workspace;
export { notifyError };
