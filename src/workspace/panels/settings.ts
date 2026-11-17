// Settings: status, AI providers (Claude, ChatGPT, Gemini, DeepSeek, Ollama, your own
// OpenAI-compatible endpoints), external MCP servers, appearance and layout, iPad and network.
//
// Keys only go to the local backend and are stored in ~/workcraft/config.json
// (file mode 0600). After that the frontend only sees a mask.

import { h, uid, ROOT } from '../../app/util.js';
import { icon, markSvg } from '../../app/icons.js';
import { api, live } from '../../app/backend.js';
import { bus } from '../../app/bus.js';
import { prefs } from '../../app/settings.js';
import { confirmDanger } from '../../app/ui.js';
import { condenseHints, statusChip } from '../../app/info-tip.js';
import { toast, notifyError } from '../../app/notifications.js';
import { aiConfig, type PublicConfig, type PublicProvider, type PublicCustom, type TestResult, type McpEntry } from '../../chat/config.js';
import { AVAILABLE, TOOLS, RELEASES, WEB_BUILDS, toolMark, type PanelContext, type PanelInstance, type ToolId } from '../registry.js';
import { APPS, ORIGIN_LABEL, appById, type CraftId, type Origin } from '../../ecosystems/catalog.js';
import { kindOf, themeOf } from '../../ecosystems/theme.js';
import { orchestrator } from '../../mcp/orchestrator.js';
import { backend } from '../../app/backend.js';
import { device } from '../../app/device.js';
import { allowScribble } from '../pencil.js';
import { voiceStatus } from '../../chat/voice.js';
import { wantsWebgl } from './craftapp.js';
import { projects } from '../../project/manager.js';
import { fs } from '../../project/fs.js';
import { downloadBlob, basename, normPath } from '../../app/util.js';
import { shareOrDownload } from '../../app/share-file.js';
import { t, tn, lang, LANGS, LANG_LABELS, setLang } from '../../app/i18n.js';
import { VERSION, appStatus } from '../../app/status.js';
import { workspace } from '../layout.js';
import { telemetry, usageTable, providerTable } from '../../chat/telemetry.js';
import { usageTotals, compactTokens, money, percent, type Rate, type UsageStore } from '../../chat/usage.js';
import { DEEPSEEK_MAX_OUTPUT, DEEPSEEK_PRESETS, presetOf, type DeepSeekSettings } from '../../chat/deepseek.js';
import { extraSections, type ExtraSection } from './settings-extra.js';
import { connectSections, type ConnectSection } from './settings-connect.js';
import { updates, checkNow, appVersionState, appVersionTitle } from '../../app/updates.js';
import { providerMark } from '../../chat/provider-logos.js';
import { qrSvg } from '../../core/qr.js';

type Section = 'status' | 'updates' | 'ai' | 'usage' | 'mcp' | 'view' | 'device' | ExtraSection | ConnectSection;

interface LanInfo {
  active: boolean;
  enabled: boolean;
  token: string | null;
  port: number;
  addresses: string[];
  urls: string[];
}

const DESKTOP_KEY = 'workcraft.desktop';
function savedDesktop(): { host: string; port: string; token: string } {
  try {
    return { host: '', port: '5175', token: '', ...(JSON.parse(localStorage.getItem(DESKTOP_KEY) || '{}') as object) };
  } catch {
    return { host: '', port: '5175', token: '' };
  }
}

export async function mount(el: HTMLElement, ctx: PanelContext): Promise<PanelInstance> {
  const root = h('div.sp');
  const nav = h('nav.sp-nav', { 'aria-label': t('Sections') });
  const body = h('div.sp-body');
  root.append(nav, body);
  el.append(root);
  // One short label per control: the long grey explanations move behind an (i) icon (src/app/info-tip.ts)
  let condensing = false;
  new MutationObserver(() => {
    if (condensing) return;
    condensing = true;
    queueMicrotask(() => {
      condensing = false;
      condenseHints(body);
    });
  }).observe(body, { childList: true, subtree: true });

  let cfg: PublicConfig;
  let section: Section = 'ai';
  // Few choices up front: the five things most people ever change. Everything else is behind "Developer options", one toggle,
  // where every section and option stays reachable (they are also found by the command palette).
  const MAIN: [Section, string, string][] = [
    ['ai', t('AI models'), 'spark'],
    ['personal', t('Personas and context'), 'user'],
    ['view', t('Appearance and layout'), 'palette'],
    ['privacy', t('Privacy'), 'lock'],
    ['cloud', t('Cloud storage'), 'upload'],
  ];
  const DEV: [string, [Section, string, string][]][] = [
    [t('Overview'), [['status', t('Status'), 'activity'], ['updates', t('Updates'), 'download'], ['health', t('Health check'), 'life'], ['monitor', t('Memory and GPU'), 'cpu']]],
    [t('AI'), [['team', t('Team Mode'), 'users'], ['search', t('Search and memory'), 'search'], ['usage', t('Usage and telemetry'), 'trend']]],
    [t('Privacy'), [['audit', t('Audit log'), 'shield']]],
    [t('Project'), [['history', t('History and snapshots'), 'clock'], ['trash', t('Trash'), 'trash'], ['share', t('Share and sync'), 'share']]],
    [t('Extensions'), [['mcp', t('MCP servers'), 'plug'], ['craft', t('Craft apps'), 'layers'], ['bridge', t('Connect other IDEs'), 'link'], ['plugins', t('Plugins and sandbox'), 'box'], ['logs', t('Logs and metrics'), 'terminal']]],
    [t('Workspace'), [['device', t('iPad and network'), 'tablet']]],
  ];
  const SECTIONS: [Section, string, string][] = [...MAIN, ...DEV.flatMap(([, list]) => list)];
  const isDevSection = (s: Section) => DEV.some(([, list]) => list.some(([id]) => id === s));
  const DEV_KEY = 'workcraft.settings.dev';
  let devOpen = (() => {
    try {
      return localStorage.getItem(DEV_KEY) === '1';
    } catch {
      return false;
    }
  })();
  const setDevOpen = (open: boolean) => {
    devOpen = open;
    try {
      localStorage.setItem(DEV_KEY, open ? '1' : '0');
    } catch {
      /* storage blocked: the fold just starts closed next time */
    }
  };
  const extraCtx = {
    cfg: () => cfg,
    setCfg: (c: PublicConfig) => void (cfg = c),
    render: () => render(),
    go: (s: string) => {
      if (SECTIONS.some(([id]) => id === s)) (section = s as Section), render();
    },
    visible: (s: string) => section === s && el.isConnected && !el.closest('[hidden]'),
  };
  const extras: Record<ExtraSection | ConnectSection, () => Promise<HTMLElement>> = { ...extraSections(extraCtx), ...connectSections(extraCtx) };

  function renderNav() {
    // A section opened from somewhere else (the status chip, the palette, a link) opens the fold it lives in
    if (isDevSection(section) && !devOpen) setDevOpen(true);
    const tab = ([id, label, ic]: [Section, string, string]) =>
      h('button.sp-tab' + (section === id ? '.is-active' : ''), { type: 'button', 'data-section': id, 'aria-current': section === id ? 'page' : 'false', html: icon(ic, { size: 16 }) + `<span>${label}</span>`, onclick: () => ((section = id), render()) });
    nav.replaceChildren(
      ...MAIN.map(tab),
      h('button.sp-tab.sp-dev-toggle', { type: 'button', 'data-action': 'dev-options', 'aria-expanded': String(devOpen), html: icon('code', { size: 16 }) + `<span>${t('Developer options')}</span>` + icon(devOpen ? 'chevronUp' : 'chevronDown', { size: 14 }), onclick: () => {
        // Closing the fold while one of its sections is open goes back to the first section
        if (devOpen && isDevSection(section)) section = 'ai';
        setDevOpen(!devOpen);
        render();
      } }),
      ...(devOpen ? DEV.flatMap(([group, list]) => [h('p.sp-nav-group.eyebrow', group), ...list.map(tab)]) : [])
    );
  }

  async function reload() {
    cfg = await aiConfig.get();
    render();
  }

  function render() {
    renderNav();
    if (section === 'status') body.replaceChildren(statusSection());
    else if (section === 'updates') body.replaceChildren(updatesSection());
    else if (section === 'ai') body.replaceChildren(aiSection());
    else if (section === 'usage') void usageSection().then((n) => section === 'usage' && body.replaceChildren(n));
    else if (section === 'mcp') void mcpSection().then((n) => body.replaceChildren(n));
    else if (section === 'view') body.replaceChildren(viewSection());
    else if (section === 'device') void deviceSection().then((n) => body.replaceChildren(n));
    else {
      const want = section;
      body.replaceChildren(h('div.sp-section', h('p.muted', t('Loading …'))));
      void extras[want]()
        .then((n) => section === want && body.replaceChildren(n))
        .catch((e: Error) => section === want && body.replaceChildren(h('div.sp-section', h('p.sp-err', e.message))));
    }
  }

  // ---------------------------------------------------------------- Status

  function row(label: string, value: string | Node, mono = true): HTMLElement {
    return h('div.sp-kv', h('span.muted', label), typeof value === 'string' ? h('span' + (mono ? '.mono' : ''), value) : value);
  }
  function dot(state: string, text: string): HTMLElement {
    return h('span.sp-state', h('span.sp-dot', { 'data-state': state }), h('span', text));
  }

  let buildFilterOrigin: Origin | 'all' = 'all';
  let buildFilterQuery = '';

  function statusSection(): HTMLElement {
    const remote = document.documentElement.dataset.backend === 'remote';
    const st = aiConfig.cached;
    const s = workspace.stats();
    const modeText = backend.browser ? t('Browser mode (IndexedDB on this device)') : remote ? t('Desktop PC on the home network') : t('Desktop backend on this computer');
    const backendState = backend.browser ? dot('local', t('Browser mode')) : live.connected ? dot('on', t('connected')) : dot('error', t('disconnected'));
    const ai = st?.active ? dot(st.active.local ? 'local' : 'on', `${st.active.name} · ${st.active.model}`) : dot('error', t('not set up'));
    const mode: Record<string, string> = { normal: t('visible'), minimized: t('minimized'), hidden: t('hidden') };
    const state: Record<string, string> = { idle: t('not loaded'), queued: t('waiting'), loading: t('loading'), active: t('running'), unloaded: t('unloaded'), error: t('error') };
    const panels = workspace.details().map((p) =>
      h(
        'div.sp-panel-row',
        { 'data-panel': p.id },
        h('strong', p.name),
        h('span.mono.muted', p.path || '–'),
        h('span', `${mode[p.mode] || p.mode} · ${p.status === 'active' && p.paused ? t('paused') : state[p.status] || p.status}`),
        h('span.mono.muted', [p.text, p.loadMs ? t('start {s} s', { s: (p.loadMs / 1000).toFixed(1) }) : '', p.error].filter(Boolean).join(' · ') || '–')
      )
    );
    const themeName: Record<string, string> = { system: t('System'), light: t('Light'), dark: t('Dark') };

    const relByApp = new Map(RELEASES.map((r) => [r.app, r]));
    const wbByApp = new Map(WEB_BUILDS.map((b) => [b.app, b]));
    const totalReady = APPS.filter((a) => AVAILABLE.has(a.id)).length;
    const totalBytes = RELEASES.reduce((acc, r) => acc + (r.webZipBytes || 0), 0) + WEB_BUILDS.reduce((acc, b) => acc + (b.bytes || 0), 0);

    const searchIn = h<'input'>('input.input.sm', {
      type: 'search',
      placeholder: t('Find an app'),
      value: buildFilterQuery,
      'aria-label': t('Find an app'),
    });
    const originSel = h<'select'>(
      'select.input.sm',
      { 'aria-label': t('Origin') },
      h('option', { value: 'all', selected: buildFilterOrigin === 'all' }, `${t('All')} (${APPS.length})`),
      h('option', { value: 'artcraft', selected: buildFilterOrigin === 'artcraft' }, `ArtCraft (${APPS.filter((a) => a.origin === 'artcraft').length})`),
      h('option', { value: 'community', selected: buildFilterOrigin === 'community' }, `${t('Community apps')} (${APPS.filter((a) => a.origin === 'community').length})`),
      h('option', { value: 'independent', selected: buildFilterOrigin === 'independent' }, `${t('Independent apps')} (${APPS.filter((a) => a.origin === 'independent').length})`)
    );
    const buildListEl = h('div.sp-kvs.sp-builds-list');
    const paintBuildRows = () => {
      const q = buildFilterQuery.trim().toLowerCase();
      const filtered = APPS.filter((a) => (buildFilterOrigin === 'all' || a.origin === buildFilterOrigin) && (!q || `${a.name} ${a.id} ${a.kind} ${a.repo}`.toLowerCase().includes(q)));
      buildListEl.replaceChildren(
        ...filtered.map((a) => {
          const tool = TOOLS[a.id as ToolId];
          const r = relByApp.get(a.id);
          const wb = wbByApp.get(a.id);
          const vState = appVersionState(a.id);
          const vTitle = appVersionTitle(a.id);
          const bytes = r?.webZipBytes || wb?.bytes || 0;
          const mb = bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '';
          const u = updates.apps.find((x) => x.repo === a.id || x.repo === a.repo.split('/')[1]);
          return h(
            'div.sp-kv.sp-build-row',
            { 'data-app': a.id, 'data-origin': a.origin, 'data-ver-state': vState, title: r?.webNote || vTitle },
            h(
              'span.sp-app',
              h('a.sp-app-repo.is-repo-link', {
                href: `https://github.com/${a.repo}`,
                target: '_blank',
                rel: 'noopener',
                title: t('{name} on GitHub ({repo})', { name: a.name, repo: a.repo }),
                html: toolMark(a.id, 22),
              }),
              h('span.sp-app-meta', h('strong', a.name), h('small.muted', ` · ${ORIGIN_LABEL[a.origin]} · ${t(a.kind)}`))
            ),
            h(
              'span.sp-build-ver',
              h('span.ver-pill.mono', { 'data-ver-state': vState, title: vTitle }, tool?.available ? `v${tool.version}` : '—'),
              h('small.mono.muted', [mb, a.license, r?.date || (wb?.fetchedAt ? wb.fetchedAt.slice(0, 10) : '')].filter(Boolean).join(' · '))
            ),
            u?.isOutdated
              ? h('a.sp-upd', { href: u.releaseUrl || `https://github.com/${a.repo}/releases`, target: '_blank', rel: 'noopener', title: t('Newest release on GitHub') }, t('Newer: v{v}', { v: u.latest || '' }))
              : h('button.btn.ghost.sm', { type: 'button', onclick: () => void workspace.openPanel(a.id as ToolId) }, t('Open'))
          );
        })
      );
    };
    searchIn.oninput = () => {
      buildFilterQuery = searchIn.value;
      paintBuildRows();
    };
    originSel.onchange = () => {
      buildFilterOrigin = originSel.value as Origin | 'all';
      paintBuildRows();
    };
    paintBuildRows();

    return h(
      'div.sp-section.sp-status',
      h('p.eyebrow', t('Status')),
      h('h2.duo', 'WorkCraft ', h('span.tone', 'v' + VERSION)),
      h(
        'div.frame.sp-card',
        { 'data-card': 'status' },
        h(
          'div.well',
          h('div.sp-card-head', h('h3.duo', t('Connection') + ' ', h('span.tone', t('and services')))),
          h(
            'div.sp-kvs',
            row(t('Mode'), modeText, false),
            row('Backend', backendState),
            row(t('AI model'), ai),
            row(t('Offline cache'), appStatus.get().cache || '–', false),
            row(t('Appearance'), `${themeName[prefs.get('theme')]} · ${LANGS.find((l) => l.id === lang)?.name}`, false)
          )
        )
      ),
      h(
        'div.frame.sp-card',
        { 'data-card': 'apps' },
        h(
          'div.well',
          h(
            'div.sp-card-head',
            h('h3.duo', t('Apps') + ' ', h('span.tone', `${totalReady}/${APPS.length} · ${(totalBytes / 1048576).toFixed(0)} MB`)),
            h('span.spacer'),
            h(
              'div.ver-legend',
              h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'newest', 'aria-hidden': 'true' }), t('Newest installed')),
              h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'ready', 'aria-hidden': 'true' }), t('Ready build')),
              h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'outdated', 'aria-hidden': 'true' }), t('Update available'))
            )
          ),
          h('div.sp-actions', searchIn, originSel),
          buildListEl
        )
      ),
      h(
        'div.frame.sp-card',
        { 'data-card': 'panels' },
        h(
          'div.well',
          h('div.sp-card-head', h('h3.duo', t('Panels') + ' ', h('span.tone', t('{a} running · {p} paused · {u} not loaded', { a: s.active, p: s.paused, u: s.unloaded })))),
          h('p.muted', tn(s.apps, '{n} app in memory. Hidden apps pause and keep their state.', '{n} apps in memory. Hidden apps pause and keep their state.')),
          h('div.sp-panels', h('div.sp-panel-row.sp-panel-headrow.eyebrow', h('span', t('Panel')), h('span', t('File')), h('span', t('State')), h('span', t('Details'))), ...panels)
        )
      )
    );
  }

  // ---------------------------------------------------------------- Updates (apicraft)

  function updatesSection(): HTMLElement {
    const u = cfg.updates || { enabled: false, hasKey: false, keyHint: '' };
    const on = h<'input'>('input', { type: 'checkbox', 'data-updates-enabled': '' });
    on.checked = u.enabled;
    const key = h<'input'>('input.input.mono', { type: 'password', placeholder: u.hasKey ? `github_pat_… ${u.keyHint}` : 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
    const list = h('div.upd-list', { 'data-updates-list': '' });
    const note = h('p.upd-note', { role: 'status' });
    const paint = () => {
      const r = updates.last;
      note.textContent = !r ? '' : r.state === 'ok' ? t('Checked {time}.', { time: new Date(r.checkedAt || Date.now()).toLocaleTimeString() }) : r.state === 'off' ? t('The check is off.') : r.message || t('The check did not work.');
      note.dataset.state = r?.state || 'none';
      list.replaceChildren(...(r?.results || []).map((x) => updateRow(x)));
      list.hidden = !list.childElementCount;
    };
    const save = async (body: { enabled?: boolean; githubToken?: string | null }) => {
      cfg = await api.send<PublicConfig>('PUT', '/api/config/updates', body);
    };
    on.onchange = () => void save({ enabled: on.checked }).then(() => checkNow(true)).then(paint).catch(notifyError);
    offsUpdates = bus.on('updates:change', () => section === 'updates' && el.isConnected && paint());
    paint();

    const newestCount = APPS.filter((a) => appVersionState(a.id) === 'newest').length;
    const readyCount = APPS.filter((a) => appVersionState(a.id) === 'ready').length;
    const outdatedCount = APPS.filter((a) => appVersionState(a.id) === 'outdated').length;
    const catalogOverview = h(
      'div.frame.sp-card',
      { 'data-card': 'catalog-versions' },
      h(
        'div.well',
        h(
          'div.sp-card-head',
          h('h3.duo', t('Catalog builds') + ' ', h('span.tone', `${APPS.filter((a) => AVAILABLE.has(a.id)).length}/${APPS.length}`)),
          h('span.spacer'),
          h(
            'div.ver-legend',
            h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'newest', 'aria-hidden': 'true' }), `${t('Newest installed')} (${newestCount})`),
            h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'ready', 'aria-hidden': 'true' }), `${t('Ready build')} (${readyCount})`),
            outdatedCount ? h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'outdated', 'aria-hidden': 'true' }), `${t('Update available')} (${outdatedCount})`) : null
          )
        ),
        h(
          'div.sp-kvs.sp-builds-compact',
          ...APPS.map((a) => {
            const tool = TOOLS[a.id as ToolId];
            const vState = appVersionState(a.id);
            const vTitle = appVersionTitle(a.id);
            return h(
              'div.sp-kv',
              { 'data-app': a.id, 'data-ver-state': vState },
              h(
                'span.sp-app',
                h('a.sp-app-repo.is-repo-link', {
                  href: `https://github.com/${a.repo}`,
                  target: '_blank',
                  rel: 'noopener',
                  title: t('{name} on GitHub ({repo})', { name: a.name, repo: a.repo }),
                  html: toolMark(a.id, 18),
                }),
                h('span', a.name)
              ),
              h('span.ver-pill.mono', { 'data-ver-state': vState, title: vTitle }, tool?.available ? `v${tool.version}` : '—'),
              h('a.mono.muted', { href: `https://github.com/${a.repo}`, target: '_blank', rel: 'noopener' }, a.repo)
            );
          })
        )
      )
    );

    return h(
      'div.sp-section.sp-updates',
      h('p.eyebrow', t('Updates')),
      h('h2.duo', t('Release check') + ' ', h('span.tone', t('with apicraft logic'))),
      h('p.muted', t('WorkCraft compares its own version and the four app builds with their newest GitHub releases. The check is off until you switch it on. It uses the release logic of apicraft built into this workspace and asks GitHub directly, so no extra server or key is needed; only repository names and version numbers are sent.')),
      h(
        'div.frame.sp-card',
        h(
          'div.well',
          h('label.switch.upd-switch', on, h('span', h('strong', t('Check for new releases')), h('small.muted', t('Off by default. Only repository names and version numbers leave this computer.')))),
          h('div.sp-grid', h('label.field', h('span', t('GitHub token (optional)')), key, h('small.muted', u.hasKey ? t('A token is saved. Leave empty to keep it.') : t('Without a token GitHub allows 60 checks per hour. Stored only in config.json on this computer.')))),
          h(
            'div.sp-actions',
            h('button.btn.primary', { type: 'button', 'data-updates-save': '', onclick: async () => {
              try {
                await save({ enabled: on.checked, ...(key.value.trim() ? { githubToken: key.value.trim() } : {}) });
                key.value = '';
                toast(t('Update settings saved'), 'success');
                await checkNow(true);
                render();
              } catch (e) {
                notifyError(e);
              }
            } }, t('Save and check')),
            h('button.btn', { type: 'button', 'data-updates-now': '', onclick: () => void checkNow(true).then(paint) }, t('Check now')),
            u.hasKey ? h('button.btn.ghost', { type: 'button', onclick: () => void save({ githubToken: null }).then(() => (toast(t('Token removed'), 'success'), render())).catch(notifyError) }, t('Remove token')) : null
          )
        )
      ),
      h('div.upd-head', h('p.eyebrow', t('Versions')), note),
      list,
      catalogOverview
    );
  }
  let offsUpdates: (() => void) | null = null;
  function updateRow(x: { repo: string; current: string; latest: string | null; isOutdated: boolean | null; releaseUrl: string | null; error: string | null }): HTMLElement {
    const tool = TOOLS[x.repo as ToolId];
    const name = x.repo === 'workcraft' ? 'WorkCraft' : tool?.name || x.repo;
    const vState = x.error ? 'missing' : x.isOutdated ? 'outdated' : 'newest';
    const state = x.error
      ? h('span.sp-upd.is-muted', { title: x.error }, x.error.length > 40 ? t('No release found') : x.error)
      : x.isOutdated
        ? h('a.sp-upd.is-new', { href: x.releaseUrl || '#', target: '_blank', rel: 'noopener' }, t('Newer: v{v}', { v: x.latest || '' }))
        : h('span.sp-upd.is-ok', { html: icon('check', { size: 12 }) + `<span>${t('Up to date')}</span>` });
    const mark = x.repo === 'workcraft' ? h('span.upd-mark', { html: markSvg(18) }) : h('img.upd-mark', { src: tool?.logo || '', width: 22, height: 22, alt: '' });
    return h('div.upd-row', { 'data-repo': x.repo, 'data-outdated': String(!!x.isOutdated) }, h('span.upd-app', mark, h('span.upd-name', name)), h('span.upd-ver.ver-pill.mono', { 'data-ver-state': vState }, `v${x.current}`), state);
  }
  // ---------------------------------------------------------------- AI

  function testLine(): { el: HTMLElement; show: (r: TestResult | null, pending?: boolean) => void } {
    const el = h('div.sp-test.mono', { role: 'status', hidden: true });
    return {
      el,
      show(r, pending) {
        el.hidden = false;
        if (pending) {
          el.dataset.state = 'pending';
          el.textContent = t('Checking the connection …');
          return;
        }
        if (!r) return void (el.hidden = true);
        el.dataset.state = r.ok ? 'ok' : 'error';
        el.textContent = r.ok ? `${t('Connected.')} ${r.models.length ? t('{n} models, for example {list}', { n: r.models.length, list: r.models.slice(0, 4).join(', ') }) : t('Model list not available.')}` : `${r.error?.code || t('ERROR')}: ${r.error?.message || t('unknown')}`;
      },
    };
  }

  function modelInput(value: string, list: string): HTMLInputElement {
    return h<'input'>('input.input.mono', { value, list, placeholder: t('Model name (free text)'), autocomplete: 'off', spellcheck: 'false' });
  }

  /** Context window of Ollama models: Ollama itself starts every model with 4096 tokens, so WorkCraft asks for more. */
  function ollamaContextRow(): HTMLElement {
    const choices = [-1, 8192, 16384, 32768, 65536, 131072, 262144, 0];
    const now = cfg.ai.ollamaContext ?? -1;
    const kilo = (n: number) => (n < 0 ? t('Automatic (fits your GPU)') : n ? t('{n}k tokens', { n: Math.round(n / 1024) }) : t('Maximum of the model'));
    const sel = h<'select'>('select.input', { 'data-ollama-context': '' }, ...(choices.includes(now) ? choices : [...choices, now].sort((a, b) => a - b)).map((n) => h('option', { value: String(n), selected: n === now }, kilo(n))));
    const note = h('small.muted', { 'data-keep': '' }, t('Reading the model …'));
    const num = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');
    const paint = () =>
      void api
        .get<{ available: boolean; model?: string; window?: number; max?: number; gpu?: number; auto?: boolean }>('/api/ai/ollama-context')
        .then((r) => {
          if (!r.available || !r.window) return void (note.textContent = t('Ollama is not reachable.'));
          const base = t('{model} runs with {n} tokens. Its own limit is {max}. A larger context needs more memory and answers more slowly.', { model: r.model || '', n: num(r.window), max: r.max ? num(r.max) : t('unknown') });
          // Below 100% on the GPU the rest runs on the CPU: answers get several times slower
          note.textContent = r.gpu !== undefined && r.gpu < 0.97 ? `${base} ${t('{pct}% of the model sits in GPU memory, the rest runs on the CPU and is much slower. Choose a smaller context or a smaller model.', { pct: Math.round(r.gpu * 100) })}` : base;
        })
        .catch(() => (note.textContent = ''));
    sel.onchange = () =>
      void api
        .send<PublicConfig>('PUT', '/api/config/ollama-context', { tokens: Number(sel.value) })
        .then((c) => {
          cfg = c;
          toast(t('Context window saved'), 'success');
          note.textContent = t('Reading the model …');
          paint();
        })
        .catch(notifyError);
    paint();
    return h('label.field', h('span', t('Context window')), sel, note);
  }

  function providerCard(p: PublicProvider): HTMLElement {
    const listId = uid('models');
    const datalist = h('datalist', { id: listId });
    const key = h<'input'>('input.input.mono', { type: 'password', placeholder: p.hasKey ? t('saved {hint}', { hint: p.keyHint }) : p.needsKey ? t('API key') : t('no key needed'), autocomplete: 'off', spellcheck: 'false', disabled: !p.needsKey && !p.local ? true : false });
    const model = modelInput(p.model, listId);
    const base = h<'input'>('input.input.mono', { value: p.baseUrl, placeholder: t('Base URL'), spellcheck: 'false' });
    const test = testLine();
    const active = cfg.ai.active === p.id;
    const runTest = async () => {
      test.show(null, true);
      const r = await api.send<TestResult>('POST', '/api/ai/test', { id: p.id, apiKey: key.value.trim() || undefined, baseUrl: base.value.trim() || undefined, model: model.value.trim() || undefined }).catch((e: Error) => ({ ok: false, models: [], error: { code: 'BACKEND_DOWN', message: e.message } }));
      test.show(r);
      datalist.replaceChildren(...r.models.map((m) => h('option', { value: m })));
    };
    const save = async () => {
      try {
        cfg = await api.send<PublicConfig>('PUT', '/api/config/provider', { id: p.id, apiKey: key.value.trim() || undefined, model: model.value.trim(), baseUrl: base.value.trim() });
        key.value = '';
        toast(t('{name} saved', { name: p.name }), 'success');
        await aiConfig.changed();
        render();
      } catch (e) {
        notifyError(e);
      }
    };
    return h(
      'div.frame.sp-card' + (active ? '.is-active' : ''),
      { 'data-provider': p.id },
      h(
        'div.well',
        h(
          'div.sp-card-head',
          h('span.sp-pmark', { html: providerMark(p.id, 20) || icon(p.local ? 'cpu' : 'spark', { size: 18 }) }),
          h('h3', p.name),
          p.local ? statusChip('local', t('Local'), 'cpu', t('Runs on this computer, no key needed')) : p.hasKey ? statusChip('ok', t('Ready'), 'check', t('Key saved')) : statusChip('warn', t('No key'), 'key', t('No API key yet. Paste one below and save.')),
          h('span.spacer'),
          active ? statusChip('ok', t('Default'), 'check', t('Used for new chats')) : h('button.btn.sm', { type: 'button', onclick: () => void setActive(p.id) }, t('Make default'))
        ),
        h(
          'div.sp-grid',
          p.needsKey ? h('label.field', h('span', t('API key')), key) : null,
          h('label.field', h('span', t('Model')), model, datalist),
          h('label.field', h('span', p.local ? t('Address') : t('Base URL')), base)
        ),
        p.id === 'ollama' ? ollamaContextRow() : null,
        test.el,
        h(
          'div.sp-actions',
          h('button.btn.primary', { type: 'button', onclick: () => void save() }, t('Save')),
          h('button.btn', { type: 'button', onclick: () => void runTest() }, t('Test connection')),
          p.hasKey
            ? h(
                'button.btn.ghost.danger',
                {
                  type: 'button',
                  onclick: async () => {
                    cfg = await api.send<PublicConfig>('PUT', '/api/config/provider', { id: p.id, apiKey: null });
                    await aiConfig.changed();
                    render();
                  },
                },
                t('Remove key')
              )
            : null,
          h('small.muted', t('Get a key at {url}.', { url: p.docs }))
        )
      )
    );
  }

  function customCard(c: PublicCustom | null): HTMLElement {
    const listId = uid('models');
    const datalist = h('datalist', { id: listId });
    const name = h<'input'>('input.input', { value: c?.name || '', placeholder: t('for example LM Studio, OpenRouter, vLLM') });
    const base = h<'input'>('input.input.mono', { value: c?.baseUrl || '', placeholder: 'https://host/v1', spellcheck: 'false' });
    const key = h<'input'>('input.input.mono', { type: 'password', placeholder: c?.hasKey ? t('saved {hint}', { hint: c.keyHint }) : t('optional'), autocomplete: 'off' });
    const model = modelInput(c?.model || '', listId);
    const test = testLine();
    const active = c && cfg.ai.active === c.id;
    const runTest = async () => {
      if (!base.value.trim()) return toast(t('Enter the base URL first'), 'warning');
      test.show(null, true);
      const r = await api
        .send<TestResult>('POST', '/api/ai/test', { id: c?.id || 'custom-new', apiKey: key.value.trim() || undefined, baseUrl: base.value.trim(), model: model.value.trim() || undefined })
        .catch((e: Error) => ({ ok: false, models: [], error: { code: 'BACKEND_DOWN', message: e.message } }));
      test.show(r);
      datalist.replaceChildren(...r.models.map((m) => h('option', { value: m })));
    };
    const save = async () => {
      const b = { name: name.value.trim(), baseUrl: base.value.trim(), model: model.value.trim(), apiKey: key.value.trim() || undefined };
      if (!b.name || !b.baseUrl || !b.model) return toast(t('Name, base URL and model are required'), 'warning');
      try {
        if (c) cfg = await api.send<PublicConfig>('PUT', `/api/config/custom/${c.id}`, b);
        else {
          const r = await api.send<{ id: string; config: PublicConfig }>('POST', '/api/config/custom', b);
          cfg = r.config;
        }
        toast(t('{name} saved', { name: b.name }), 'success');
        await aiConfig.changed();
        render();
      } catch (e) {
        notifyError(e);
      }
    };
    return h(
      'div.frame.sp-card' + (active ? '.is-active' : ''),
      { 'data-provider': c?.id || 'custom-new' },
      h(
        'div.well',
        h(
          'div.sp-card-head',
          h('span.sp-pmark', { html: providerMark('custom', 20) }),
          h('h3', c ? c.name : t('Own endpoint')),
          statusChip(c ? 'ok' : 'off', c ? t('Custom') : t('New'), c ? 'plug' : 'plus', c ? t('OpenAI compatible endpoint') : t('Add an OpenAI compatible endpoint')),
          h('span.spacer'),
          c ? (active ? statusChip('ok', t('Default'), 'check', t('Used for new chats')) : h('button.btn.sm', { type: 'button', onclick: () => void setActive(c.id) }, t('Make default'))) : null
        ),
        h('div.sp-grid', h('label.field', h('span', t('Name')), name), h('label.field', h('span', t('Base URL')), base), h('label.field', h('span', t('API key')), key), h('label.field', h('span', t('Model')), model, datalist)),
        test.el,
        h(
          'div.sp-actions',
          h('button.btn.primary', { type: 'button', 'data-action': c ? 'save-custom' : 'add-custom', onclick: () => void save() }, c ? t('Save') : t('Add')),
          h('button.btn', { type: 'button', onclick: () => void runTest() }, t('Test connection')),
          c
            ? h(
                'button.btn.ghost.danger',
                {
                  type: 'button',
                  onclick: async () => {
                    if (!(await confirmDanger(t('Remove endpoint'), t('{name} is deleted from the configuration.', { name: c.name }), t('Remove')))) return;
                    cfg = await api.send<PublicConfig>('DELETE', `/api/config/custom/${c.id}`);
                    await aiConfig.changed();
                    render();
                  },
                },
                t('Remove')
              )
            : null
        )
      )
    );
  }

  /**
   * DeepSeek presets (standard chat, thinking, deep thinking, coding and FIM) with the parameters the
   * API reference allows: max_tokens 1 to 384K, temperature only without thinking, effort only with it.
   */
  function deepseekCard(): HTMLElement {
    let cur: DeepSeekSettings = { ...(cfg.ai.deepseek || { preset: 'reasoning' }) };
    const hint = h('p.muted.sp-ds-hint');
    const maxIn = h<'input'>('input.input.mono', { type: 'number', min: '1', max: String(DEEPSEEK_MAX_OUTPUT), step: '1024', inputmode: 'numeric', 'data-ds': 'max-tokens' });
    const tempIn = h<'input'>('input.input.mono', { type: 'number', min: '0', max: '2', step: '0.1', inputmode: 'decimal', 'data-ds': 'temperature' });
    const effortSel = h<'select'>('select.input', { 'data-ds': 'effort' }, ...(['low', 'high', 'max'] as const).map((e) => h('option', { value: e }, e)));
    const segs = DEEPSEEK_PRESETS.map((p) => h('button.seg-btn', { type: 'button', 'data-preset': p.id, onclick: () => ((cur = { preset: p.id }), paint()) }, t(p.name)));
    const paint = () => {
      const p = presetOf(cur.preset);
      for (const b of segs) b.setAttribute('aria-pressed', String(b.dataset.preset === p.id));
      hint.textContent = t(p.hint);
      maxIn.placeholder = String(p.maxTokens);
      maxIn.value = cur.maxTokens ? String(cur.maxTokens) : '';
      tempIn.disabled = p.thinking;
      tempIn.placeholder = p.thinking ? t('no effect in thinking mode') : String(p.temperature ?? 1);
      tempIn.value = !p.thinking && cur.temperature !== undefined ? String(cur.temperature) : '';
      effortSel.disabled = !p.thinking;
      effortSel.value = cur.effort || p.effort || 'high';
    };
    const save = async () => {
      const p = presetOf(cur.preset);
      const max = parseInt(maxIn.value, 10);
      const temp = parseFloat(tempIn.value);
      const next: DeepSeekSettings = { preset: p.id, ...(isFinite(max) && max > 0 ? { maxTokens: Math.min(DEEPSEEK_MAX_OUTPUT, max) } : {}), ...(!p.thinking && isFinite(temp) ? { temperature: Math.min(2, Math.max(0, temp)) } : {}), ...(p.thinking && effortSel.value !== (p.effort || 'high') ? { effort: effortSel.value as 'low' | 'high' | 'max' } : {}) };
      try {
        cfg = await api.send<PublicConfig>('PUT', '/api/config/deepseek', next);
        await aiConfig.get();
        toast(t('DeepSeek mode: {name}', { name: t(p.name) }), 'success');
        render();
      } catch (e) {
        notifyError(e);
      }
    };
    paint();
    return h(
      'div.frame.sp-card.sp-deepseek',
      { 'data-deepseek': 'presets' },
      h(
        'div.well',
        h('div.sp-card-head', h('h3.duo', 'DeepSeek ', h('span.tone', t('mode and parameters')))),
        h('div.seg.sp-ds-presets', { role: 'group', 'aria-label': t('DeepSeek mode') }, segs),
        hint,
        h('div.sp-grid', h('label.field', h('span', t('Max output tokens')), maxIn), h('label.field', h('span', t('Temperature')), tempIn), h('label.field', h('span', t('Thinking effort')), effortSel)),
        h(
          'ul.sp-ds-rules.mono.muted',
          h('li', t('Thinking mode ignores temperature; tool chains send the chain of thought back with every step.')),
          h('li', t('/ commands that force a tool run without thinking (the API rejects a forced tool in thinking mode).')),
          h('li', t('max_tokens 1 to 393,216. FIM completions in the code editor: up to 4,096.')),
          h('li', t('Requests keep a fixed prefix (system prompt, sorted tools, project context) for cache hits.'))
        ),
        h('div.sp-actions', h('button.btn.primary', { type: 'button', 'data-action': 'save-deepseek', onclick: () => void save() }, t('Save')))
      )
    );
  }

  async function setActive(id: string) {
    cfg = await api.send<PublicConfig>('PUT', '/api/config/active', { active: id });
    prefs.set('chatProvider', id);
    await aiConfig.changed();
    render();
  }

  let lastNonZeroRounds = prefs.get('agentRounds') > 0 ? prefs.get('agentRounds') : 8;
  function roundSelect(): HTMLSelectElement {
    const cur = prefs.get('agentRounds');
    const sel = h<'select'>(
      'select.input',
      { 'data-pref': 'agentRounds', 'aria-label': t('Agent round limit') },
      ...[
        [0, t('Off (no limit)')],
        [4, t('{n} rounds', { n: 4 })],
        [8, t('{n} rounds (default)', { n: 8 })],
        [12, t('{n} rounds', { n: 12 })],
        [16, t('{n} rounds', { n: 16 })],
        [20, t('{n} rounds', { n: 20 })],
        [24, t('{n} rounds', { n: 24 })],
        [32, t('{n} rounds', { n: 32 })],
        [50, t('{n} rounds', { n: 50 })],
        [100, t('{n} rounds', { n: 100 })],
      ].map(([v, l]) => h('option', { value: String(v), selected: cur === v }, l))
    );
    sel.onchange = () => {
      const v = Number(sel.value);
      if (v > 0) lastNonZeroRounds = v;
      prefs.set('agentRounds', v);
    };
    return sel;
  }
  function roundSwitch(): HTMLElement {
    const cur = prefs.get('agentRounds');
    const sw = h<'input'>('input', {
      type: 'checkbox',
      'data-pref': 'agentRoundLimit',
      checked: cur > 0,
      onchange: (e: Event) => {
        const checked = (e.target as HTMLInputElement).checked;
        prefs.set('agentRounds', checked ? (lastNonZeroRounds || 8) : 0);
      },
    });
    return h('label.switch', sw, h('span', t('Stop agent after round limit'), h('small.muted', ' ' + t('(asks before continuing)'))));
  }

  function aiSection(): HTMLElement {
    const modeSel = h<'select'>('select.input', { 'aria-label': t('Default provider') }, h('option', { value: 'auto', selected: cfg.ai.active === 'auto' }, t('Automatic (first provider that is set up, otherwise Ollama)')), ...[...cfg.ai.providers, ...cfg.ai.custom].map((p) => h('option', { value: p.id, selected: cfg.ai.active === p.id }, p.name)));
    modeSel.onchange = () => void setActive(modeSel.value);
    const configuredCount = cfg.ai.providers.filter((p) => p.local || p.hasKey).length + cfg.ai.custom.length;
    const summaryKpi = (label: string, value: string) => h('div.sp-kpi.frame.sm', h('div.well', h('span.muted', label), h('strong.mono', value)));
    return h(
      'div.sp-section',
      h('p.eyebrow', t('AI models')),
      h('h2.duo', t('Providers') + ' ', h('span.tone', t('and keys'))),
      h(
        'div.sp-kpis',
        summaryKpi(t('Default'), cfg.ai.active === 'auto' ? t('Automatic') : [...cfg.ai.providers, ...cfg.ai.custom].find((p) => p.id === cfg.ai.active)?.name || cfg.ai.active),
        summaryKpi(t('Ready'), `${configuredCount} / ${cfg.ai.providers.length + cfg.ai.custom.length}`),
        summaryKpi(t('Own endpoints'), String(cfg.ai.custom.length)),
        summaryKpi(t('Round limit'), prefs.get('agentRounds') > 0 ? String(prefs.get('agentRounds')) : t('Off'))
      ),
      h(
        'div.frame.sm.sp-notice',
        h(
          'div.well',
          h('span', { html: icon('lock', { size: 16 }) }),
          backend.browser
            ? h('p', h('strong', t('Browser mode:') + ' '), t('Keys stay in the memory of this browser until a reload, unless you allow storing them under iPad and network. Requests go straight from the browser to the provider.'))
            : h('p', t('Keys only go to the local backend on this computer and are stored in') + ' ', h('code.mono', '~/workcraft/config.json'), ' ' + t('(readable only by your user account). Requests to providers go through the backend, never straight from the browser. Ollama works fully local.'))
        )
      ),
      h(
        'div.sp-grid',
        h('label.field', h('span', t('Default for the chat')), modeSel),
        h('label.field', h('span', t('Agent round limit')), roundSelect(), h('small.muted', t('Stops after this many tool rounds to ask before continuing.')))
      ),
      h(
        'div.sp-toggles',
        roundSwitch(),
        h('label.switch', h('input', { type: 'checkbox', 'data-pref': 'remoteCount', checked: prefs.get('remoteCount'), onchange: (e: Event) => prefs.set('remoteCount', (e.target as HTMLInputElement).checked) }), h('span', t('Exact token counts from Claude and Gemini while typing'), h('small.muted', ' ' + t('(count_tokens and countTokens see the draft like a request; off: estimate. DeepSeek and ChatGPT always count exactly on this computer)'))))
      ),
      ...cfg.ai.providers.flatMap((p) => (p.id === 'deepseek' ? [providerCard(p), deepseekCard()] : [providerCard(p)])),
      h('p.eyebrow.sp-sub', t('Own endpoints')),
      ...cfg.ai.custom.map((c) => customCard(c)),
      customCard(null)
    );
  }

  // ---------------------------------------------------------------- MCP

  async function mcpSection(): Promise<HTMLElement> {
    const ext = await api.get<{ id: string; name: string; status: string; error?: string; tools: string[]; sandbox?: string }[]>('/api/mcp/external').catch(() => []);
    const builtInCount = orchestrator.ready ? orchestrator.tools().length : 0;
    const mcpUrl = `${location.origin}/mcp`;
    const list = cfg.mcpServers.map((s) => {
      const st = ext.find((e) => e.id === s.id);
      return h(
        'div.sp-mcp-row',
        h('span.sp-dot', { 'data-state': st?.status || 'off' }),
        h('div', h('strong', s.name), h('small.mono.muted', s.transport === 'http' ? String(s.url) : `${s.command} ${s.args.join(' ')}`), (st as { sandbox?: string } | undefined)?.sandbox ? h('small.muted', t('Sandbox applied: {s}', { s: (st as { sandbox?: string }).sandbox! })) : null, st?.error ? h('small.sp-err', st.error) : null, st?.tools.length ? h('small.mono.muted', t('{n} tools: {list}', { n: st.tools.length, list: st.tools.slice(0, 6).join(', ') })) : null),
        h('span.spacer'),
        policySelect(s, 'sandbox', [
          ['strict', t('Sandbox: strict')],
          ['standard', t('Sandbox: standard')],
          ['off', t('Sandbox: off')],
        ]),
        policySelect(s, 'approval', [
          ['ask', t('Ask before every call')],
          ['read', t('Read-only tools run freely')],
          ['all', t('Never ask')],
        ]),
        h('label.switch', h('input', { type: 'checkbox', checked: s.enabled, onchange: (e: Event) => void saveMcp(cfg.mcpServers.map((x) => (x.id === s.id ? { ...x, enabled: (e.target as HTMLInputElement).checked } : x))) }), h('span', t('active'))),
        h('button.icon-btn', { type: 'button', 'aria-label': t('Remove {name}', { name: s.name }), html: icon('trash', { size: 16 }), onclick: () => void saveMcp(cfg.mcpServers.filter((x) => x.id !== s.id)) })
      );
    });
    const name = h<'input'>('input.input', { placeholder: t('Name, for example filesystem') });
    const cmd = h<'input'>('input.input.mono', { placeholder: t('Command (npx -y @modelcontextprotocol/server-everything) or URL (http://127.0.0.1:8188/mcp)'), spellcheck: 'false' });
    return h(
      'div.sp-section',
      h('p.eyebrow', 'Model Context Protocol'),
      h('h2.duo', t('External') + ' ', h('span.tone', t('MCP servers'))),
      h('p.muted', t('WorkCraft itself is an MCP server at') + ' ', h('code.mono', mcpUrl), ' ' + t('(Streamable HTTP). External servers over stdio are then available in the chat under /.')),
      h(
        'div.frame.sp-card',
        { 'data-card': 'mcp-builtin' },
        h(
          'div.well',
          h(
            'div.sp-card-head',
            h('h3.duo', 'WorkCraft MCP ', h('span.tone', builtInCount ? tn(builtInCount, '{n} tool', '{n} tools') : 'Streamable HTTP')),
            h('span.spacer'),
            h('button.btn.ghost.sm', { type: 'button', onclick: () => void navigator.clipboard?.writeText(mcpUrl).then(() => toast(t('Copied'), 'success')) }, t('Copy'))
          ),
          h(
            'div.sp-kvs',
            row(t('Address'), mcpUrl),
            row(t('Apps'), `${APPS.length} (${APPS.filter((a) => AVAILABLE.has(a.id)).length} ${t('ready')})`),
            row(t('External MCP servers'), `${ext.filter((e) => e.status === 'connected').length} / ${cfg.mcpServers.length}`)
          )
        )
      ),
      h('div.frame', h('div.well.flush', list.length ? list : h('p.muted.sp-empty', t('No external servers yet.')))),
      h(
        'div.sp-grid',
        h('label.field', h('span', t('Name')), name),
        h('label.field', h('span', t('Command')), cmd),
        h(
          'div.sp-actions',
          h(
            'button.btn.primary',
            {
              type: 'button',
              onclick: () => {
                const parts = cmd.value.trim().match(/"[^"]*"|\S+/g)?.map((x) => x.replace(/^"|"$/g, '')) || [];
                if (!name.value.trim() || !parts.length) return toast(t('Name and command are required'), 'warning');
                const http = /^https?:\/\//.test(parts[0]!);
                void saveMcp([...cfg.mcpServers, http ? { id: uid('mcp'), name: name.value.trim(), command: 'http', args: [], url: parts[0]!, transport: 'http', enabled: true, sandbox: 'strict', approval: 'ask' } : { id: uid('mcp'), name: name.value.trim(), command: parts[0]!, args: parts.slice(1), enabled: true, transport: 'stdio', sandbox: 'standard', approval: 'ask' }]);
              },
            },
            t('Add server')
          )
        )
      )
    );
  }
  function policySelect(srv: McpEntry, key: 'sandbox' | 'approval', options: [string, string][]): HTMLElement {
    const sel = h<'select'>('select.input.sp-policy', { 'aria-label': key === 'sandbox' ? t('Sandbox of {name}', { name: srv.name }) : t('Approval rule of {name}', { name: srv.name }) }, ...options.map(([v, l]) => h('option', { value: v, selected: (srv[key] || (key === 'sandbox' ? 'standard' : 'ask')) === v }, l)));
    sel.onchange = () => void saveMcp(cfg.mcpServers.map((x) => (x.id === srv.id ? { ...x, [key]: sel.value } : x)));
    return sel;
  }
  async function saveMcp(list: McpEntry[]) {
    try {
      const r = await api.send<{ config: PublicConfig }>('PUT', '/api/config/mcp', list);
      cfg = r.config;
      render();
    } catch (e) {
      notifyError(e);
    }
  }

  // ---------------------------------------------------------------- Appearance and layout

  function choice<K extends 'theme' | 'renderer' | 'appDownloads' | 'chatSide' | 'iconsOnly' | 'fingerTyping' | 'penBarrel' | 'touchKeys' | 'voiceEngine' | 'chatPetTheme' | 'chatPetAccessory'>(key: K, label: string, options: [string, string][], hint?: string): HTMLElement {
    const sel = h<'select'>('select.input', { 'data-pref': key }, ...options.map(([v, l]) => h('option', { value: v, selected: prefs.get(key) === v }, l)));
    sel.onchange = () => prefs.set(key, sel.value as never);
    return h('label.field', h('span', label), sel, hint ? h('small.muted', hint) : null);
  }
  function toggle(key: 'sounds' | 'autoOpenPanels' | 'statusbar' | 'panelFooters' | 'focusMode' | 'topbarHidden' | 'railHidden' | 'penScratch' | 'chatPet' | 'chatPetAccent', label: string, hint?: string): HTMLElement {
    return h('label.switch', h('input', { type: 'checkbox', 'data-pref': key, checked: prefs.get(key), onchange: (e: Event) => prefs.set(key, (e.target as HTMLInputElement).checked) }), h('span', label, hint ? h('small.muted', ' ' + hint) : null));
  }
  /** Voice input: which recognizer, whether Handy is found and has a model, where it lives. */
  function voiceBlock(): HTMLElement {
    const status = h('p.muted.mono', { role: 'status' }, t('Checking for Handy …'));
    const path = h<'input'>('input.input.mono', { placeholder: t('Automatic (the usual places)'), 'aria-label': t('Path of the Handy program'), spellcheck: 'false' });
    const model = h<'select'>('select.input', { 'aria-label': t('Handy model'), 'data-pref': 'voiceModel' });
    const lang = h<'input'>('input.input', { placeholder: t('Language of the browser'), 'aria-label': t('Language for browser speech'), value: prefs.get('voiceLang'), spellcheck: 'false' });
    lang.onchange = () => prefs.set('voiceLang', lang.value.trim());
    const save = async () => {
      try {
        await api.send('PUT', '/api/voice', { handyPath: path.value, model: model.value });
        await paint(true);
      } catch (e) {
        notifyError(e);
      }
    };
    path.onchange = () => void save();
    model.onchange = () => void save();
    async function paint(fresh = false) {
      const st = await voiceStatus(fresh);
      if (!st) {
        status.textContent = t('Handy is available with the desktop version of WorkCraft. The browser speech recognizer works everywhere it exists.');
        path.disabled = model.disabled = true;
        return;
      }
      path.disabled = model.disabled = false;
      path.value = st.settings.handyPath;
      model.replaceChildren(h('option', { value: '' }, t('The model chosen in Handy')), ...st.models.map((m) => h('option', { value: m.id, selected: st.settings.model === m.id }, `${m.name}${m.streaming ? ' · ' + t('streaming') : ''}`)));
      status.textContent = !st.installed ? t('Handy was not found. Install it from github.com/cjpais/Handy or enter its path below.') : st.ready ? t('Handy is ready: {n} speech model(s) downloaded. Audio stays on this computer.', { n: st.models.length }) : st.message;
      status.dataset.state = st.ready ? 'ok' : 'warn';
      // Handy 0.10 (November 2026) detects the language by itself and handles long recordings; say when the installed one is older
      if (st.installed && st.version) status.textContent += ' ' + (st.outdated ? t('Handy {v} is installed; {latest} is out (language detection, better long recordings). Update from github.com/cjpais/Handy/releases.', { v: st.version, latest: st.latest || '' }) : t('Handy {v}.', { v: st.version }));
    }
    void paint();
    return h(
      'div',
      h('p.eyebrow.sp-sub', t('Voice input')),
      h(
        'div.sp-grid',
        choice(
          'voiceEngine',
          t('Speech engine'),
          [
            ['auto', t('Automatic')],
            ['handy', t('Handy (offline)')],
            ['browser', t('Browser')],
          ],
          t('Automatic: Handy (offline) when it is there, otherwise the browser. Handy runs the speech models of your computer and sends nothing to a cloud. The browser recognizer shows words live, but Chrome and Edge send the audio to the browser maker and Safari to Apple.')
        ),
        h('label.field', h('span', t('Browser speech language')), lang, h('small.muted', t('For example de-DE or en-GB. Handy uses the language of its model.')))
      ),
      h('div.sp-grid', h('label.field', h('span', t('Handy program')), path), h('label.field', h('span', t('Handy model')), model)),
      status,
      h('button.btn.sm', { type: 'button', onclick: () => void paint(true) }, t('Check again'))
    );
  }
  /** What each app does with the color scheme switch: follows it, has a setting of its own, or is always light or dark (src/ecosystems/theme.ts). */
  function themeTable(): HTMLElement {
    const chip = (a: (typeof APPS)[number]) => {
      const th = themeOf(a);
      const kind = kindOf(th);
      const label = kind === 'follows' ? t('Follows the switch') : kind === 'own' ? t('Own setting, {look}', { look: th.look === 'light' ? t('light') : t('dark') }) : kind === 'always-light' ? t('Always light') : t('Always dark');
      const tip = kind === 'follows' ? t('Follows the color scheme switch of the workspace') : kind === 'own' ? t('Has a light and dark setting inside the app. WorkCraft cannot set it from outside yet, so it shows {look} until you change it in the app.', { look: th.look === 'light' ? t('light') : t('dark') }) : kind === 'always-light' ? t('This app only has a light look; its panel stays light') : t('This app only has a dark look; its panel stays dark');
      return statusChip(kind === 'follows' ? 'ok' : 'off', label, kind === 'follows' ? 'check' : kind === 'always-light' ? 'sun' : kind === 'always-dark' ? 'moon' : 'settings', tip, false);
    };
    const counts = { follows: 0, own: 0, fixed: 0 };
    for (const a of APPS) {
      const k = kindOf(themeOf(a));
      if (k === 'follows') counts.follows++;
      else if (k === 'own') counts.own++;
      else counts.fixed++;
    }
    const rows = APPS.map((a) => h('div.sp-row.theme-row', { 'data-app': a.id, 'data-kind': kindOf(themeOf(a)) }, h('img.tool-logo', { src: `${ROOT}assets/craft/${a.id}.png`, width: 20, height: 20, alt: '', decoding: 'async' }), h('strong', a.name), h('small.muted', ` · ${t(a.kind)}`), h('span.spacer'), chip(a)));
    return h(
      'div',
      h('p.eyebrow.sp-sub', t('Apps and the color scheme')),
      h('p.muted', t('{a} apps follow the switch, {b} have a light and dark setting of their own that WorkCraft cannot set from outside yet, and {c} have one look only. The panel around an app is painted to match the look it keeps.', { a: String(counts.follows), b: String(counts.own), c: String(counts.fixed) })),
      h('div.theme-table', ...rows)
    );
  }
  function viewSection(): HTMLElement {
    const unload = h<'select'>('select.input', {}, ...[0, 5, 15, 30, 60].map((m) => h('option', { value: String(m), selected: prefs.get('autoUnloadMinutes') === m }, m ? t('after {n} minutes', { n: m }) : t('never (the state is kept)'))));
    unload.onchange = () => prefs.set('autoUnloadMinutes', Number(unload.value));
    const langSel = h<'select'>('select.input', { 'data-pref': 'lang' }, ...LANGS.map((l) => h('option', { value: l.id, selected: l.id === lang }, LANG_LABELS[l.id])));
    langSel.onchange = () => setLang(langSel.value as 'en' | 'de');
    return h(
      'div.sp-section',
      h('p.eyebrow', t('Appearance and layout')),
      h('h2.duo', t('Interface') + ' ', h('span.tone', t('and performance'))),
      h(
        'div.sp-grid',
        choice(
          'theme',
          t('Color scheme'),
          [
            ['system', t('System')],
            ['light', t('Light')],
            ['dark', t('Dark')],
          ],
          t('The one switch for the workspace, the chat and every app that supports both modes. An app that is only light or only dark keeps its own look; the list below says which.')
        ),
        h('label.field', h('span', t('Language')), langSel),
        choice(
          'renderer',
          t('Graphics'),
          [
            ['auto', t('Automatic')],
            ['webgl', t('WebGL2')],
          ],
          t('Automatic uses WebGPU when the browser has it and WebGL2 otherwise.')
        ),
        choice(
          'appDownloads',
          t('Saving'),
          [
            ['project', t('Project only')],
            ['both', t('Project and downloads')],
          ],
          t('Where the apps put a file you save: only into the project, or also into the downloads folder.')
        ),
        h('label.field', h('span', t('Unload hidden apps')), unload)
      ),
      themeTable(),
      h('p.eyebrow.sp-sub', t('AI chat')),
      h(
        'div.sp-grid',
        choice('chatSide', t('Chat dock'), [
          ['right', t('Right')],
          ['left', t('Left')],
        ]),
        h('label.field', h('span', t('Round limit')), roundSelect(), h('small.muted', t('Stops after this many tool rounds to ask before continuing.'))),
        h(
          'div.field',
          h('span', t('Full Chat Mode')),
          h('button.btn', { type: 'button', 'data-action': 'full-chat', onclick: () => workspace.setFullChat(true), html: icon('chat', { size: 15 }) + `<span>${t('Open')}</span>` }),
          h('small.muted', t('Also with the chat launcher in the top bar, the command palette or the address ?mode=chat.'))
        )
      ),
      h('p.eyebrow.sp-sub', t('Layout')),
      h(
        'div.sp-toggles',
        toggle('topbarHidden', t('Hide the top bar'), t('(a handle at the top edge brings it back)')),
        toggle('railHidden', t('Hide the tool rail')),
        toggle('focusMode', t('Focus mode'), t('(hides the top bar and the tool rail)')),
        toggle('statusbar', t('Status bar at the bottom'), t('(the same details are on the Status page)')),
        toggle('panelFooters', t('Footer line under each panel'), t('(file status, renderer, start time)'))
      ),
      h(
        'div.sp-grid',
        choice(
          'iconsOnly',
          t('Icon-only buttons'),
          [
            ['auto', t('Automatic')],
            ['on', t('Always')],
            ['off', t('Never')],
          ],
          t('Automatic switches to icons on the iPad and in narrow windows. Icons keep every touch target at 44 px and give the content more room.')
        )
      ),
      h('p.eyebrow.sp-sub', t('Apple Pencil and touch')),
      h(
        'div.sp-grid',
        choice(
          'fingerTyping',
          t('Finger typing'),
          [
            ['auto', t('Auto')],
            ['never', t('Never')],
            ['always', t('Always')],
          ],
          t('Whether a finger tap opens the on-screen keyboard. Auto: until the Apple Pencil is used. Never: the pencil writes (Scribble). The keyboard button in the chat input always opens it.')
        ),
        choice(
          'penBarrel',
          t('Pencil button'),
          [
            ['eraser', t('Eraser')],
            ['toggle', t('Pen / eraser')],
            ['off', t('Off')],
          ],
          t('Safari does not report the Apple Pencil double tap. A squeeze that arrives as a button press uses this setting; E and the toolbar switch the tool anywhere.')
        ),
        choice(
          'touchKeys',
          t('Touch keys'),
          [
            ['auto', t('Auto')],
            ['on', t('Always')],
            ['off', t('Never')],
          ],
          t('A bar of shortcut buttons in FilmCraft and ProCraft, which are worked with keys. Auto: on a touch screen until a hardware keyboard is used.')
        )
      ),
      h('div.sp-toggles', toggle('penScratch', t('Scribble over ink deletes it'), t('(PdfCraft pencil view)'))),
      voiceBlock(),
      h('p.eyebrow.sp-sub', t('Behavior')),
      h('div.sp-toggles', toggle('autoOpenPanels', t('Open panels when the AI edits a file')), roundSwitch(), toggle('sounds', t('Sounds'))),
      h('p.eyebrow.sp-sub', t('Companion (Blip)')),
      h('div.sp-toggles', toggle('chatPet', t('Show Blip in the chat'), t('(a small animated helper that thinks, works, listens and celebrates with the AI)')), toggle('chatPetAccent', t('Chat accent follows Blip'), t('(the send button and active switches take Blip color)'))),
      h(
        'div.sp-grid',
        choice('chatPetTheme', t('Color'), ['blue', 'indigo', 'ice', 'teal', 'amber', 'coral', 'emerald', 'mono'].map((c): [string, string] => [c, t(c[0]!.toUpperCase() + c.slice(1))])),
        choice('chatPetAccessory', t('Accessory'), [['', t('None')], ['glasses', t('Glasses')], ['headset', t('Headset')], ['crown', t('Crown')], ['coffee', t('Coffee')], ['hardhat', t('Hardhat')]], t('What Blip wears. The headset also appears by itself while Blip listens to the microphone.'))
      )
    );
  }

  // ---------------------------------------------------------------- Usage and telemetry

  async function usageSection(): Promise<HTMLElement> {
    let store: UsageStore;
    try {
      store = await telemetry.get();
    } catch (e) {
      return h('div.sp-section', h('p.eyebrow', t('Usage and telemetry')), h('p.muted', (e as Error).message));
    }
    const tot = usageTotals(store);
    const kpi = (label: string, value: string) => h('div.sp-kpi.frame.sm', h('div.well', h('span.muted', label), h('strong.mono', value)));
    // Rate table: one row per model seen so far, plus rows already set
    const models = [...new Set([...Object.values(store.rows).filter((r) => !r.local).map((r) => r.model), ...Object.keys(store.rates)])].sort();
    const inputs = new Map<string, { input: HTMLInputElement; output: HTMLInputElement; cached: HTMLInputElement; write: HTMLInputElement }>();
    const numIn = (v: number | undefined, label: string) => h<'input'>('input.input.mono', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: v === undefined ? '' : String(v), 'aria-label': label, placeholder: '0.00' });
    const rateRows = models.map((m) => {
      const r = store.rates[m];
      const row = { input: numIn(r?.input, t('Input rate for {model}', { model: m })), output: numIn(r?.output, t('Output rate for {model}', { model: m })), cached: numIn(r?.cached, t('Cached input rate for {model}', { model: m })), write: numIn(r?.cacheWrite, t('Cache write rate for {model}', { model: m })) };
      inputs.set(m, row);
      return h('tr', { 'data-model': m }, h('td.mono', m), h('td', row.input), h('td', row.cached), h('td', row.write), h('td', row.output));
    });
    const newModel = h<'input'>('input.input.mono', { placeholder: t('model name, for example gpt-5'), 'aria-label': t('Model name') });
    const saveRates = async () => {
      const rates: Record<string, Rate> = {};
      for (const [m, r] of inputs) {
        const input = parseFloat(r.input.value);
        const output = parseFloat(r.output.value);
        const cached = parseFloat(r.cached.value);
        const write = parseFloat(r.write.value);
        if (!isFinite(input) && !isFinite(output)) continue;
        rates[m] = { input: isFinite(input) ? input : 0, output: isFinite(output) ? output : 0, ...(isFinite(cached) ? { cached } : {}), ...(isFinite(write) ? { cacheWrite: write } : {}) };
      }
      const add = newModel.value.trim();
      if (add && !rates[add]) rates[add] = { input: 0, output: 0 };
      try {
        await telemetry.setRates(rates);
        toast(t('Rates saved'), 'success');
        render();
      } catch (e) {
        notifyError(e);
      }
    };
    return h(
      'div.sp-section.sp-usage',
      h('p.eyebrow', t('Usage and telemetry')),
      h('h2.duo', t('API usage') + ' ', h('span.tone', t('across all providers'))),
      h('p.muted', t('Every answer counts its tokens: the exact numbers of the provider, or an estimate (≈) when an endpoint sends none. Only numbers are stored, no content. Since {date}.', { date: new Date(store.since).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US') })),
      h('div.sp-kpis', kpi(t('Requests'), String(tot.requests)), kpi(t('Input tokens'), compactTokens(tot.input)), kpi(t('Output tokens'), compactTokens(tot.output)), kpi(t('Cached tokens'), compactTokens(tot.cached)), kpi(t('Estimated cost'), money(tot.cost))),
      h('p.eyebrow.sp-sub', t('Context cache and thinking')),
      h('p.muted', t('Every provider reports its cache hits: DeepSeek prompt_cache_hit_tokens, ChatGPT cached_tokens, Claude cache_read_input_tokens (and cache writes), Gemini cachedContentTokenCount. Hits are billed at the cached input rate; the savings need both rates below.')),
      h('div.sp-kpis.sp-cache-kpis', kpi(t('Cache hit ratio'), tot.input ? percent(tot.cached / tot.input) : '–'), kpi(t('Cache hits'), compactTokens(tot.cached)), kpi(t('Cache misses'), compactTokens(tot.cacheMiss)), kpi(t('Thinking tokens'), compactTokens(tot.reasoning)), kpi(t('Saved by the cache'), money(tot.savings))),
      h('p.eyebrow.sp-sub', t('Providers side by side')),
      h('p.muted', t('Input, output and thinking tokens, cache hits and misses with the hit ratio and the money the cache saved, time to the first token, speed and the share of successful MCP tool calls.')),
      providerTable(store),
      h('p.eyebrow.sp-sub', t('By provider and model')),
      usageTable(store),
      h('p.eyebrow.sp-sub', t('Rates')),
      h('p.muted', t('US dollars per million tokens, from the price list of your provider. Local models (Ollama) always cost $0.00. Without a rate the cost stays $0.00.')),
      h(
        'div.usage-table.mono.sp-rates',
        h('table', h('thead', h('tr', h('th', t('Model')), h('th', t('Input')), h('th', t('Cached input')), h('th', t('Cache write')), h('th', t('Output')))), h('tbody', rateRows.length ? rateRows : h('tr', h('td', { colspan: '5' }, t('Models appear here after their first request. You can also add one below.')))))
      ),
      h('div.sp-actions', newModel, h('button.btn.primary', { type: 'button', 'data-action': 'save-rates', onclick: () => void saveRates() }, t('Save rates'))),
      h('p.eyebrow.sp-sub', t('Reset')),
      h(
        'div.sp-actions',
        h('button.btn.danger', {
          type: 'button',
          'data-action': 'reset-usage',
          onclick: async () => {
            if (!(await confirmDanger(t('Reset usage statistics'), t('All counted requests and tokens are deleted. The rates stay.'), t('Reset')))) return;
            try {
              await telemetry.reset();
              toast(t('Usage statistics reset'), 'success');
              render();
            } catch (e) {
              notifyError(e);
            }
          },
          html: icon('trash', { size: 14 }) + `<span>${t('Reset usage statistics')}</span>`,
        }),
        h('button.btn', { type: 'button', onclick: () => render(), html: icon('refresh', { size: 14 }) + `<span>${t('Refresh')}</span>` })
      )
    );
  }

  // ---------------------------------------------------------------- iPad and network

  async function deviceSection(): Promise<HTMLElement> {
    const d = device.info;
    const remote = document.documentElement.dataset.backend === 'remote';
    const modeText = backend.browser ? t('Browser mode (IndexedDB)') : remote ? t('Desktop PC on the home network') : t('Desktop backend on this computer');
    const wm: Record<string, string> = { full: t('Full screen'), stage: 'Stage Manager', split: 'Split View', slide: t('Slide Over or narrow') };
    const out = h(
      'div.sp-section.sp-device',
      h('p.eyebrow', 'iPadOS'),
      h('h2.duo', 'iPad ', h('span.tone', t('and network'))),
      h(
        'div.frame.sp-card',
        { 'data-card': 'device' },
        h(
          'div.well',
          h('div.sp-card-head', h('h3.duo', t('This device') + ' ', h('span.tone', d.ipad ? 'iPad' : d.touch ? 'Touch' : 'Desktop'))),
          h(
            'div.sp-kvs',
            row(t('Mode'), modeText, false),
            row(t('iPadOS detected'), d.ipad ? t('yes (touch hardware, desktop identifier)') : t('no')),
            row(t('Input'), [d.touch ? t('Finger') : '', d.fine ? t('Pencil or trackpad') : '', d.hover ? t('Hover') : ''].filter(Boolean).join(' · ') || t('Mouse')),
            row(t('Window'), `${wm[d.windowMode]} · ${d.orientation === 'portrait' ? t('portrait') : t('landscape')} · ${Math.round(d.viewport.width)} × ${Math.round(d.viewport.height)}`),
            row(t('Pixel ratio'), `${d.dpr} (${t('apps')} ${d.renderDpr})`),
            row(t('Graphics of the apps'), wantsWebgl() ? (d.secure ? 'WebGL2' : t('WebGL2 (HTTP on the home network, no WebGPU)')) : 'WebGPU'),
            row(t('Offline cache'), d.secure ? t('available') : t('not over HTTP (service workers need HTTPS)'))
          )
        )
      )
    );

    // ---------- Desktop: share on the home network ----------
    if (!backend.browser && !remote) {
      const lan = await api.get<LanInfo>('/api/lan').catch(() => null);
      if (lan) {
        const tokenEl = h<'input'>('input.input.mono', { value: lan.token || '', readonly: true, type: 'password', 'aria-label': t('Access token') });
        const show = h<'button'>('button.btn.ghost', { type: 'button', onclick: () => (tokenEl.type = tokenEl.type === 'password' ? 'text' : 'password') }, t('Show'));
        const copy = h<'button'>('button.btn.ghost', { type: 'button', onclick: () => void navigator.clipboard?.writeText(lan.token || '').then(() => toast(t('Token copied'), 'success')) }, t('Copy'));
        const rotate = h<'button'>('button.btn.ghost.danger', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmDanger(t('New access token'), t('Paired devices have to pair again afterwards.'), t('Renew')))) return;
            await api.send('POST', '/api/lan/token');
            render();
          },
        }, t('Renew'));
        const enabled = h<'input'>('input', { type: 'checkbox', checked: lan.enabled, 'data-lan-toggle': '' });
        enabled.onchange = async () => {
          const r = await api.send<{ enabled: boolean; restart: boolean }>('PUT', '/api/lan', { enabled: enabled.checked });
          toast(r.enabled ? t('Home network mode on') : t('Home network mode off'), 'success', r.restart ? t('Takes effect after restarting the backend (npm start or npm run dev).') : undefined);
          render();
        };
        out.append(
          h(
            'div.frame.sp-card',
            { 'data-card': 'lan' },
            h(
              'div.well',
              h('div.sp-card-head', h('h3.duo', t('Home network') + ' ', h('span.tone', lan.active ? t('active') : t('off'))), h('span.spacer'), h('label.switch', enabled, h('span', t('Share on Wi-Fi')))),
              h('p.muted', t('The backend then listens on 0.0.0.0. Other devices need the access token. The iPad uses the projects, the real terminal and Ollama of this PC. Ollama stays local, only the backend talks to it.')),
              h('label.field', h('span', t('Access token')), h('div.sp-inline', tokenEl, show, copy, rotate)),
              lan.active
                ? h(
                    'div.sp-urls',
                    h('span.muted', t('Scan the code with the iPad camera, or open the address in Safari (pairs once):')),
                    ...lan.urls.map((u) => h('div.sp-pair', h('div.sp-qr', { 'data-qr': u, role: 'img', 'aria-label': t('QR code with the pairing address'), html: qrSvg(u, { label: t('QR code with the pairing address') }) }), h('code.mono.sp-url', u))),
                    h('p.muted.sp-qr-note', t('The code contains the access token: show it only to your own devices. Renew the token above to cancel old pairings.'))
                  )
                : h('p.muted', lan.enabled ? t('Switched on. Restart the backend, then the addresses show up here.') : t('Start without this setting: npm run dev:lan or npm run start:lan.'))
            )
          )
        );
      }
    }

    // ---------- iPad: connect to the desktop ----------
    const saved = savedDesktop();
    const host = h<'input'>('input.input.mono', { value: saved.host, placeholder: '192.168.178.20', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('IP address of the desktop PC'), 'data-field': 'lan-host' });
    const port = h<'input'>('input.input.mono', { value: saved.port, inputmode: 'numeric', 'aria-label': 'Port', 'data-field': 'lan-port' });
    const token = h<'input'>('input.input.mono', { value: saved.token, type: 'password', placeholder: t('Access token from the desktop'), autocomplete: 'off', 'data-field': 'lan-token' });
    const remember = h<'input'>('input', { type: 'checkbox', checked: !!saved.token });
    allowScribble(host);
    const connect = h<'button'>('button.btn.primary', {
      type: 'button',
      'data-action': 'lan-connect',
      onclick: () => {
        const ip = host.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const pt = port.value.trim() || '5175';
        if (!/^[\w.-]+$/.test(ip) || !/^\d{2,5}$/.test(pt)) return toast(t('Check the IP address and port'), 'warning', t('Example: 192.168.178.20 and 5175'));
        if (!token.value.trim()) return toast(t('The access token is missing'), 'warning', t('It is on the desktop in the settings under iPad and network.'));
        try {
          localStorage.setItem(DESKTOP_KEY, JSON.stringify({ host: ip, port: pt, token: remember.checked ? token.value.trim() : '' }));
        } catch {
          /* storage blocked */
        }
        location.href = `http://${ip}:${pt}/pair?token=${encodeURIComponent(token.value.trim())}`;
      },
    }, t('Connect to desktop'));
    out.append(
      h(
        'div.frame.sp-card',
        { 'data-card': 'connect' },
        h(
          'div.well',
          h('div.sp-card-head', h('h3.duo', t('Desktop PC') + ' ', h('span.tone', t('on the home network')))),
          h('p.muted', t('Enter the local IP address of the desktop PC. WorkCraft then opens straight from the PC, on the same Wi-Fi. On the road it switches to browser mode by itself.')),
          h('div.sp-grid', h('label.field', h('span', t('IP address')), host), h('label.field', h('span', 'Port'), port), h('label.field', h('span', t('Access token')), token)),
          h('label.switch', remember, h('span', t('Remember the token on this device'))),
          h('div.sp-actions', connect, h('small.muted', t('Over HTTP on the home network the apps run with WebGL2. Service workers and WebGPU need HTTPS.')))
        )
      )
    );

    // ---------- Browser mode: keys and file exchange ----------
    if (backend.browser) {
      const { keyStore, importFiles, wipeBrowserData } = await import('../../app/offline.js');
      const persist = h<'input'>('input', { type: 'checkbox', checked: keyStore.persistent, 'data-keys-persist': '' });
      persist.onchange = async () => {
        if (persist.checked) {
          const ok = await confirmDanger(t('Store API keys permanently'), t('The keys for Claude, ChatGPT, Gemini and DeepSeek are then stored unencrypted in the browser storage (localStorage) of this iPad. Any extension or person with access to this device and browser profile can read them. Use keys with a spending limit.'), t('Allow storing'));
          if (!ok) return void (persist.checked = false);
        }
        keyStore.setPersistent(persist.checked);
        toast(persist.checked ? t('Keys are stored in this browser') : t('Keys only until the next reload'), 'info');
        await aiConfig.changed();
      };
      const fileIn = h<'input'>('input', { type: 'file', multiple: true, hidden: true, 'data-import-files': '' });
      fileIn.onchange = async () => {
        const list = [...(fileIn.files || [])];
        fileIn.value = '';
        if (!list.length) return;
        const paths = await importFiles(list);
        await fs.reload();
        toast(tn(paths.length, '{n} file imported', '{n} files imported'), 'success', paths.join(', '));
      };
      const pick = h<'select'>('select.input.mono', { 'aria-label': t('File to export') }, ...fs.files().map((f) => h('option', { value: f.path }, f.path)));
      out.append(
        h(
          'div.frame.sp-card.sp-warn',
          { 'data-card': 'keys' },
          h(
            'div.well',
            h('div.sp-card-head', h('h3.duo', t('API keys') + ' ', h('span.tone', t('in the browser')))),
            h(
              'div.frame.sm.sp-notice.is-warn',
              h('div.well', h('span', { html: icon('alert', { size: 16 }) }), h('p', h('strong', t('Local storage:') + ' '), t('Without the desktop backend there is no protected key store. Only allow storing on your own iPad. Without permission keys last until the page reloads.')))
            ),
            h('label.switch', persist, h('span', t('Store keys for Claude, ChatGPT, Gemini and DeepSeek in this browser'))),
            h('div.sp-actions', h('button.btn', { type: 'button', onclick: () => ((section = 'ai'), render()) }, t('Enter keys')))
          )
        ),
        h(
          'div.frame.sp-card',
          { 'data-card': 'files' },
          h(
            'div.well',
            h('div.sp-card-head', h('h3.duo', t('Files') + ' ', h('span.tone', t('exchange')))),
            h('p.muted', t('The iPadOS file dialog opens the Files app, iCloud Drive and connected drives. Export uses the share sheet (Save to Files).')),
            h(
              'div.sp-actions',
              h('button.btn', { type: 'button', 'data-action': 'import-files', html: icon('upload', { size: 16 }) + `<span>${t('Import files')}</span>`, onclick: () => fileIn.click() }),
              h('button.btn', { type: 'button', 'data-action': 'import-zip', html: icon('archive', { size: 16 }) + `<span>${t('Import project ZIP')}</span>`, onclick: () => projects.pickZip() }),
              h('button.btn', {
                type: 'button',
                'data-action': 'export-zip',
                html: icon('download', { size: 16 }) + `<span>${t('Project as ZIP')}</span>`,
                onclick: async () => {
                  const p = projects.current;
                  if (!p) return;
                  const bytes = await api.bytes(`/api/projects/${encodeURIComponent(p.id)}/export`);
                  await shareOrDownload(new Blob([bytes], { type: 'application/zip' }), `${p.name.replace(/[^\p{L}\p{N}_-]+/gu, '-')}.zip`);
                },
              })
            ),
            h(
              'div.sp-inline',
              pick,
              h('button.btn', {
                type: 'button',
                'data-action': 'export-file',
                onclick: async () => {
                  if (!pick.value) return;
                  const data = await fs.readBinary(normPath(pick.value));
                  await shareOrDownload(new Blob([data]), basename(pick.value));
                },
              }, t('Export file'))
            ),
            fileIn
          )
        ),
        h(
          'div.sp-actions',
          h('button.btn.ghost.danger', {
            type: 'button',
            onclick: async () => {
              if (!(await confirmDanger(t('Delete browser data'), t('All projects, chats and keys of browser mode on this device are deleted.'), t('Delete everything')))) return;
              await wipeBrowserData();
              keyStore.setPersistent(false);
              location.reload();
            },
          }, t('Delete browser data'))
        )
      );
    }
    return out;
  }

  const offOpen = bus.on('open-settings', (s) => {
    if (s && SECTIONS.some(([id]) => id === s)) {
      section = s as Section;
      render();
    }
  });
  const offSettings = bus.on('settings:change', ({ key }) => {
    if (key === 'agentRounds') {
      const val = prefs.get('agentRounds');
      if (val > 0) lastNonZeroRounds = val;
      for (const sel of el.querySelectorAll<HTMLSelectElement>('select[data-pref="agentRounds"]')) {
        sel.value = String(val);
      }
      for (const chk of el.querySelectorAll<HTMLInputElement>('input[data-pref="agentRoundLimit"]')) {
        chk.checked = val > 0;
      }
    }
  });
  // The Status page updates itself while it is open (skip while typing in the search filter)
  const refreshStatus = () => {
    if (section !== 'status' || !el.isConnected || el.closest('[hidden]')) return;
    const activeEl = document.activeElement;
    if (activeEl && body.contains(activeEl) && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')) return;
    body.replaceChildren(statusSection());
  };
  const offs = [bus.on('workspace:change', refreshStatus), bus.on('workspace:resources', refreshStatus), bus.on('status:change', refreshStatus), bus.on('ai:status', refreshStatus), bus.on('ws:state', refreshStatus)];
  const tick = setInterval(refreshStatus, 2000);
  await reload();
  ctx.setStatus(t('Configuration in the local backend'));

  return {
    open: async () => {},
    getScroll: () => ({ top: body.scrollTop, left: 0 }),
    setScroll: (s) => void (body.scrollTop = s.top),
    status: () => ({ section, standard: cfg.ai.active }),
    unmount() {
      offOpen();
      offSettings();
      offsUpdates?.();
      for (const off of offs) off();
      clearInterval(tick);
      root.remove();
    },
  };
}
