// What a tool card shows (pure, tested in tests/server/app-agents.test.ts): a readable tool name with the app as a chip, a live
// duration, and the way out when the app behind a tool stopped answering.

import { appOfGroup } from '../ecosystems/catalog.js';
import { externalGroup } from './app-roles.js';

export interface StepDisplay {
  /** Tool name without the `ext-<app>-` prefix of a Craft app's MCP tool */
  label: string;
  /** The Craft app behind an external tool */
  app?: { id: string; name: string };
}

/** `ext-photocraft-apply-filter` is shown as `apply-filter` with the chip PhotoCraft; every other tool keeps its name. */
export function stepDisplay(name: string): StepDisplay {
  const group = externalGroup(name);
  const app = group ? appOfGroup(group) : undefined;
  if (!app || !group) return { label: name };
  return { label: name.slice(`ext-${group}-`.length) || name, app: { id: app.id, name: app.name } };
}

/** The connection to a server is gone (the app was closed, the pipe broke), as opposed to a tool that failed. Same words as src/server/mcp.ts. */
export const connectionLost = (text: string) => /closed|EPIPE|ECONNRESET|ECONNREFUSED|not connected|connection (?:lost|reset)|socket hang up|not running any more|no answer to a ping|spawn .* ENOENT/i.test(text);

/** Seconds with one decimal below a minute, then minutes and seconds ("2 m 05 s"). */
export function elapsedText(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, '0')} s`;
}

/** Counts for the one-line summary above a group of tool cards. */
export function stepTotals(steps: readonly { status: string; result?: { ms: number } }[]): { total: number; done: number; failed: number; running: number; ms: number } {
  return {
    total: steps.length,
    done: steps.filter((s) => s.status === 'done').length,
    failed: steps.filter((s) => s.status === 'error').length,
    running: steps.filter((s) => s.status === 'running' || s.status === 'pending' || s.status === 'waiting').length,
    ms: steps.reduce((a, s) => a + (s.result?.ms || 0), 0),
  };
}
