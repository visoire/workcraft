// The guided cloud setup: pick the service you already use, read three short steps, press one button. No account is typed into
// WorkCraft: the service's own app syncs a folder (found for you on a computer, chosen with the browser's folder picker, or typed),
// and WorkCraft keeps a copy of the project in it. Where no folder can be reached (iPad, Safari, Firefox) the project goes out as a
// ZIP through the share sheet ("Save to Files" lists iCloud Drive and every cloud app). The rules are in cloud-providers.ts.
// Opened from the onboarding ("Also in the cloud"), the main menu and Settings, Cloud storage.

import { h, ROOT } from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { dialog } from './ui.js';
import { toast, notifyError } from './notifications.js';
import { api, backend } from './backend.js';
import { bus } from './bus.js';
import { device } from './device.js';
import { shareOrDownload } from './share-file.js';
import { PROVIDERS, providerById, routesFor, stepsFor, zipName, type Ctx, type Provider, type Route } from './cloud-providers.js';
import { projects } from '../project/manager.js';

interface Found {
  id: string;
  name: string;
  path: string;
}

/** Same id the backend builds from a folder's name (src/server/cloud-routes.ts). */
/** The tile mark of a service: its icon from public/assets/cloud (a local file), else its letters. */
const markOf = (p: Provider) => (p.logo ? h('span.cg-mark', h('img', { src: `${ROOT}assets/cloud/${p.logo}`, alt: '', width: '24', height: '24', decoding: 'async' })) : h('span.cg-mark', p.mark));

const folderId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'folder';

async function detect(): Promise<Found[]> {
  try {
    const r = await api.get<{ found: Found[] }>('/api/cloud/detect');
    return r.found || [];
  } catch {
    // another device on the home network, or no backend: nothing to look at
    return [];
  }
}

async function context(): Promise<{ canPick: boolean; noFolder: boolean }> {
  const { canPickFolder } = await import('./cloud-browser.js');
  const remote = document.documentElement.dataset.backend === 'remote';
  const canPick = canPickFolder();
  // A paired desktop seen from an iPad: its folders are on the PC, so from here the ZIP is the way. In the browser alone it depends on the picker.
  const noFolder = backend.browser ? !canPick : remote || device.info.ipad;
  return { canPick, noFolder };
}

/** Opens the guide. `provider` jumps to one service (its page). */
export async function openCloudGuide(opt: { provider?: string } = {}): Promise<void> {
  const project = projects.current;
  if (!project) return void toast(t('Open a project first.'), 'warning');
  let [found, base] = await Promise.all([detect(), context()]);
  let close = () => {};
  const body = h('div.cg');

  const ctxFor = (p: Provider): Ctx => ({ noFolder: base.noFolder, browserMode: backend.browser, canPick: base.canPick, detected: found.some((f) => f.id === p.id) });

  /** Keeps the project in this folder: remembers the folder, then binds the project (the first sync runs right away). */
  async function keepIn(p: Provider, provider: string) {
    const r = await api.send<{ result?: { pushed?: number; pulled?: number } }>('POST', '/api/cloud/bind', { project: project!.id, provider });
    const n = (r.result?.pushed ?? 0) + (r.result?.pulled ?? 0);
    toast(t('{name} is kept in {where}', { name: project!.name, where: p.name }), 'success', n ? t('{n} files in step.', { n }) : undefined);
    close();
  }
  async function useFolder(p: Provider, path: string) {
    if (p.id === 'icloud') {
      await api.send('PUT', '/api/cloud/icloud', { path });
      return keepIn(p, 'icloud');
    }
    const name = p.id === 'other' ? path.split(/[\\/]/).filter(Boolean).pop() || t('Cloud folder') : p.name;
    await api.send('POST', '/api/cloud/folders', { name, path });
    return keepIn(p, `folder:${folderId(name)}`);
  }
  async function pickFolder(p: Provider) {
    const [{ chooseCloudFolder }, { browserHelpers }] = await Promise.all([import('./cloud-browser.js'), import('./offline.js')]);
    const provider = await chooseCloudFolder(browserHelpers(), p.id === 'other' ? '' : p.name, p.id === 'icloud' ? 'icloud' : 'folder');
    return keepIn(p, provider);
  }
  async function saveZip(p?: Provider) {
    const bytes = await api.bytes(`/api/projects/${encodeURIComponent(project!.id)}/export`);
    const how = await shareOrDownload(new Blob([bytes], { type: 'application/zip' }), zipName(project!.name));
    if (how === 'cancelled') return;
    const where = p ? p.name : t('your cloud app');
    toast(how === 'shared' ? t('ZIP ready: choose {name} in the list.', { name: where }) : t('ZIP saved: put it in your {name} folder.', { name: where }), 'success');
    if (how === 'shared') close();
  }
  const run = (fn: () => Promise<unknown>) => () => void fn().catch((e: Error) => e.name !== 'AbortError' && notifyError(e));

  /** A service whose folder was found on this computer: one button, no steps to read. */
  const foundRow = (p: Provider, hit: Found) =>
    h(
      'div.cg-row',
      { 'data-provider': p.id },
      markOf(p),
      h('span.cg-row-text', h('strong', t(p.name)), h('small.is-found', t('Found on this computer'))),
      h('button.btn.primary', { type: 'button', 'data-action': 'cg-use', onclick: run(() => useFolder(p, hit.path)), html: icon('check', { size: 16 }) + `<span>${t('Connect')}</span>` })
    );

  function list() {
    const proton = providerById('proton')!;
    const hits = PROVIDERS.filter((p) => p.id !== 'proton' && p.id !== 'other')
      .map((p) => ({ p, hit: found.find((f) => f.id === p.id) }))
      .filter((x): x is { p: Provider; hit: Found } => !!x.hit && routesFor(x.p, ctxFor(x.p))[0] === 'folder-found');
    const protonRoute = routesFor(proton, ctxFor(proton))[0]!;
    const canPickAny = backend.browser && base.canPick;
    const parts: (Node | null)[] = [
      // Proton Drive first and larger: private by design (end-to-end encrypted), the one we recommend
      h(
        'div.cg-hero',
        { 'data-provider': 'proton' },
        h('span.cg-badge', t('Recommended')),
        h('div.cg-hero-main', markOf(proton), h('div.cg-hero-text', h('strong', t('Proton Drive')), h('p', t('End-to-end encrypted: your files are locked before they leave this device, so not even the cloud can read them.')))),
        h('button.btn.primary', { type: 'button', 'data-provider': 'proton', 'data-action': 'cg-proton', onclick: () => detail(proton), html: icon(protonRoute === 'zip' ? 'archive' : 'cloud', { size: 16 }) + `<span>${protonRoute === 'folder-found' ? t('Connect Proton Drive') : protonRoute === 'zip' ? t('Use Proton Drive') : t('Set up Proton Drive')}</span>` })
      ),
      // Anything else that can be connected right now (its folder is on this computer)
      hits.length ? h('div.cg-found', h('p.cg-sub', t('Also found on this computer')), ...hits.map((x) => foundRow(x.p, x.hit))) : null,
      // Every other service: nothing to pick, no steps. A browser can connect any folder it is allowed to open; the rest saves a ZIP.
      h(
        'div.cg-other',
        h('p.cg-sub', t('Google Drive, iCloud, OneDrive, Dropbox, MEGA and every other service')),
        h(
          'div.cg-other-actions',
          canPickAny ? h('button.btn', { type: 'button', 'data-action': 'cg-pick-any', onclick: run(() => pickFolder(providerById('other')!)), html: icon('folderOpen', { size: 16 }) + `<span>${t('Choose the folder of your cloud app')}</span>` }) : null,
          h('button.btn', { type: 'button', 'data-action': 'cg-zip', onclick: run(() => saveZip()), html: icon('archive', { size: 16 }) + `<span>${t('Save a ZIP')}</span>` })
        ),
        h('small.muted', t('Put the ZIP in the app of your service. Do it again whenever you want a fresh copy.'))
      ),
      h(
        'p.cg-foot.muted',
        t('No password is typed into WorkCraft: the app of your service does the syncing, WorkCraft only writes into its folder. Without a folder, the project goes out as a ZIP.'),
        ' ',
        h('button.link', { type: 'button', 'data-action': 'cg-advanced', onclick: () => (close(), bus.emit('open-settings', 'cloud')) }, t('Advanced: sign in to Google Drive directly'))
      )
    ];
    body.replaceChildren(...parts.filter((n): n is Node => !!n));
  }

  function detail(p: Provider) {
    const ctx = ctxFor(p);
    const routes = routesFor(p, ctx);
    const primary = routes[0]!;
    const hit = found.find((f) => f.id === p.id);
    const steps = stepsFor(p, primary).map((s) => h('li', t(s, { name: t(p.name) })));
    const path = h<'input'>('input.input.mono', { type: 'text', placeholder: t('Folder of the service, for example {example}', { example: navigator.platform.startsWith('Win') ? `C:\\Users\\you\\${p.id === 'other' ? 'pCloud' : p.name}` : `~/${p.id === 'other' ? 'pCloud' : p.name}` }), 'aria-label': t('Folder'), autocomplete: 'off', spellcheck: 'false', 'data-cg-path': '' });
    const actions: Node[] = [];
    const act = (route: Route, primaryBtn: boolean): Node | null => {
      const cls = primaryBtn ? '.primary' : '';
      if (route === 'folder-found' && hit) return h('button.btn' + cls, { type: 'button', 'data-action': 'cg-use', onclick: run(() => useFolder(p, hit.path)), html: icon('check', { size: 16 }) + `<span>${t('Use this folder')}</span>` });
      if (route === 'folder-pick') return h('button.btn' + cls, { type: 'button', 'data-action': 'cg-pick', onclick: run(() => pickFolder(p)), html: icon('folderOpen', { size: 16 }) + `<span>${t('Choose the folder')}</span>` });
      if (route === 'folder-path')
        return h('div.cg-path', path, p.id === 'other' ? null : h('button.btn.ghost', { type: 'button', 'data-action': 'cg-check', onclick: run(async () => { found = await detect(); detail(p); }) }, t('Check again')), h('button.btn' + cls, { type: 'button', 'data-action': 'cg-use', onclick: run(async () => (path.value.trim() ? useFolder(p, path.value.trim()) : void path.focus())), html: icon('check', { size: 16 }) + `<span>${t('Use this folder')}</span>` }));
      if (route === 'zip') return h('button.btn' + cls, { type: 'button', 'data-action': 'cg-zip', onclick: run(() => saveZip(p)), html: icon('archive', { size: 16 }) + `<span>${t('Save ZIP')}</span>` });
      return null;
    };
    actions.push(act(primary, true)!);
    if (primary !== 'zip') actions.push(h('span.cg-or.muted', t('or')), act('zip', false)!);
    const parts: (Node | null)[] = [
      h('div.cg-head', h('button.btn.ghost.sm', { type: 'button', 'data-action': 'cg-back', onclick: list, html: icon('back', { size: 14 }) + `<span>${t('Back')}</span>` }), markOf(p), h('strong.cg-title', t(p.name))),
      h('ol.cg-steps', ...steps),
      primary === 'folder-found' && hit ? h('p.cg-found.mono', { title: hit.path }, hit.path) : null,
      h('div.cg-actions', ...actions),
      p.site && !p.builtIn ? h('a.cg-get', { href: p.site, target: '_blank', rel: 'noopener noreferrer', html: icon('external', { size: 14 }) + `<span>${t('Get {name}', { name: t(p.name) })}</span>` }) : null,
    ];
    body.replaceChildren(...parts.filter((n): n is Node => !!n));
    body.querySelector<HTMLElement>('.cg-actions .btn, .cg-actions input')?.focus({ preventScroll: true });
  }

  const start = opt.provider ? providerById(opt.provider) : undefined;
  if (start) detail(start);
  else list();
  await dialog({ title: t('Save in the cloud'), tone: project.name, body, ok: false, cancel: t('Close'), onOpen: (c) => (close = c) });
}
