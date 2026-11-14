// What happens to the stage when a workspace (ecosystem) is entered. Kept apart from the picker (ui.ts) so the start-up code can use it
// without loading the dialogs. The decisions are the pure functions in stage-plan.ts; this file only moves panels.
//
// Rule: entering a workspace NEVER opens an app. The stage shows the welcome page of the workspace and you open the apps
// you want, because several engines starting at once (WebAssembly, GPU) make the machine laggy. The only thing that changes is that
// the open apps of the workspace you left give way (hidden, not closed: their state is kept).

import { device } from '../app/device.js';
import { bus } from '../app/bus.js';
import { workspace } from '../workspace/layout.js';
import { AVAILABLE, TOOLS, type ToolId } from '../workspace/registry.js';
import { planLeave, planStage, type PlanPanel, type StagePlan } from './stage-plan.js';
import type { Ecosystem } from './catalog.js';

/** The panels of the stage as the planner sees them. */
export const stagePanels = (): PlanPanel[] =>
  workspace.panels().filter((p) => TOOLS[p.tool].zone === 'stage').map((p) => ({ id: p.id, tool: p.tool, mode: p.mode as PlanPanel['mode'], app: TOOLS[p.tool].kind === 'app' }));

/** The plan of "open the first apps of this workspace" on this device, from the panels that exist now. */
export function planFor(eco: Ecosystem, panels: readonly PlanPanel[] = stagePanels()): StagePlan {
  return planStage({
    apps: eco.apps,
    runs: (id) => AVAILABLE.has(id as ToolId),
    weightOf: (id) => TOOLS[id as ToolId]?.traits?.weight,
    panels,
    ipad: device.info.ipad,
    compact: device.compact,
    stageWidth: document.getElementById('stage')?.clientWidth ?? 0,
  });
}

/**
 * Enters a workspace: the visible apps of other workspaces give way, nothing is opened. Returns how many panels were hidden.
 * Code and terminal panels stay as they are.
 */
export function enterEcosystem(eco: Ecosystem): number {
  const leave = planLeave(eco.apps, stagePanels());
  for (const id of leave) workspace.hide(id);
  if (!leave.length) bus.emit('workspace:change');
  return leave.length;
}

/**
 * The button of the welcome page, "Open the first apps": the first apps of the workspace that can run here show side by side (two on
 * a wide stage, one in a small window; on an iPad the weights decide, see stage-plan.ts). Always your choice, never automatic.
 */
export function openFirstApps(eco: Ecosystem): StagePlan {
  const plan = planFor(eco);
  if (plan.reason === 'no-builds') return plan;
  for (const id of plan.hide) workspace.hide(id);
  let target: string | undefined;
  for (const id of plan.show) {
    const existing = workspace.panels().find((p) => p.tool === id);
    if (existing) {
      workspace.show(existing.id);
      target ??= existing.id;
    } else target = workspace.openPanel(id as ToolId, { silent: true, ...(target ? { target, side: 'right' as const, focus: false } : {}) });
  }
  if (plan.layout) workspace.applyPreset(plan.layout);
  return plan;
}
