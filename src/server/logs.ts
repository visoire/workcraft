// Observability, local only: a ring buffer with the log of the backend (warnings, errors, tool
// calls, AI requests) for the log panel in Settings, and optional performance metrics in
// ~/workcraft/metrics.json (start times of the apps, MCP latency, time to the first token).
// Nothing here is ever sent anywhere. The anonymized report is a file the user saves by hand.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from './paths.js';
import { config } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogLine {
  seq: number;
  at: string;
  level: LogLevel;
  source: string;
  message: string;
  ms?: number;
}

const MAX = 2000;
const lines: LogLine[] = [];
let seq = 0;
export const STARTED = Date.now();

export function log(level: LogLevel, source: string, message: string, ms?: number): void {
  lines.push({ seq: ++seq, at: new Date().toISOString(), level, source, message: message.slice(0, 2000), ...(ms !== undefined ? { ms: Math.round(ms) } : {}) });
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

export function logList(opt: { since?: number; level?: LogLevel; limit?: number } = {}): LogLine[] {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const min = order.indexOf(opt.level || 'debug');
  return lines.filter((l) => l.seq > (opt.since || 0) && order.indexOf(l.level) >= min).slice(-(opt.limit || 500));
}

export function logClear(): void {
  lines.length = 0;
}

/** Copies console.warn and console.error into the ring buffer (the terminal output stays). */
export function captureConsole(): void {
  for (const level of ['warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(level, 'backend', args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      orig(...args);
    };
  }
}

// ---------------------------------------------------------------- Metrics

const METRICS_FILE = join(HOME, 'metrics.json');
interface Series {
  n: number;
  /** last 200 values for the percentiles */
  values: number[];
}
interface MetricsStore {
  since: string;
  series: Record<string, Series>;
}
let metrics: MetricsStore | null = null;
const loadMetrics = (): MetricsStore => {
  if (metrics) return metrics;
  try {
    metrics = existsSync(METRICS_FILE) ? (JSON.parse(readFileSync(METRICS_FILE, 'utf8')) as MetricsStore) : null;
  } catch {
    metrics = null;
  }
  if (!metrics || typeof metrics.series !== 'object') metrics = { since: new Date().toISOString(), series: {} };
  return metrics;
};
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Records one measurement, for example metric('mcp:read-sheet', 120). Only when metrics are on. */
export function metric(name: string, value: number): void {
  if (!config().metrics.enabled || !isFinite(value)) return;
  const m = loadMetrics();
  const s = (m.series[name.slice(0, 80)] ||= { n: 0, values: [] });
  s.n++;
  s.values.push(Math.round(value));
  if (s.values.length > 200) s.values.shift();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      writeFileSync(METRICS_FILE, JSON.stringify(m));
    } catch {
      /* next time */
    }
  }, 1000);
}

const pct = (v: number[], p: number) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

export function metricsSummary() {
  const m = loadMetrics();
  return {
    enabled: config().metrics.enabled,
    since: m.since,
    series: Object.entries(m.series)
      .map(([name, s]) => ({ name, n: s.n, p50: pct(s.values, 50), p95: pct(s.values, 95), max: Math.max(0, ...s.values) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function metricsReset(): void {
  metrics = { since: new Date().toISOString(), series: {} };
  try {
    writeFileSync(METRICS_FILE, JSON.stringify(metrics));
  } catch {
    /* ignore */
  }
}

/**
 * Anonymized report: series names without file names or paths (tool, app and provider names
 * only), no times of day, no host names. The user saves it by hand.
 */
export function anonymizedReport() {
  const s = metricsSummary();
  return {
    kind: 'workcraft-performance-report',
    generated: new Date().toISOString().slice(0, 10),
    platform: process.platform,
    node: process.versions.node.split('.')[0],
    series: s.series.filter((x) => /^[a-z]+:[\w.-]+$/i.test(x.name) && !x.name.includes('/')),
  };
}
