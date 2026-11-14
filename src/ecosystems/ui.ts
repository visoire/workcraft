// Interface of the ecosystems: the workspace picker (first run and Switch workspace), the launcher (apps of the
// ecosystem, Recent files, offline use) and the step that rearranges the panels when the ecosystem changes.
//
// The picker opens by itself once. Each card is one ecosystem; "Create your own" builds a custom one from any of the
// catalog apps. Apps without a web build in this installation are shown dimmed with a note, never hidden, so the
// structure is the same everywhere and a build that arrives later needs no change.

import { h } from '../app/util.js';
import { icon } from '../app/icons.js';
import { t as tr } from '../app/i18n.js';
import { dialog } from '../app/ui.js';
import { toast } from '../app/notifications.js';
import { bus } from '../app/bus.js';
import { projects } from '../project/manager.js';
import { fs } from '../project/fs.js';
import { workspace } from '../workspace/layout.js';
import { AVAILABLE, TOOLS, toolMark, type ToolId } from '../workspace/registry.js';
import { recentList } from '../storage/recent-view.js';
import { addCustomEcosystem, activeEcosystem, allEcosystems, removeCustomEcosystem, setEcosystem, updateCustomEcosystem } from './ecosystems.js';
import { APPS, ORIGIN_LABEL, appById, appsOfOrigin, type CraftId, type Ecosystem, type Origin } from './catalog.js';
import { cacheApps, cacheable } from './offline-apps.js';
import { enterEcosystem } from './enter.js';
import { appVersionState, appVersionTitle } from '../app/updates.js';

const readyCount = (e: Ecosystem) => e.apps.filter((id) => AVAILABLE.has(id)).length;

function readyNote(e: Ecosystem): string {
  const n = readyCount(e);
  if (n === e.apps.length) return e.apps.length === 1 ? tr('Ready') : tr('All {n} apps ready', { n });
  if (n === 0) return tr('No web builds yet');
  return tr('{n} of {total} apps ready', { n, total: e.apps.length });
}

/** "WordCraft" to "Word": every name ends in Craft, so the short form reads better under an icon. The full name stays in the tooltip. */
const shortName = (name: string) => name.replace(/Craft$/, '') || name;

/** Opens the upstream GitHub repository for a catalog app without triggering the parent card or label. */
function openAppRepo(id: CraftId, ev: Event): void {
  const a = appById(id);
  if (!a) return;
  ev.stopPropagation();
  ev.preventDefault();
  window.open(`https://github.com/${a.repo}`, '_blank', 'noopener,noreferrer');
}

/** All app icons of an ecosystem as tiles with short name, version status badge, and clickable GitHub icon. */
function appTiles(ids: readonly CraftId[]): HTMLElement {
  const tiles = ids.map((id) => {
    const t = TOOLS[id];
    const a = appById(id)!;
    const vState = appVersionState(id);
    const vTitle = appVersionTitle(id);
    // The icon is part of the card button: a click anywhere on the card chooses the workspace (the GitHub links live in the launcher,
    // in Settings and on the homepage, not nested inside a button where they would swallow the click)
    const iconEl = h('span.eco-icon', { html: toolMark(id, 36), 'data-repo': a.repo });
    // The version is a status dot on the icon (the legend above explains the three colors); the number is in the tooltip.
    // A name never overlaps its neighbour: the label is one ellipsed line inside its own column.
    return h(
      'span.eco-tile' + (t.available ? '' : '.is-missing'),
      { title: `${t.name} · ${t.available ? 'v' + t.version + ' · ' : ''}${vTitle}`, style: `--tool:${t.accent}`, 'data-ver-state': vState },
      h('span.eco-icon-wrap', iconEl, t.available ? h('i.ver-dot.eco-ver-dot', { 'data-ver-state': vState, 'aria-hidden': 'true' }) : null),
      h('span.eco-label', shortName(t.name))
    );
  });
  return h('span.eco-tiles', ...tiles);
}

/** green: every app of the workspace runs here, amber: some, grey: none (the apps are listed anyway) */
const readyState = (e: Ecosystem): 'ok' | 'part' | 'none' => (readyCount(e) === e.apps.length ? 'ok' : readyCount(e) === 0 ? 'none' : 'part');

export { enterEcosystem };

/** Shows the panel of an app, or opens one: the same app does not pile up as a second panel. */
export function openApp(id: CraftId): void {
  const existing = workspace.panels().find((p) => p.tool === id);
  if (existing) workspace.show(existing.id);
  else workspace.openPanel(id);
}

function pick(e: Ecosystem, close: () => void): void {
  const eco = setEcosystem(e.id);
  // Nothing opens by itself: the welcome page of the workspace shows and you start the apps you want
  enterEcosystem(eco);
  toast(tr('Workspace: {name}', { name: eco.name }), 'success', readyCount(eco) ? readyNote(eco) : tr('None of its apps has a web build here yet. Apps open from the launcher as soon as one does.'));
  close();
}

// ---------------------------------------------------------------- picker

export interface PickerOptions {
  /** First run: says so in the text, and Esc keeps the current workspace */
  first?: boolean;
}

export async function openEcosystemPicker(opt: PickerOptions = {}): Promise<void> {
  let closeDlg = () => {};
  const body = h('div.eco');
  const current = activeEcosystem().id;

  const cards = () => {
    const list = allEcosystems();
    body.replaceChildren(
      h(
        'div.eco-intro',
        h('p.muted.dlg-text', opt.first ? tr('Pick the kind of work you do. Each workspace shows its own apps, and your files stay in the project, so you can switch any time.') : tr('Each workspace shows the apps for one kind of work. Your files stay in the project.')),
        h(
          'div.ver-legend',
          h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'newest', 'aria-hidden': 'true' }), tr('Newest installed')),
          h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'ready', 'aria-hidden': 'true' }), tr('Ready build')),
          h('span.ver-legend-item', h('i.ver-dot', { 'data-ver-state': 'outdated', 'aria-hidden': 'true' }), tr('Update available'))
        )
      ),
      h(
        'div.eco-grid',
        { role: 'list' },
        ...list.map((e) => {
          const card = h<'button'>(
            'button.eco-card' + (e.id === current ? '.is-current' : ''),
            { type: 'button', role: 'listitem', 'data-eco': e.id, 'aria-pressed': String(e.id === current), style: `--eco:${e.accent}`, onclick: () => pick(e, closeDlg) },
            h(
              'span.eco-title',
              h('strong.eco-name', { title: e.name }, e.name),
              e.id === current ? h('span.eco-current-pill', { title: tr('in use'), 'aria-label': tr('in use') }, h('span', { html: icon('check', { size: 12 }) }), tr('In use')) : null
            ),
            h('small.muted.eco-blurb', e.custom ? e.blurb : tr(e.blurb)),
            appTiles(e.apps),
            h('small.mono.muted.eco-state', { 'data-state': readyState(e) }, h('i.eco-dot', { 'aria-hidden': 'true' }), readyNote(e))
          );
          if (!e.custom) return card;
          // A custom ecosystem: the card opens it, the small buttons edit or remove it
          return h(
            'div.eco-card-wrap',
            card,
            h(
              'div.eco-card-tools',
              h<'button'>('button.btn.ghost.sm', { type: 'button', onclick: () => custom(e) }, tr('Edit')),
              h<'button'>('button.btn.ghost.sm', { type: 'button', onclick: () => (removeCustomEcosystem(e.id), cards()) }, tr('Remove'))
            )
          );
        }),
        h(
          'button.eco-card.eco-new',
          { type: 'button', role: 'listitem', 'data-eco': 'new', onclick: () => custom() },
          h('span.eco-title', h('strong', tr('Create your own'))),
          h('small.muted.eco-blurb', tr('Choose any apps and name the workspace.')),
          h('span.eco-plus', { html: icon('plus', { size: 22 }), 'aria-hidden': 'true' })
        )
      )
    );
  };

  /** The "Create your own" form, also used to edit one. */
  const custom = (editing?: Ecosystem) => {
    const name = h<'input'>('input.input', { type: 'text', placeholder: tr('For example: Studio'), maxlength: '40', autocomplete: 'off', value: editing?.name ?? '', 'aria-label': tr('Name of the workspace') });
    if (editing) name.disabled = true;
    const chosen = new Set<string>(editing?.apps ?? []);
    const error = h('p.dlg-error', { role: 'alert', hidden: true });
    // A grid of icon tiles you tick: the real icon, the name, the kind of work; a ring and a check when chosen.
    // The apps come in three groups (ArtCraft, community apps, independent apps) and a search box narrows them.
    const rowOf = (a: (typeof APPS)[number]) => {
      const t = TOOLS[a.id];
      const vState = appVersionState(a.id);
      const vTitle = appVersionTitle(a.id);
      const box = h<'input'>('input', { type: 'checkbox', checked: chosen.has(a.id), 'aria-label': a.name });
      box.onchange = () => (box.checked ? chosen.add(a.id) : chosen.delete(a.id));
      const missing = t.available ? '' : ' ' + tr('{name}: no web build here yet', { name: a.name });
      // A tick box row: the whole row toggles, the icon is not a link here (it would swallow the click)
      const iconEl = h('span.eco-icon', { html: toolMark(a.id, 40), 'data-repo': a.repo });
      return h(
        'label.eco-pick' + (t.available ? '' : '.is-missing'),
        { style: `--tool:${a.accent}`, title: `${a.name} · ${a.license}${missing}`, 'data-find': `${a.name} ${a.id} ${a.kind} ${a.repo}`.toLowerCase(), 'data-ver-state': vState },
        box,
        iconEl,
        h(
          'span.eco-pick-name',
          h('span.eco-pick-top', h('strong', shortName(a.name)), h('small.mono.ver-pill', { 'data-ver-state': vState, title: vTitle }, t.available ? `v${t.version}` : '—')),
          h('small.muted', tr(a.kind))
        ),
        h('span.eco-check', { html: icon('check', { size: 12 }), 'aria-hidden': 'true' })
      );
    };
    const groups: { origin: Origin; title: string }[] = [
      { origin: 'artcraft', title: tr('ArtCraft apps') },
      { origin: 'community', title: tr('Community apps') },
      { origin: 'independent', title: tr('Independent apps') },
    ];
    const sections = groups
      .map((g) => ({ g, apps: appsOfOrigin(g.origin) }))
      .filter((s) => s.apps.length)
      .map(({ g, apps }) => {
        const rows = apps.map(rowOf);
        const grid = h('div.eco-picks', ...rows);
        const head = h('p.eyebrow.eco-group', `${g.title} · ${apps.length}`);
        return { head, grid, rows };
      });
    const filter = h<'input'>('input.input', { type: 'search', placeholder: tr('Find an app'), autocomplete: 'off', 'aria-label': tr('Find an app') });
    filter.oninput = () => {
      const q = filter.value.trim().toLowerCase();
      for (const s of sections) {
        let shown = 0;
        for (const r of s.rows) {
          const hit = !q || (r.getAttribute('data-find') || '').includes(q);
          r.hidden = !hit;
          if (hit) shown++;
        }
        s.head.hidden = s.grid.hidden = shown === 0;
      }
    };
    const save = h<'button'>('button.btn.primary', { type: 'button' }, editing ? tr('Save') : tr('Create'));
    save.onclick = () => {
      if (editing) {
        if (!updateCustomEcosystem(editing.id, [...chosen])) return void ((error.hidden = false), (error.textContent = tr('Choose at least one app.')));
        const e = allEcosystems().find((x) => x.id === editing.id);
        if (e && editing.id === activeEcosystem().id) enterEcosystem(e);
        return cards();
      }
      const r = addCustomEcosystem(name.value, [...chosen]);
      if (!r.ok) {
        error.hidden = false;
        error.textContent = r.error === 'name' ? tr('Give the workspace a name.') : r.error === 'apps' ? tr('Choose at least one app.') : tr('A workspace with this name exists.');
        return;
      }
      enterEcosystem(r.ecosystem);
      toast(tr('Workspace: {name}', { name: r.ecosystem.name }), 'success');
      closeDlg();
    };
    body.replaceChildren(
      h('label.field', h('span', tr('Name')), name),
      h('label.field', h('span', tr('Apps')), filter),
      h('div.eco-pick-scroll', ...sections.flatMap((s) => [s.head, s.grid])),
      error,
      h('div.dlg-actions', h<'button'>('button.btn.ghost', { type: 'button', onclick: () => cards() }, tr('Back')), save)
    );
    if (!editing) setTimeout(() => name.focus(), 0);
  };

  cards();
  await dialog({
    title: opt.first ? tr('Choose your workspace') : tr('Switch workspace'),
    tone: opt.first ? tr('start here') : undefined,
    body,
    ok: false,
    cancel: opt.first ? tr('Keep Office & Documents') : tr('Close'),
    wide: true,
    onOpen: (close) => (closeDlg = close),
  });
}

// ---------------------------------------------------------------- launcher

/** Apps of the ecosystem in use, Recent files, and what the device can keep offline. */
export async function openLauncher(): Promise<void> {
  const eco = activeEcosystem();
  const project = projects.current?.id || fs.project;
  let closeDlg = () => {};
  const body = h('div.launcher');

  body.append(
    h(
      'div.launcher-head',
      h('div', h('p.eyebrow', tr('Workspace')), h('strong.launcher-name', eco.name)),
      h<'button'>('button.btn', { type: 'button', html: icon('shuffle', { size: 16 }) + `<span>${tr('Switch workspace')}</span>`, onclick: () => (closeDlg(), void openEcosystemPicker()) })
    ),
    h(
      'div.launcher-apps',
      ...eco.apps.map((id) => {
        const t = TOOLS[id];
        const a = appById(id)!;
        const vState = appVersionState(id);
        const vTitle = appVersionTitle(id);
        const repoTitle = tr('{name} on GitHub ({repo})', { name: t.name, repo: a.repo });
        const markEl = h('span.empty-mark.is-repo-link', {
          html: toolMark(id, 32),
          role: 'link',
          tabindex: '0',
          title: `${repoTitle} · ${vTitle}`,
          'aria-label': repoTitle,
          'data-repo': a.repo,
          onclick: (ev: MouseEvent) => openAppRepo(id, ev),
          onkeydown: (ev: KeyboardEvent) => {
            if (ev.key === 'Enter' || ev.key === ' ') openAppRepo(id, ev);
          },
        });
        return h<'button'>(
          'button.empty-tool.launcher-app' + (t.available ? '' : '.is-missing'),
          {
            type: 'button',
            style: `--tool:${t.accent}`,
            'data-ver-state': vState,
            title: `${a.name} · ${ORIGIN_LABEL[a.origin]} · ${a.license}` + (t.available ? ` · v${t.version}` : ` · ${tr('No web build here yet')}`),
            onclick: () => {
              closeDlg();
              openApp(id);
            },
          },
          h('div.launcher-app-top', markEl, h('small.mono.ver-pill', { 'data-ver-state': vState, title: vTitle }, t.available ? `v${t.version}` : '—')),
          h('strong', t.name),
          h('small.muted', t.available ? tr(a.blurb) : tr('No web build here yet')),
          h('small.mono.muted.launcher-app-meta', `${ORIGIN_LABEL[a.origin]} · ${a.repo}`)
        );
      })
    )
  );

  const recent = recentList(project, (e) => (closeDlg(), void workspace.openFile(e.path, e.tool as ToolId)), 8);
  if (recent) body.append(recent);

  // Offline use: the engines of this ecosystem on the device (a standalone iPad works without a desktop or network)
  const ids = cacheable(eco.apps);
  if (ids.length && 'serviceWorker' in navigator) {
    const status = h('small.muted');
    const btn = h<'button'>('button.btn', { type: 'button', html: icon('download', { size: 16 }) + `<span>${tr('Keep these apps offline')}</span>` });
    btn.onclick = async () => {
      btn.disabled = true;
      status.textContent = tr('Loading...');
      const r = await cacheApps(eco.apps, (p) => (status.textContent = tr('{done} of {total} files', { done: p.done, total: p.total })));
      btn.disabled = false;
      status.textContent = r.reason === 'no-worker' ? tr('The offline cache needs a secure connection (HTTPS) and a first reload.') : r.reason === 'no-space' ? tr('Not enough space on this device: these apps need about {need} MB and {free} MB are free. Keep fewer apps offline or free some storage.', { need: Math.round((r.needed ?? 0) / 1048576), free: Number.isFinite(r.free) ? Math.round((r.free ?? 0) / 1048576) : 0 }) : r.ok ? tr('Ready offline: {n} files', { n: r.files }) : tr('{n} files could not be loaded', { n: r.failed });
    };
    body.append(h('div.launcher-offline', btn, status));
  }

  await dialog({ title: tr('Apps'), tone: eco.name, body, ok: false, cancel: tr('Close'), wide: true, onOpen: (close) => (closeDlg = close) });
}
