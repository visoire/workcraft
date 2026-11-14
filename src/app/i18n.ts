// Interface language of the workspace. English is the default and lives in the source code; German is
// optional and comes from the dictionary in i18n-de.ts. The choice is stored per browser ("oc-ide-lang")
// and applies after a reload. The website is English only and never reads it.
//
//   t('Open settings')                      -> "Einstellungen öffnen" in German
//   t('{n} tools available', { n: 12 })     -> placeholders in curly braces

import { DE } from './i18n-de.js';

export type Lang = 'en' | 'de';
export const LANG_KEY = 'oc-ide-lang';
/** Key of versions before 1.3 (read once, so an earlier choice of German is kept) */
const OLD_LANG_KEY = 'opencraft-lang';
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
];
/** Labels for the language selector in the settings */
export const LANG_LABELS: Record<Lang, string> = { en: 'English (default)', de: 'Deutsch (optional)' };

function stored(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY) ?? localStorage.getItem(OLD_LANG_KEY);
    if (v === 'en' || v === 'de') return v;
  } catch {
    /* no storage */
  }
  return 'en';
}

export const lang: Lang = stored();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** Text in the current language. The English text is the key. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill(lang === 'de' ? (DE[en] ?? en) : en, vars);
}

/** Singular or plural: tn(n, '{n} file', '{n} files'). */
export function tn(n: number, one: string, many: string, vars: Record<string, string | number> = {}): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

/** Date and time in the format of the current language. */
export const locale = () => (lang === 'de' ? 'de-DE' : 'en-US');

export function setLang(l: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* no storage */
  }
  location.reload();
}
