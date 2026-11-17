// The first start of WorkCraft, as one calm page in three steps: a welcome (with a way to support the project), the workspace,
// and where the files are kept (this computer, or also a cloud). It runs before anything else loads: no project, no project tree,
// no chat, no tool rail. When it is done the workspace starts with what was chosen. The rules (who sees it, what is remembered)
// are in onboarding-state.ts. The card has a fixed shape that follows the device (a landscape card on a computer, a smaller one on
// an iPad, the whole screen on a phone); only its body scrolls.

import { h } from './util.js';
import { icon, logoSvg } from './icons.js';
import { t } from './i18n.js';
import { URL_BMC } from './coffee.js';
import { next, position, prev, remember, STEPS, type Remembered, type Step } from './onboarding-state.js';
import { setEcosystem } from '../ecosystems/ecosystems.js';
import type { Ecosystem } from '../ecosystems/catalog.js';

export interface OnboardingResult {
  ecosystem: Ecosystem;
  files: Remembered['files'];
}

/** Draws the page over an empty window and resolves when the user has finished (or skipped). */
export async function runOnboarding(): Promise<OnboardingResult> {
  const { ecosystemPickerBody } = await import('../ecosystems/ui.js');
  const { activeEcosystem } = await import('../ecosystems/ecosystems.js');
  document.documentElement.classList.add('is-onboarding');

  return new Promise<OnboardingResult>((resolve) => {
    let step: Step = 'welcome';
    let chosen: Ecosystem | null = null;

    const root = h('div.onb', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onb-title' });
    document.body.append(root);

    const finish = (files: Remembered['files']) => {
      remember(files);
      root.remove();
      document.documentElement.classList.remove('is-onboarding');
      resolve({ ecosystem: chosen ?? activeEcosystem(), files });
    };
    const go = (s: Step | null) => {
      if (!s) return;
      step = s;
      paint();
    };
    /** Skipping keeps Office & Documents (or what a link chose) and keeps the files on this computer. */
    const skip = () => {
      if (!chosen) chosen = setEcosystem(activeEcosystem().id);
      finish('skipped');
    };

    const dots = () => {
      const p = position(step);
      return h(
        'ol.onb-dots',
        { 'aria-label': t('Step {n} of {of}', { n: String(p.n), of: String(p.of) }) },
        STEPS.map((s) => h('li', { 'aria-current': s === step ? 'step' : 'false', class: s === step ? 'is-on' : STEPS.indexOf(s) < STEPS.indexOf(step) ? 'is-done' : '' }))
      );
    };
    const point = (ic: string, text: string) => h('li', h('span', { html: icon(ic, { size: 16 }), 'aria-hidden': 'true' }), h('span', text));

    const welcome = (): Node[] => [
      h('p.eyebrow', t('Welcome')),
      h('h1.duo#onb-title', t('Welcome to') + ' ', h('span.tone', 'WorkCraft')),
      h('p.onb-lead', t('One window for your documents, spreadsheets, presentations, PDFs and more, with an AI assistant you control.')),
      h('ul.onb-points', point('folder', t('Your files stay in a folder you own.')), point('spark', t('An AI assistant that works on your files, with your own key or a local model.')), point('lock', t('Nothing leaves your computer unless you decide it should.'))),
      h(
        'div.onb-support',
        h('span.onb-support-ic', { html: icon('heart', { size: 18 }), 'aria-hidden': 'true' }),
        h('div', h('strong', t('Support WorkCraft')), h('p.muted', t('WorkCraft is free and open source, made by one person. If it saves you time, a coffee keeps it going. It is never required.'))),
        h('a.btn.sm', { href: URL_BMC, target: '_blank', rel: 'noopener noreferrer' }, t('Buy me a coffee'))
      ),
    ];

    const workspace = (): Node[] => {
      const body = ecosystemPickerBody({
        first: true,
        noCurrent: true,
        intro: t('Each workspace shows its own apps. Your files stay in the project, so you can switch any time.'),
        onPick: (e) => {
          chosen = setEcosystem(e.id);
          go(next('workspace'));
        },
      });
      return [h('p.eyebrow', t('Step {n} of {of}', { n: '2', of: '3' })), h('h1.duo#onb-title', t('Choose your') + ' ', h('span.tone', t('workspace'))), body];
    };

    const files = (): Node[] => [
      h('p.eyebrow', t('Step {n} of {of}', { n: '3', of: '3' })),
      h('h1.duo#onb-title', t('Where should your') + ' ', h('span.tone', t('files be saved?'))),
      h('p.onb-lead', t('Your files are always saved in your project folder. You can also keep a copy in the cloud. This question is asked once.')),
      h(
        'div.onb-choices',
        h(
          'button.onb-choice',
          { type: 'button', 'data-choice': 'local', onclick: () => finish('local') },
          h('span.onb-choice-ic', { html: icon('folder', { size: 22 }), 'aria-hidden': 'true' }),
          h('strong', t('Only on this computer')),
          h('span.muted', t('Nothing leaves your computer. You can add a cloud later from the menu.'))
        ),
        h(
          'button.onb-choice',
          { type: 'button', 'data-choice': 'connect', onclick: () => finish('connect') },
          h('span.onb-choice-ic', { html: icon('upload', { size: 22 }), 'aria-hidden': 'true' }),
          h('strong', t('Also in the cloud')),
          h('span.muted', t('Google Drive, iCloud, OneDrive, Dropbox, MEGA, Proton Drive and more. A short guide opens right after the start.'))
        )
      ),
    ];

    function paint() {
      const back = prev(step);
      const body = step === 'welcome' ? welcome() : step === 'workspace' ? workspace() : files();
      const actions =
        step === 'welcome'
          ? [h('button.btn.ghost', { type: 'button', 'data-action': 'onb-skip', onclick: skip }, t('Skip setup')), h('button.btn.primary', { type: 'button', 'data-action': 'onb-continue', onclick: () => go(next('welcome')) }, t('Continue'))]
          : [];
      // Back sits at the top, where it is seen without scrolling the list of workspaces
      const backBtn = back ? h('button.btn.ghost.sm', { type: 'button', 'data-action': 'onb-back', onclick: () => go(back), html: icon('back', { size: 14 }) + `<span>${t('Back')}</span>` }) : null;
      root.replaceChildren(
        h(
          'div.onb-card.frame',
          { 'data-step': step },
          h('div.onb-top', h('div.onb-top-l', h('span.onb-mark', { html: logoSvg(24), 'aria-hidden': 'true' }), backBtn), dots()),
          h('div.onb-body.well', ...body),
          h('div.onb-actions', ...actions)
        )
      );
      // Focus the button of the step, but never a workspace card: it would look chosen
      root.querySelector<HTMLElement>('[data-action="onb-continue"], .onb-choice')?.focus({ preventScroll: true });
      root.querySelector<HTMLElement>('.onb-body')?.scrollTo(0, 0);
    }
    paint();
  });
}
