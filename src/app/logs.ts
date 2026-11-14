// Local log of the interface for the log panel (Settings, Logs and metrics): uncaught errors,
// console warnings, app start times and MCP latency. In desktop mode the lines also go to the
// backend log (only to this computer). Measurements go to the local metrics when the user
// switched them on. Nothing leaves the device.

import { api, backend } from './backend.js';
import { bus } from './bus.js';
import { aiConfig } from '../chat/config.js';

export type Level = 'debug' | 'info' | 'warn' | 'error';
export interface UiLog {
  seq: number;
  at: string;
  level: Level;
  source: string;
  message: string;
  ms?: number;
}

const MAX = 600;
const lines: UiLog[] = [];
let seq = 0;
let outbox: Omit<UiLog, 'seq' | 'at'>[] = [];
let metricsOut: { name: string; value: number }[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  if (backend.browser) {
    outbox = [];
    metricsOut = [];
    return;
  }
  if (outbox.length) {
    const batch = outbox.splice(0, 100);
    void api.send('POST', '/api/logs', batch).catch(() => {});
  }
  if (metricsOut.length && aiConfig.config?.metrics?.enabled) {
    const batch = metricsOut.splice(0, 100);
    void api.send('POST', '/api/metrics', batch).catch(() => {});
  } else metricsOut = [];
}
const later = () => void (timer ||= setTimeout(flush, 2500));

export function uiLog(level: Level, source: string, message: string, ms?: number, send = true): void {
  const l: UiLog = { seq: ++seq, at: new Date().toISOString(), level, source, message: message.slice(0, 2000), ...(ms !== undefined ? { ms: Math.round(ms) } : {}) };
  lines.push(l);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  if (send) {
    outbox.push({ level, source, message: l.message, ...(ms !== undefined ? { ms: l.ms } : {}) });
    later();
  }
  bus.emit('log:line', l);
}

export const uiLogs = {
  list: () => lines.slice(),
  clear: () => void (lines.length = 0),
};

let installed = false;
export function installLogCapture(): void {
  if (installed) return;
  installed = true;
  addEventListener('error', (e) => uiLog('error', 'window', e.error?.stack || e.message || String(e.error)));
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; stack?: string; message?: string };
    if (r?.name === 'AbortError') return;
    uiLog('error', 'promise', r?.stack || r?.message || String(e.reason));
  });
  for (const level of ['warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        uiLog(level, 'console', args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      } catch {
        /* never break the console */
      }
      orig(...args);
    };
  }
  bus.on('metric', ({ name, value }) => {
    uiLog('info', name.split(':')[0] || 'metric', `${name}: ${Math.round(value)} ms`, value, false);
    metricsOut.push({ name, value });
    later();
  });
  bus.on('tool:activity', (e) => e.phase === 'end' && e.ok === false && uiLog('warn', 'mcp', `${e.name}: ${e.message || 'failed'}`, undefined, false));
  bus.on('backend:mode', (e) => uiLog('info', 'backend', `mode ${e.mode}${e.reason ? ': ' + e.reason : ''}`));
  bus.on('ws:state', (e) => uiLog(e.connected ? 'info' : 'warn', 'ws', e.connected ? 'live connection open' : 'live connection lost', undefined, false));
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) addEventListener('load', () => setTimeout(() => bus.emit('metric', { name: 'ide:load', value: nav.loadEventEnd || performance.now() }), 0), { once: true });
}
