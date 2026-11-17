/**
 * The order of the app icons in the tool rail. You drag an icon to a new place (or use Move up and Move down in its
 * menu); the order is kept per workspace in the prefs (`railOrder`, workspace id -> app ids). Pure: no DOM, no storage.
 *
 * The workspace decides WHICH apps the rail shows (its own list); this only decides the ORDER. An app that is not in the
 * saved order (a new one, or one added to a custom workspace) goes to the end in its workspace order, and a saved id
 * that is no longer in the workspace is ignored, so a stale order never hides or invents an icon.
 */

export type RailOrder = Record<string, string[]>;

/** The apps in the saved order; the rest follows in the order the workspace gave. */
export function orderApps<T extends string>(apps: readonly T[], saved: readonly string[] | undefined): T[] {
  if (!saved?.length) return [...apps];
  const have = new Set<string>(apps);
  const first = saved.filter((id, i) => have.has(id) && saved.indexOf(id) === i) as T[];
  const seen = new Set<string>(first);
  return [...first, ...apps.filter((id) => !seen.has(id))];
}

/** The list with `id` moved to position `to` (0 = first). A position past the end puts it last; an unknown id changes nothing. */
export function moveApp<T extends string>(list: readonly T[], id: T, to: number): T[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const rest = list.filter((x) => x !== id);
  const at = Math.max(0, Math.min(rest.length, Math.round(to)));
  rest.splice(at, 0, id);
  return rest;
}

/** One step up (-1) or down (+1); the ends stay where they are. */
export function stepApp<T extends string>(list: readonly T[], id: T, dir: -1 | 1): T[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  return moveApp(list, id, Math.max(0, Math.min(list.length - 1, from + dir)));
}

/** Where a dragged icon lands: the index among the other icons, from the pointer position and the centers of the others (top to bottom). */
export function dropIndex(pointerY: number, centers: readonly number[]): number {
  let i = 0;
  while (i < centers.length && pointerY > centers[i]!) i++;
  return i;
}

/** Damaged or foreign data in the pref becomes an empty order instead of an error. */
export function sanitizeRailOrder(raw: unknown): RailOrder {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: RailOrder = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v) || k.length > 60) continue;
    out[k] = v.filter((x): x is string => typeof x === 'string' && x.length < 60).slice(0, 80);
  }
  return out;
}
