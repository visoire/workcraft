// Which apps start together, and how long an app gets to start. Pure: the same numbers on every device, tested without a browser.
//
// Why: the apps of the other ecosystems differ a lot in weight (catalog trait `weight`: a text editor against a video editor or a
// 3D modeler with 100 MB of WebAssembly). Opening the first two apps of a workspace side by side is fine on a desktop; on an iPad
// two heavy engines can end the tab before the memory governor has a number (Safari closes it silently at roughly 1.5 to 2.5 GB).
// And a heavy engine needs longer to compile on an iPad than on a desktop, so a flat start timeout reports a healthy app as dead.

export type Weight = 'light' | 'medium' | 'heavy';

const COST: Record<Weight, number> = { light: 1, medium: 2, heavy: 3 };

/** Weight points that may start together: two medium apps (the office apps side by side), or a heavy app with a light one, on an iPad; two heavy apps elsewhere. */
export const stageCapacity = (ipad: boolean): number => (ipad ? 4 : 6);

/**
 * The apps a workspace opens by itself, in its own order, at most `max` (default 2, side by side). An app that would take the
 * stage over its capacity is skipped and a lighter one after it may take its place; the skipped ones stay one click away in the
 * launcher. Pure.
 */
export function pickStageApps<T extends string>(ids: readonly T[], weightOf: (id: T) => Weight | undefined, opt: { ipad: boolean; max?: number }): T[] {
  const max = opt.max ?? 2;
  const cap = stageCapacity(opt.ipad);
  const out: T[] = [];
  let used = 0;
  for (const id of ids) {
    if (out.length >= max) break;
    const cost = COST[weightOf(id) ?? 'medium'];
    if (used + cost > cap && out.length) continue;
    out.push(id);
    used += cost;
  }
  return out;
}

/** Base time an engine gets to take over its canvas, in ms. */
export const START_BASE_MS = 90_000;

/** Time allowed for an app to start: longer for a heavy engine and on an iPad (the WebAssembly compiles slower there). Pure. */
export function startTimeoutMs(weight: Weight | undefined, ipad: boolean): number {
  return Math.round(START_BASE_MS * (weight === 'heavy' ? 1.5 : weight === 'light' ? 0.75 : 1) * (ipad ? 1.5 : 1));
}
