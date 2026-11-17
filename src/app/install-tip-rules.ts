// Pure rules of the "Add to Home Screen" tip for the iPad (no DOM, unit-tested): who gets it, and when it comes back.
//   An iPad that runs WorkCraft in a Safari tab gets a notice once; "Not now" brings it back after two weeks, "Do not remind me" never.
//   Run from the Home Screen (standalone), it is never shown: that is what the tip is for.

export interface InstallState {
  /** 'never' (do not remind me), or the time (ms) when the tip may come back */
  until?: number | 'never';
}

export const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export function shouldOfferInstall(d: { ipad: boolean; standalone: boolean; state: InstallState | null; now: number }): boolean {
  if (!d.ipad || d.standalone) return false;
  const u = d.state?.until;
  if (u === 'never') return false;
  if (typeof u === 'number' && d.now < u) return false;
  return true;
}

export const snoozed = (now: number): InstallState => ({ until: now + SNOOZE_MS });
export const neverAgain = (): InstallState => ({ until: 'never' });

/** The four steps of the short tutorial, English source text (the guide translates them). */
export const INSTALL_STEPS: readonly string[] = [
  'Open workcraft.cc/app in Safari.',
  'Tap the Share button in the toolbar of Safari (a square with an arrow pointing up).',
  'Scroll the list and tap Add to Home Screen.',
  'Tap Add. WorkCraft is now an icon on your Home Screen: open it from there.',
];
