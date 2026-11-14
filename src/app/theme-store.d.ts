export type Theme = 'system' | 'light' | 'dark';
export type ThemeScope = 'ide' | 'home';
export const THEMES: Theme[];
export const SCOPES: Record<ThemeScope, { key: string; at: string; cookie: string; channel: string }>;
export function readTheme(scope?: ThemeScope): Theme;
export function writeTheme(theme: string, scope?: ThemeScope): void;
export function resolveTheme(theme: string): 'light' | 'dark';
export function watchTheme(fn: (theme: Theme) => void, scope?: ThemeScope): { set(theme: string): void };
