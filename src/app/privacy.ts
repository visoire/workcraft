// Local-only mode in the interface: a badge in the top bar and, as a second barrier besides the
// backend, a stricter Content Security Policy: once the mode is on, this page can only connect
// to itself, this computer and the paired desktop. Browsers cannot loosen a policy again, so
// switching the mode off takes effect after a reload.

import { bus } from './bus.js';
import { aiConfig } from '../chat/config.js';

let injected = false;

function desktopHost(): string | null {
  try {
    const d = JSON.parse(localStorage.getItem('workcraft.desktop') || '{}') as { host?: string; port?: string };
    return d.host ? `http://${d.host}:${d.port || '5175'}` : null;
  } catch {
    return null;
  }
}

/** Adds the strict policy (once per page). */
export function lockConnections(): void {
  if (injected) return;
  injected = true;
  const allow = ["'self'", 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*', `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`];
  const d = desktopHost();
  if (d) allow.push(d);
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = `connect-src ${allow.join(' ')}`;
  meta.dataset.workcraftLocalOnly = '';
  document.head.append(meta);
}

export const privacy = {
  get localOnly(): boolean {
    return !!aiConfig.config?.privacy?.localOnly;
  },
  /** true when the strict policy of an earlier "on" still applies after switching off */
  get needsReload(): boolean {
    return injected && !this.localOnly;
  },
};

export function installPrivacyGuard(): void {
  const apply = () => {
    const on = privacy.localOnly;
    document.documentElement.classList.toggle('is-local-only', on);
    if (on) lockConnections();
    bus.emit('privacy:change', { localOnly: on });
  };
  bus.on('config:change', apply);
  void aiConfig.get().then(apply).catch(() => {});
}
