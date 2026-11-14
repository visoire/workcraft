// Small helpers without dependencies.

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

/** DOM-Helfer: h('div.cls#id', {attrs}, ...children) */
export function h<K extends keyof HTMLElementTagNameMap = 'div'>(sel: string, attrs?: Attrs | Child, ...children: Child[]): HTMLElementTagNameMap[K] {
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m?.[1] || 'div') as K);
  for (const part of m?.[2]?.match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs !== undefined && (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs as Child);
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'html') el.innerHTML = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface Debounced<A extends unknown[]> {
  (...a: A): void;
  flush(...a: A): void;
  cancel(): void;
}
export function debounce<A extends unknown[]>(fn: (...a: A) => unknown, ms: number): Debounced<A> {
  let t: ReturnType<typeof setTimeout> | undefined;
  let last: A | null = null;
  const d = ((...a: A) => {
    last = a;
    clearTimeout(t);
    t = setTimeout(() => {
      last = null;
      fn(...a);
    }, ms);
  }) as Debounced<A>;
  d.flush = (...a: A) => {
    clearTimeout(t);
    const args = a.length ? a : last;
    last = null;
    if (args) fn(...args);
  };
  d.cancel = () => {
    clearTimeout(t);
    last = null;
  };
  return d;
}

/** Filters empty children (null, false) for replaceChildren and append. */
export const nodes = (...xs: (Node | string | null | undefined | false)[]): (Node | string)[] => xs.filter((x): x is Node | string => !!x);

export const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- Paths ----------
export function normPath(p: string): string {
  const parts: string[] = [];
  for (const seg of String(p).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}
export const dirname = (p: string) => normPath(p).replace(/\/[^/]*$/, '') || '/';
export const basename = (p: string) => normPath(p).split('/').pop() || '';
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};
export const stem = (p: string) => basename(p).replace(/\.[^.]+$/, '');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export const formatTime = (ts: number | string) => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const clock = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

import { lang } from './i18n.js';
/**
 * Root of the site: the folder that holds index.html. Works under / (npm start, npm run dev) and
 * under sub paths like /workcraft/ (XAMPP). Apps, logos, sounds and the service worker live there.
 */
export const ROOT = new URL('./', location.href).href;
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : lang === 'de' ? 'Strg' : 'Ctrl';

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'xml', 'svg', 'yml', 'yaml', 'toml', 'py', 'sh', 'sql', 'ini', 'log', 'tex', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'gitignore']);
export const isText = (p: string) => TEXT_EXT.has(extname(p)) || !extname(p);
