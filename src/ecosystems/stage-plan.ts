// What happens to the stage around a workspace, decided in one place. Pure: no DOM, no panels, tested without a browser.
//
// Entering a workspace opens NOTHING: the stage shows the welcome page and the user opens the apps (several engines
// starting together make the machine laggy). `planLeave` says which open apps of the old workspace give way. `planStage` is what the
// welcome page's button "Open the first apps" uses, an explicit choice: which apps show, which panels give way and the layout, from the
// apps of the workspace, which of them have a web build here, and the device.

import { pickStageApps, type Weight } from '../ipados/stage.js';

export interface PlanPanel {
  id: string;
  tool: string;
  mode: 'normal' | 'minimized' | 'hidden';
  /** a Craft app (not the code editor, the terminal or the settings) */
  app: boolean;
}

export interface PlanInput {
  /** the apps of the workspace, in its own order */
  apps: readonly string[];
  /** has a web build in this installation */
  runs: (id: string) => boolean;
  weightOf: (id: string) => Weight | undefined;
  /** the stage panels that exist now */
  panels: readonly PlanPanel[];
  ipad: boolean;
  /** a narrow window or a portrait iPad: one app fills the stage */
  compact: boolean;
  /** width of the stage in px (the space between the project tree and the chat); omitted when unknown */
  stageWidth?: number;
}

export interface StagePlan {
  /** apps to show: the panel is shown if it exists, opened if not */
  show: string[];
  /** ids of visible app panels of other workspaces that give way */
  hide: string[];
  /** how the visible panels are laid out afterwards; null keeps the layout */
  layout: 'columns' | 'grid' | null;
  /** ok: something shows. no-builds: no app of the workspace can run here, the stage stays as it is */
  reason: 'ok' | 'no-builds';
}

/** The least width an app needs next to another one, in px. Below two of them the stage opens one app (the second is a tab away). */
export const MIN_APP_WIDTH = 320;

/**
 * How many apps a workspace opens side by side: one in a compact window, and one when the stage itself is too narrow for two
 * (a 800 px window with the project tree and the chat open leaves about 300 px), two otherwise. `stageWidth` 0 means unknown.
 */
export const stageSlots = (compact: boolean, stageWidth = 0): number => (compact || (stageWidth > 0 && stageWidth < MIN_APP_WIDTH * 2) ? 1 : 2);

export function planStage(input: PlanInput): StagePlan {
  const runnable = input.apps.filter((id) => input.runs(id));
  const show = pickStageApps(runnable, input.weightOf, { ipad: input.ipad, max: stageSlots(input.compact, input.stageWidth) });
  // Nothing can start: touch nothing. The panels of the old workspace stay, the empty stage (or the launcher) says why.
  if (!show.length) return { show: [], hide: [], layout: null, reason: 'no-builds' };
  const mine = new Set<string>(input.apps);
  const hide = input.panels.filter((p) => p.app && !mine.has(p.tool) && p.mode === 'normal').map((p) => p.id);
  return { show, hide, layout: show.length === 2 ? 'columns' : 'grid', reason: 'ok' };
}

/** Entering a workspace opens nothing: the ids of the visible app panels of other workspaces that give way (hidden, state kept). */
export function planLeave(apps: readonly string[], panels: readonly PlanPanel[]): string[] {
  const mine = new Set<string>(apps);
  return panels.filter((p) => p.app && !mine.has(p.tool) && p.mode === 'normal').map((p) => p.id);
}

/** Does the stage need arranging at start: no stage panel is visible although the workspace has an app that can run? */
export function stageIsBlank(panels: readonly Pick<PlanPanel, 'mode'>[]): boolean {
  return !panels.some((p) => p.mode === 'normal');
}

/**
 * A panel tab that belongs on the strip: everything visible or minimized, the tools (code, terminal, settings), the apps of the
 * workspace in use, and any app that is loaded (it holds live state, maybe unsaved). A hidden panel of another workspace's app that
 * never started stays off the strip: it is not gone, the launcher and Open with bring it back.
 */
export function tabBelongs(p: { app: boolean; tool: string; mode: string; live: boolean }, mine: ReadonlySet<string>): boolean {
  if (p.mode !== 'hidden') return true;
  if (!p.app) return true;
  return mine.has(p.tool) || p.live;
}
