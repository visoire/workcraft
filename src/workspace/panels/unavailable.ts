// Panel of a Craft app that has no web build in this installation. The app is part of its ecosystem and shows in the
// rail, so it never disappears; this panel says what is missing and what to do, and still opens the file in the
// desktop app when that app is installed on the computer that runs WorkCraft.
//
// A web build is added by `npm run apps:import` or `npm run apps:fetch` (scripts/fetch-apps.mjs), never by hand: it writes
// public/web-builds.json, and the build, the dev server and the service worker pick the app up from there.

import { h, basename } from '../../app/util.js';
import { icon } from '../../app/icons.js';
import { t as tr } from '../../app/i18n.js';
import { desktopApp, openInDesktop } from '../../project/desktop.js';
import { TOOLS, toolMark, type PanelContext, type PanelInstance } from '../registry.js';

export async function mount(el: HTMLElement, ctx: PanelContext): Promise<PanelInstance> {
  const t = TOOLS[ctx.tool];
  const root = h('div.ca.ca-missing', { style: `--tool:${t.accent}` });
  const actions = h('div.ca-actions');
  const note = h('small.muted');
  root.append(
    h(
      'div.ca-error',
      h(
        'div.frame',
        h(
          'div.well',
          h('span.ca-missing-mark', { html: toolMark(ctx.tool, 40) }),
          h('p.eyebrow', t.name),
          h('h3.duo', tr('No web build in this installation')),
          h('p.muted', tr('{name} is part of this workspace, but its browser version has not been added here yet. Files you open with it stay in your project.', { name: t.name })),
          actions,
          note
        )
      )
    )
  );
  el.append(root);

  const paint = async () => {
    actions.replaceChildren();
    const desk = await desktopApp(ctx.tool).catch(() => null);
    if (desk) {
      const path = ctx.path;
      actions.append(
        h(
          'button.btn.primary',
          { type: 'button', html: icon('popout', { size: 16 }) + `<span>${path ? tr('Open {file} in the desktop app', { file: basename(path) }) : tr('Open the desktop app')}</span>`, onclick: () => void openInDesktop(ctx.tool, path || undefined) }
        )
      );
      note.textContent = tr('The desktop app is installed on this computer.');
    } else {
      note.textContent = tr('Whoever runs this workspace adds it with: npm run apps:import or npm run apps:fetch');
    }
  };
  void paint();

  return {
    ready: Promise.resolve(),
    async open(path) {
      ctx.setPath(path);
      void paint();
      return tr('{name} has no web build here.', { name: t.name });
    },
    canUnload: () => true,
    status: () => ({ app: t.name, loaded: false, available: false, file: ctx.path }),
    unmount() {
      root.remove();
    },
  };
}
