/**
 * First start, decided without a DOM: who sees the onboarding, which steps it has, and what is remembered afterwards.
 * Pure and injectable, so tests/server/onboarding.test.ts keeps the rules; src/app/onboarding.ts draws the page.
 *
 * The onboarding runs BEFORE the workspace loads: no project, no tree, no chat, no tool rail until it is done. It has
 * three steps: welcome (and a way to support the project), the workspace, and where the files are kept (this computer, or
 * also a cloud). The answer to the last one is remembered in the browser, so it is never asked again.
 */

export const STEPS = ['welcome', 'workspace', 'files'] as const;
export type Step = (typeof STEPS)[number];

/** What is kept in the browser (localStorage `workcraft.onboarding`) once the page is finished. */
export interface Remembered {
  /** local: files stay on this computer, connect: the user wants a cloud (Settings, Cloud storage opens after the start), skipped: closed without an answer */
  files: 'local' | 'connect' | 'skipped';
  /** Milliseconds since 1970 */
  at: number;
}

export interface StartFacts {
  /** The workspace was chosen before (prefs ecosystemChosen): a returning user */
  chosen: boolean;
  /** A link chose a workspace (/?ecosystem=imaging): that counts as the choice */
  linked: boolean;
  /** A separate window of one panel (?popout=1) */
  popout: boolean;
  /** An automated browser (navigator.webdriver) */
  automated: boolean;
  /** ?onboarding=1 forces the page (tests, support) */
  forced: boolean;
}

/** Who sees the page: a new user in a normal window. A returning user, a linked workspace, a pop-out and an automated browser skip it, unless it is forced. */
export function needsOnboarding(f: StartFacts): boolean {
  if (f.popout) return false;
  if (f.forced) return true;
  return !f.chosen && !f.linked && !f.automated;
}

export const next = (s: Step): Step | null => STEPS[STEPS.indexOf(s) + 1] ?? null;
export const prev = (s: Step): Step | null => STEPS[STEPS.indexOf(s) - 1] ?? null;
/** "2 of 3" for the dots and the screen reader */
export const position = (s: Step): { n: number; of: number } => ({ n: STEPS.indexOf(s) + 1, of: STEPS.length });

/** Damaged or foreign data in the storage key counts as "not remembered". */
export function sanitizeRemembered(raw: unknown): Remembered | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Remembered>;
  if (r.files !== 'local' && r.files !== 'connect' && r.files !== 'skipped') return null;
  return { files: r.files, at: Number.isFinite(r.at) ? (r.at as number) : 0 };
}

const KEY = 'workcraft.onboarding';

export function readRemembered(storage: Pick<Storage, 'getItem'> = localStorage): Remembered | null {
  try {
    return sanitizeRemembered(JSON.parse(storage.getItem(KEY) || 'null'));
  } catch {
    return null;
  }
}

export function remember(files: Remembered['files'], storage: Pick<Storage, 'setItem'> = localStorage, now = Date.now()): void {
  try {
    storage.setItem(KEY, JSON.stringify({ files, at: now } satisfies Remembered));
  } catch {
    /* storage blocked: the page may come again next time, nothing is lost */
  }
}
