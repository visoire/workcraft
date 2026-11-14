// Notifications: toast cards and inline banners in the .frame/.well style.
// Every error names the cause in plain language and offers an action to fix it.

import { h } from './util.js';
import { icon } from './icons.js';
import { bus } from './bus.js';
import { play } from './sounds.js';
import { t } from './i18n.js';

export type Level = 'info' | 'success' | 'warning' | 'error';
export interface Action {
  label: string;
  run: () => void | Promise<void>;
  primary?: boolean;
}
export interface Note {
  level?: Level;
  title: string;
  message?: string;
  code?: string;
  actions?: Action[];
  /** Milliseconds, 0 = stays until closed */
  timeout?: number;
}

const ICON: Record<Level, string> = { info: 'info', success: 'check', warning: 'alert', error: 'alert' };
let host: HTMLElement | null = null;
const active = new Map<string, HTMLElement>();

function card(n: Note, close: () => void): HTMLElement {
  const level = n.level || 'info';
  const actions = (n.actions || []).map((a) =>
    h(
      'button.btn' + (a.primary ? '.primary' : ''),
      {
        type: 'button',
        onclick: async () => {
          close();
          await a.run();
        },
      },
      a.label
    )
  );
  return h(
    'div.frame.note',
    { 'data-level': level, role: level === 'error' ? 'alert' : 'status' },
    h(
      'div.well.note-well',
      h('span.note-ic', { html: icon(ICON[level], { size: 18 }) }),
      h(
        'div.note-body',
        h('strong.note-title', n.title),
        n.message ? h('p.note-msg', n.message) : null,
        n.code ? h('small.note-code.mono', n.code) : null,
        actions.length ? h('div.note-actions', actions) : null
      ),
      h('button.icon-btn.note-x', { type: 'button', 'aria-label': t('Close'), html: icon('close', { size: 16 }), onclick: close })
    )
  );
}

/** Shows a toast card. Equal titles replace each other instead of stacking. */
export function notify(n: Note): () => void {
  host ||= document.body.appendChild(h('div.notes', { 'aria-live': 'polite' }));
  const key = `${n.level}|${n.title}`;
  active.get(key)?.remove();
  let t: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    clearTimeout(t);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
    active.delete(key);
  };
  const el = card(n, close);
  host.append(el);
  active.set(key, el);
  const ms = n.timeout ?? (n.level === 'error' || n.actions?.length ? 0 : 3500);
  if (ms) t = setTimeout(close, ms);
  if (n.level === 'error') play('error');
  return close;
}

export const toast = (title: string, level: Level = 'info', message?: string) => notify({ title, level, message });

/** Inline banner in a container (for example above the chat or in a panel). */
export function banner(container: HTMLElement, n: Note): () => void {
  container.querySelector(`.note-inline[data-key="${CSS.escape(n.title)}"]`)?.remove();
  const close = () => el.remove();
  const el = card(n, close);
  el.classList.add('note-inline');
  el.dataset.key = n.title;
  container.prepend(el);
  return close;
}

// ---------------------------------------------------------------- Error catalogue

const openSettings = (section?: string): Action => ({ label: t('Open settings'), primary: true, run: () => bus.emit('open-settings', section) });

/** Turns a technical error into a clear message with a way to fix it. */
export function explain(err: unknown, retry?: () => void): Note {
  const e = err as { code?: string; message?: string; info?: { code?: string; message?: string; provider?: string }; name?: string };
  const code = e?.info?.code || e?.code || (e?.name === 'AbortError' ? 'ABORTED' : 'UNKNOWN');
  const detail = e?.info?.message || e?.message || String(err);
  const provider = e?.info?.provider;
  const again: Action[] = retry ? [{ label: t('Retry'), run: retry, primary: true }] : [];
  switch (code) {
    case 'AUTH':
      return { level: 'error', title: t('{provider}: API key missing or invalid', { provider: provider || t('AI provider') }), message: t('The provider rejected the request. Check the key in the settings.'), code: detail, actions: [openSettings('ai')] };
    case 'UNREACHABLE':
      return {
        level: 'error',
        title: provider === 'Ollama' ? t('Ollama is not reachable') : t('{provider} is not reachable', { provider: provider || t('The AI service') }),
        message: provider === 'Ollama' ? t('Start Ollama (ollama serve) and check the address in the settings.') : t('Check the internet connection or the endpoint address.'),
        code: detail,
        actions: [...again, openSettings('ai')],
      };
    case 'LOCAL_ONLY':
      return { level: 'warning', title: t('Local-only mode is on'), message: t('Cloud providers are blocked. Use Ollama or a local endpoint, or switch the mode off under Settings, Privacy.'), code: detail, actions: [openSettings('privacy')] };
    case 'BROWSER_MODE':
      return { level: 'info', title: t('Needs the desktop'), message: detail };
    case 'NO_PROVIDER':
      return { level: 'warning', title: t('No AI model set up'), message: t('Add an API key (Claude, ChatGPT, Gemini, DeepSeek), your own endpoint, or start Ollama.'), actions: [openSettings('ai')] };
    case 'RATE_LIMIT':
      return { level: 'warning', title: t('Rate limit reached'), message: t('The provider is throttling requests. Wait a moment and try again.'), code: detail, actions: again };
    case 'NOT_FOUND':
      // The router already looked at the provider's model list (src/chat/model-recovery.ts): these two messages are its findings
      if (/does not answer the models endpoint/i.test(detail)) return { level: 'error', title: t('Address not found'), message: t('The address of this provider does not answer. Check the base URL in the settings; OpenAI-compatible addresses usually end in /v1.'), code: detail, actions: [openSettings('ai')] };
      if (/reports no models/i.test(detail)) return { level: 'error', title: t('No model available'), message: t('The provider has no model to chat with. For Ollama, pull one first (for example ollama pull qwen3:4b); for a cloud provider check the account and the key.'), code: detail, actions: [openSettings('ai')] };
      return { level: 'error', title: t('Model or endpoint not found'), message: t('This provider has no model with that name. Pick an available model in the connection test.'), code: detail, actions: [openSettings('ai')] };
    case 'BAD_REQUEST':
      return { level: 'error', title: t('Request rejected by the model'), message: t('The model may not support tool calls. Pick a model with tool support.'), code: detail, actions: [...again, openSettings('ai')] };
    case 'TIMEOUT':
      return { level: 'warning', title: t('Timed out'), message: t('The answer did not arrive in time.'), actions: again };
    case 'ABORTED':
      return { level: 'info', title: t('Request stopped'), message: t('The answer was stopped. What arrived so far stays in the history.'), actions: again, timeout: 5000 };
    case 'BACKEND_DOWN':
      return { level: 'error', title: t('Local backend not reachable'), message: t('Start WorkCraft with npm run dev or npm start.'), actions: [{ label: t('Reconnect'), primary: true, run: () => location.reload() }] };
    case 'IMPORT':
      return { level: 'error', title: t('Import failed'), message: detail, actions: again };
    case 'VALIDATION':
      return { level: 'error', title: t('Invalid input'), message: detail, actions: again };
    case 'TOOL_FAILED':
      return { level: 'error', title: t('Tool failed'), message: detail, actions: again };
    default:
      return { level: 'error', title: t('Unexpected error'), message: detail, actions: again };
  }
}

export function notifyError(err: unknown, retry?: () => void): () => void {
  return notify(explain(err, retry));
}

/** Catches unhandled errors instead of leaving them silently in the console. */
export function installGlobalHandlers(): void {
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; code?: string };
    if (r?.name === 'AbortError' || r?.code === 'ABORTED') return;
    console.error(e.reason);
    notifyError(e.reason);
  });
  addEventListener('error', (e) => {
    if (!e.error) return;
    console.error(e.error);
    notifyError(e.error);
  });
}
