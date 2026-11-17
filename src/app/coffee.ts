// A small "Buy me a coffee" note, once in a while. It appears after a longer stretch of work, closing it hides it
// for two weeks and "No thanks" for good. No network request: the button only opens the maker's page in a new tab.
import { esc } from './util.js';
import { t } from './i18n.js';

export const URL_BMC = 'https://www.buymeacoffee.com/visoire';
const KEY = 'workcraft.coffee';
const DELAY = 10 * 60 * 1000;
const SNOOZE = 14 * 24 * 3600 * 1000;

type State = { never?: boolean; until?: number };
const read = (): State => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem('oc-coffee') || '{}') as State;
  } catch {
    return {};
  }
};
const write = (s: State) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the note may come again next time */
  }
};

export function showCoffee(): HTMLElement | null {
  if (document.querySelector('.coffee') || document.querySelector('.coffee-note')) return null;
  const box = document.createElement('aside');
  box.className = 'coffee coffee-note';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'coffee-t');
  box.innerHTML = `
    <button class="coffee-x" type="button" aria-label="${esc(t('Close'))}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <svg class="coffee-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3v2M12 3v2"/></svg>
    <h2 class="coffee-t" id="coffee-t">${esc(t('Enjoying WorkCraft?'))}</h2>
    <p>${esc(t('It is free, open source and keeps running on coffee. If it saves you time, you can buy me one.'))}</p>
    <div class="coffee-actions">
      <a class="btn btn-solid btn-sm" href="${URL_BMC}" target="_blank" rel="noopener noreferrer">${esc(t('Buy me a coffee'))}</a>
      <button class="btn btn-ghost btn-sm" type="button" data-never>${esc(t('No thanks'))}</button>
    </div>`;

  const close = (never: boolean) => {
    write(never ? { never: true } : { until: Date.now() + SNOOZE });
    box.classList.remove('is-in');
    window.setTimeout(() => box.remove(), 400);
  };

  box.querySelector<HTMLButtonElement>('.coffee-x')?.addEventListener('click', () => close(false));
  box.querySelector<HTMLButtonElement>('[data-never]')?.addEventListener('click', () => close(true));
  box.querySelector<HTMLAnchorElement>('a.btn')?.addEventListener('click', () => write({ until: Date.now() + 30 * 24 * 3600 * 1000 }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.isConnected) close(false);
  });

  document.body.append(box);
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('is-in')));
  return box;
}

export function startCoffee(): void {
  const s = read();
  if (s.never || (s.until && Date.now() < s.until)) return;
  window.setTimeout(() => {
    showCoffee();
  }, DELAY);
}

if (typeof window !== 'undefined') {
  (window as unknown as { __showCoffee?: typeof showCoffee }).__showCoffee = showCoffee;
}
