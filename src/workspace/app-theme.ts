// The light or dark look of the workspace and what it means for one app panel (rules: src/ecosystems/theme.ts, guide: docs/THEMING.md).
//
// The switch of the workspace (prefs.theme: system, light or dark) is the one source of truth. `workspaceLook()` resolves it; a panel
// reads its app's capability from the catalog and shows the matching frame: an app that follows the switch gets the workspace look,
// every other app keeps its own look and its panel is painted to match it, so a dark-only app in a light workspace does not sit in a
// light frame with a dark hole in it.

import { prefs } from '../app/settings.js';
import { bus } from '../app/bus.js';
import { appById } from '../ecosystems/catalog.js';
import { kindOf, lookIn, themeOf, type Look, type ThemeKind } from '../ecosystems/theme.js';

/** The look of the workspace now: the switch, or the operating system when the switch says system. */
export function workspaceLook(): Look {
  const pref = prefs.get('theme');
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export interface PanelLook {
  /** What the panel shows around the app */
  look: Look;
  /** follows, own, always-light or always-dark */
  kind: ThemeKind;
  /** The app keeps a look that differs from the workspace (the frame is painted for it) */
  differs: boolean;
}

/** The look of one app's panel in the workspace as it is now. */
export function panelLook(appId: string): PanelLook {
  const t = themeOf(appById(appId));
  const ws = workspaceLook();
  const look = lookIn(t, ws);
  return { look, kind: kindOf(t), differs: look !== ws };
}

/**
 * Puts the look on an element (data-look, data-theme-kind, data-differs) and keeps it current when the switch or the system theme
 * changes. Returns the function that stops watching.
 */
export function bindPanelLook(el: HTMLElement, appId: string): () => void {
  const paint = () => {
    const p = panelLook(appId);
    el.dataset.look = p.look;
    el.dataset.themeKind = p.kind;
    el.dataset.differs = String(p.differs);
  };
  paint();
  const off = bus.on('settings:change', ({ key }: { key: string }) => key === 'theme' && paint());
  let mq: MediaQueryList | null = null;
  try {
    mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', paint);
  } catch {
    /* no matchMedia */
  }
  return () => {
    off?.();
    mq?.removeEventListener('change', paint);
  };
}
