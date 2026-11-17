// "Add WorkCraft to your Home Screen" (iPad only): a notice with a short tutorial. From the Home Screen WorkCraft runs full screen, without the
// Safari bars, in an app window of its own, which is steadier and leaves more room. The rules are in install-tip-rules.ts.

import { h } from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { dialog } from './ui.js';
import { notify } from './notifications.js';
import { device } from './device.js';
import { INSTALL_STEPS, neverAgain, shouldOfferInstall, snoozed, type InstallState } from './install-tip-rules.js';

const KEY = 'workcraft.installTip';

const load = (): InstallState | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') as InstallState | null;
  } catch {
    return null;
  }
};
const save = (s: InstallState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* blocked: the tip may come back, which is harmless */
  }
};

const standalone = () => (navigator as unknown as { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;

/** The tutorial: four steps with the pictures of the buttons to look for. */
export async function openInstallGuide(): Promise<void> {
  const pic = (name: string, label: string) => h('span.it-pic', { 'aria-hidden': 'true', html: icon(name, { size: 20 }) }, h('span', label));
  const steps = INSTALL_STEPS.map((s, i) =>
    h('li', h('span.it-n', String(i + 1)), h('span.it-text', t(s)), i === 1 ? pic('share', t('Share')) : i === 2 ? pic('plus', t('Add to Home Screen')) : null)
  );
  const body = h(
    'div.it',
    h('p.muted', t('From the Home Screen WorkCraft opens full screen, without the Safari bars, and runs better.')),
    h('ol.it-steps', ...steps),
    h('p.muted.it-note', t('Using another browser on the iPad? Open its menu, choose Share, then Add to Home Screen.'))
  );
  const again = await dialog({ title: t('Add WorkCraft to your Home Screen'), tone: t('iPad'), body, ok: t('Do not remind me'), cancel: t('Close') });
  if (again) save(neverAgain());
}

/** Shows the notice once the workspace is up, when the rules say so. */
export function offerInstallTip(): void {
  if (!shouldOfferInstall({ ipad: device.info.ipad, standalone: standalone(), state: load(), now: Date.now() })) return;
  setTimeout(() => {
    // Shown once per fortnight: it counts as asked as soon as it appears, and it leaves by itself (it sits where the chat's Send button is)
    save(snoozed(Date.now()));
    notify({
      title: t('Add WorkCraft to your Home Screen'),
      message: t('It then opens full screen like an app and works better on the iPad.'),
      timeout: 20000,
      actions: [
        { label: t('Show me how'), primary: true, run: () => void openInstallGuide() },
        { label: t('Not now'), run: () => save(snoozed(Date.now())) },
      ],
    });
  }, 2500);
}
