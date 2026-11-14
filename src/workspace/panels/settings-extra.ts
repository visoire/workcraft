// Settings pages of the trust, search, history, home-network and observability features:
// Health check, Memory and GPU, Privacy (local-only mode, one-click wipe), Audit log,
// Personal context (personas), Search and memory, History and snapshots, Trash,
// Share and export, Plugins and sandbox, Logs and metrics.
// settings.ts mounts them; every builder returns the finished section element.

import { h, formatBytes, downloadBlob, uid } from '../../app/util.js';
import { icon } from '../../app/icons.js';
import { api, backend, live } from '../../app/backend.js';
import { bus } from '../../app/bus.js';
import { dialog, confirmDanger } from '../../app/ui.js';
import { toast, notifyError } from '../../app/notifications.js';
import { aiConfig, type PublicConfig, type Persona, type ContextEntry } from '../../chat/config.js';
import { CONTEXT_TEMPLATES, DEFAULT_PERSONAS, PERSONA_CATEGORIES, personalPrompt } from '../../core/defaults.js';
import { activeApps } from '../../ecosystems/ecosystems.js';
import { t, tn, locale } from '../../app/i18n.js';
import { workspace } from '../layout.js';
import { projects } from '../../project/manager.js';
import { fs } from '../../project/fs.js';
import { uiLogs, type UiLog } from '../../app/logs.js';
import { privacy } from '../../app/privacy.js';
import { AVAILABLE, isApp } from '../registry.js';
import { APPS } from '../../ecosystems/catalog.js';
import { ROLE_DEFS } from '../../chat/team.js';
import { loadOrchestrator } from '../../mcp/lazy.js';
import { prefs } from '../../app/settings.js';
import { ipados } from '../../ipados/index.js';
import type { Degradation } from '../../ipados/capabilities.js';

export type ExtraSection = 'health' | 'monitor' | 'privacy' | 'audit' | 'personal' | 'team' | 'search' | 'history' | 'trash' | 'share' | 'plugins' | 'logs';

export interface ExtraContext {
  /** current configuration (masked keys) */
  cfg(): PublicConfig;
  setCfg(c: PublicConfig): void;
  /** render the active section again */
  render(): void;
  go(section: string): void;
  /** the section is still on screen */
  visible(section: string): boolean;
}

// ---------------------------------------------------------------- Small building blocks

const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) });
  return t('{n} days ago', { n: Math.round(s / 86400) });
};
const kv = (label: string, value: string | Node, mono = true) => h('div.sp-kv', h('span.muted', label), typeof value === 'string' ? h('span' + (mono ? '.mono' : ''), value) : value);
const dot = (state: 'on' | 'off' | 'error' | 'warn' | 'local', text: string) => h('span.sp-state', h('span.sp-dot', { 'data-state': state === 'on' ? 'connected' : state }), h('span', text));
const card = (title: string, tone: string, ...children: (Node | null | false)[]) => h('div.frame.sp-card', h('div.well', h('div.sp-card-head', h('h3.duo', title + ' ', h('span.tone', tone))), ...children.filter((c): c is Node => !!c)));
const section = (eyebrow: string, title: string, tone: string, ...children: (Node | null | false)[]) => h('div.sp-section', h('p.eyebrow', eyebrow), h('h2.duo', title + ' ', h('span.tone', tone)), ...children.filter((c): c is Node => !!c));
const note = (text: string | Node, warn = false) => h('div.frame.sm.sp-notice' + (warn ? '.is-warn' : ''), h('div.well', h('span', { html: icon(warn ? 'alert' : 'info', { size: 16 }) }), typeof text === 'string' ? h('p', text) : text));
const btn = (label: string, ic: string, run: () => unknown, cls = '', action = '') => h<'button'>('button.btn' + cls, { type: 'button', ...(action ? { 'data-action': action } : {}), html: icon(ic, { size: 14 }) + `<span>${label}</span>`, onclick: () => void run() });
const sw = (checked: boolean, label: string, onchange: (v: boolean) => unknown, hint?: string, attr: Record<string, string> = {}) => {
  const input = h<'input'>('input', { type: 'checkbox', checked, ...attr });
  input.onchange = () => void onchange(input.checked);
  return h('label.switch', input, h('span', label, hint ? h('small.muted', ' ' + hint) : null));
};
const bar = (value: number, max: number, tone = '') => h('span.sp-bar' + tone, { 'aria-hidden': 'true' }, h('span', { style: `width:${Math.min(100, max ? (value / max) * 100 : 0).toFixed(1)}%` }));
const desktopOnly = (what: string) => note(t('{what} needs the desktop backend. In browser mode it is not available.', { what }), true);
async function load<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch {
    return null;
  }
}

export function extraSections(x: ExtraContext): Record<ExtraSection, () => Promise<HTMLElement>> {
  return {
    health: () => healthSection(x),
    monitor: () => monitorSection(x),
    privacy: () => privacySection(x),
    audit: () => auditSection(x),
    personal: () => personalSection(x),
    team: () => teamSection(x),
    search: () => searchSection(x),
    history: () => historySection(x),
    trash: () => trashSection(x),
    share: () => shareSection(x),
    plugins: () => pluginsSection(x),
    logs: () => logsSection(x),
  };
}

// ---------------------------------------------------------------- Health check

interface Check {
  ok: boolean;
  ms: number;
  detail?: unknown;
  error?: string;
}
interface HealthFull {
  browser?: boolean;
  ms?: number;
  backend: { ok: boolean; version?: string; node?: string; platform?: string; uptime?: number; rss?: number; lan?: boolean };
  system?: { freemem: number; totalmem: number; cpus: number };
  mcp?: Check & { detail?: { tools: number; builtIn: number; listMs: number } };
  external?: { name: string; status: string; error?: string; tools: string[]; sandbox?: string }[];
  ollama?: Check & { detail?: { url: string; version?: string; models: string[]; embedModel: string; embedModelPresent: boolean } };
  disk?: Check & { detail?: { free: number; total: number; path: string } };
  terminal?: { pty: boolean; mode: string };
  privacy?: { localOnly: boolean; audit: boolean };
  search?: { files: number; chunks: number; vectors: number; embeddings: boolean; phase: string };
  share?: { running: boolean; shares: unknown[]; port: number };
  trash?: { entries: number };
  snapshots?: { count: number; store: { bytes: number } };
}

async function browserChecks() {
  const out: { id: string; label: string; state: 'on' | 'warn' | 'error' | 'off'; text: string }[] = [];
  const wasm = typeof WebAssembly === 'object';
  let simd = false;
  try {
    simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    simd = false;
  }
  out.push({ id: 'wasm', label: t('WebAssembly'), state: wasm ? (simd ? 'on' : 'warn') : 'error', text: wasm ? `${t('ready')}${simd ? ' · SIMD' : ` · ${t('no SIMD')}`}${crossOriginIsolated ? ' · threads' : ''}` : t('not supported') });
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string; description?: string } } | null> } }).gpu;
  let gpuText = t('not available (needs a secure context and a GPU), the apps use WebGL2');
  let gpuState: 'on' | 'warn' = 'warn';
  if (gpu) {
    try {
      const a = await Promise.race([gpu.requestAdapter(), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      if (a) {
        gpuState = 'on';
        gpuText = [a.info?.vendor, a.info?.architecture, a.info?.description].filter(Boolean).join(' · ') || t('adapter ready');
      } else gpuText = t('no adapter, the apps use WebGL2');
    } catch (e) {
      gpuText = (e as Error).message;
    }
  }
  out.push({ id: 'webgpu', label: 'WebGPU', state: gpuState, text: gpuText });
  let gl = '';
  try {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    gl = c ? String((ext && c.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || c.getParameter(c.RENDERER)) : '';
  } catch {
    gl = '';
  }
  out.push({ id: 'webgl', label: 'WebGL2', state: gl ? 'on' : 'error', text: gl || t('not available') });
  const swReg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
  out.push({ id: 'sw', label: t('Service worker'), state: navigator.serviceWorker?.controller ? 'on' : swReg ? 'warn' : isSecureContext ? 'warn' : 'off', text: navigator.serviceWorker?.controller ? t('active, offline cache ready') : swReg ? t('registered, active after a reload') : isSecureContext ? t('not registered (development server)') : t('not over HTTP (needs HTTPS)') });
  const est = await navigator.storage?.estimate?.().catch(() => null);
  if (est?.quota) out.push({ id: 'storage', label: t('Browser storage'), state: (est.usage || 0) / est.quota > 0.85 ? 'warn' : 'on', text: `${formatBytes(est.usage || 0)} / ${formatBytes(est.quota)}` });
  out.push({ id: 'secure', label: t('Secure context'), state: isSecureContext ? 'on' : 'warn', text: isSecureContext ? t('yes') : t('no (HTTP on the home network)') });
  out.push(...ipadosChecks());
  return out;
}

const DEGRADATION: Record<Degradation, () => string> = {
  'insecure-context': () => t('Plain HTTP: Safari offers no WebGPU, offline cache or OPFS. Use HTTPS (iPadOS guide).'),
  'no-offline-cache': () => t('no offline cache'),
  'no-opfs': () => t('files stay in IndexedDB (no OPFS)'),
  'no-webgpu': () => t('apps use WebGL2'),
  'no-webgl2': () => t('no WebGL2: the apps cannot draw'),
  'no-persistence': () => t('Safari may delete the data after seven days without use'),
  'no-coalesced-events': () => t('no high rate pencil points'),
  'not-installed': () => t('Add to Home Screen keeps your data and gives a full screen app'),
};

/** The iPadOS layer in the health check: plan, pen, and what each engine reports. */
function ipadosChecks(): { id: string; label: string; state: 'on' | 'warn' | 'error' | 'off'; text: string }[] {
  const s = ipados.state;
  const sum = ipados.summary();
  const tiles: { id: string; label: string; state: 'on' | 'warn' | 'error' | 'off'; text: string }[] = [];
  const serious = s.plan.notes.filter((n) => n === 'insecure-context' || n === 'no-webgl2');
  tiles.push({
    id: 'ipados',
    label: t('iPadOS layer'),
    state: serious.length ? 'warn' : 'on',
    text: [`${t('mode')} ${sum.mode}`, `${t('storage')} ${sum.storage}${s.persisted === true ? ` (${t('kept')})` : s.persisted === false && s.mode === 'standalone' ? ` (${t('may be cleared')})` : ''}`, sum.renderer, `${t('isolation')} ${sum.isolation}`, `${t('pen')}: ${sum.pen}`, ...s.plan.notes.map((n) => DEGRADATION[n]())].join(' · '),
  });
  const reports = [...ipados.engines.values()];
  if (reports.length) {
    const bad = reports.some((r) => r.sharpness === 'blurry' || r.sharpness === 'oversampled' || r.measures.some((m) => m.state === 'failed'));
    tiles.push({
      id: 'engines',
      label: t('Apps and the iPadOS layer'),
      state: bad ? 'warn' : 'on',
      text: reports.map((r) => `${r.tool}: ${r.sharpness}${r.density ? ` ${r.density}x` : ''}${r.manifest.length ? ` [${r.manifest.join(' ')}]` : ''}${r.measures.filter((m) => m.state === 'failed').map((m) => ` ${m.id} ${t('failed')}`).join('')}${r.gpuLost ? ` · ${t('graphics lost')} ${r.gpuLost}x` : ''}`).join(' · '),
    });
  }
  return tiles;
}

async function healthSection(x: ExtraContext): Promise<HTMLElement> {
  const [full, browser] = await Promise.all([load<HealthFull>('/api/health/full'), browserChecks()]);
  const tiles: { id: string; label: string; state: 'on' | 'warn' | 'error' | 'off' | 'local'; text: string; action?: [string, () => void] }[] = [];
  if (!full || full.browser) {
    tiles.push({ id: 'backend', label: 'Backend', state: backend.browser ? 'local' : 'error', text: backend.browser ? t('Browser mode, no desktop backend') : t('not reachable') });
  } else {
    const b = full.backend;
    tiles.push({ id: 'backend', label: 'Backend', state: live.connected ? 'on' : 'warn', text: `v${b.version} · Node ${b.node} · ${t('up {n}', { n: fmtUptime(b.uptime || 0) })} · RAM ${formatBytes(b.rss || 0)}${live.connected ? '' : ` · ${t('live connection lost')}`}` });
    const m = full.mcp;
    tiles.push({ id: 'mcp', label: t('MCP server'), state: m?.ok ? 'on' : 'error', text: m?.ok ? t('{n} tools, list in {ms} ms', { n: m.detail!.tools, ms: m.detail!.listMs }) : m?.error || '–' });
    const ext = full.external || [];
    if (ext.length) tiles.push({ id: 'external', label: t('External MCP servers'), state: ext.every((e) => e.status === 'connected') ? 'on' : ext.some((e) => e.status === 'connected') ? 'warn' : 'error', text: ext.map((e) => `${e.name}: ${e.status === 'connected' ? tn(e.tools.length, '{n} tool', '{n} tools') : e.error || e.status}`).join(' · '), action: [t('Plugins'), () => x.go('plugins')] });
    const o = full.ollama;
    tiles.push({
      id: 'ollama',
      label: 'Ollama',
      state: o?.ok ? (o.detail!.models.length ? 'on' : 'warn') : full.privacy?.localOnly ? 'error' : 'off',
      text: o?.ok ? `v${o.detail!.version || '?'} · ${tn(o.detail!.models.length, '{n} model', '{n} models')}${o.detail!.embedModelPresent ? ` · ${t('embeddings ready ({m})', { m: o.detail!.embedModel })}` : ` · ${t('embedding model missing: ollama pull {m}', { m: o.detail!.embedModel })}`}` : t('not running (optional, for local models and semantic search)'),
    });
    tiles.push({ id: 'terminal', label: t('Terminal'), state: full.terminal?.pty ? 'on' : 'warn', text: full.terminal?.pty ? t('full PTY (node-pty)') : t('line mode (node-pty missing)') });
    const d = full.disk?.detail;
    if (d) tiles.push({ id: 'disk', label: t('Disk'), state: d.free / d.total < 0.05 ? 'error' : d.free / d.total < 0.12 ? 'warn' : 'on', text: `${formatBytes(d.free)} ${t('free of')} ${formatBytes(d.total)}` });
    if (full.system) tiles.push({ id: 'memory', label: t('System memory'), state: full.system.freemem / full.system.totalmem < 0.08 ? 'warn' : 'on', text: `${formatBytes(full.system.freemem)} ${t('free of')} ${formatBytes(full.system.totalmem)} · ${full.system.cpus} CPU`, action: [t('Monitor'), () => x.go('monitor')] });
    if (full.search) tiles.push({ id: 'search', label: t('Search index'), state: 'on', text: `${tn(full.search.files, '{n} file', '{n} files')} · ${full.search.chunks} ${t('passages')}${full.search.embeddings ? ` · ${full.search.vectors} ${t('vectors')}` : ''}`, action: [t('Search'), () => x.go('search')] });
    tiles.push({ id: 'privacy', label: t('Privacy'), state: full.privacy?.localOnly ? 'local' : 'on', text: full.privacy?.localOnly ? t('local-only mode: cloud blocked') : t('cloud providers allowed') + (full.privacy?.audit ? ` · ${t('audit log on')}` : ''), action: [t('Privacy'), () => x.go('privacy')] });
  }
  for (const b of browser) tiles.push(b);
  const readyApps = APPS.filter((a) => AVAILABLE.has(a.id)).length;
  const artReady = APPS.filter((a) => a.origin === 'artcraft' && AVAILABLE.has(a.id)).length;
  const comReady = APPS.filter((a) => a.origin === 'community' && AVAILABLE.has(a.id)).length;
  const pgReady = APPS.filter((a) => a.origin === 'independent' && AVAILABLE.has(a.id)).length;
  tiles.push({
    id: 'builds',
    label: t('WebAssembly app builds'),
    state: readyApps === APPS.length ? 'on' : readyApps > 0 ? 'warn' : 'error',
    text: `${readyApps} / ${APPS.length} ${t('ready')} · ArtCraft ${artReady} · ${t('Community apps')} ${comReady} · ${t('Independent apps')} ${pgReady}`,
    action: [t('Status'), () => x.go('status')],
  });
  const ok = tiles.filter((x) => x.state === 'on' || x.state === 'local').length;
  const bad = tiles.filter((x) => x.state === 'error').length;
  return section(
    t('Health check'),
    t('Everything'),
    t('at a glance'),
    h('p.muted', t('{ok} of {n} checks are fine{bad}. Backend, MCP, WebAssembly, WebGPU, service worker and Ollama in one place.', { ok, n: tiles.length, bad: bad ? `, ${tn(bad, '{n} needs attention', '{n} need attention')}` : '' })),
    h(
      'div.hc-grid',
      ...tiles.map((tile) =>
        h('div.frame.sm.hc-tile', { 'data-check': tile.id, 'data-state': tile.state }, h('div.well', h('div.hc-head', dot(tile.state === 'on' ? 'on' : tile.state, tile.label)), h('p.hc-text.mono', tile.text), tile.action ? h('button.btn.ghost.sm', { type: 'button', onclick: tile.action[1] }, tile.action[0]) : null))
      )
    ),
    h('div.sp-actions', btn(t('Run the checks again'), 'refresh', () => x.render(), '.primary', 'health-run'), full?.ms !== undefined ? h('small.muted', t('Backend checks took {ms} ms', { ms: full.ms })) : null)
  );
}
const fmtUptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);

// ---------------------------------------------------------------- Memory and GPU monitor

async function monitorSection(x: ExtraContext): Promise<HTMLElement> {
  const host = h('div.mon');
  const paint = async () => {
    const rows = workspace.resources();
    const be = backend.browser ? null : await load<{ rss: number; heapUsed: number; freemem: number; totalmem: number; uptime: number }>('/api/health/resources');
    const pm = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const devMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const loaded = rows.filter((r) => r.status === 'active');
    const wasm = loaded.reduce((n, r) => n + (r.res?.wasm || 0), 0);
    const gpu = loaded.reduce((n, r) => n + (r.res?.gpu || 0), 0);
    const budget = (devMem ? devMem * 1024 ** 3 : be?.totalmem || 8 * 1024 ** 3) * 0.5;
    const tight = wasm + gpu > budget * 0.7;
    const maxRow = Math.max(1, ...loaded.map((r) => (r.res?.wasm || 0) + (r.res?.gpu || 0)));
    host.replaceChildren(
      tight ? note(t('Memory is getting tight: the loaded apps use {n}. Unload apps you do not need, or use the emergency stop.', { n: formatBytes(wasm + gpu) }), true) : h('span'),
      h(
        'div.sp-kpis',
        kpi(t('WebAssembly memory'), formatBytes(wasm)),
        kpi(t('GPU memory (estimate)'), '≈ ' + formatBytes(gpu)),
        kpi(t('Tab JS heap'), pm ? `${formatBytes(pm.usedJSHeapSize)}` : t('not measurable')),
        kpi(t('Backend'), be ? formatBytes(be.rss) : '–'),
        kpi(t('Device memory'), devMem ? `${devMem} GB` : be ? `${formatBytes(be.freemem)} ${t('free')}` : '–')
      ),
      h(
        'div.mon-table',
        h('div.mon-row.mon-head.eyebrow', h('span', t('Panel')), h('span', t('State')), h('span', 'WASM'), h('span', 'GPU'), h('span', t('Start')), h('span')),
        ...rows
          .filter((r) => isApp(r.tool) || r.status === 'active')
          .map((r) => {
            const total = (r.res?.wasm || 0) + (r.res?.gpu || 0);
            const state = r.status === 'active' ? (r.paused ? t('paused') : r.visible ? t('running') : t('hidden, running')) : r.status === 'unloaded' ? t('unloaded') : t('not loaded');
            return h(
              'div.mon-row',
              { 'data-panel': r.id, 'data-status': r.status },
              h('strong', r.name, r.path ? h('small.mono.muted', ' ' + r.path.split('/').pop()) : null),
              h('span', state, r.unsaved ? h('small.sp-err', ' ' + t('unsaved')) : null),
              h('span.mono', r.res ? formatBytes(r.res.wasm) : '–', r.res ? bar(total, maxRow) : null),
              h('span.mono', r.res ? `≈ ${formatBytes(r.res.gpu)}${r.res.gpuApi ? ` ${r.res.gpuApi}` : ''}` : '–'),
              h('span.mono', r.loadMs ? `${(r.loadMs / 1000).toFixed(1)} s` : '–'),
              r.status === 'active' && isApp(r.tool)
                ? h('button.btn.ghost.danger.sm', {
                    type: 'button',
                    'data-action': 'kill-panel',
                    title: t('Unload at once and free WebAssembly and GPU memory'),
                    onclick: async () => {
                      if (r.unsaved && !(await confirmDanger(t('Kill {name}', { name: r.name }), t('{name} has unsaved changes. They are lost.', { name: r.name }), t('Kill panel')))) return;
                      await workspace.unload(r.id, { force: true });
                      toast(t('{name} unloaded, memory freed', { name: r.name }), 'success');
                      void paint();
                    },
                    html: icon('power', { size: 13 }) + `<span>${t('Kill')}</span>`,
                  })
                : h('span')
            );
          })
      ),
      h(
        'div.sp-actions',
        h('button.btn.danger', {
          type: 'button',
          'data-action': 'kill-all',
          onclick: async () => {
            const active = workspace.resources().filter((r) => r.status === 'active' && isApp(r.tool));
            if (!active.length) return toast(t('No app is loaded'), 'info');
            const unsaved = active.filter((r) => r.unsaved).map((r) => r.name);
            if (!(await confirmDanger(t('Emergency stop'), unsaved.length ? t('Unloads every app at once. Unsaved changes in {list} are lost.', { list: unsaved.join(', ') }) : t('Unloads every app at once and frees their memory. A click on a panel loads it again.'), t('Stop all apps')))) return;
            for (const r of active) await workspace.unload(r.id, { force: true });
            toast(tn(active.length, '{n} app stopped', '{n} apps stopped'), 'success');
            void paint();
          },
          html: icon('power', { size: 14 }) + `<span>${t('Emergency stop: unload all apps')}</span>`,
        }),
        btn(t('Unload hidden apps'), 'eyeOff', async () => {
          for (const r of workspace.resources().filter((r) => r.status === 'active' && !r.visible && isApp(r.tool))) await workspace.unload(r.id);
          void paint();
        }),
        h('small.muted', t('Updates every two seconds. GPU values are estimates from the buffers and textures the apps create.'))
      ),
      governorControls()
    );
  };
  await paint();
  const timer = setInterval(() => (x.visible('monitor') && host.isConnected ? void paint() : clearInterval(timer)), 2000);
  return section(t('Memory and GPU'), t('Resources'), t('per app'), h('p.muted', t('How much WebAssembly and GPU memory each app uses right now, with an emergency stop for weaker devices.')), host);
}
const kpi = (label: string, value: string) => h('div.sp-kpi.frame.sm', h('div.well', h('span.muted', label), h('strong.mono', value)));

/** Memory governor (src/ipados/memory.ts): switch and budget. Hidden, saved apps are unloaded before Safari ends the tab. */
function governorControls(): HTMLElement {
  const mode = h<'select'>('select.input', { 'data-pref': 'memoryGovernor', 'aria-label': t('Memory guard') }, h('option', { value: 'auto' }, t('Automatic (on)')), h('option', { value: 'on' }, t('On')), h('option', { value: 'off' }, t('Off')));
  const action = h<'select'>('select.input', { 'data-pref': 'memoryAction', 'aria-label': t('When memory is high') }, h('option', { value: 'auto' }, t('Unload hidden, saved apps by itself')), h('option', { value: 'ask' }, t('Ask me first')), h('option', { value: 'warn' }, t('Only warn me')));
  action.value = prefs.get('memoryAction');
  action.onchange = () => prefs.set('memoryAction', action.value as 'auto' | 'ask' | 'warn');
  mode.value = prefs.get('memoryGovernor');
  mode.onchange = () => prefs.set('memoryGovernor', mode.value as 'auto' | 'on' | 'off');
  const budget = h<'input'>('input.input.mono', { type: 'number', min: '0', step: '50', value: String(prefs.get('memoryBudgetMb')), 'data-pref': 'memoryBudgetMb', 'aria-label': t('Memory budget in MB') });
  budget.onchange = () => prefs.set('memoryBudgetMb', Math.max(0, Math.round(Number(budget.value) || 0)));
  const s = ipados.state;
  const mb = (n: number) => `${Math.round(n / 1048576)} MB`;
  return card(
    t('Memory guard'),
    t('all devices'),
    h('p.muted', t('The guard watches the memory of the apps and how fast the page answers. When memory passes the limit, or the page stays slow, it unloads apps that are hidden and saved, the least recently shown first (Safari ends an iPad tab without a message). It never touches a visible app. An app with unsaved changes is never unloaded without a question: you get a notice, and the button saves it first.')),
    h('div.sp-grid', h('label.field', h('span', t('Guard')), mode), h('label.field', h('span', t('When memory is high')), action), h('label.field', h('span', t('Budget in MB (0 = automatic)')), budget)),
    s.memory ? h('small.muted.mono', `${t('now')}: ${s.memory.level}${s.memory.lag !== 'ok' ? ` · ${t('page')} ${s.memory.lag}` : ''} · ${mb(s.memory.usage)} / ${mb(s.memory.budget.act)}`) : h('small.muted', s.governor === 'on' ? t('Watching. Nothing to report yet.') : t('Off.')),
    s.memory?.events?.length
      ? h('ul.mem-events', ...[...s.memory.events].reverse().slice(0, 8).map((e) => h('li', h('time.mono.muted', new Date(e.at).toLocaleTimeString()), ' ', e.text)))
      : h('small.muted', t('Nothing was unloaded yet.'))
  );
}

// ---------------------------------------------------------------- Privacy: local-only mode and wipe

async function privacySection(x: ExtraContext): Promise<HTMLElement> {
  const cfg = x.cfg();
  const on = !!cfg.privacy?.localOnly;
  const st = await aiConfig.status(true).catch(() => null);
  const blocked = st?.providers.filter((p) => !p.local) || [];
  const allowed = st?.providers.filter((p) => p.local) || [];
  const toggle = h<'input'>('input', { type: 'checkbox', checked: on, 'data-local-only': '', role: 'switch', 'aria-label': t('Local-only mode') });
  toggle.onchange = async () => {
    try {
      x.setCfg(await aiConfig.put('privacy', { localOnly: toggle.checked }));
      await aiConfig.changed();
      toast(toggle.checked ? t('Local-only mode on') : t('Local-only mode off'), toggle.checked ? 'success' : 'info', toggle.checked ? t('Only Ollama, local endpoints and local files. Cloud providers are blocked.') : privacy.needsReload ? t('Reload the page so this browser may reach cloud providers again.') : undefined);
      x.render();
    } catch (e) {
      notifyError(e);
      toggle.checked = !toggle.checked;
    }
  };
  const big = h(
    'div.frame.lo-card' + (on ? '.is-on' : ''),
    { 'data-card': 'local-only' },
    h(
      'div.well',
      h('div.lo-head', h('span.lo-icon', { html: icon(on ? 'lock' : 'globe', { size: 26 }) }), h('div', h('h3.duo', t('Local-only mode') + ' ', h('span.tone', on ? t('on') : t('off'))), h('p.muted', on ? t('Nothing goes to the cloud. Only Ollama, endpoints on this computer or in the home network, and the local files.') : t('Switch it on to block every cloud provider at once: Claude, ChatGPT, Gemini, DeepSeek and remote endpoints.'))), h('label.lo-switch', toggle, h('span.lo-track', h('span.lo-thumb')))),
      h('div.lo-lists', h('div', h('p.eyebrow', on ? t('Blocked') : t('Would be blocked')), h('p.mono', blocked.map((p) => p.name).join(', ') || '–')), h('div', h('p.eyebrow', t('Allowed')), h('p.mono', allowed.map((p) => p.name).join(', ') || 'Ollama'))),
      h('p.muted.small', t('The backend refuses cloud requests, connection tests and remote MCP servers. In the browser a strict content security policy also blocks connections to other hosts.'))
    )
  );
  const audit = await load<{ local: boolean; at: string; destination: string }[]>('/api/audit?cloud=1&limit=1000');
  const week = (audit || []).filter((e) => Date.now() - Date.parse(e.at) < 7 * 86400_000);
  const hosts = [...new Set(week.map((e) => e.destination))];

  // ---------- One-click wipe ----------
  const opts = { keys: true, projects: true, usage: true, audit: true, personal: true, plugins: false };
  const word = t('DELETE');
  const confirmIn = h<'input'>('input.input.mono', { placeholder: word, autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Type {word} to confirm', { word }), 'data-field': 'wipe-confirm' });
  const wipeBtn = h<'button'>('button.btn.danger', { type: 'button', disabled: true, 'data-action': 'wipe', html: icon('trash', { size: 14 }) + `<span>${t('Delete everything now')}</span>` });
  confirmIn.oninput = () => (wipeBtn.disabled = confirmIn.value.trim().toUpperCase() !== word.toUpperCase());
  wipeBtn.onclick = async () => {
    wipeBtn.disabled = true;
    try {
      const r = await api.send<{ done: string[] }>('POST', '/api/wipe', { confirm: 'WIPE', ...opts, chats: true });
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('workcraft')) localStorage.removeItem(k);
      } catch {
        /* storage blocked */
      }
      toast(t('Everything deleted'), 'success', r.done.join(', '));
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      notifyError(e);
      wipeBtn.disabled = false;
    }
  };
  const optSw = (k: keyof typeof opts, label: string) => sw(opts[k], label, (v) => void (opts[k] = v), undefined, { 'data-wipe': k });
  const wipe = h(
    'div.frame.sp-card.sp-danger',
    { 'data-card': 'wipe' },
    h(
      'div.well',
      h('div.sp-card-head', h('h3.duo', t('One-click wipe') + ' ', h('span.tone', t('for demo devices and handing over')))),
      h('p.muted', t('Deletes securely: files are overwritten with random data before they are removed. On SSDs and with backups old blocks can remain; for those, encrypt the drive.')),
      h('div.sp-toggles', optSw('keys', t('API keys, own endpoints and the home-network token')), optSw('projects', t('All projects with their chats, snapshots and the trash')), optSw('usage', t('Usage statistics and metrics')), optSw('audit', t('Audit log and logs')), optSw('personal', t('Personal context and personas')), optSw('plugins', t('Plugins and MCP servers'))),
      h('label.field', h('span', t('Type {word} to confirm', { word })), confirmIn),
      h('div.sp-actions', wipeBtn, h('small.muted', backend.browser ? t('Browser mode: deletes all data of this browser.') : t('A fresh sample project is created afterwards.')))
    )
  );
  return section(
    t('Privacy'),
    t('Trust'),
    t('and control'),
    big,
    card(
      t('What left the device'),
      t('last 7 days'),
      h('p.muted', week.length ? t('{n} requests went to {hosts}. Only metadata is logged: destination, model, sizes and the names of attached files.', { n: week.length, hosts: hosts.join(', ') }) : t('No request left this device in the last 7 days.')),
      sw(cfg.privacy?.audit !== false, t('Keep the audit log'), async (v) => x.setCfg(await aiConfig.put('privacy', { audit: v })), t('(metadata only, never content)')),
      h('div.sp-actions', btn(t('Open the audit log'), 'shield', () => x.go('audit'), '.primary'))
    ),
    note(h('p', t('API keys stay on this computer in ~/workcraft/config.json and reach the frontend only masked. Requests to cloud models carry your prompt and the attached content to that provider; local models keep everything here.') + ' ', h('a', { href: '../docs/#privacy', target: '_blank', rel: 'noopener' }, t('Read the privacy guide')))),
    wipe
  );
}

// ---------------------------------------------------------------- Audit log

interface AuditRow {
  id: string;
  at: string;
  kind: string;
  destination: string;
  local: boolean;
  provider?: string;
  model?: string;
  bytes: number;
  files: { name: string; kind: string; size: number }[];
  images: number;
  status: string;
  tokens?: { input: number; output: number };
  note?: string;
}

async function auditSection(x: ExtraContext): Promise<HTMLElement> {
  let cloudOnly = true;
  let query = '';
  const statsHost = h('div.sp-kpis');
  const body = h('div');
  let cachedList: AuditRow[] = [];
  const renderRows = () => {
    const q = query.trim().toLowerCase();
    const list = cachedList.filter((e) => !q || `${e.destination} ${e.provider || ''} ${e.model || ''} ${e.kind} ${e.status} ${e.files.map((f) => f.name).join(' ')}`.toLowerCase().includes(q));
    const cloudCount = cachedList.filter((e) => !e.local).length;
    const localCount = cachedList.filter((e) => e.local).length;
    const blockedCount = cachedList.filter((e) => e.status === 'blocked').length;
    const totalBytes = cachedList.reduce((acc, e) => acc + (e.bytes || 0), 0);
    statsHost.replaceChildren(
      kpi(t('Requests'), String(cachedList.length)),
      kpi(t('Cloud'), String(cloudCount)),
      kpi(t('Local'), String(localCount)),
      kpi(t('Blocked'), String(blockedCount)),
      kpi(t('Sent'), formatBytes(totalBytes))
    );
    body.replaceChildren(
      list.length
        ? h(
            'div.usage-table.audit-table',
            h(
              'table',
              h('thead', h('tr', h('th', t('Time')), h('th', t('Destination')), h('th', t('Provider and model')), h('th', t('Sent')), h('th', t('Files (names only)')), h('th', t('Result')))),
              h(
                'tbody',
                ...list.map((e) =>
                  h(
                    'tr',
                    { 'data-kind': e.kind, 'data-local': String(e.local), 'data-status': e.status },
                    h('td.mono', when(e.at)),
                    h('td', h('span.pill.mono' + (e.local ? '.is-local' : '.is-cloud'), e.local ? t('local') : t('cloud')), ' ', h('span.mono', e.destination)),
                    h('td', [e.provider, e.model].filter(Boolean).join(' · ') || e.kind, e.note ? h('small.muted', ' ' + e.note) : null),
                    h('td.mono', e.bytes ? formatBytes(e.bytes) : '–', e.images ? h('small.muted', ' · ' + tn(e.images, '{n} image', '{n} images')) : null),
                    h('td', e.files.length ? h('span.mono', e.files.map((f) => f.name).join(', ')) : h('span.muted', '–')),
                    h('td', h('span.audit-status', { 'data-status': e.status }, e.status === 'blocked' ? t('blocked') : e.status === 'ok' ? t('sent') : t('error')), e.tokens ? h('small.mono.muted', ` ↑${e.tokens.input} ↓${e.tokens.output}`) : null)
                  )
                )
              )
            )
          )
        : h('p.muted.sp-empty', cloudOnly ? t('Nothing left this device so far.') : t('The audit log is empty.'))
    );
  };
  const paint = async () => {
    cachedList = (await load<AuditRow[]>(`/api/audit?limit=500${cloudOnly ? '&cloud=1' : ''}`)) || [];
    renderRows();
  };
  await paint();
  const findIn = h<'input'>('input.input.sm', { type: 'search', placeholder: t('Filter'), 'aria-label': t('Filter') });
  findIn.oninput = () => {
    query = findIn.value;
    renderRows();
  };
  const seg = h(
    'div.seg',
    { role: 'group', 'aria-label': t('Filter') },
    ...([
      [true, t('Left the device')],
      [false, t('Everything, also local')],
    ] as const).map(([v, label]) =>
      h('button.seg-btn', {
        type: 'button',
        'aria-pressed': String(v === cloudOnly),
        'data-filter': v ? 'cloud' : 'all',
        onclick: (e: MouseEvent) => {
          cloudOnly = v;
          for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          void paint();
        },
      }, label)
    )
  );
  return section(
    t('Audit log'),
    t('What left'),
    t('this device?'),
    h('p.muted', t('Every request to Claude, ChatGPT, Gemini, DeepSeek or your own endpoints, every blocked attempt, local embeddings, home-network shares and syncs. Only metadata: destination, model, request size and the names and sizes of attached files, never their content.')),
    statsHost,
    h('div.sp-actions', seg, findIn, h('span.spacer'), btn(t('Export CSV'), 'download', async () => downloadBlob(new Blob([await api.text('/api/audit/export')], { type: 'text/csv' }), 'workcraft-audit.csv')), btn(t('Refresh'), 'refresh', () => paint())),
    body,
    h(
      'div.sp-actions',
      h('button.btn.ghost.danger', {
        type: 'button',
        onclick: async () => {
          if (!(await confirmDanger(t('Clear the audit log'), t('All entries are deleted.'), t('Clear')))) return;
          await api.send('DELETE', '/api/audit');
          void paint();
        },
        html: icon('trash', { size: 14 }) + `<span>${t('Clear the audit log')}</span>`,
      }),
      x.cfg().privacy?.audit === false ? h('small.sp-err', t('The audit log is switched off under Privacy.')) : null
    )
  );
}

// ---------------------------------------------------------------- Personal context and personas

// ---------------------------------------------------------------- Team Mode

/**
 * Team Mode: the Team Leader and the specialist sub-agents with their providers, models and effort,
 * presets and saved teams, plus the usage per role across all chats.
 */
async function teamSection(x: ExtraContext): Promise<HTMLElement> {
  const [{ teamEditor, roleUsageTable, roleIcon }, status, store] = await Promise.all([import('../../chat/team-ui.js'), aiConfig.status().catch(() => null), api.get<{ roles?: Record<string, import('../../chat/usage.js').RoleUsage>; rates: Record<string, import('../../chat/usage.js').Rate> }>('/api/usage').catch(() => null)]);
  void x;
  const roles = store?.roles && Object.keys(store.roles).length ? roleUsageTable(store.roles, store.rates) : h('p.muted', t('No team runs yet. Usage per role appears here after the first Team Mode answer.'));
  const roleEntries = Object.entries(ROLE_DEFS);
  const roleCards = h(
    'div.sp-kvs',
    ...roleEntries.map(([id, def]) =>
      h(
        'div.sp-kv',
        { 'data-role': id },
        h(
          'span.sp-app',
          h('span.team-role-ic', { style: `--agent:${def.accent}`, html: roleIcon(id, 16) }),
          h('strong', t(def.name)),
          h('small.mono.muted', ` @${def.mention}`)
        ),
        h('span.muted', t(def.scope))
      )
    )
  );
  return h(
    'div.sp-section.sp-team',
    h('p.eyebrow', t('Team Mode')),
    h('h2.duo', t('Your AI team') + ' ', h('span.tone', t('leader and specialists'))),
    h('p.muted', t('In Team Mode a Team Leader breaks the prompt into a task graph, specialist sub-agents work on independent tasks at the same time, and the leader reviews every result before it writes the answer. Mix providers freely, for example a cloud leader with fast local specialists.')),
    h('div.frame.sm.sp-team-frame', h('div.well', teamEditor({ providers: status?.providers || [] }))),
    card(t('Agents of the team'), String(roleEntries.length), roleCards),
    h('p.eyebrow', t('Usage per role, all chats')),
    roles
  );
}

/** Rough token count of a text (4 characters per token), for the "what every request carries" number. */
const roughTokens = (s: string) => Math.ceil(s.length / 4);

const CONTEXT_ID = /^[\w-]{2,40}$/;

async function personalSection(x: ExtraContext): Promise<HTMLElement> {
  const pc = x.cfg().personal || { context: '', active: 'default', personas: [], contexts: [], contextActive: '' };
  let personas: Persona[] = structuredClone(pc.personas);
  let contexts: ContextEntry[] = structuredClone(pc.contexts || []);
  let query = '';
  let group = 'all';
  const activeId = () => aiConfig.config?.personal.active || pc.active;
  const contextId = () => aiConfig.config?.personal.contextActive ?? pc.contextActive ?? '';
  const suited = new Set(activeApps());

  const ctxIn = h<'textarea'>('textarea.input', { rows: 4, placeholder: t('For example: I run a small design studio in Berlin. Answer in German, use euros, keep slides short.'), 'data-field': 'personal-context' });
  ctxIn.value = pc.context;
  const list = h('div.persona-list');
  const ctxList = h('div.persona-list.context-list');
  const preview = h('pre.mono.sp-pre.persona-preview');
  const kpis = h('div.sp-kpis');

  const save = async (patch: Record<string, unknown>, msg = t('Saved')) => {
    try {
      x.setCfg(await aiConfig.put('personal', patch));
      toast(msg, 'success');
    } catch (e) {
      notifyError(e);
    }
  };
  const personasPatch = () => ({ personas: personas.map((p) => ({ ...p, name: p.name.trim() || t('Persona') })), contexts: contexts.map((c) => ({ ...c, name: c.name.trim() || t('Context') })) });

  /** The exact text that goes into every request, and what it costs. */
  const paintSummary = () => {
    const text = personalPrompt({ context: ctxIn.value, active: activeId(), personas, contexts, contextActive: contextId() });
    preview.textContent = text || t('Nothing: no persona, no context. The assistant works without an extra role.');
    const p = personas.find((y) => y.id === activeId());
    const c = contexts.find((y) => y.id === contextId());
    kpis.replaceChildren(
      kpi(t('Persona'), !p || p.id === 'default' ? t('None') : p.name),
      kpi(t('Context'), c ? c.name : t('None')),
      kpi(t('Added to every request'), text ? `~${roughTokens(text)} ${t('tokens')}` : '0')
    );
  };
  ctxIn.addEventListener('input', paintSummary);

  const suggested = (p: Persona) => !!p.apps?.some((a) => suited.has(a as never));
  const categoryOf = (p: Persona) => (p.id === 'default' ? '' : p.category || 'Yours');

  const paintPersonas = () => {
    const q = query.trim().toLowerCase();
    const shown = personas.filter((p) => {
      if (p.id === 'default') return group === 'all' && !q;
      if (group === 'suggested' && !suggested(p)) return false;
      if (group !== 'all' && group !== 'suggested' && categoryOf(p) !== group) return false;
      return !q || `${p.name} ${p.description || ''} ${p.prompt} ${p.id}`.toLowerCase().includes(q);
    });
    if (!shown.length) return void list.replaceChildren(h('p.muted', t('No persona matches. Clear the search or add your own below.')));
    list.replaceChildren(
      ...shown.map((p) => {
        const i = personas.findIndex((y) => y.id === p.id);
        const name = h<'input'>('input.input', { value: p.name, 'aria-label': t('Name') });
        const desc = h<'input'>('input.input', { value: p.description || '', placeholder: t('When to use it (one line)'), 'aria-label': t('Description') });
        const prompt = h<'textarea'>('textarea.input', { rows: 4, placeholder: t('System prompt of this role'), 'aria-label': t('System prompt') });
        prompt.value = p.prompt;
        name.oninput = () => (personas[i] = { ...personas[i]!, name: name.value });
        desc.oninput = () => (personas[i] = { ...personas[i]!, description: desc.value });
        prompt.oninput = () => ((personas[i] = { ...personas[i]!, prompt: prompt.value }), paintSummary());
        const active = activeId() === p.id;
        const original = DEFAULT_PERSONAS.find((d) => d.id === p.id);
        const edited = !!original && (original.prompt !== p.prompt || original.name !== p.name);
        const apps = (p.apps || []).filter((a) => APPS.some((c) => c.id === a));
        return h(
          'div.frame.sm.persona' + (active ? '.is-active' : ''),
          { 'data-persona': p.id },
          h(
            'div.well',
            h(
              'div.sp-card-head',
              h('strong', p.id === 'default' ? t('No persona') : p.name || t('New persona')),
              p.id === 'default' ? null : h('span.pill.mono', t(categoryOf(p))),
              suggested(p) ? h('span.pill.mono', t('suits this workspace')) : null,
              h('small.mono.muted', '/persona ' + p.id),
              h('span.spacer'),
              active ? h('span.pill.mono', t('active')) : h('button.btn.ghost.sm', { type: 'button', onclick: () => void save({ active: p.id }, t('Persona: {name}', { name: p.name })).then(() => x.render()) }, t('Use'))
            ),
            p.id === 'default'
              ? h('p.muted', t('The AI works without an extra role.'))
              : h(
                  'div',
                  p.description ? h('p.muted', p.description) : null,
                  apps.length ? h('div.sp-actions', ...apps.map((a) => h('span.pill.mono', { title: APPS.find((c) => c.id === a)?.name }, APPS.find((c) => c.id === a)?.name || a))) : null,
                  h(
                    'details.persona-edit',
                    h('summary', t('Edit')),
                    h('div.sp-grid', h('label.field', h('span', t('Name')), name), h('label.field', h('span', t('Description')), desc)),
                    h('label.field', h('span', t('System prompt')), prompt),
                    h(
                      'div.sp-actions',
                      h('small.muted', `~${roughTokens(p.prompt)} ${t('tokens')}`),
                      h('span.spacer'),
                      h('button.btn.ghost.sm', { type: 'button', 'data-action': 'persona-copy', onclick: () => ((personas = [...personas, { ...p, id: `${p.id.slice(0, 28)}-${uid('').slice(-4)}`, name: `${p.name} ${t('copy')}`, builtIn: false, category: 'Yours' }]), paintPersonas()) }, t('Duplicate')),
                      edited ? h('button.btn.ghost.sm', { type: 'button', onclick: () => ((personas[i] = { ...original!, builtIn: true }), paintPersonas(), paintSummary()) }, t('Reset to the original')) : null,
                      p.builtIn ? null : h('button.btn.ghost.danger.sm', { type: 'button', onclick: () => ((personas = personas.filter((y) => y.id !== p.id)), paintPersonas(), paintSummary()) }, t('Remove'))
                    )
                  )
                )
          )
        );
      })
    );
  };

  const paintContexts = () =>
    ctxList.replaceChildren(
      ...(contexts.length ? contexts : [null]).map((c) => {
        if (!c) return h('p.muted', t('No named contexts yet. Add one for a client, a project or a subject, and switch between them in the chat header or with /context.'));
        const i = contexts.findIndex((y) => y.id === c.id);
        const name = h<'input'>('input.input', { value: c.name, 'aria-label': t('Name') });
        const text = h<'textarea'>('textarea.input', { rows: 3, placeholder: t('Facts the AI should know while this context is in use'), 'aria-label': t('Context') });
        text.value = c.text;
        name.oninput = () => (contexts[i] = { ...contexts[i]!, name: name.value });
        text.oninput = () => ((contexts[i] = { ...contexts[i]!, text: text.value }), paintSummary());
        const active = contextId() === c.id;
        return h(
          'div.frame.sm.persona' + (active ? '.is-active' : ''),
          { 'data-context': c.id },
          h(
            'div.well',
            h('div.sp-card-head', h('strong', c.name || t('New context')), h('small.mono.muted', '/context ' + c.id), h('span.spacer'), active ? h('button.btn.ghost.sm', { type: 'button', onclick: () => void save({ contextActive: '' }, t('No context')).then(() => x.render()) }, t('Switch off')) : h('button.btn.ghost.sm', { type: 'button', onclick: () => void save({ ...personasPatch(), contextActive: c.id }, t('Context: {name}', { name: c.name })).then(() => x.render()) }, t('Use'))),
            h('label.field', h('span', t('Name')), name),
            h('label.field', h('span', t('Context')), text),
            h('div.sp-actions', h('small.muted', `~${roughTokens(c.text)} ${t('tokens')}`), h('span.spacer'), h('button.btn.ghost.danger.sm', { type: 'button', onclick: () => ((contexts = contexts.filter((y) => y.id !== c.id)), paintContexts(), paintSummary()) }, t('Remove')))
          )
        );
      })
    );

  /** Personas and contexts you made, as one file (the built-in personas are in the program). */
  const exportAll = () => {
    const mine = personas.filter((p) => !p.builtIn);
    const changed = personas.filter((p) => p.builtIn && DEFAULT_PERSONAS.some((d) => d.id === p.id && (d.prompt !== p.prompt || d.name !== p.name)));
    downloadBlob(new Blob([JSON.stringify({ workcraft: 'personas', version: 1, context: ctxIn.value, personas: [...mine, ...changed], contexts }, null, 2)], { type: 'application/json' }), 'workcraft-personas.json');
  };
  const importAll = async (file: File) => {
    try {
      const j = JSON.parse(await file.text()) as { workcraft?: string; personas?: Persona[]; contexts?: ContextEntry[]; context?: string };
      if (j.workcraft !== 'personas') throw new Error(t('This is not a WorkCraft personas file.'));
      const okP = (j.personas || []).filter((p) => p && CONTEXT_ID.test(p.id) && typeof p.name === 'string' && typeof p.prompt === 'string' && p.prompt.length <= 8000).slice(0, 60);
      const okC = (j.contexts || []).filter((c) => c && CONTEXT_ID.test(c.id) && typeof c.name === 'string' && typeof c.text === 'string' && c.text.length <= 8000).slice(0, 40);
      for (const p of okP) personas = [...personas.filter((y) => y.id !== p.id), { id: p.id, name: p.name.slice(0, 60), prompt: p.prompt, ...(p.builtIn ? { builtIn: true } : {}), ...(p.category ? { category: p.category.slice(0, 30) } : {}), ...(p.description ? { description: p.description.slice(0, 160) } : {}) }];
      for (const c of okC) contexts = [...contexts.filter((y) => y.id !== c.id), { id: c.id, name: c.name.slice(0, 60), text: c.text }];
      if (typeof j.context === 'string' && !ctxIn.value.trim()) ctxIn.value = j.context.slice(0, 8000);
      paintPersonas();
      paintContexts();
      paintSummary();
      toast(t('Imported {a} personas and {b} contexts. Save to keep them.', { a: String(okP.length), b: String(okC.length) }), 'success');
    } catch (e) {
      notifyError(e);
    }
  };
  const pick = h<'input'>('input', { type: 'file', accept: '.json,application/json', hidden: true });
  pick.onchange = () => pick.files?.[0] && void importAll(pick.files[0]).then(() => (pick.value = ''));

  const search = h<'input'>('input.input', { type: 'search', placeholder: t('Search personas'), 'aria-label': t('Search personas'), 'data-field': 'persona-search' });
  search.oninput = () => ((query = search.value), paintPersonas());
  const groups = h('div.sp-actions.persona-groups');
  const paintGroups = () => {
    const hasSuggested = personas.some(suggested);
    const cats = [['all', t('All')], ...(hasSuggested ? [['suggested', t('For this workspace')]] : []), ...PERSONA_CATEGORIES.map((c) => [c, t(c)]), ['Yours', t('Yours')]] as [string, string][];
    groups.replaceChildren(...cats.map(([id, label]) => h('button.btn.sm' + (group === id ? '.primary' : '.ghost'), { type: 'button', 'data-group': id, onclick: () => ((group = id), paintGroups(), paintPersonas()) }, label)));
  };

  paintGroups();
  paintPersonas();
  paintContexts();
  paintSummary();
  return section(
    t('Personal context'),
    t('Personas'),
    t('and your context'),
    h('p.muted', t('A persona is a role (Financial analyst, Photo retoucher, Strict reviewer), a context is a set of facts (your studio, a client, a subject). Switch both in the chat header or with /persona and /context. Team Mode specialists use them too.')),
    kpis,
    card(t('About you'), t('always sent'), h('label.field', h('span', t('What the AI should always know about you')), ctxIn), h('div.sp-actions', h('button.btn.primary', { type: 'button', 'data-action': 'save-context', onclick: () => void save({ context: ctxIn.value.trim() }).then(() => paintSummary()) }, t('Save')), h('small.muted', t('Stays on this computer. It goes to the model of each chat, also to cloud models unless local-only mode is on.')))),
    card(
      t('Contexts'),
      t('switchable facts'),
      ctxList,
      h(
        'div.sp-actions',
        btn(t('Add context'), 'plus', () => {
          contexts.push({ id: uid('c').replace(/[^\w-]/g, '').slice(0, 12), name: t('New context'), text: '' });
          paintContexts();
        }),
        ...CONTEXT_TEMPLATES.map((tpl) =>
          h('button.btn.ghost.sm', { type: 'button', onclick: () => (contexts.some((c) => c.name === t(tpl.name)) ? undefined : (contexts.push({ id: `${tpl.id}-${uid('').slice(-4)}`, name: t(tpl.name), text: tpl.text }), paintContexts())) }, `+ ${t(tpl.name)}`)
        )
      )
    ),
    h('p.eyebrow.sp-sub', t('Personas')),
    h('div.sp-actions', search, h('span.spacer')),
    groups,
    list,
    h(
      'div.sp-actions',
      btn(t('Add persona'), 'plus', () => {
        personas.push({ id: uid('p').replace(/[^\w-]/g, '').slice(0, 12), name: t('New persona'), prompt: '', category: 'Yours' });
        group = 'Yours';
        paintGroups();
        paintPersonas();
      }),
      btn(t('Export'), 'download', exportAll),
      btn(t('Import'), 'upload', () => pick.click()),
      pick,
      h('span.spacer'),
      h('button.btn.primary', { type: 'button', 'data-action': 'save-personas', onclick: () => void save(personasPatch(), t('Personas saved')).then(() => x.render()) }, t('Save personas and contexts'))
    ),
    card(t('What every request carries'), t('exact text'), h('p.muted', t('This is added to the system prompt of every chat and of every Team Mode specialist. Short is cheaper.')), preview)
  );
}

// ---------------------------------------------------------------- Search and memory

interface SearchHit {
  source: string;
  kind: string;
  loc: string;
  snippet: string;
  score: number;
}

async function searchSection(x: ExtraContext): Promise<HTMLElement> {
  const sc = x.cfg().search || { embeddings: false, embedModel: 'nomic-embed-text', memory: true, ragChunks: 4 };
  const st = await load<{ phase: string; done: number; total: number; files: number; chunks: number; vectors: number; updated: string; error?: string; errors: { path: string; error: string }[]; browser?: boolean }>('/api/search/status');
  const notes = (await load<{ id: string; text: string; source: string; created: string }[]>('/api/memory')) || [];
  const put = async (patch: Record<string, unknown>) => {
    try {
      x.setCfg(await aiConfig.put('search', patch));
    } catch (e) {
      notifyError(e);
    }
  };
  const model = h<'input'>('input.input.mono', { value: sc.embedModel, 'aria-label': t('Embedding model'), spellcheck: 'false' });
  model.onchange = () => void put({ embedModel: model.value.trim() || 'nomic-embed-text' });
  const chunks = h<'select'>('select.input', { 'aria-label': t('Passages per question') }, ...[0, 2, 4, 6, 8].map((n) => h('option', { value: String(n), selected: sc.ragChunks === n }, n ? String(n) : t('none'))));
  chunks.onchange = () => void put({ ragChunks: Number(chunks.value) });
  const q = h<'input'>('input.input', { type: 'search', placeholder: t('Try: find the part with the revenue forecast'), 'data-field': 'search-q' });
  const results = h('div.search-results');
  q.onkeydown = async (e) => {
    if (e.key !== 'Enter' || !q.value.trim()) return;
    const r = await api.get<{ hits: SearchHit[]; mode: string; error?: string; ms?: number }>(`/api/search?q=${encodeURIComponent(q.value.trim())}&limit=8`).catch((err: Error) => ({ hits: [], mode: 'text', error: err.message }));
    results.replaceChildren(r.error ? h('small.muted', r.error) : h('span'), ...r.hits.map((hit) => hitRow(hit)));
  };
  const memList = h(
    'div.mem-list',
    ...(notes.length
      ? notes.map((n) =>
          h(
            'div.mem-row',
            { 'data-note': n.id },
            h('span', { html: icon(n.source === 'ai' ? 'spark' : 'pin', { size: 14 }) }),
            h('span', n.text),
            h('small.muted.mono', ago(n.created)),
            h('button.icon-btn', {
              type: 'button',
              'aria-label': t('Remove note'),
              html: icon('trash', { size: 14 }),
              onclick: async () => {
                await api.send('DELETE', `/api/memory/${n.id}`);
                x.render();
              },
            })
          )
        )
      : [h('p.muted.sp-empty', t('No notes yet. Use /remember in the chat or the Remember button under an answer.'))])
  );
  const noteIn = h<'input'>('input.input', { placeholder: t('New note, for example: prices are net, without VAT'), 'data-field': 'memory-note' });
  return section(
    t('Search and memory'),
    t('Find'),
    t('everything'),
    h('p.muted', t('Full-text search across Word, Excel, PowerPoint, PDF, Markdown, code and the chats. With embeddings from Ollama it also finds passages by meaning. Open it from the command palette (Ctrl/Cmd K) or the search button in the top bar.')),
    card(
      t('Search index'),
      st?.browser ? t('browser mode') : st?.phase === 'idle' ? t('ready') : t('working'),
      h('div.sp-kvs', kv(t('Files'), String(st?.files ?? '–')), kv(t('Passages'), String(st?.chunks ?? '–')), kv(t('Vectors'), sc.embeddings ? String(st?.vectors ?? 0) : t('off')), kv(t('Updated'), st?.updated ? ago(st.updated) : '–', false)),
      st?.error ? h('p.sp-err', st.error) : null,
      st?.errors?.length ? h('details', h('summary.muted', tn(st.errors.length, '{n} file could not be read', '{n} files could not be read')), ...st.errors.map((e) => h('div.mono.small', `${e.path}: ${e.error}`))) : null,
      h('div.sp-actions', btn(t('Rebuild the index'), 'refresh', async () => {
        await api.send('POST', '/api/search/reindex?force=1');
        toast(t('The index is being rebuilt'), 'info');
        setTimeout(() => x.visible('search') && x.render(), 2500);
      }, '', 'reindex'), btn(t('Open search'), 'search', () => bus.emit('search:open', undefined)))
    ),
    card(t('Semantic search'), sc.embeddings ? t('on') : t('off'), sw(sc.embeddings, t('Embeddings with Ollama'), (v) => put({ embeddings: v }).then(() => x.render()), t('(runs on this computer, nothing leaves it)'), { 'data-pref': 'embeddings' }), h('div.sp-grid', h('label.field', h('span', t('Embedding model')), model)), h('small.muted', t('Install the model once with: ollama pull {m}', { m: sc.embedModel }))),
    card(t('Try it'), t('search'), q, results),
    card(
      t('Project memory'),
      sc.memory ? t('on') : t('off'),
      h('p.muted', t('The chat keeps the context of this project on its own: your pinned notes and decisions, the latest AI steps and the most relevant passages from the files (RAG). Stored in the project, in .workcraft/memory.json and the local index.')),
      h('div.sp-grid', sw(sc.memory, t('Use the project memory in the chat'), (v) => put({ memory: v }), undefined, { 'data-pref': 'memory' }), h('label.field', h('span', t('Passages per question')), chunks)),
      memList,
      h('div.sp-inline', noteIn, btn(t('Remember'), 'pin', async () => {
        if (!noteIn.value.trim()) return;
        await api.send('POST', '/api/memory', { text: noteIn.value.trim() }).catch(notifyError);
        x.render();
      }, '.primary', 'add-note')),
      notes.length ? h('div.sp-actions', h('button.btn.ghost.danger.sm', { type: 'button', onclick: async () => (await confirmDanger(t('Clear the project memory'), t('All notes of this project are deleted.'), t('Clear'))) && (await api.send('DELETE', '/api/memory'), x.render()) }, t('Clear the project memory'))) : null
    )
  );
}

/** One search hit: opens the file in its app, or the chat. */
export function hitRow(hit: SearchHit, after?: () => void): HTMLElement {
  const chat = hit.source.startsWith('chat:');
  return h(
    'button.search-hit',
    {
      type: 'button',
      'data-source': hit.source,
      onclick: () => {
        if (chat) bus.emit('ai:toggle', true);
        else void workspace.openFile(hit.source);
        after?.();
      },
    },
    h('span.search-kind', { 'data-kind': hit.kind }, hit.kind),
    h('span.search-main', h('strong.mono', chat ? hit.loc : hit.source), h('small.muted', chat ? t('chat') : hit.loc), h('span.search-snippet', hit.snippet)),
    h('span.search-score.mono', `${Math.round(hit.score * 100)}`)
  );
}

// ---------------------------------------------------------------- History: snapshots and project graph

interface SnapRow {
  id: string;
  created: string;
  label: string;
  auto: boolean;
  chain?: string;
  fileCount: number;
  chatCount: number;
  bytes: number;
  skipped: string[];
}

async function historySection(x: ExtraContext): Promise<HTMLElement> {
  if (backend.browser) return section(t('History'), t('Snapshots'), t('and project graph'), desktopOnly(t('Snapshots and the project graph')));
  const data = await load<{ snapshots: SnapRow[]; store: { count: number; bytes: number } }>('/api/snapshots');
  const graph = await load<{ nodes: { path: string; versions: number; deleted?: string; last?: { at: string; tool?: string; origin: string } }[]; edges: { from: string; to: string; tool: string; at: string }[]; steps: { callId: string; tool: string; at: string; ms: number; ok: boolean; inputs: string[]; outputs: string[] }[] }>('/api/graph');
  const label = h<'input'>('input.input', { placeholder: t('Label, for example before the big rewrite'), 'data-field': 'snapshot-label' });
  const snaps = (data?.snapshots || []).map((s) =>
    h(
      'div.snap-row',
      { 'data-snapshot': s.id },
      h('span', { html: icon(s.auto ? 'spark' : 'save', { size: 15 }) }),
      h('div', h('strong', s.label), h('small.muted.mono', `${when(s.created)} · ${tn(s.fileCount, '{n} file', '{n} files')} · ${formatBytes(s.bytes)}${s.chatCount ? ` · ${tn(s.chatCount, '{n} chat', '{n} chats')}` : ''}${s.auto ? ` · ${t('automatic')}` : ''}`)),
      h('span.spacer'),
      h('button.btn.ghost.sm', {
        type: 'button',
        onclick: async () => {
          const d = await api.get<{ changed: string[]; added: string[]; removed: string[] }>(`/api/snapshots/${s.id}/diff`);
          await dialog({ title: s.label, tone: t('differences'), wide: true, ok: false, cancel: t('Close'), body: h('div.snap-diff.mono', diffList(t('Changed since'), d.changed), diffList(t('New since (go to the trash on restore)'), d.added), diffList(t('Deleted since'), d.removed)) });
        },
      }, t('Differences')),
      h('button.btn.sm', {
        type: 'button',
        'data-action': 'restore-snapshot',
        onclick: async () => {
          if (!(await dialog({ title: t('Restore snapshot'), tone: s.label, body: t('Every file goes back to the state of {when} in all apps, files created later go to the trash, and the chats come back. A snapshot of the current state is taken first, so you can go back.', { when: when(s.created) }), ok: t('Restore') }))) return;
          try {
            const r = await api.send<{ written: number; trashed: number }>('POST', `/api/snapshots/${s.id}/restore`, { chats: true });
            toast(t('Snapshot restored'), 'success', t('{w} files restored, {t} moved to the trash.', { w: r.written, t: r.trashed }));
            bus.emit('project:changed');
          } catch (e) {
            notifyError(e);
          }
        },
      }, t('Restore')),
      h('button.icon-btn', {
        type: 'button',
        'aria-label': t('Delete snapshot'),
        html: icon('trash', { size: 14 }),
        onclick: async () => {
          if (!(await confirmDanger(t('Delete snapshot'), s.label))) return;
          await api.send('DELETE', `/api/snapshots/${s.id}`);
          x.render();
        },
      })
    )
  );
  // project graph: file versions and lineage
  const nodes = (graph?.nodes || []).filter((n) => !n.deleted).sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || ''));
  const pick = h<'select'>('select.input.mono', { 'aria-label': t('File'), 'data-field': 'graph-file' }, ...nodes.map((n) => h('option', { value: n.path }, `${n.path} (${tn(n.versions, '{n} version', '{n} versions')})`)));
  const detail = h('div.graph-detail');
  const showFile = async () => {
    if (!pick.value) return;
    const l = await api.get<{ node: { versions: { v: number; at: string; size: number; origin: string; tool?: string; chain?: string; stored: boolean }[] } | null; derivedFrom: { from: string; to: string; tool: string }[]; usedBy: { from: string; to: string; tool: string }[] }>(`/api/graph/file?path=${encodeURIComponent(pick.value)}`);
    detail.replaceChildren(
      lineage(l.derivedFrom, pick.value, l.usedBy),
      h(
        'div.ver-list',
        ...(l.node?.versions || [])
          .slice()
          .reverse()
          .map((v, i) =>
            h(
              'div.ver-row',
              h('span.mono', `v${v.v}`),
              h('span', v.tool ? h('span.pill.mono', v.tool) : h('span.muted', originLabel(v.origin))),
              h('small.mono.muted', `${when(v.at)} · ${formatBytes(v.size)}`),
              h('span.spacer'),
              i === 0
                ? h('small.muted', t('current'))
                : v.stored
                  ? h('button.btn.ghost.sm', {
                      type: 'button',
                      onclick: async () => {
                        if (!(await dialog({ title: t('Restore version {v}', { v: v.v }), body: t('{path} gets the content of {when}. The current content stays as a new version.', { path: pick.value, when: when(v.at) }), ok: t('Restore') }))) return;
                        await api.send('POST', '/api/graph/restore', { path: pick.value, v: v.v }).catch(notifyError);
                        toast(t('Version restored'), 'success');
                        void showFile();
                      },
                    }, t('Restore'))
                  : h('small.muted', t('not kept'))
            )
          )
      )
    );
  };
  pick.onchange = () => void showFile();
  if (nodes.length) void showFile();
  const steps = (graph?.steps || []).slice(-12).reverse();
  const snapSearch = h<'input'>('input.input.sm', { type: 'search', placeholder: t('Filter'), 'aria-label': t('Filter') });
  snapSearch.oninput = () => {
    const q = snapSearch.value.trim().toLowerCase();
    for (const rowEl of snaps) {
      rowEl.hidden = !!q && !(rowEl.textContent || '').toLowerCase().includes(q);
    }
  };
  return section(
    t('History'),
    t('Snapshots'),
    t('and project graph'),
    h('p.muted', t('A snapshot keeps the whole project folder and the chats. Before the AI writes the first file of an answer, WorkCraft takes one on its own, so one click undoes the changes in every app.')),
    h(
      'div.sp-kpis',
      kpi(t('Snapshots'), String(data?.snapshots.length ?? 0)),
      kpi(t('Browser storage'), formatBytes(data?.store.bytes ?? 0)),
      kpi(t('Files'), String(nodes.length)),
      kpi(t('Recent tool steps'), String(graph?.steps.length ?? 0))
    ),
    card(
      t('Snapshots'),
      data ? `${tn(data.snapshots.length, '{n} snapshot', '{n} snapshots')} · ${formatBytes(data.store.bytes)}` : '–',
      h('div.sp-inline', label, btn(t('Take snapshot'), 'save', async () => {
        try {
          await api.send('POST', '/api/snapshots', { label: label.value.trim() || t('Snapshot') });
          toast(t('Snapshot saved'), 'success');
          x.render();
        } catch (e) {
          notifyError(e);
        }
      }, '.primary', 'take-snapshot'), snaps.length > 2 ? snapSearch : null),
      h('div.snap-list', ...(snaps.length ? snaps : [h('p.muted.sp-empty', t('No snapshots yet.'))])),
      h('div.sp-actions', btn(t('Free unused storage'), 'archive', async () => {
        const r = await api.send<{ freed: number }>('POST', '/api/snapshots/gc');
        toast(t('{n} freed', { n: formatBytes(r.freed) }), 'success');
        x.render();
      }))
    ),
    card(
      t('Project graph'),
      tn(nodes.length, '{n} file with history', '{n} files with history'),
      h('p.muted', t('Assets, dependencies and version history: which file came from which MCP step and from which input files.')),
      nodes.length ? pick : h('p.muted.sp-empty', t('The graph fills up as soon as files are written.')),
      detail
    ),
    steps.length
      ? card(
          t('Recent tool steps'),
          t('pipeline'),
          h(
            'div.step-list',
            ...steps.map((s) => h('div.step-row', { 'data-ok': String(s.ok) }, h('span.pill.mono', s.tool), h('span.mono.small', `${s.inputs.join(', ') || '–'} → ${s.outputs.join(', ') || '–'}`), h('small.muted.mono', `${ago(s.at)} · ${s.ms} ms`)))
          )
        )
      : null
  );
}
const diffList = (title: string, list: string[]) => h('div', h('p.eyebrow', `${title} (${list.length})`), ...(list.length ? list.slice(0, 200).map((p) => h('div', p)) : [h('div.muted', '–')]));
const originLabel = (o: string) => ({ ui: t('saved in the editor'), snapshot: t('snapshot restore'), sync: t('sync'), history: t('version restore'), trash: t('trash restore'), disk: t('changed on disk') })[o] || (o.startsWith('panel:') ? t('saved in an app') : o);
function lineage(from: { from: string; tool: string }[], path: string, used: { to: string; tool: string }[]): HTMLElement {
  if (!from.length && !used.length) return h('p.muted', t('No known inputs or outputs.'));
  const col = (title: string, items: { p: string; tool: string }[]) => h('div.lin-col', h('p.eyebrow', title), ...(items.length ? items.map((i) => h('div.lin-node', h('span.mono', i.p), h('small.muted', i.tool))) : [h('div.muted', '–')]));
  return h('div.lineage', col(t('Derived from'), from.map((e) => ({ p: e.from, tool: e.tool }))), h('div.lin-col.is-center', h('div.lin-node.is-self', h('span.mono', path))), col(t('Used for'), used.map((e) => ({ p: e.to, tool: e.tool }))));
}

// ---------------------------------------------------------------- Trash

async function trashSection(x: ExtraContext): Promise<HTMLElement> {
  if (backend.browser) return section(t('Trash'), t('Deleted'), t('and restorable'), desktopOnly(t('The trash')));
  const list = (await load<{ id: string; kind: 'project' | 'file'; name: string; projectName: string; path?: string; deleted: string; expires: string; size: number; dir?: boolean }[]>('/api/trash')) || [];
  const rows = list.map((e) => {
    const days = Math.max(0, Math.ceil((Date.parse(e.expires) - Date.now()) / 86400_000));
    return h(
      'div.trash-row',
      { 'data-trash': e.id, 'data-kind': e.kind },
      h('span', { html: icon(e.kind === 'project' ? 'briefcase' : e.dir ? 'folder' : 'file', { size: 16 }) }),
      h('div', h('strong', e.kind === 'project' ? e.name : e.path || e.name), h('small.muted.mono', `${e.kind === 'project' ? t('project') : t('in {project}', { project: e.projectName })} · ${formatBytes(e.size)} · ${t('deleted {when}', { when: ago(e.deleted) })} · ${tn(days, 'removed in {n} day', 'removed in {n} days')}`)),
      h('span.spacer'),
      h('button.btn.sm', {
        type: 'button',
        'data-action': 'restore',
        onclick: async () => {
          try {
            const r = await api.send<{ kind: string; projectId: string; path?: string }>('POST', `/api/trash/${e.id}/restore`);
            toast(t('Restored'), 'success', r.path || e.name);
            if (r.kind === 'file') await fs.reload();
            x.render();
          } catch (err) {
            notifyError(err);
          }
        },
      }, t('Restore')),
      h('button.btn.ghost.danger.sm', {
        type: 'button',
        onclick: async () => {
          if (!(await confirmDanger(t('Delete for good'), t('{name} is overwritten and removed. This cannot be undone.', { name: e.path || e.name }), t('Delete for good')))) return;
          await api.send('DELETE', `/api/trash/${e.id}`);
          x.render();
        },
      }, t('Delete for good'))
    );
  });
  const totalTrashBytes = list.reduce((acc, e) => acc + (e.size || 0), 0);
  const trashSearch = h<'input'>('input.input.sm', { type: 'search', placeholder: t('Filter'), 'aria-label': t('Filter') });
  trashSearch.oninput = () => {
    const q = trashSearch.value.trim().toLowerCase();
    for (const rowEl of rows) {
      rowEl.hidden = !!q && !(rowEl.textContent || '').toLowerCase().includes(q);
    }
  };
  return section(
    t('Trash'),
    t('Deleted'),
    t('and restorable'),
    h('p.muted', t('Deleted projects and files stay here for 30 days before they are removed for good. Restored files go back to their old place.')),
    h(
      'div.sp-kpis',
      kpi(t('Deleted'), String(list.length)),
      kpi(t('Browser storage'), formatBytes(totalTrashBytes)),
      kpi(t('Valid for'), '30 d')
    ),
    rows.length > 2 ? h('div.sp-actions', trashSearch) : null,
    h('div.frame', h('div.well.flush', ...(rows.length ? rows : [h('p.muted.sp-empty', t('The trash is empty.'))]))),
    rows.length
      ? h('div.sp-actions', h('button.btn.ghost.danger', {
          type: 'button',
          'data-action': 'empty-trash',
          onclick: async () => {
            if (!(await confirmDanger(t('Empty the trash'), tn(list.length, '{n} entry is overwritten and removed.', '{n} entries are overwritten and removed.'), t('Empty')))) return;
            await api.send('DELETE', '/api/trash');
            x.render();
          },
          html: icon('trash', { size: 14 }) + `<span>${t('Empty the trash')}</span>`,
        }))
      : null
  );
}

// ---------------------------------------------------------------- Share and export, sync

async function shareSection(x: ExtraContext): Promise<HTMLElement> {
  const p = projects.current;
  const exportCard = card(
    t('Export'),
    t('formats'),
    h('p.muted', t('Besides the ZIP of the project: a static HTML gallery to open in any browser, a PDF portfolio with all documents, and a Markdown documentation folder.')),
    h(
      'div.sp-actions',
      btn(t('ZIP (with chats)'), 'archive', () => projects.exportZip(), '', 'export-zip'),
      backend.browser ? null : btn(t('HTML gallery'), 'browser', () => projects.exportAs('html'), '', 'export-html'),
      backend.browser ? null : btn(t('PDF portfolio'), 'file', () => projects.exportAs('pdf'), '', 'export-pdf'),
      backend.browser ? null : btn(t('Markdown folder'), 'book', () => projects.exportAs('markdown'), '', 'export-md')
    )
  );
  const remote = document.documentElement.dataset.backend === 'remote';
  if (backend.browser) {
    const { syncBrowserWithDesktop } = await import('../../app/offline-extra.js');
    const { browserHelpers } = await import('../../app/offline.js');
    let saved = { host: '', port: '5175', token: '' };
    try {
      saved = { ...saved, ...(JSON.parse(localStorage.getItem('workcraft.desktop') || '{}') as object) };
    } catch {
      /* none */
    }
    const out = h('div.sync-out.mono');
    const run = async (dry: boolean) => {
      if (!saved.host || !saved.token) return toast(t('Connect the desktop first'), 'warning', t('Enter its IP address and token under iPad and network, and keep "Remember the token" on.'));
      out.textContent = t('Syncing …');
      try {
        const r = await syncBrowserWithDesktop(browserHelpers(), saved, dry);
        out.textContent = dry ? t('Preview: {n} actions', { n: r.actions.length }) + '\n' + r.actions.map((a) => `${a.op} ${a.path}`).join('\n') : t('{p} sent, {l} received, {c} conflicts, {d} deleted', { p: r.pushed, l: r.pulled, c: r.conflicts, d: r.deleted }) + (r.errors.length ? '\n' + r.errors.map((e) => `${e.path}: ${e.message}`).join('\n') : '');
        if (!dry) await fs.reload();
      } catch (e) {
        out.textContent = (e as Error).message;
      }
    };
    return section(t('Share and sync'), t('Home network'), t('without cloud'), exportCard, card(t('Sync with the desktop'), saved.host || t('not connected'), h('p.muted', t('Two-way sync of this browser project with the same project on the desktop PC. Changes on both sides become conflict copies, nothing is lost.')), h('div.sp-actions', btn(t('Preview'), 'eye', () => run(true)), btn(t('Sync now'), 'refresh', () => run(false), '.primary', 'sync-browser')), out));
  }
  if (remote) return section(t('Share and sync'), t('Home network'), t('without cloud'), exportCard, note(t('Shares and syncs are started on the desktop PC itself.')));
  const info = await load<{ port: number; running: boolean; error?: string; addresses: string[]; shares: { token: string; projectName: string; expires: string; download: boolean; visits: number; devices: string[]; urls: string[] }[] }>('/api/share');
  const minutes = h<'select'>('select.input', { 'aria-label': t('Valid for') }, ...[15, 30, 60, 120, 480].map((m) => h('option', { value: String(m), selected: m === 60 }, m < 60 ? `${m} min` : `${m / 60} h`)));
  const download = h<'input'>('input', { type: 'checkbox', checked: true });
  const shares = (info?.shares || []).map((s) =>
    h(
      'div.share-row',
      { 'data-share': s.token.slice(0, 8) },
      h('div', h('strong', s.projectName), h('small.muted.mono', `${t('until {time}', { time: new Date(s.expires).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })} · ${tn(s.devices.length, '{n} device', '{n} devices')} · ${s.download ? t('downloads allowed') : t('view only')}`), ...s.urls.map((u) => h('div.sp-inline', h('code.mono.sp-url', u), h('button.btn.ghost.sm', { type: 'button', onclick: () => void navigator.clipboard?.writeText(u).then(() => toast(t('Link copied'), 'success')) }, t('Copy'))))),
      h('span.spacer'),
      h('button.btn.ghost.danger.sm', { type: 'button', 'data-action': 'revoke-share', onclick: async () => (await api.send('DELETE', `/api/share/${s.token}`), x.render()) }, t('End sharing'))
    )
  );
  // desktop to desktop sync
  const peerHost = h<'input'>('input.input.mono', { placeholder: '192.168.178.30', 'aria-label': t('IP address of the other desktop') });
  const peerPort = h<'input'>('input.input.mono', { value: '5175', 'aria-label': 'Port' });
  const peerToken = h<'input'>('input.input.mono', { type: 'password', placeholder: t('Access token of the other desktop'), 'aria-label': t('Access token') });
  const out = h('div.sync-out.mono');
  const sync = async (dryRun: boolean) => {
    if (!peerHost.value.trim() || !peerToken.value.trim()) return toast(t('IP address and token are required'), 'warning');
    out.textContent = t('Syncing …');
    try {
      const r = await api.send<{ actions: { op: string; path: string }[]; pushed: number; pulled: number; conflicts: number; deleted: number; errors: { path: string; message: string }[] }>('POST', '/api/sync/peer', { host: peerHost.value.trim(), port: Number(peerPort.value) || 5175, token: peerToken.value.trim(), dryRun });
      out.textContent = dryRun ? t('Preview: {n} actions', { n: r.actions.length }) + '\n' + r.actions.map((a) => `${a.op} ${a.path}`).join('\n') : t('{p} sent, {l} received, {c} conflicts, {d} deleted', { p: r.pushed, l: r.pulled, c: r.conflicts, d: r.deleted }) + (r.errors.length ? '\n' + r.errors.map((e) => `${e.path}: ${e.message}`).join('\n') : '');
    } catch (e) {
      out.textContent = (e as Error).message;
    }
  };
  return section(
    t('Share and sync'),
    t('Home network'),
    t('without cloud'),
    card(
      t('Read-only link'),
      info?.running ? t('active on port {p}', { p: info.port }) : t('off'),
      h('p.muted', t('Shows {name} to someone on the same Wi-Fi: a page with all files and previews, without an account and without the cloud. The link only reads, expires on its own and ends when you revoke it.', { name: p?.name || t('the project') })),
      info?.error ? h('p.sp-err', info.error) : null,
      h('div.sp-grid', h('label.field', h('span', t('Valid for')), minutes), h('label.switch', download, h('span', t('Allow downloading the originals')))),
      h('div.sp-actions', btn(t('Create link'), 'share', async () => {
        try {
          await api.send('POST', '/api/share', { minutes: Number(minutes.value), download: download.checked });
          x.render();
        } catch (e) {
          notifyError(e);
        }
      }, '.primary', 'create-share'), h('small.muted', t('Other devices reach port {p}. Allow it in the firewall of this computer if needed.', { p: info?.port || 5179 }))),
      ...shares
    ),
    card(
      t('Sync with another desktop'),
      t('two-way'),
      h('p.muted', t('Syncs the active project with the same project on a second PC in the home network (it needs home-network sharing on). Conflicts become copies, deletions go to the trash. The iPad syncs from its own settings in browser mode.')),
      h('div.sp-grid', h('label.field', h('span', t('IP address')), peerHost), h('label.field', h('span', 'Port'), peerPort), h('label.field', h('span', t('Access token')), peerToken)),
      h('div.sp-actions', btn(t('Preview'), 'eye', () => sync(true)), btn(t('Sync now'), 'refresh', () => sync(false), '.primary', 'sync-peer')),
      out
    ),
    exportCard
  );
}

// ---------------------------------------------------------------- Plugins and sandbox

async function pluginsSection(x: ExtraContext): Promise<HTMLElement> {
  if (backend.browser) return section(t('Plugins'), t('Tool API'), t('and sandbox'), desktopOnly(t('Plugins')));
  const data = await load<{ dir: string; plugins: { name: string; dir: string; enabled: boolean; manifest: { title: string; description: string; version: string; sandbox: string; approval: string; mcp: { transport: string; command?: string; url?: string } } | null; error?: string }[]; catalog: { name: string; title: string; description: string; note: string; accent?: string }[]; external: { id: string; name: string; status: string; error?: string; tools: string[]; sandbox?: string; approval?: string; plugin?: string }[] }>('/api/plugins');
  if (!data) return section(t('Plugins'), t('Tool API'), t('and sandbox'), note(t('The backend does not answer.'), true));
  const installed = new Set(data.plugins.map((p) => p.name));
  const rows = data.plugins.map((p) => {
    const st = data.external.find((e) => e.plugin === p.name);
    const m = p.manifest;
    return h(
      'div.sp-mcp-row',
      { 'data-plugin': p.name },
      h('span.sp-dot', { 'data-state': st?.status || 'off' }),
      h('div', h('strong', m?.title || p.name, m ? h('small.muted.mono', ` v${m.version}`) : null), h('small.muted', m?.description || p.error || ''), m ? h('small.mono.muted', `${m.mcp.transport === 'http' ? m.mcp.url : m.mcp.command} · ${t('sandbox')} ${st?.sandbox || m.sandbox} · ${t('approval')} ${m.approval}`) : null, st?.error ? h('small.sp-err', st.error) : null, st?.tools.length ? h('small.mono.muted', tn(st.tools.length, '{n} tool: {list}', '{n} tools: {list}', { list: st.tools.slice(0, 6).join(', ') })) : null),
      h('span.spacer'),
      m ? sw(p.enabled, t('active'), async (v) => {
        await api.send('PUT', `/api/plugins/${p.name}`, { enabled: v }).catch(notifyError);
        await (await loadOrchestrator()).refresh().catch(() => []);
        x.render();
      }) : null,
      h('button.icon-btn', { type: 'button', 'aria-label': t('Remove {name}', { name: p.name }), html: icon('trash', { size: 16 }), onclick: async () => (await confirmDanger(t('Remove plugin'), p.dir)) && (await api.send('DELETE', `/api/plugins/${p.name}`), x.render()) })
    );
  });
  const activePluginTools = data.external.reduce((acc, e) => acc + (e.tools?.length || 0), 0);
  const catCards = data.catalog.map((c) =>
    h(
      'div.frame.sm.plugin-card',
      { style: c.accent ? `--accent-plugin:${c.accent}` : '', 'data-template': c.name },
      h('div.well', h('strong', c.title), h('p.muted', c.description), h('small.muted', c.note), installed.has(c.name) ? h('span.pill.mono', t('installed')) : h('button.btn.sm', { type: 'button', onclick: async () => (await api.send('POST', '/api/plugins/install', { name: c.name }).catch(notifyError), x.render()) }, t('Install template')))
    )
  );
  const catFilter = h<'input'>('input.input.sm', { type: 'search', placeholder: t('Filter'), 'aria-label': t('Filter') });
  catFilter.oninput = () => {
    const q = catFilter.value.trim().toLowerCase();
    for (const cardEl of catCards) {
      cardEl.hidden = !!q && !(cardEl.textContent || '').toLowerCase().includes(q);
    }
  };
  return section(
    t('Plugins'),
    t('Tool API'),
    t('and sandbox'),
    h('p.muted', t('PhotoCraft, ArtCraft, Blender headless, ComfyUI and more join as MCP servers without changes to the core. A plugin is a folder with an workcraft.plugin.json in') + ' ', h('code.mono', data.dir)),
    h(
      'div.sp-kpis',
      kpi(t('Plugins'), `${data.plugins.filter((p) => p.enabled).length} / ${data.plugins.length}`),
      kpi('MCP', String(activePluginTools)),
      kpi(t('Catalog'), String(data.catalog.length))
    ),
    note(h('p', h('strong', t('Sandbox:') + ' '), t('strict runs Node servers with the Node permission model (read the plugin and the project, write only the project) and a clean environment without API keys. standard keeps the clean environment. Every call of a tool from outside asks first unless the plugin allows read-only or all tools. Results are capped at 200 KB, calls at 120 s.'))),
    h('div.frame', h('div.well.flush', ...(rows.length ? rows : [h('p.muted.sp-empty', t('No plugins installed.'))]))),
    h('div.sp-actions', h('p.eyebrow.sp-sub', t('Catalog')), h('span.spacer'), catFilter),
    h('div.plugin-grid', ...catCards),
    h('div.sp-actions', btn(t('Reload plugins'), 'refresh', async () => (await api.send('POST', '/api/plugins/reload'), x.render())), h('a.btn.ghost', { href: '../docs/#plugins', target: '_blank', rel: 'noopener' }, t('Plugin API reference')))
  );
}

// ---------------------------------------------------------------- Logs and metrics

async function logsSection(x: ExtraContext): Promise<HTMLElement> {
  let level: 'debug' | 'info' | 'warn' | 'error' = 'info';
  let filter = '';
  const box = h('div.log-box.mono', { role: 'log', 'aria-live': 'polite' });
  const order = ['debug', 'info', 'warn', 'error'];
  let all: UiLog[] = [];
  const paint = async () => {
    const server = backend.browser ? [] : ((await load<UiLog[]>(`/api/logs?limit=800`)) || []).map((l) => ({ ...l, source: l.source }));
    const ui = uiLogs.list().map((l) => ({ ...l, source: `ui:${l.source}` }));
    // lines the interface sent are in the backend log too: keep one copy
    const seen = new Set(server.filter((l) => l.source.startsWith('ui:')).map((l) => l.message));
    all = [...server, ...ui.filter((l) => !seen.has(l.message))].sort((a, b) => a.at.localeCompare(b.at));
    const shown = all.filter((l) => order.indexOf(l.level) >= order.indexOf(level) && (!filter || `${l.source} ${l.message}`.toLowerCase().includes(filter)));
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.replaceChildren(...(shown.length ? shown.slice(-600).map((l) => h('div.log-line', { 'data-level': l.level }, h('span.log-time', l.at.slice(11, 19)), h('span.log-level', l.level), h('span.log-src', l.source), h('span.log-msg', l.message), l.ms !== undefined ? h('span.log-ms', `${l.ms} ms`) : null)) : [h('div.muted', t('No log lines for this filter.'))]));
    if (atBottom) box.scrollTop = box.scrollHeight;
  };
  await paint();
  const timer = setInterval(() => (x.visible('logs') && box.isConnected ? void paint() : clearInterval(timer)), 2500);
  const lvl = h<'select'>('select.input', { 'aria-label': t('Level') }, ...order.map((o) => h('option', { value: o, selected: o === level }, o)));
  lvl.onchange = () => ((level = lvl.value as typeof level), void paint());
  const find = h<'input'>('input.input', { type: 'search', placeholder: t('Filter, for example mcp or gridcraft'), 'aria-label': t('Filter') });
  find.oninput = () => ((filter = find.value.toLowerCase().trim()), void paint());
  const m = await load<{ enabled: boolean; since: string; series: { name: string; n: number; p50: number; p95: number; max: number }[] }>('/api/metrics');
  return section(
    t('Logs and metrics'),
    t('Observability'),
    t('only for you'),
    h('p.muted', t('The log of the backend and of this interface: errors, warnings, MCP tool calls with their latency, AI requests, app start times. It stays on this computer.')),
    h('div.sp-actions', lvl, find, h('span.spacer'), btn(t('Save as text'), 'download', () => downloadBlob(new Blob([all.map((l) => `${l.at} ${l.level.toUpperCase()} [${l.source}] ${l.message}${l.ms !== undefined ? ` (${l.ms} ms)` : ''}`).join('\n')], { type: 'text/plain' }), 'workcraft-log.txt')), btn(t('Clear'), 'trash', async () => {
      uiLogs.clear();
      if (!backend.browser) await api.send('DELETE', '/api/logs').catch(() => {});
      void paint();
    })),
    box,
    card(
      t('Performance metrics'),
      m?.enabled ? t('on') : t('off'),
      h('p.muted', t('Optional and local: start times of the WebAssembly apps, MCP latency per tool, time to the first token per provider, search time. Never sent anywhere. The anonymized report holds tool and app names and numbers only, no file names, paths or content, so you can share it by hand.')),
      sw(!!m?.enabled, t('Collect performance metrics on this computer'), async (v) => {
        await api.send('PUT', '/api/metrics/config', { enabled: v }).catch(notifyError);
        await aiConfig.get().catch(() => null);
        x.render();
      }, undefined, { 'data-pref': 'metrics' }),
      m?.series.length
        ? h('div.usage-table.mono', h('table', h('thead', h('tr', h('th', t('Measurement')), h('th', 'n'), h('th', 'p50'), h('th', 'p95'), h('th', 'max'))), h('tbody', ...m.series.map((s) => h('tr', h('td', s.name), h('td', String(s.n)), h('td', `${s.p50} ms`), h('td', `${s.p95} ms`), h('td', `${s.max} ms`))))))
        : h('p.muted', m?.enabled ? t('No measurements yet. Open an app or send a chat message.') : t('Switched off.')),
      h('div.sp-actions', btn(t('Export the anonymized report'), 'download', async () => downloadBlob(new Blob([await api.text('/api/metrics/report')], { type: 'application/json' }), 'workcraft-performance.json')), btn(t('Reset'), 'refresh', async () => (await api.send('DELETE', '/api/metrics'), x.render())))
    )
  );
}
