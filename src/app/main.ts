// Entry point of the WorkCraft workspace (frontend). The local backend (src/server) serves
// files, projects, terminal, AI routing and the MCP server.

import './legacy.js';
import { startUpdateChecks } from './updates.js';
import { startCoffee } from './coffee.js';
import { canLocate, copyProjectPath, revealInFileManager } from '../project/locate.js';
import { h, modKey, isMac, debounce, basename, ROOT } from './util.js';
import { icon, logoSvg, wordmarkSvg } from './icons.js';
import { bus } from './bus.js';
import { api, live, backend } from './backend.js';
const backendMode = backend;
import { prefs } from './settings.js';
import { menu, type MenuEntry } from './ui.js';
import { onContextAction } from './long-press.js';
import { desktopAppCached, desktopApps, openInDesktop } from '../project/desktop.js';
import { notify, toast, installGlobalHandlers, explain } from './notifications.js';
import { openPalette, registerCommands, type Command } from './palette.js';
import { fs } from '../project/fs.js';
import { projects } from '../project/manager.js';
import { TOOLS, APP_IDS, toolMark, type ToolId } from '../workspace/registry.js';
import { activeApps, activeEcosystem, initEcosystems, needsChoice, allEcosystems, setEcosystem } from '../ecosystems/ecosystems.js';
import { enterEcosystem } from '../ecosystems/enter.js';
import { popoutParams } from '../workspace/popout.js';
import { workspace } from '../workspace/layout.js';
import { loadOrchestrator } from '../mcp/lazy.js';
import { aiConfig } from '../chat/config.js';
import { installDevice, device } from './device.js';
import { installIpados } from '../ipados/index.js';
import { trackInput } from '../workspace/pencil.js';
import { t, lang, LANGS, setLang } from './i18n.js';
import { VERSION, appStatus } from './status.js';
import { writeTheme, watchTheme } from './theme-store.js';
import { installLogCapture } from './logs.js';
import { installPrivacyGuard } from './privacy.js';
import { openSearch } from './search-ui.js';
import { installSelects } from './select.js';

export { VERSION };
const $ = (id: string) => document.getElementById(id)!;

// ---------------------------------------------------------------- Color scheme of the workspace (scope 'ide': shell, chat, PiP and the apps in panels; the website has its own)
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => (prefs.get('theme') === 'system' ? (darkQuery.matches ? 'dark' : 'light') : prefs.get('theme'));

function applyTheme(broadcast = true) {
  const pref = prefs.get('theme');
  const th = resolvedTheme();
  document.documentElement.dataset.theme = th;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th === 'dark' ? '#121214' : '#FFFFFF');
  // The apps read this (public/craft-theme.js), also right after a reload
  (window as unknown as { __workcraftTheme: string; __ocThemeScope: string }).__workcraftTheme = pref;
  (window as unknown as { __ocThemeScope: string }).__ocThemeScope = 'ide';
  // The loaded apps switch in place (no reload, the open document stays as it is)
  for (const f of document.querySelectorAll('iframe')) {
    try {
      f.contentWindow?.postMessage({ type: 'workcraft:theme', scope: 'ide', theme: pref }, location.origin);
    } catch {
      /* frame gone */
    }
  }
  if (!broadcast) return;
  // A choice made here: oc-ide-theme in localStorage and the oc_ide_theme cookie (other workspace tabs and ports follow)
  writeTheme(pref, 'ide');
  themeWatch?.set(pref);
}
let themeWatch: { set(t: string): void } | null = null;
function watchSharedTheme() {
  darkQuery.addEventListener('change', () => prefs.get('theme') === 'system' && applyTheme(false));
  // Changed in another workspace tab or on another port of this host (never by the website)
  themeWatch = watchTheme((v: string) => {
    if ((v === 'system' || v === 'light' || v === 'dark') && v !== prefs.get('theme')) prefs.set('theme', v);
  }, 'ide');
}
const toggleTheme = () => prefs.set('theme', resolvedTheme() === 'dark' ? 'light' : 'dark');

// ---------------------------------------------------------------- Chrome: status bar, panel footers, focus mode, full screen
function applyChrome() {
  const root = document.documentElement.classList;
  root.toggle('has-statusbar', prefs.get('statusbar'));
  root.toggle('has-panel-footers', prefs.get('panelFooters'));
  root.toggle('is-focus', prefs.get('focusMode'));
  // The top bar and the tool rail hide on their own (focus mode hides both). A handle brings the top bar back.
  root.toggle('is-topbar-hidden', prefs.get('topbarHidden'));
  root.toggle('is-rail-hidden', prefs.get('railHidden'));
  // Icon-only buttons: automatic on iPad and in narrow windows
  const mode = prefs.get('iconsOnly');
  root.toggle('icons-only', mode === 'on' || (mode === 'auto' && (device.info.ipad || device.info.viewport.width < 900)));
  bus.emit('workspace:resize');
}

/** Show or hide the top bar. Hiding says how to get it back, once. */
function toggleTopbar(force?: boolean) {
  const hide = force ?? !prefs.get('topbarHidden');
  prefs.set('topbarHidden', hide);
}
function toggleRail(force?: boolean) {
  prefs.set('railHidden', force ?? !prefs.get('railHidden'));
}

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const fsDoc = document as FsDoc;
const fullscreenSupported = () => !!(fsDoc.fullscreenEnabled || fsDoc.webkitFullscreenEnabled);
const isFullscreen = () => !!(fsDoc.fullscreenElement || fsDoc.webkitFullscreenElement);
function toggleFullscreen() {
  if (isFullscreen()) {
    if (fsDoc.exitFullscreen) void fsDoc.exitFullscreen().catch(() => {});
    else fsDoc.webkitExitFullscreen?.();
    return;
  }
  const el = document.documentElement as FsEl;
  if (el.requestFullscreen) void el.requestFullscreen().catch(() => toast(t('Full screen is not available here'), 'info', t('On iPad: Share, Add to Home Screen opens WorkCraft without browser bars.')));
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else toast(t('Full screen is not available here'), 'info', t('On iPad: Share, Add to Home Screen opens WorkCraft without browser bars.'));
}

/** The main menu (button at the top right, also the floating button in focus mode). */
function mainMenu(): MenuEntry[] {
  const th = prefs.get('theme');
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return [
    // Also in the rail, but the rail is hidden in Slide Over (520 px and below): the menu must reach the apps and the workspaces on its own
    { heading: t('Workspace') },
    { label: t('Apps, recent files and workspaces'), icon: 'grid', run: () => void import('../ecosystems/ui.js').then((m) => m.openLauncher()) },
    { label: t('Switch workspace'), icon: 'shuffle', run: () => void import('../ecosystems/ui.js').then((m) => m.openEcosystemPicker()) },
    '-',
    { heading: t('Layout') },
    { label: t('Columns'), icon: 'layoutColumns', run: () => workspace.applyPreset('columns') },
    { label: t('Rows'), icon: 'layoutRows', run: () => workspace.applyPreset('rows') },
    { label: t('Grid'), icon: 'layoutGrid', run: () => workspace.applyPreset('grid') },
    { label: t('Maximize focused panel'), icon: 'layoutSingle', run: () => workspace.toggleMaximize() },
    { label: t('Picture in picture for the focused panel'), icon: 'pip', run: () => workspace.focused && workspace.togglePip(workspace.focused) },
    { label: t('Full screen for the focused panel'), icon: 'fullscreen', hint: 'Alt ↵', run: () => workspace.focused && workspace.setFullscreen(workspace.focused) },
    { label: t('Open the focused panel in a separate window'), icon: 'popout', run: () => workspace.focused && void workspace.popOut(workspace.focused) },
    ...(workspace.hasOtherDisplay ? [{ label: t('Open the focused panel on the other display'), icon: 'popout', run: () => workspace.focused && void workspace.popOut(workspace.focused, { other: true }) }] : []),
    '-',
    { heading: t('AI chat') },
    { label: t('Full Chat Mode'), icon: 'chat', checked: workspace.fullChat, run: () => workspace.setFullChat() },
    { label: t('Chat on the left'), icon: 'sidebar', checked: prefs.get('chatSide') === 'left', run: () => prefs.set('chatSide', 'left') },
    { label: t('Chat on the right'), icon: 'sidebar', checked: prefs.get('chatSide') === 'right', run: () => prefs.set('chatSide', 'right') },
    '-',
    { heading: t('View') },
    ...(fullscreenSupported() && !standalone ? [{ label: isFullscreen() ? t('Exit browser full screen') : t('Browser full screen'), icon: isFullscreen() ? 'collapse' : 'expand', run: toggleFullscreen }] : []),
    { label: t('Top bar'), icon: 'panelTop', checked: !prefs.get('topbarHidden'), run: () => toggleTopbar() },
    { label: t('Tool rail'), icon: 'panelLeft', checked: !prefs.get('railHidden'), run: () => toggleRail() },
    { label: t('Project tree'), icon: 'sidebar', checked: workspace.panel('tree')?.mode === 'normal', hint: `${modKey} \\`, run: () => toggleSide('tree') },
    { label: t('Focus mode'), icon: 'eyeOff', checked: prefs.get('focusMode'), run: () => prefs.set('focusMode', !prefs.get('focusMode')) },
    { label: t('Status bar'), icon: 'activity', checked: prefs.get('statusbar'), run: () => prefs.set('statusbar', !prefs.get('statusbar')) },
    '-',
    { heading: t('Appearance') },
    { label: t('Light'), icon: 'sun', checked: th === 'light', run: () => prefs.set('theme', 'light') },
    { label: t('Dark'), icon: 'moon', checked: th === 'dark', run: () => prefs.set('theme', 'dark') },
    { label: t('System'), icon: 'palette', checked: th === 'system', run: () => prefs.set('theme', 'system') },
    '-',
    { heading: t('Language') },
    ...LANGS.map((l) => ({ label: l.name, icon: 'globe', checked: lang === l.id, run: () => lang !== l.id && setLang(l.id) })),
    '-',
    { label: t('Status'), icon: 'info', run: () => bus.emit('open-settings', 'status') },
    { label: t('Health check'), icon: 'life', run: () => bus.emit('open-settings', 'health') },
    { label: t('Search the project'), icon: 'search', run: () => openSearch() },
    { label: t('Privacy'), icon: 'lock', run: () => bus.emit('open-settings', 'privacy') },
    { label: t('Documentation'), icon: 'book', run: () => void open(`${ROOT}docs/`, '_blank') },
    { label: t('Settings'), icon: 'settings', run: () => bus.emit('open-settings', 'ai') },
    { label: t('WorkCraft website'), icon: 'external', run: () => void open(ROOT, '_blank') },
  ];
}
let closeMain: (() => void) | null = null;
/** The menu button toggles: it shows a close mark while the menu is open and closes it on the next tap. */
function openMainMenu(anchor: HTMLElement) {
  if (closeMain) {
    closeMain();
    return;
  }
  const r = anchor.getBoundingClientRect();
  const idle = anchor.innerHTML;
  const idleLabel = anchor.getAttribute('aria-label') || '';
  anchor.innerHTML = icon('close', { size: 18 });
  anchor.setAttribute('aria-expanded', 'true');
  anchor.setAttribute('aria-label', t('Close menu'));
  closeMain = menu(mainMenu(), r.right, r.bottom + 6, {
    alignRight: true,
    anchor,
    onClose: () => {
      closeMain = null;
      anchor.innerHTML = idle;
      anchor.setAttribute('aria-expanded', 'false');
      anchor.setAttribute('aria-label', idleLabel);
    },
  });
}

// ---------------------------------------------------------------- Top bar
function buildTopbar(): HTMLElement {
  const tabs = h('div.tabs', { role: 'tablist', 'aria-label': t('Panels') });
  const add = h<'button'>('button.icon-btn', { type: 'button', title: t('Add panel'), 'aria-label': t('Add panel'), 'aria-haspopup': 'menu', html: icon('plus', { size: 18 }) });
  add.onclick = () => {
    const r = add.getBoundingClientRect();
    menu(
      Object.values(TOOLS)
        .filter((x) => x.zone === 'stage')
        .map((x) => ({ label: x.name, html: toolMark(x.id, 16), hint: x.single ? '' : t('new'), run: () => void workspace.openPanel(x.id) })),
      r.left,
      r.bottom + 6
    );
  };
  const search = h('button.icon-btn', { type: 'button', 'data-act': 'search', title: t('Search commands, files and tools ({key} K)', { key: modKey }), 'aria-label': t('Open command palette'), html: icon('search', { size: 18 }), onclick: () => openPalette() });
  // The project tree and the top bar can be hidden on their own (also with Mod + \ and Mod + Shift + \)
  const treeBtn = h<'button'>('button.icon-btn', { type: 'button', 'data-act': 'tree', title: t('Project tree ({key} \\)', { key: modKey }), 'aria-label': t('Show or hide the project tree'), html: icon('panelLeft', { size: 18 }), onclick: () => toggleSide('tree') });
  const paintTree = () => treeBtn.setAttribute('aria-pressed', String(workspace.panel('tree')?.mode === 'normal'));
  bus.on('workspace:change', paintTree);
  const hideBarBtn = h<'button'>('button.icon-btn.hide-bar-btn', { type: 'button', 'data-act': 'hide-topbar', title: t('Hide the top bar'), 'aria-label': t('Hide the top bar'), html: icon('chevronUp', { size: 18 }), onclick: () => toggleTopbar(true) });
  const aiBtn = h<'button'>('button.icon-btn', { type: 'button', 'data-act': 'chat', title: t('AI chat ({key} J)', { key: modKey }), 'aria-label': t('Show or hide the AI chat'), html: toolMark('chat', 18), onclick: () => bus.emit('ai:toggle', undefined) });
  // Chat launcher: the dedicated Full Chat Mode (also ?mode=chat)
  const fullBtn = h<'button'>('button.icon-btn', { type: 'button', 'data-act': 'chat-full', title: t('Full Chat Mode'), 'aria-label': t('Full Chat Mode'), html: icon('chat', { size: 18 }), onclick: () => workspace.setFullChat() });
  const paintFull = () => fullBtn.setAttribute('aria-pressed', String(workspace.fullChat));
  bus.on('chat:view', paintFull);
  const themeBtn = h<'button'>('button.icon-btn', { type: 'button', 'data-act': 'theme', title: t('Light or dark (also for the apps)'), 'aria-label': t('Switch color scheme'), html: icon(resolvedTheme() === 'dark' ? 'sun' : 'moon', { size: 18 }) });
  themeBtn.onclick = toggleTheme;
  bus.on('settings:change', ({ key }) => key === 'theme' && (themeBtn.innerHTML = icon(resolvedTheme() === 'dark' ? 'sun' : 'moon', { size: 18 })));
  const menuBtn = h<'button'>('button.icon-btn.menu-btn', { type: 'button', 'data-act': 'menu', title: t('Menu'), 'aria-label': t('Open menu'), 'aria-haspopup': 'menu', html: icon('menu', { size: 18 }) });
  menuBtn.onclick = () => openMainMenu(menuBtn);
  const paintAi = () => aiBtn.setAttribute('aria-pressed', String(workspace.panel('chat')?.mode === 'normal'));
  bus.on('workspace:change', paintAi);
  // Project search across all files and chats
  const findBtn = h<'button'>('button.icon-btn', { type: 'button', 'data-act': 'project-search', title: t('Search the project'), 'aria-label': t('Search the project'), html: icon('filter', { size: 18 }), onclick: () => openSearch() });
  // Local-only mode: a clear badge while cloud providers are blocked
  const localBadge = h<'button'>('button.top-badge', { type: 'button', 'data-act': 'local-only', hidden: true, title: t('Local-only mode: cloud providers are blocked. Click for the privacy settings.'), onclick: () => bus.emit('open-settings', 'privacy'), html: icon('lock', { size: 14 }) + `<span>${t('Local only')}</span>` });
  bus.on('privacy:change', ({ localOnly }) => (localBadge.hidden = !localOnly));
  // Memory and speed: shown only while memory is high or the page is slow, with the last thing the guard did as its tooltip
  const memBadge = h<'button'>('button.top-badge.mem-badge', { type: 'button', 'data-act': 'memory', hidden: true, onclick: () => bus.emit('open-settings', 'monitor') });
  bus.on('ipados:memory', (m) => {
    const slow = m.lag === 'laggy' || m.lag === 'slow';
    memBadge.hidden = m.level === 'ok' && !slow;
    if (memBadge.hidden) return;
    const gb = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.round(n / 1048576)} MB`);
    memBadge.dataset.state = m.level === 'critical' ? 'crit' : 'warn';
    const label = m.level === 'critical' ? t('Memory full') : m.level === 'ok' ? t('Slow') : slow && m.level === 'warn' ? t('Slow') : t('Memory {n}', { n: gb(m.usage) });
    memBadge.innerHTML = icon('cpu', { size: 14 }) + `<span>${label}</span>`;
    const last = m.events?.at(-1);
    memBadge.title = [t('Apps use {n} of {max}.', { n: gb(m.usage), max: gb(m.budget.act) }), slow ? t('The workspace is responding slowly.') : '', last ? last.text : t('Open the memory monitor.')].filter(Boolean).join(' ');
  });

  $('topbar').append(
    h('a.brand', { href: ROOT, title: t('WorkCraft website') }, h('span.brand-mark', { html: logoSvg(22) }), h('span.brand-name', { html: wordmarkSvg(18, 'wordmark-svg', 'WorkCraft') })),
    treeBtn,
    tabs,
    h('div.top-actions', localBadge, memBadge, add, search, findBtn, aiBtn, fullBtn, themeBtn, hideBarBtn, menuBtn)
  );
  paintTree();

  // Focus mode: a single floating button brings the menu back
  const fab = h<'button'>('button.icon-btn.focus-fab', { type: 'button', title: t('Menu'), 'aria-label': t('Open menu'), 'aria-haspopup': 'menu', html: icon('menu', { size: 18 }) });
  fab.onclick = () => openMainMenu(fab);
  $('app').append(fab);
  // Top bar hidden: a small handle at the top edge brings it back (tap, or pull it down)
  const handle = h<'button'>('button.chrome-handle', { type: 'button', title: t('Show the top bar'), 'aria-label': t('Show the top bar'), html: icon('panelTop', { size: 16 }) });
  let pull: { y: number; id: number } | null = null;
  handle.onpointerdown = (e) => {
    pull = { y: e.clientY, id: e.pointerId };
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointerup = (e) => {
    // A tap or a pull downwards; a pull upwards does nothing
    if (pull && e.clientY - pull.y > -12) toggleTopbar(false);
    pull = null;
  };
  handle.onpointercancel = () => (pull = null);
  $('app').append(handle);
  return tabs;
}

// ---------------------------------------------------------------- Tool rail
function buildActivity() {
  const nav = $('activity');
  nav.setAttribute('aria-label', t('Tools'));
  const btn = (id: string, ic: string, label: string, run: () => void, extra: Record<string, string> = {}) =>
    h('button.act-btn', { type: 'button', title: label, 'aria-label': label, html: TOOLS[id as ToolId]?.logo || TOOLS[id as ToolId]?.kind === 'app' ? toolMark(id, 22) : icon(ic, { size: 20 }), onclick: run, ...extra });
  // The rail shows the apps of the ecosystem in use (src/ecosystems); it is rebuilt when the workspace is switched
  const fill = () => {
    nav.replaceChildren(
      btn('tree', 'folder', t('Project tree'), () => toggleSide('tree'), { 'data-tool': 'tree' }),
      h('button.act-btn', { type: 'button', 'data-act': 'launcher', title: t('Apps, recent files and workspaces'), 'aria-label': t('Apps, recent files and workspaces'), html: icon('grid', { size: 20 }), onclick: () => void import('../ecosystems/ui.js').then((m) => m.openLauncher()) }),
      h('span.act-sep')
    );
    for (const id of activeApps()) {
      const x = TOOLS[id];
      nav.append(btn(id, x.icon, x.available ? x.name : t('{name} (no web build here yet)', { name: x.name }), () => toggleTool(id), { 'data-tool': id, style: `--tool:${x.accent}`, ...(x.available ? {} : { 'data-missing': '1' }) }));
    }
    nav.append(h('span.act-sep'));
    for (const id of ['code', 'terminal'] as ToolId[]) nav.append(btn(id, TOOLS[id].icon, TOOLS[id].name, () => toggleTool(id), { 'data-tool': id, style: `--tool:${TOOLS[id].accent}` }));
    // The AI chat opens from the top bar (spark button, {key} J); the rail ends with the settings
    nav.append(h('span.spacer'), btn('settings', 'settings', t('Settings'), () => void workspace.openPanel('settings'), { 'data-tool': 'settings' }));
    paint();
  };
  const paint = () => {
    const panels = workspace.panels();
    nav.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => {
      const mine = panels.filter((p) => p.tool === b.dataset.tool);
      b.classList.toggle('has-visible', mine.some((p) => p.mode === 'normal'));
      b.classList.toggle('has-hidden', mine.length > 0 && mine.every((p) => p.mode === 'hidden' || p.mode === 'minimized'));
      b.classList.toggle('is-focused', workspace.focusedTool === b.dataset.tool);
      b.classList.toggle('is-loaded', mine.some((p) => p.status === 'active'));
    });
  };
  bus.on('workspace:change', paint);
  bus.on('workspace:focus', paint);
  bus.on('workspace:resources', paint);
  bus.on('ecosystem:change', fill);
  fill();
  // Right click, pencil barrel button or long press on a tool's icon: the same menu as on the panel header. Nothing open yet: open it.
  void desktopApps();
  onContextAction(
    nav,
    (x, y, target) => {
      const id = target.closest<HTMLElement>('[data-tool]')?.dataset.tool as ToolId | undefined;
      const tool = id && TOOLS[id];
      if (!id || !tool) return;
      const mine = workspace.panels().filter((p) => p.tool === id);
      // Several windows of one app: the focused one, else a visible one, else the first
      const pick = mine.find((p) => p.id === workspace.focused) || mine.find((p) => p.mode === 'normal') || mine[0];
      if (pick) return workspace.panelMenu(pick.id, x, y);
      const desk = desktopAppCached(id);
      menu(
        [
          { label: t('Open {name}', { name: tool.name }), icon: 'plus', run: () => void workspace.openPanel(id) },
          ...(desk ? [{ label: t('Open {name} for desktop', { name: desk.name }), icon: 'external', run: () => void openInDesktop(desk.id) }] : []),
        ],
        x,
        y
      );
    },
    { accept: (el) => !!el.closest('[data-tool]') }
  );
}

function toggleSide(id: 'tree' | 'chat') {
  const p = workspace.panel(id);
  if (!p) return;
  if (p.mode === 'normal') workspace.hide(id);
  else workspace.show(id);
}

/** Click on a tool: open it, show it, or (when focused) hide it. */
function toggleTool(id: ToolId) {
  const mine = workspace.panels().filter((p) => p.tool === id);
  if (!mine.length) return void workspace.openPanel(id);
  const visible = mine.filter((p) => p.mode === 'normal');
  if (!visible.length) return workspace.show(mine[0]!.id);
  const focused = visible.find((p) => p.id === workspace.focused);
  if (focused) workspace.hide(focused.id);
  else workspace.focus(visible[0]!.id);
}

// ---------------------------------------------------------------- Status bar (optional, off by default)
function buildStatusbar() {
  const bar = $('statusbar');
  const ai = h('button.sb-item.sb-ai', { type: 'button', title: t('AI model'), onclick: () => bus.emit('open-settings', 'ai') }, h('span.dot'), h('span'));
  const backendChip = h('button.sb-item.sb-backend', { type: 'button', onclick: () => bus.emit('open-settings', 'status') }, h('span.dot'), h('span', 'Backend'));
  const more = h('button.sb-item', { type: 'button', title: t('Status'), html: icon('info', { size: 14 }) + `<span>${t('Status')}</span>`, onclick: () => bus.emit('open-settings', 'status') });
  bar.append(h('span.spacer'), ai, backendChip, more);

  const paintAi = () => {
    const st = aiConfig.cached;
    ai.dataset.state = !st ? 'unknown' : st.active ? (st.active.local ? 'local' : 'ok') : 'error';
    (ai.lastChild as HTMLElement).textContent = st?.active ? `${st.active.name} · ${st.active.model}` : t('AI not set up');
  };
  const paintBackend = () => {
    if (backendMode.browser) {
      backendChip.dataset.state = 'local';
      backendChip.title = t('No desktop backend reachable. Projects live in this browser (IndexedDB).');
      (backendChip.lastChild as HTMLElement).textContent = t('Browser mode');
      return;
    }
    const remote = document.documentElement.dataset.backend === 'remote';
    backendChip.dataset.state = live.connected ? 'ok' : 'error';
    backendChip.title = remote ? t('Connected to the desktop PC on the home network') : t('Local desktop backend');
    (backendChip.lastChild as HTMLElement).textContent = live.connected ? (remote ? t('Desktop on the home network') : t('Backend connected')) : t('Backend disconnected');
  };
  bus.on('ai:status', paintAi);
  bus.on('ws:state', paintBackend);
  bus.on('backend:mode', paintBackend);
  paintAi();
  paintBackend();
}

// ---------------------------------------------------------------- Commands
function commands(): Command[] {
  const list: Command[] = [];
  for (const x of Object.values(TOOLS)) list.push({ id: 'open-' + x.id, label: t('Open {name}', { name: x.name }), mark: x.id, keywords: x.blurb, run: () => (x.zone === 'stage' ? void workspace.openPanel(x.id) : workspace.show(x.id)) });
  list.push(
    { id: 'layout-grid', label: t('Layout: grid'), icon: 'layoutGrid', run: () => workspace.applyPreset('grid') },
    { id: 'layout-columns', label: t('Layout: columns'), icon: 'layoutColumns', run: () => workspace.applyPreset('columns') },
    { id: 'layout-rows', label: t('Layout: rows'), icon: 'layoutRows', run: () => workspace.applyPreset('rows') },
    { id: 'maximize', label: t('Maximize focused panel'), icon: 'expand', run: () => workspace.toggleMaximize() },
    { id: 'minimize', label: t('Minimize focused panel (dock)'), icon: 'minimize', run: () => workspace.focused && workspace.minimize(workspace.focused) },
    { id: 'fullscreen-panel', label: t('Full screen for the focused panel'), icon: 'fullscreen', hint: 'Alt ↵', keywords: 'fullscreen immersive hide bars chat sidebar', run: () => workspace.focused && workspace.setFullscreen(workspace.focused) },
    { id: 'popout', label: t('Open the focused panel in a separate window'), icon: 'popout', keywords: 'window second display monitor screen detach', run: () => workspace.focused && void workspace.popOut(workspace.focused) },
    ...(workspace.hasOtherDisplay ? [{ id: 'popout-other', label: t('Open the focused panel on the other display'), icon: 'popout', keywords: 'second monitor screen display', run: () => workspace.focused && void workspace.popOut(workspace.focused, { other: true }) }] : []),
    { id: 'hide-focused', label: t('Hide focused panel'), icon: 'eyeOff', run: () => workspace.focused && workspace.hide(workspace.focused) },
    { id: 'launcher', label: t('Apps, recent files and workspaces'), icon: 'grid', keywords: 'launcher home recent files start apps', run: () => void import('../ecosystems/ui.js').then((m) => m.openLauncher()) },
    { id: 'workspace-switch', label: t('Switch workspace'), icon: 'shuffle', keywords: 'ecosystem office imaging video audio design cad 3d custom', run: () => void import('../ecosystems/ui.js').then((m) => m.openEcosystemPicker()) },
    ...allEcosystems().map((e) => ({ id: 'workspace-' + e.id, label: t('Workspace: {name}', { name: e.name }), icon: 'grid', keywords: `ecosystem ${e.apps.join(' ')}`, run: () => void import('../ecosystems/ui.js').then((m) => { setEcosystem(e.id); m.enterEcosystem(e); }) })),
    { id: 'apps-all', label: t('All four apps side by side'), icon: 'layoutGrid', keywords: 'wordcraft gridcraft deckcraft pdfcraft', run: () => showAllApps() },
    { id: 'chat', label: t('Show or hide the AI chat'), icon: 'spark', hint: `${modKey} J`, run: () => bus.emit('ai:toggle', undefined) },
    { id: 'voice', label: t('Voice input: speak instead of typing'), icon: 'mic', keywords: 'microphone dictate speech handy talk voice', run: () => bus.emit('chat:voice') },
    { id: 'chat-full', label: t('Full Chat Mode'), icon: 'chat', keywords: 'chatgpt gemini assistant fullscreen', run: () => workspace.setFullChat() },
    { id: 'chat-left', label: t('Dock the AI chat on the left'), icon: 'sidebar', keywords: 'sidebar side', run: () => prefs.set('chatSide', 'left') },
    { id: 'chat-right', label: t('Dock the AI chat on the right'), icon: 'sidebar', keywords: 'sidebar side', run: () => prefs.set('chatSide', 'right') },
    { id: 'pip', label: t('Picture in picture for the focused panel'), icon: 'pip', keywords: 'float window pip', run: () => workspace.focused && workspace.togglePip(workspace.focused) },
    { id: 'pip-chat', label: t('AI chat as a floating window'), icon: 'pip', keywords: 'float pip', run: () => workspace.togglePip('chat') },
    { id: 'usage', label: t('API usage and tokens'), icon: 'trend', keywords: 'tokens cost telemetry usage', run: () => bus.emit('open-settings', 'usage') },
    { id: 'tree', label: t('Show or hide the project tree'), icon: 'sidebar', run: () => toggleSide('tree') },
    { id: 'topbar', label: t('Show or hide the top bar'), icon: 'panelTop', keywords: 'header toolbar chrome hide', run: () => toggleTopbar() },
    { id: 'rail', label: t('Show or hide the tool rail'), icon: 'panelLeft', keywords: 'activity bar icons left hide', run: () => toggleRail() },
    { id: 'icons-only', label: t('Buttons with icons only'), icon: 'sliders', keywords: 'compact labels text ipad touch', run: () => prefs.set('iconsOnly', document.documentElement.classList.contains('icons-only') ? 'off' : 'on') },
    { id: 'focus-mode', label: t('Focus mode (hide the bars)'), icon: 'eyeOff', keywords: 'zen chrome hide menu', run: () => prefs.set('focusMode', !prefs.get('focusMode')) },
    ...(fullscreenSupported() ? [{ id: 'fullscreen', label: t('Browser full screen'), icon: 'expand', keywords: 'fullscreen', run: toggleFullscreen }] : []),
    { id: 'statusbar', label: t('Show or hide the status bar'), icon: 'activity', run: () => prefs.set('statusbar', !prefs.get('statusbar')) },
    { id: 'status', label: t('Status: backend, AI, panels, offline cache'), icon: 'info', keywords: 'version info', run: () => bus.emit('open-settings', 'status') },
    { id: 'copy-path', label: t('Copy the path of the focused file'), icon: 'copy', keywords: 'path file location clipboard', run: () => { const p = workspace.focused ? workspace.panel(workspace.focused)?.path : null; if (p) void copyProjectPath(p); } },
    ...(canLocate() ? [{ id: 'reveal-file', label: t('Show the focused file in the file manager'), icon: 'folderOpen', keywords: 'explorer finder open pc folder location', run: () => { const p = workspace.focused ? workspace.panel(workspace.focused)?.path : null; if (p) void revealInFileManager(p); } }] : []),
    { id: 'project-new', label: t('New project'), icon: 'plus', keywords: 'project create', run: () => void projects.create() },
    { id: 'project-switch', label: t('Switch project'), icon: 'briefcase', run: () => void projects.openSwitcher(document.querySelector('.tree-project') || $('topbar')) },
    { id: 'project-export', label: t('Export project as ZIP (with chats)'), icon: 'archive', run: () => void projects.exportZip() },
    { id: 'project-import', label: t('Import project from ZIP'), icon: 'upload', run: () => projects.pickZip() },
    { id: 'theme', label: t('Switch color scheme'), icon: 'moon', keywords: 'dark light theme', run: toggleTheme },
    ...LANGS.filter((l) => l.id !== lang).map((l) => ({ id: 'lang-' + l.id, label: t('Language: {name}', { name: l.name }), icon: 'globe', keywords: 'language sprache', run: () => setLang(l.id) })),
    {
      id: 'unload-hidden',
      label: t('Unload hidden apps now'),
      icon: 'power',
      keywords: 'memory ram wasm',
      run: () => void Promise.all(workspace.panels().filter((p) => !p.visible && p.status === 'active' && (APP_IDS as string[]).includes(p.tool)).map((p) => workspace.unload(p.id))),
    },
    { id: 'project-search', label: t('Search the project (files and chats)'), icon: 'search', keywords: 'find semantic full text volltext suche', run: () => openSearch() },
    { id: 'health', label: t('Health check: backend, MCP, WebGPU, Ollama'), icon: 'life', keywords: 'status diagnose health', run: () => bus.emit('open-settings', 'health') },
    { id: 'monitor', label: t('Memory and GPU monitor'), icon: 'cpu', keywords: 'ram wasm webgpu kill memory', run: () => bus.emit('open-settings', 'monitor') },
    { id: 'local-only', label: t('Privacy: local-only mode'), icon: 'lock', keywords: 'cloud ollama offline privacy datenschutz', run: () => bus.emit('open-settings', 'privacy') },
    { id: 'audit', label: t('Audit log: what left the device'), icon: 'shield', keywords: 'privacy log cloud', run: () => bus.emit('open-settings', 'audit') },
    { id: 'personas', label: t('Personas and personal context'), icon: 'user', keywords: 'persona role system prompt', run: () => bus.emit('open-settings', 'personal') },
    { id: 'snapshots', label: t('Snapshots and history'), icon: 'clock', keywords: 'undo restore version graph', run: () => bus.emit('open-settings', 'history') },
    { id: 'snapshot-now', label: t('Take a project snapshot now'), icon: 'save', keywords: 'backup undo', run: () => void api.send('POST', '/api/snapshots', { label: t('Snapshot from the command palette') }).then(() => toast(t('Snapshot saved'), 'success')).catch((e) => notify({ level: 'error', title: t('Snapshot failed'), message: (e as Error).message })) },
    { id: 'trash', label: t('Trash'), icon: 'trash', keywords: 'restore deleted papierkorb', run: () => bus.emit('open-settings', 'trash') },
    { id: 'share', label: t('Share on the home network (read-only link)'), icon: 'share', keywords: 'lan wifi share link sync', run: () => bus.emit('open-settings', 'share') },
    { id: 'export-html', label: t('Export as HTML gallery'), icon: 'browser', run: () => void projects.exportAs('html') },
    { id: 'export-pdf', label: t('Export as PDF portfolio'), icon: 'file', run: () => void projects.exportAs('pdf') },
    { id: 'export-md', label: t('Export as Markdown folder'), icon: 'book', run: () => void projects.exportAs('markdown') },
    { id: 'plugins', label: t('Plugins and sandbox'), icon: 'box', keywords: 'comfyui blender photocraft artcraft mcp', run: () => bus.emit('open-settings', 'plugins') },
    { id: 'logs', label: t('Logs and metrics'), icon: 'terminal', keywords: 'log debug performance', run: () => bus.emit('open-settings', 'logs') },
    { id: 'wipe', label: t('Delete everything (one-click wipe)'), icon: 'trash', keywords: 'wipe reset demo', run: () => bus.emit('open-settings', 'privacy') },
    { id: 'docs', label: t('Documentation'), icon: 'book', keywords: 'help docs privacy', run: () => void open(`${ROOT}docs/`, '_blank') },
    { id: 'settings', label: t('Settings: models, keys, MCP'), icon: 'settings', keywords: 'api key claude chatgpt gemini deepseek ollama endpoint', run: () => bus.emit('open-settings', 'ai') },
    { id: 'mcp-refresh', label: t('Reload MCP tools'), icon: 'refresh', run: () => void loadOrchestrator().then((o) => o.refresh()).then((x) => toast(t('{n} tools available', { n: x.length }), 'success')) }
  );
  return list;
}

function showAllApps() {
  for (const id of APP_IDS) {
    const p = workspace.panels().find((x) => x.tool === id);
    if (!p) workspace.openPanel(id, { silent: true });
    else if (p.mode !== 'normal') workspace.show(p.id);
  }
  for (const p of workspace.panels()) if (!(APP_IDS as string[]).includes(p.tool) && TOOLS[p.tool].zone === 'stage' && p.mode === 'normal') workspace.hide(p.id);
  workspace.applyPreset('grid');
}

/**
 * First start of a project, and a new workspace: no app opens by itself. The stage shows the welcome page of the workspace (src/workspace/
 * layout.ts emptyStage) and you open the apps you want from it, the tool rail or the project tree. Several engines starting together
 * (WebAssembly, GPU) make the machine laggy, so the first thing on screen is a page, not a pile of loading apps. The project tree and the
 * chat exist anyway; Code and the Terminal open from the rail when asked.
 */
function defaultLayout() {}

// ---------------------------------------------------------------- Keyboard
function keys() {
  addEventListener(
    'keydown',
    (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      // Only three shortcuts, none of them a browser shortcut: the command palette (Ctrl/Cmd K, which finds everything else: chat,
      // search, picture in picture, full chat, focus mode, the top bar), the project tree (Ctrl/Cmd \) and full screen for a panel (Alt Enter).
      // Ctrl J (downloads), Ctrl Shift J, K, E, M, P, F (browser tools, private windows, full screen) and Alt 1 to 9 (tab switching in
      // Firefox) were taken out; every one of those actions is in the palette and in the menus.
      if (mod && !e.shiftKey && !e.altKey && k === 'k') {
        e.preventDefault();
        openPalette();
      } else if (mod && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        toggleSide('tree');
      } else if (e.altKey && !mod && !e.shiftKey && k === 'enter') {
        e.preventDefault();
        workspace.setFullscreen(workspace.fullscreen ?? workspace.focused);
      }
    },
    true
  );
  bus.on('palette:open', (q) => openPalette(q || ''));
  bus.on('search:open', (q) => openSearch(q || ''));
  bus.on('ai:toggle', (force) => {
    const p = workspace.panel('chat');
    const visible = p?.mode === 'normal';
    const next = typeof force === 'boolean' ? force : !visible;
    if (!next && workspace.fullChat) workspace.setFullChat(false);
    if (next) {
      workspace.show('chat');
      setTimeout(() => document.querySelector<HTMLTextAreaElement>('.chat-input')?.focus(), 60);
    } else workspace.hide('chat');
  });
  // @ and / from the top bar: show the chat and load it first if it is not running yet
  bus.on('chat:trigger', async (ch) => {
    if (workspace.instance('chat')) return;
    workspace.show('chat');
    await workspace.ensureInstance('chat').catch(() => {});
    bus.emit('chat:trigger', ch);
  });
  // Voice input from the command palette: show the chat and load it first if it is not running yet
  bus.on('chat:voice', async () => {
    if (workspace.instance('chat')) return;
    workspace.show('chat');
    await workspace.ensureInstance('chat').catch(() => {});
    bus.emit('chat:voice');
  });
  let forwarding = false;
  bus.on('open-settings', async (section) => {
    if (forwarding) return;
    const id = workspace.openPanel('settings');
    await workspace.ensureInstance(id).catch(() => {});
    forwarding = true;
    bus.emit('open-settings', section);
    forwarding = false;
  });
}

// ---------------------------------------------------------------- Service worker
async function registerSw() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) {
    // Safari allows service workers only in a secure context (HTTPS, localhost), not over HTTP on the home network
    appStatus.set({ cache: import.meta.env.DEV ? t('Development (no offline cache)') : !window.isSecureContext ? t('Home network over HTTP: no offline cache') : t('No offline cache') });
    return;
  }
  try {
    // From the site root: works under / (npm start) and under sub paths like /workcraft/
    const reg = await navigator.serviceWorker.register(`${ROOT}sw.js`, { scope: ROOT });
    const paint = () => appStatus.set({ cache: reg.active ? t('Apps cached for offline use') : t('Caching apps for offline use') });
    paint();
    void navigator.serviceWorker.ready.then(paint);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        paint();
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast(t('New version loaded'), 'info', t('It becomes active on the next start.'));
      });
    });
  } catch (e) {
    console.warn('Service worker', e);
    appStatus.set({ cache: t('No offline cache') });
  }
}

// ---------------------------------------------------------------- Load and switch projects
async function loadProject() {
  const { active } = await projects.list();
  live.setProject(active.id);
  await fs.reload();
  // ?popout=1: a separate window of one panel (second display), not the workspace
  if (popout) {
    await workspace.loadPopout(active.id, popout);
    document.title = `${TOOLS[popout.tool].name}${popout.path ? ' · ' + basename(popout.path) : ''} · ${active.name} · WorkCraft`;
    return;
  }
  await workspace.load(active.id, defaultLayout);
  document.title = `${active.name} · WorkCraft`;
}

let switching: Promise<void> | null = null;
function onProjectChanged() {
  if (switching) return;
  switching = (async () => {
    const before = projects.current?.id;
    const { active } = await projects.list();
    if (active.id === before && fs.project === active.id) return;
    await workspace.teardown();
    await loadProject();
    toast(t('Project {name} opened', { name: active.name }), 'success');
  })()
    .catch((e) => void notify({ ...explain(e, () => onProjectChanged()), timeout: 0 }))
    .finally(() => (switching = null));
}

/**
 * Browser mode: as long as no desktop backend answers, the workspace works with IndexedDB.
 * When the desktop becomes reachable again (for example back on the home network), a notice
 * offers the switch. No error dialog, no interruption.
 */
function watchForDesktop() {
  let offered = false;
  const check = async () => {
    if (offered || !backend.browser || document.visibilityState === 'hidden') return;
    const r = await backend.probe(1500);
    if (!r) return;
    offered = true;
    notify({
      level: 'info',
      title: t('Desktop backend reachable'),
      message: t('Projects, terminal and Ollama of the desktop PC are available again. Move projects from browser mode with a ZIP export.'),
      timeout: 0,
      actions: [{ label: t('Switch to the desktop'), primary: true, run: () => location.reload() }],
    });
  };
  setInterval(() => void check(), 20_000);
  document.addEventListener('visibilitychange', () => void check());
}

function translateShell() {
  // Static labels of index.html
  $('zone-left').setAttribute('aria-label', t('Project tree'));
  $('zone-right').setAttribute('aria-label', t('AI chat'));
  $('stage').setAttribute('aria-label', t('Panels'));
  $('dock').setAttribute('aria-label', t('Minimized panels'));
  for (const id of ['gutter-left', 'gutter-right']) $(id).title = t('Drag to resize, double click resets');
}

// ---------------------------------------------------------------- Start
/** Set when this page is a separate window of one panel (?popout=1) instead of the workspace. */
const popout = popoutParams();

/** First run: the workspace picker opens once (src/ecosystems/ui.ts). Skipped in automated browsers and when a link
 *  chose one (?ecosystem=imaging). Closing it keeps the default, Office & Documents. */
function maybeOnboard() {
  if (popout || !needsChoice() || navigator.webdriver) return;
  setTimeout(() => {
    void import('../ecosystems/ui.js')
      .then((m) => m.openEcosystemPicker({ first: true }))
      .finally(() => {
        if (needsChoice()) prefs.set('ecosystemChosen', true);
      });
  }, 700);
}

async function boot() {
  installDevice();
  initEcosystems(location.search);
  // Check mark of the flat checkboxes (src/styles/tools.css) from the icon set, as a CSS mask
  const check = icon('check', { size: 16 }).replace(/currentColor/g, '#000').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  document.documentElement.style.setProperty('--ic-check', `url("data:image/svg+xml,${encodeURIComponent(check)}")`);
  // Disclosure arrow of the tool cards in the chat (src/styles/chat-ui.css), a mask like the check mark
  const chevron = icon('chevron', { size: 16 }).replace(/currentColor/g, '#000').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  document.documentElement.style.setProperty('--ic-chevron', `url("data:image/svg+xml,${encodeURIComponent(chevron)}")`);
  // Every <select> of the workspace becomes the same custom dropdown (src/app/select.ts)
  installSelects(document);
  trackInput();
  applyTheme(false);
  applyChrome();
  watchSharedTheme();
  installGlobalHandlers();
  installLogCapture();
  translateShell();
  bus.on('settings:change', ({ key }) => {
    if (key === 'theme') applyTheme();
    if (key === 'statusbar' || key === 'panelFooters' || key === 'focusMode' || key === 'topbarHidden' || key === 'railHidden' || key === 'iconsOnly') applyChrome();
  });
  bus.on('device:change', () => applyChrome());
  const tabs = buildTopbar();
  buildActivity();
  buildStatusbar();
  // Desktop backend (same machine or home network) or browser mode (iPad on the road)
  const health = await backend.probe();
  if (!health) {
    backend.setMode('browser', t('Desktop backend not reachable'));
    watchForDesktop();
  } else document.documentElement.dataset.backend = health.remote ? 'remote' : 'desktop';
  live.connect();
  fs.init();
  workspace.init({ ws: $('ws'), stage: $('stage'), left: $('zone-left'), right: $('zone-right'), gl: $('gutter-left'), gr: $('gutter-right'), tabs, dock: $('dock') });
  projects.onBeforeSwitch(() => workspace.save());
  // iPadOS layer (src/ipados): capability plan, memory governor, storage mode, isolation on demand
  installIpados({
    remote: !!health?.remote,
    panels: () => workspace.resources().map((r) => ({ id: r.id, name: r.name, status: r.status, visible: r.visible, unsaved: r.unsaved, res: r.res ? { wasm: r.res.wasm, gpu: r.res.gpu } : null })),
    unload: async (id) => {
      await workspace.unload(id);
      return workspace.panels().find((p) => p.id === id)?.status !== 'active';
    },
    save: async (id) => (await workspace.instance(id)?.flushUnsaved?.()) ?? false,
    saveAll: () => workspace.flushUnsaved(),
  });
  await loadProject();
  registerCommands(commands());
  keys();
  // /?mode=chat opens the dedicated Full Chat Mode
  if (!popout && new URLSearchParams(location.search).get('mode') === 'chat') {
    workspace.setFullChat(true);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.chat-input')?.focus(), 120);
  }
  projects.installDropImport(document.body);
  bus.on('project:changed', onProjectChanged);
  bus.on('ws:state', ({ connected }) => {
    if (connected) {
      if (!popout) void loadOrchestrator().then((o) => o.connect()).catch(() => {});
      void fs.reload().catch(() => {});
    }
  });
  // A separate window shows one panel only: no chat, no update check, and it does not take over the MCP panel
  // tools of the workspace window (open-panel, panel-status)
  if (!popout) {
    void aiConfig.status().catch(() => {});
    startUpdateChecks();
    startCoffee();
    installPrivacyGuard();
    void loadOrchestrator().then((o) => o.connect()).catch((e) => console.warn('MCP', e));
    void registerSw();
  }
  // Browser mode: a project kept in the cloud (Google Drive, a folder of the computer) syncs by itself, like on the desktop
  if (!popout && backend.browser) void Promise.all([import('./cloud-browser.js'), import('./offline.js')]).then(([c, o]) => c.installBrowserCloud(o.browserHelpers())).catch(() => {});
  document.documentElement.classList.add('is-ready');
  maybeOnboard();
  // A link that chose a workspace (/?ecosystem=imaging) also arranges the stage for it, once
  if (!popout && new URLSearchParams(location.search).get('ecosystem')) {
    enterEcosystem(activeEcosystem());
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.prepend(h('div.boot-error', t('WorkCraft could not start: {message}', { message: (e as Error).message })));
});
