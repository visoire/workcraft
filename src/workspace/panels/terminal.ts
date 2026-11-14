// Real terminal: shell process in the backend (node-pty), shown with xterm.js, sent over the WebSocket.
// On Windows a switch picks PowerShell or the Command Prompt (cmd.exe); the choice is remembered.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { h } from '../../app/util.js';
import { bus } from '../../app/bus.js';
import { live } from '../../app/backend.js';
import type { PanelContext, PanelInstance } from '../registry.js';
import { desktopOnly, toolbar } from './common.js';
import { t as tr } from '../../app/i18n.js';

type ShellKind = 'powershell' | 'cmd' | 'posix';
const SHELL_KEY = 'workcraft.terminal.shell';
const SHELL_NAME: Record<ShellKind, string> = { powershell: 'PowerShell', cmd: 'Command Prompt', posix: 'Shell' };

function themeColors(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
  return { background: v('--inset', '#FAFAFB'), foreground: v('--ink', '#0D0D12'), cursor: '#335CFF', cursorAccent: v('--inset', '#FAFAFB'), selectionBackground: 'rgba(51,92,255,.25)' };
}

function savedShell(): ShellKind | undefined {
  try {
    const v = localStorage.getItem(SHELL_KEY);
    return v === 'powershell' || v === 'cmd' || v === 'posix' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Shells the backend offers (from /api/health). */
async function availableShells(): Promise<ShellKind[]> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = (await r.json()) as { shells?: ShellKind[] };
    return Array.isArray(j.shells) ? j.shells : [];
  } catch {
    return [];
  }
}

export async function mount(el: HTMLElement, ctx: PanelContext): Promise<PanelInstance> {
  const offline = await desktopOnly(el, ctx, 'Terminal', tr('The terminal'));
  if (offline) return offline;
  const root = h('div.tm');
  const shells = await availableShells();
  let shell: ShellKind | undefined = savedShell() && shells.includes(savedShell()!) ? savedShell() : shells[0];

  // Switch between the shells (only when there is more than one, that is on Windows)
  const pick = h<'select'>('select.input.tm-shell', { 'aria-label': tr('Shell'), title: tr('Shell for this terminal') }, ...shells.map((k) => h('option', { value: k, selected: k === shell }, SHELL_NAME[k])));
  pick.onchange = () => {
    shell = pick.value as ShellKind;
    try {
      localStorage.setItem(SHELL_KEY, shell);
    } catch {
      /* no storage */
    }
    term.reset();
    start();
  };
  const bar = shells.length > 1 ? toolbar([h('span.muted.tm-label', tr('Shell')), pick, '->', { icon: 'refresh', label: tr('Restart the shell'), run: () => (term.reset(), start()) }]) : null;
  if (bar) el.append(bar);
  el.append(root);

  const term = new Terminal({
    fontFamily: '"DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    theme: themeColors(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(root);
  const id = ctx.id;
  let exited = false;

  const doFit = () => {
    if (!root.isConnected || root.clientWidth < 20 || root.clientHeight < 20) return;
    try {
      fit.fit();
      live.send({ t: 'term:resize', id, cols: term.cols, rows: term.rows });
    } catch {
      /* not visible yet */
    }
  };
  const start = () => {
    exited = false;
    ready = false;
    doFit();
    live.send({ t: 'term:open', id, cols: term.cols || 100, rows: term.rows || 30, ...(shell ? { shell } : {}) });
    ctx.setStatus(tr('Shell runs in the project folder'));
  };

  // Keys typed before the shell has started are kept and sent once it runs
  let ready = false;
  const pending: string[] = [];
  term.onData((data) => {
    if (exited) {
      if (data === '\r') {
        term.reset();
        start();
      }
      return;
    }
    if (!ready) {
      pending.push(data);
      return;
    }
    live.send({ t: 'term:input', id, data });
  });
  term.attachCustomKeyEventHandler((e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.type === 'keydown' && mod && (e.key === 'k' || e.key === 'j') && !e.shiftKey) {
      if (e.key === 'k') bus.emit('palette:open', undefined);
      else bus.emit('ai:toggle', undefined);
      return false;
    }
    return true;
  });

  const offData = bus.on('term:data', (m) => m.id === id && term.write(m.data));
  const offShell = bus.on('term:shell', (m) => {
    if (m.id !== id) return;
    ready = true;
    if (pending.length) live.send({ t: 'term:input', id, data: pending.splice(0).join('') });
    // The backend may fall back to another shell: show the one that runs
    if (shells.includes(m.kind)) pick.value = m.kind;
    ctx.setStatus(tr('{shell} runs in the project folder', { shell: SHELL_NAME[m.kind] }));
  });
  const offExit = bus.on('term:exit', (m) => {
    if (m.id !== id) return;
    exited = true;
    term.write(`\r\n\x1b[2m[${m.code != null ? tr('Process ended with code {code}.', { code: m.code }) : tr('Process ended.')} ${tr('Enter restarts.')}]\x1b[0m\r\n`);
    ctx.setStatus(tr('ended'));
  });
  const offWs = bus.on('ws:state', ({ connected }) => {
    if (connected) start();
    else ctx.setStatus(tr('Connection to the backend lost'));
  });
  const offTheme = bus.on('settings:change', ({ key }) => key === 'theme' && (term.options.theme = themeColors()));
  const ro = new ResizeObserver(() => doFit());
  ro.observe(root);

  requestAnimationFrame(start);

  return {
    pause() {
      /* The shell keeps running, xterm only draws visible areas */
    },
    resume: () => requestAnimationFrame(doFit),
    status: () => ({ terminal: id, shell: shell || 'default', columns: term.cols, rows: term.rows, ended: exited }),
    unmount() {
      offData();
      offShell();
      offExit();
      offWs();
      offTheme();
      ro.disconnect();
      live.send({ t: 'term:close', id });
      term.dispose();
      bar?.remove();
      root.remove();
    },
  };
}
