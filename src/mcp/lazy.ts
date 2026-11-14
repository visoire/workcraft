// The MCP client (SDK and Zod) loads only after the first frame of the workspace.
// That keeps the start bundle small. The chat loads it right away.

import type { orchestrator as Orchestrator } from './orchestrator.js';

let mod: { orchestrator: typeof Orchestrator } | null = null;
let loading: Promise<typeof Orchestrator> | null = null;

export function loadOrchestrator(): Promise<typeof Orchestrator> {
  if (mod) return Promise.resolve(mod.orchestrator);
  loading ||= import('./orchestrator.js').then((m) => (mod = m).orchestrator);
  return loading;
}

/** The already loaded orchestrator or null (for synchronous places like the command palette). */
export const loadedOrchestrator = (): typeof Orchestrator | null => mod?.orchestrator || null;
