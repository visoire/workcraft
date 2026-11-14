// Settings pages for connections: the Craft apps on this computer (as MCP servers), cloud storage (Google
// Drive, iCloud Drive, synced folders) and the bridge for other IDEs and agent platforms.
// settings.ts mounts them next to the pages of settings-extra.ts.

import { h, ROOT } from '../../app/util.js';
import { icon } from '../../app/icons.js';
import { api, backend } from '../../app/backend.js';
import { projects } from '../../project/manager.js';
import { toast, notifyError } from '../../app/notifications.js';
import { confirmDanger } from '../../app/ui.js';
import { t, locale } from '../../app/i18n.js';
import { AVAILABLE, TOOLS, type ToolId } from '../registry.js';
import { APPS, appById, type CraftId } from '../../ecosystems/catalog.js';
import { appVersionState, appVersionTitle } from '../../app/updates.js';
import { workspace } from '../layout.js';
import type { ExtraContext } from './settings-extra.js';

export type ConnectSection = 'craft' | 'cloud' | 'bridge';

const card = (title: string, tone: string, ...children: (Node | null | false)[]) => h('div.frame.sp-card', h('div.well', h('div.sp-card-head', h('h3.duo', title + ' ', h('span.tone', tone))), ...children.filter((c): c is Node => !!c)));
const section = (eyebrow: string, title: string, tone: string, ...children: (Node | null | false)[]) => h('div.sp-section', h('p.eyebrow', eyebrow), h('h2.duo', title + ' ', h('span.tone', tone)), ...children.filter((c): c is Node => !!c));
const note = (text: string, warn = false) => h('div.frame.sm.sp-notice' + (warn ? '.is-warn' : ''), h('div.well', h('span', { html: icon(warn ? 'alert' : 'info', { size: 16 }) }), h('p', text)));
const btn = (label: string, ic: string, run: () => unknown, cls = '', action = '') => h<'button'>('button.btn' + cls, { type: 'button', ...(action ? { 'data-action': action } : {}), html: icon(ic, { size: 14 }) + `<span>${label}</span>`, onclick: () => void run() });
const dot = (state: 'on' | 'off' | 'error' | 'warn', text: string) => h('span.sp-state', h('span.sp-dot', { 'data-state': state === 'on' ? 'connected' : state }), h('span', text));
const sw = (checked: boolean, label: string, onchange: (v: boolean) => unknown, hint?: string, attr: Record<string, string> = {}) => {
  const input = h<'input'>('input', { type: 'checkbox', checked, ...attr });
  input.onchange = () => void onchange(input.checked);
  return h('label.switch', input, h('span', label, hint ? h('small.muted', ' ' + hint) : null));
};
const field = (label: string, input: HTMLElement, hint?: string) => h('label.field', h('span', label), input, hint ? h('small.muted', hint) : null);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : t('never'));

export function connectSections(x: ExtraContext): Record<ConnectSection, () => Promise<HTMLElement>> {
  return { craft: () => craftSection(x), cloud: () => cloudSection(x), bridge: () => bridgeSection() };
}

// ---------------------------------------------------------------- Craft apps

interface CraftRow {
  id: string;
  name: string;
  kind: string;
  installed: boolean;
  live: boolean;
  enabled: boolean;
  connected: boolean;
  /** The app belongs to the workspace in use */
  workspace?: boolean;
  /** Tools of its MCP server when connected */
  tools?: number;
  /** Why the connection failed, and when the next try happens by itself */
  error?: string;
  attempts?: number;
  retry_in_s?: number;
}
interface CraftState {
  apps: CraftRow[];
  approval: 'ask' | 'read' | 'all';
}

async function craftSection(x: ExtraContext): Promise<HTMLElement> {
  let s = await api.get<CraftState>('/api/craft');
  const put = async (body: Record<string, unknown>) => {
    s = await api.send<CraftState>('PUT', '/api/craft', body);
    x.render();
  };
  const reconnect = async (ids?: string[]) => {
    try {
      await api.send<CraftState>('POST', '/api/craft/reconnect', ids ? { ids } : {});
      toast(t('Connecting again'), 'info');
      x.render();
    } catch (e) {
      notifyError(e);
    }
  };
  // The apps of the workspace in use first: those are the ones the AI is asked to work with
  const ordered = [...s.apps].sort((a, b) => Number(!!b.workspace) - Number(!!a.workspace) || Number(b.installed) - Number(a.installed));
  const rows = ordered.map((a) => {
    const catApp = appById(a.id);
    const tool = TOOLS[a.id as ToolId];
    const vState = catApp ? appVersionState(a.id as CraftId) : 'missing';
    const vTitle = catApp ? appVersionTitle(a.id as CraftId) : '';
    const logoImg = h('img.tool-logo', { src: `${ROOT}assets/craft/${a.id}.png`, width: 28, height: 28, alt: '', decoding: 'async' });
    const iconLink = catApp
      ? h('a.sp-app-repo.is-repo-link', {
          href: `https://github.com/${catApp.repo}`,
          target: '_blank',
          rel: 'noopener',
          title: t('{name} on GitHub ({repo})', { name: a.name, repo: catApp.repo }),
        }, logoImg)
      : logoImg;
    return h(
      'div.sp-row.craft-row',
      { 'data-app': a.id, 'data-ver-state': vState },
      iconLink,
      h(
        'span.craft-name',
        h('strong', a.name),
        tool?.available ? h('span.ver-pill.mono', { 'data-ver-state': vState, title: vTitle }, ` v${tool.version}`) : null,
        h('small.muted', ` · ${t(a.kind)}`),
        a.workspace ? h('span.pill.mono', { title: t('This app belongs to the workspace you are in') }, t('this workspace')) : null,
        // The reason, in plain words, instead of "starting" forever
        a.error ? h('small.sp-err', { 'data-craft-error': a.id }, ` ${a.error.slice(0, 160)}${a.retry_in_s ? ' · ' + t('next try in {n} s', { n: String(a.retry_in_s) }) : ''}`) : null
      ),
      h('span.spacer'),
      a.installed ? dot(a.connected ? 'on' : a.error ? 'error' : a.enabled ? 'warn' : 'off', a.connected ? `${a.live ? t('connected, live window') : t('connected')}${a.tools ? ` · ${a.tools} ${t('tools')}` : ''}` : a.error ? t('not connected') : a.enabled ? t('starting') : t('off')) : h('span.muted', tool?.available ? t('Ready') : t('Not installed')),
      a.installed && a.enabled && !a.connected ? h<'button'>('button.btn.ghost.sm', { type: 'button', 'data-craft-reconnect': a.id, title: t('Connect this app again now'), html: icon('refresh', { size: 13 }) + `<span>${t('Reconnect')}</span>`, onclick: () => void reconnect([a.id]) }) : null,
      a.installed ? sw(a.enabled, t('On'), (v) => put({ id: a.id, enabled: v }), undefined, { 'data-craft-toggle': a.id }) : null,
      a.installed
        ? h<'button'>('button.btn.sm', { type: 'button', 'data-craft-open': a.id, title: t('Open the app on this computer so the AI can drive its window'), html: icon('external', { size: 13 }) + `<span>${t('Open')}</span>`, onclick: () => void api.send<{ message: string }>('POST', '/api/craft/open', { id: a.id }).then((r) => toast(r.message, 'success')).catch(notifyError) })
        : tool?.available
          ? h<'button'>('button.btn.ghost.sm', { type: 'button', onclick: () => void workspace.openPanel(a.id as ToolId) }, t('Open'))
          : null
    );
  });
  const filterIn = h<'input'>('input.input.sm', { type: 'search', placeholder: t('Find an app'), 'aria-label': t('Find an app') });
  filterIn.oninput = () => {
    const q = filterIn.value.trim().toLowerCase();
    for (const r of rows) {
      r.hidden = !!q && !(r.textContent || '').toLowerCase().includes(q);
    }
  };
  const approval = h<'select'>('select.input', { 'data-craft-approval': '' });
  for (const [v, l] of [['read', t('Reading runs freely, changes ask first')], ['ask', t('Every call asks first')], ['all', t('Nothing asks (full access)')]] as const) approval.append(h('option', { value: v, selected: s.approval === v }, l));
  approval.onchange = () => void put({ approval: approval.value }).catch(notifyError);
  const installed = s.apps.filter((a) => a.installed).length;
  const connected = s.apps.filter((a) => a.connected).length;
  const kpi = (label: string, value: string) => h('div.sp-kpi.frame.sm', h('div.well', h('span.muted', label), h('strong.mono', value)));
  return section(
    t('Extensions'),
    t('Craft apps'),
    t('on this computer'),
    h('p.muted', t('WorkCraft finds the other Craft apps (photos, vector art, video, audio, CAD and more) and connects them as MCP servers, so the AI and your teams can open, edit and save their files. Their tools are called ext-<app>-<tool> and show the app icon. Skills explain how to drive each app; the AI reads them with read-skill.')),
    h(
      'div.sp-kpis',
      kpi(t('WebAssembly'), `${APPS.filter((a) => AVAILABLE.has(a.id)).length} / ${APPS.length}`),
      kpi('Desktop', `${installed} / ${s.apps.length}`),
      kpi(t('Connected'), String(connected))
    ),
    installed ? null : note(t('No Craft app was found. Install one from its website; WorkCraft looks in Program Files, the Applications folder and the PATH.')),
    card(t('Apps'), `${installed}/${s.apps.length}`, h('div.sp-actions', filterIn), ...rows),
    card(t('Approval'), t('for their tools'), field(t('Rule'), approval), h('p.muted', t('Applies to tools of the Craft apps and keeps working for the apps you switch on later.'))),
    h(
      'div.sp-actions',
      btn(t('Look again'), 'refresh', () => api.send<CraftState>('POST', '/api/craft/refresh', {}).then(() => x.render()).catch(notifyError), '', 'craft-refresh'),
      btn(t('Reconnect all'), 'refresh', () => reconnect(), '', 'craft-reconnect-all'),
      h('small.muted', t('Connected servers are checked every 45 seconds; a closed app is connected again by itself.'))
    )
  );
}

// ---------------------------------------------------------------- Cloud storage

interface CloudState {
  /** Browser mode: the routes are answered inside the browser (src/app/cloud-browser.ts) */
  browser?: boolean;
  canPickFolder?: boolean;
  redirectUri?: string;
  google: { configured: boolean; connected: boolean; email: string | null; scope: 'file' | 'full'; clientIdHint: string };
  icloud: { found: boolean; path: string | null; custom: string };
  folders: { id: string; name: string; path: string }[];
  bindings: Record<string, { provider: string; remote: string; label: string; auto: boolean; last?: string; error?: string; name: string }>;
  localOnly: boolean;
}
interface ProjectRow {
  id: string;
  name: string;
}

async function cloudSection(x: ExtraContext): Promise<HTMLElement> {
  let s = await api.get<CloudState>('/api/cloud');
  const raw = await api.get<ProjectRow[] | { projects: ProjectRow[] }>('/api/projects').catch(() => [] as ProjectRow[]);
  const projectList = Array.isArray(raw) ? raw : raw.projects || [];
  const call = async <T = CloudState>(method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', path: string, body?: unknown) => {
    const r = await api.send<T>(method, `/api/cloud${path}`, body ?? {});
    return r;
  };
  const apply = (r: CloudState) => {
    s = r;
    x.render();
  };

  // Google Drive
  const id = h<'input'>('input.input.mono', { placeholder: s.google.clientIdHint || '…apps.googleusercontent.com', autocomplete: 'off', spellcheck: 'false', 'data-google-id': '' });
  const secret = h<'input'>('input.input.mono', { type: 'password', placeholder: s.google.configured ? '••••••••' : 'GOCSPX-…', autocomplete: 'off', spellcheck: 'false', 'data-google-secret': '' });
  const scope = h<'select'>('select.input', { 'data-google-scope': '' });
  scope.append(h('option', { value: 'file', selected: s.google.scope === 'file' }, t('Only files WorkCraft creates (recommended)')), h('option', { value: 'full', selected: s.google.scope === 'full' }, t('All of my Drive (to open my existing Google Docs)')));
  const saveGoogle = () => call<CloudState>('PUT', '/google', { ...(id.value.trim() ? { clientId: id.value.trim() } : {}), ...(secret.value.trim() ? { clientSecret: secret.value.trim() } : {}), scope: scope.value }).then(apply).catch(notifyError);
  const inBrowser = !!s.browser;
  const connect = async () => {
    // The window opens first, inside the click: Safari and Chrome block a window that opens after a wait
    const win = inBrowser ? window.open('', '_blank') : null;
    try {
      await call<CloudState>('PUT', '/google', { ...(id.value.trim() ? { clientId: id.value.trim() } : {}), ...(secret.value.trim() ? { clientSecret: secret.value.trim() } : {}), scope: scope.value });
      const { url } = await call<{ url: string }>('POST', '/google/start');
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
      toast(t('Allow access in the new tab, then come back.'), 'info');
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!x.visible('cloud')) return;
        const st = await api.get<CloudState>('/api/cloud').catch(() => null);
        if (st?.google.connected) {
          // Browser mode: the account name is read once the token is there
          const done = inBrowser ? await call<CloudState>('POST', '/google/finish').catch(() => st) : st;
          return apply(done), void toast(t('Google Drive is connected'), 'success');
        }
      }
    } catch (e) {
      win?.close();
      notifyError(e);
    }
  };
  const google = card(
    'Google Drive',
    s.google.connected ? t('connected') : t('not connected'),
    dot(s.google.connected ? 'on' : s.google.configured ? 'warn' : 'off', s.google.connected ? s.google.email || t('connected') : s.google.configured ? t('ready to connect') : t('needs your OAuth client')),
    h(
      'p.muted',
      inBrowser
        ? t('Create an OAuth client of type "Web application" in Google Cloud Console (APIs and services, Credentials), enable the Google Drive API, add the address below as an authorized redirect URI and paste the client ID here. The client is yours: nothing of WorkCraft is shared, the sign-in stays in this browser for an hour and is asked for again after that, and Local-only mode blocks the connection.')
        : t('Create an OAuth client of type "Desktop app" in Google Cloud Console (APIs and services, Credentials), enable the Google Drive API, and paste its ID and secret here. The client is yours: nothing of WorkCraft is shared, the tokens stay in config.json on this computer, and Local-only mode blocks the connection.')
    ),
    inBrowser ? field(t('Redirect URI'), h('input.input.mono', { value: s.redirectUri || '', readonly: true, 'data-redirect-uri': '', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }), t('Add exactly this address under "Authorized redirect URIs" of the client.')) : null,
    h('div.sp-grid', field(t('Client ID'), id), inBrowser ? null : field(t('Client secret'), secret, s.google.configured ? t('Saved. Leave empty to keep it.') : undefined)),
    field(t('Access'), scope),
    h('div.sp-actions', btn(t('Save'), 'check', saveGoogle, '', 'google-save'), btn(s.google.connected ? t('Connect again') : t('Connect'), 'link', connect, '.primary', 'google-connect'), s.google.connected ? btn(t('Disconnect'), 'logout', () => call<CloudState>('POST', '/google/disconnect').then(apply).catch(notifyError), '.ghost', 'google-disconnect') : null)
  );

  /** Browser mode: the browser's own folder picker (it needs this click), the choice is kept in this browser */
  const pickFolder = async (name: string, kind: 'icloud' | 'folder') => {
    try {
      const [{ chooseCloudFolder }, { browserHelpers }] = await Promise.all([import('../../app/cloud-browser.js'), import('../../app/offline.js')]);
      await chooseCloudFolder(browserHelpers(), name, kind);
      apply(await api.get<CloudState>('/api/cloud'));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notifyError(e);
    }
  };

  // iCloud Drive
  const icPath = h<'input'>('input.input.mono', { value: s.icloud.custom, placeholder: t('automatic'), autocomplete: 'off', spellcheck: 'false', 'data-icloud-path': '' });
  const icloud = card(
    'iCloud Drive',
    s.icloud.found ? t('found') : t('not found'),
    dot(s.icloud.found ? 'on' : 'off', s.icloud.found ? s.icloud.path! : t('not found on this computer')),
    h('p.muted', t('Apple offers no file API for other apps outside its own platforms. iCloud for Windows and macOS keep a normal iCloud Drive folder that syncs by itself, so WorkCraft mirrors a project into WorkCraft/<project> inside it. On an iPad, open the same folder in Files.')),
    inBrowser
      ? s.canPickFolder
        ? h('div.sp-actions', btn(s.icloud.found ? t('Choose another folder') : t('Choose the iCloud Drive folder'), 'folderOpen', () => pickFolder('', 'icloud'), '.primary', 'icloud-pick'), h('small.muted', t('The folder is "iCloud Drive" in Explorer or Finder; the browser asks you to allow it.')))
        : note(t('This browser cannot keep a folder of the computer in sync (Safari and Firefox cannot). Use Google Drive here, or export the project as a ZIP and save it in iCloud Drive with the Files app.'))
      : field(t('Folder (optional)'), icPath, t('Only needed when iCloud Drive is not at the usual place.')),
    inBrowser ? null : h('div.sp-actions', btn(t('Save'), 'check', () => call<CloudState>('PUT', '/icloud', { path: icPath.value.trim() }).then(apply).catch(notifyError), '', 'icloud-save'))
  );

  // Other folders
  const fName = h<'input'>('input.input', { placeholder: 'OneDrive', autocomplete: 'off', 'data-folder-name': '' });
  const fPath = h<'input'>('input.input.mono', { placeholder: 'C:\\Users\\you\\OneDrive', autocomplete: 'off', spellcheck: 'false', 'data-folder-path': '' });
  const folders = card(
    t('Other synced folders'),
    'OneDrive, Dropbox',
    ...s.folders.map((f) => h('div.sp-row', h('strong', f.name), h('span.mono.muted', f.path), h('span.spacer'), btn(t('Remove'), 'trash', () => call<CloudState>('DELETE', `/folders/${f.id}`).then(apply).catch(notifyError), '.ghost.sm'))),
    inBrowser
      ? s.canPickFolder
        ? h('div.sp-grid', field(t('Name'), fName), h('div.field', h('span', t('Folder')), btn(t('Choose folder'), 'folderOpen', () => pickFolder(fName.value.trim(), 'folder'), '', 'folder-pick'), h('small.muted', t('Any folder that OneDrive, Dropbox or Google Drive for desktop keeps in sync; the browser asks you to allow it.'))))
        : note(t('This browser cannot keep a folder of the computer in sync (Safari and Firefox cannot). Use Google Drive here.'))
      : h('div.sp-grid', field(t('Name'), fName), field(t('Folder'), fPath)),
    inBrowser ? null : h('div.sp-actions', btn(t('Add folder'), 'plus', () => call<CloudState>('POST', '/folders', { name: fName.value.trim(), path: fPath.value.trim() }).then(apply).catch(notifyError), '', 'folder-add'))
  );

  // Projects
  const providers: [string, string, boolean][] = [
    ['google', 'Google Drive', s.google.connected],
    ['icloud', 'iCloud Drive', s.icloud.found],
    ...s.folders.map((f): [string, string, boolean] => [`folder:${f.id}`, f.name, true]),
  ];
  const projectRows = projectList.map((p) => {
    const b = s.bindings[p.id];
    if (b) {
      return h(
        'div.sp-row.cloud-row',
        { 'data-project': p.id },
        h('span.cloud-name', h('strong', p.name), h('small.muted', ` ${t('kept in {where}', { where: b.label })}`)),
        h('span.spacer'),
        h('small' + (b.error ? '.sp-err' : '.muted'), b.error || `${t('synced')} ${when(b.last)}`),
        sw(b.auto, t('Automatic'), (v) => call<CloudState>('PUT', `/bind/${p.id}`, { auto: v }).then(apply).catch(notifyError)),
        btn(t('Sync now'), 'refresh', async () => {
          try {
            const r = await call<CloudState & { result: { pushed?: number; pulled?: number; conflicts?: number; skipped?: boolean } }>('POST', '/sync', { project: p.id });
            toast(r.result.skipped ? t('A sync is already running') : t('{up} up, {down} down, {c} conflicts', { up: r.result.pushed ?? 0, down: r.result.pulled ?? 0, c: r.result.conflicts ?? 0 }), 'success');
            apply(r);
          } catch (e) {
            notifyError(e);
          }
        }, '.sm', 'cloud-sync'),
        btn(t('Stop'), 'close', async () => {
          if (await confirmDanger(t('Stop keeping in the cloud'), t('“{name}” stays on this computer and in the cloud folder; they just stop syncing.', { name: p.name }), t('Stop'))) await call<CloudState>('DELETE', `/bind/${p.id}`).then(apply).catch(notifyError);
        }, '.ghost.sm')
      );
    }
    const pick = h<'select'>('select.input.sm', { 'data-cloud-provider': p.id, 'aria-label': t('Where') });
    for (const [v, l, ok] of providers) pick.append(h('option', { value: v, disabled: !ok }, ok ? l : `${l} (${t('not set up')})`));
    const first = providers.find((q) => q[2]);
    if (first) pick.value = first[0];
    return h(
      'div.sp-row.cloud-row',
      { 'data-project': p.id },
      h('span.cloud-name', h('strong', p.name), h('small.muted', ` ${t('on this computer only')}`)),
      h('span.spacer'),
      pick,
      btn(t('Keep in the cloud'), 'upload', async () => {
        try {
          const r = await call<CloudState & { result: { pushed?: number; pulled?: number } }>('POST', '/bind', { project: p.id, provider: pick.value });
          toast(t('{up} up, {down} down', { up: r.result.pushed ?? 0, down: r.result.pulled ?? 0 }), 'success');
          apply(r);
        } catch (e) {
          notifyError(e);
        }
      }, '.sm.primary', 'cloud-bind')
    );
  });

  // A project that lives in the cloud, opened here: a new computer, a new browser, an iPad
  const openFrom = h<'select'>('select.input.sm', { 'data-open-provider': '', 'aria-label': t('Where') });
  for (const [v, l, ok] of providers) if (ok) openFrom.append(h('option', { value: v }, l));
  const found = h('div.sp-list', { 'data-remote-list': '' });
  const look = async () => {
    try {
      found.replaceChildren(h('p.muted', t('Looking ...')));
      const { names } = await call<{ names: string[] }>('POST', '/remote', { provider: openFrom.value });
      found.replaceChildren(
        ...(names.length
          ? names.map((n) =>
              h(
                'div.sp-row',
                { 'data-remote': n },
                h('strong', n),
                h('span.spacer'),
                btn(t('Open here'), 'download', async () => {
                  try {
                    if (backend.browser) {
                      // Browser mode: a new project, switched to, then kept in the cloud and pulled
                      const meta = await api.send<{ id: string; name: string }>('POST', '/api/projects', { name: n, template: 'empty' });
                      await projects.switchTo(meta.id);
                      const [{ bindToRemote }, { browserHelpers }] = await Promise.all([import('../../app/cloud-browser.js'), import('../../app/offline.js')]);
                      await bindToRemote(browserHelpers(), openFrom.value, n);
                    } else {
                      const r = await call<CloudState & { project: { id: string } }>('POST', '/open', { provider: openFrom.value, name: n });
                      await projects.switchTo(r.project.id);
                    }
                    toast(t('{name} is open here and kept in the cloud', { name: n }), 'success');
                    apply(await api.get<CloudState>('/api/cloud'));
                  } catch (e) {
                    notifyError(e);
                  }
                }, '.sm.primary', 'cloud-open')
              )
            )
          : [h('p.muted', t('No projects in the cloud yet. Keep one in the cloud above and it shows up here on every device.'))])
      );
    } catch (e) {
      found.replaceChildren();
      notifyError(e);
    }
  };
  const openCard = card(
    t('Open a project from the cloud'),
    t('on a new device'),
    h('p.muted', t('A project you keep in the cloud can be opened on any computer or browser: pick where it lives, then open it. This device gets its own copy and keeps it in step with the cloud.')),
    providers.some((q) => q[2]) ? h('div.sp-actions', openFrom, btn(t('Look'), 'search', look, '', 'cloud-look')) : h('p.muted', t('Connect Google Drive or choose a folder above first.')),
    found
  );

  return section(
    t('Project'),
    t('Cloud storage'),
    t('instead of only this computer'),
    h('p.muted', t('A project kept in the cloud syncs both ways: a few seconds after a change by you or the AI, every five minutes, and when you press Sync now. A file changed on both sides keeps both versions; nothing is overwritten silently, and files removed in Google Drive go to its trash. The apps and the AI keep working on the local copy.')),
    s.localOnly ? note(t('Local-only mode is on, so cloud storage is blocked. Switch it off in Settings, Privacy.'), true) : null,
    inBrowser ? note(t('Browser mode: this browser keeps your project itself (it works offline). Cloud storage keeps a second copy in Google Drive or in a folder that your computer syncs, and the two stay in step. Work local only, in the cloud as well, or open a cloud project on another device: it is your choice per project. One project syncs at a time, the one that is open.')) : null,
    google,
    icloud,
    folders,
    card(t('Projects'), `${Object.keys(s.bindings).length}/${projectList.length}`, ...(projectRows.length ? projectRows : [h('p.muted', t('No projects yet.'))])),
    openCard
  );
}

// ---------------------------------------------------------------- Bridge for other IDEs

interface BridgeState {
  url: string;
  lanUrl: string | null;
  targets: { id: string; name: string; where: string; format: string; snippet: string; note?: string }[];
  skills: { shared: string; claude: string };
}

async function bridgeSection(): Promise<HTMLElement> {
  const b = await api.get<BridgeState>('/api/bridge');
  const sel = h<'select'>('select.input', { 'data-bridge-target': '' });
  for (const tg of b.targets) sel.append(h('option', { value: tg.id }, tg.name));
  const where = h('p.muted.bridge-where');
  const pre = h('pre.mono.bridge-snippet');
  const hint = h('p.muted');
  const paint = () => {
    const tg = b.targets.find((x) => x.id === sel.value) || b.targets[0]!;
    where.textContent = `${t('Put it in')}: ${tg.where}`;
    pre.textContent = tg.snippet;
    hint.textContent = tg.note ? t(tg.note) : '';
    hint.hidden = !tg.note;
  };
  sel.onchange = paint;
  paint();
  const copy = () => navigator.clipboard.writeText(pre.textContent || '').then(() => toast(t('Copied'), 'success'), notifyError);
  const install = (target: 'agents' | 'claude') => api.send<{ installed: string[] }>('POST', '/api/skills/install', { target }).then((r) => toast(r.installed.length ? t('{n} skills installed', { n: r.installed.length }) : t('The skills were already there'), 'success')).catch(notifyError);
  return section(
    t('Extensions'),
    t('Connect other IDEs'),
    t('and agent platforms'),
    h('p.muted', t('WorkCraft serves its tools (documents, spreadsheets, presentations, PDF, project search, memory, skills, Google Drive and the Craft apps) at one MCP address. Antigravity, Trae, Cursor, Windsurf, Claude, OpenCode, ZCode and other agents can use them, so they work on the same project files. WorkCraft has to be running.')),
    card('MCP', t('address'), h('p.mono', { 'data-bridge-url': '' }, b.url), b.lanUrl ? h('p.muted.mono', `${t('Home network')}: ${b.lanUrl}`) : null),
    card(
      t('Setup'),
      t('copy and paste'),
      field(t('Platform'), sel),
      where,
      pre,
      hint,
      h('div.sp-actions', btn(t('Copy'), 'copy', copy, '.primary', 'bridge-copy'))
    ),
    card(
      t('Skills for other agents'),
      '13',
      h('p.muted', t('The 13 skills that explain the Craft apps follow the open agent-skills format. Install them where your other agents look for skills, and they know how to drive the apps too.')),
      h('p.mono.muted', `${b.skills.shared}\n${b.skills.claude}`),
      h('div.sp-actions', btn(t('Install for Codex, ZCode, Antigravity'), 'download', () => install('agents'), '', 'skills-install-agents'), btn(t('Install for Claude Code'), 'download', () => install('claude'), '', 'skills-install-claude'))
    )
  );
}
