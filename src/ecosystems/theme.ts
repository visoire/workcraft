// What each app can do with the light and dark mode of the workspace. Pure (no DOM): the panel, the settings page, the build script
// that writes public/craft-theme.js and the tests all use these rules. The guide for people and agents is docs/THEMING.md.
//
// The workspace switch (prefs.theme, scope 'ide') is the single source of truth. For every app the catalog says
//   modes  which looks the app has: both, light or dark
//   via    how WorkCraft can reach it:
//            media   the app reads prefers-color-scheme through matchMedia; public/craft-theme.js answers with the workspace theme
//            switch  the app has a switch of its own that public/craft-theme.js presses (WordCraft, DeckCraft)
//            css     the app styles itself with a CSS @media (prefers-color-scheme) rule; the script rewrites that rule
//            own     the app has a light/dark choice of its own that cannot be set from outside; it shows `look` until the user changes it
//            fixed   the app has one look (`modes`)
//   look   what the app shows when WorkCraft cannot decide (own and fixed apps)
// An app that follows keeps the look of the workspace; every other app keeps its own look inside a panel that matches it.

import { appById, type CatalogApp } from './catalog.js';

export type ThemeModes = 'both' | 'light' | 'dark';
export type ThemeVia = 'media' | 'switch' | 'css' | 'own' | 'fixed';
export type Look = 'light' | 'dark';

export interface AppTheme {
  modes: ThemeModes;
  via: ThemeVia;
  /** The look an own or fixed app has until its user changes it */
  look?: Look;
  /** Where the facts come from (measured in a browser, or the place in the source), so the next person can check them */
  evidence?: string;
}

/** The ways that make an app follow the workspace switch. */
export const FOLLOWING: readonly ThemeVia[] = ['media', 'switch', 'css'];

/** The theme record of an app (an app without one is treated as fixed on its look: dark). */
export const themeOf = (app: Pick<CatalogApp, 'theme'> | undefined): AppTheme => app?.theme ?? { modes: 'dark', via: 'fixed', look: 'dark' };

/** Does this app follow the workspace switch? */
export const followsWorkspace = (t: AppTheme): boolean => FOLLOWING.includes(t.via);

/**
 * The look an app has in a workspace whose resolved theme is `workspace`: the workspace theme for an app that follows it,
 * the app's own look for one that cannot follow (a dark-only app is dark in a light workspace).
 */
export function lookIn(t: AppTheme, workspace: Look): Look {
  if (followsWorkspace(t)) return workspace;
  if (t.modes === 'light' || t.modes === 'dark') return t.modes;
  return t.look ?? 'dark';
}

/** Same by app id (unknown ids behave like a dark-only app). */
export const appLook = (id: string, workspace: Look): Look => lookIn(themeOf(appById(id)), workspace);

/** One line for a tooltip or a table: what the app does with the switch. English; the interface translates it. */
export function describeTheme(t: AppTheme): string {
  if (followsWorkspace(t)) return 'Follows the workspace switch';
  if (t.via === 'own') return `Has its own light and dark setting, shows ${t.look ?? 'dark'} until you change it inside the app`;
  return t.modes === 'light' ? 'Always light' : 'Always dark';
}

/** Short status for a chip: follows, own-look or always. */
export type ThemeKind = 'follows' | 'own' | 'always-light' | 'always-dark';
export function kindOf(t: AppTheme): ThemeKind {
  if (followsWorkspace(t)) return 'follows';
  if (t.via === 'own') return 'own';
  return t.modes === 'light' ? 'always-light' : 'always-dark';
}

/** Background an app's panel gets while the app keeps a look that differs from the workspace (same values as BG in public/craft-theme.js). */
export const LOOK_BG: Record<Look, string> = { light: '#f3f3f3', dark: '#121214' };

/** The map public/craft-theme.js embeds: only what the script needs at run time, in catalog order. Written by scripts/sync-themes.mjs. */
export function scriptMap(apps: readonly Pick<CatalogApp, 'id' | 'theme'>[]): Record<string, [ThemeModes, ThemeVia, Look | '']> {
  return Object.fromEntries(apps.map((a) => [a.id, [a.theme?.modes ?? 'dark', a.theme?.via ?? 'fixed', a.theme?.look ?? ''] as [ThemeModes, ThemeVia, Look | '']]));
}
