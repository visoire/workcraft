// Three-way file sync between two sides (desktop and iPad, or two desktops) without cloud.
// The base is the state after the last sync of this pair. Rules per path:
//   same content on both sides           nothing to do
//   changed on one side since the base   copy to the other side
//   changed on both sides                conflict: the newer version keeps the name, the other one
//                                        is kept on both sides as "name (conflict <side> <date>).ext"
//   deleted on one side, unchanged other delete on the other side (into its trash)
//   deleted on one side, changed other   the changed file wins and comes back
// No DOM, no Node: used by the backend (desktop to desktop) and by browser mode (iPad).

export interface SyncFile {
  path: string;
  size: number;
  mtime: number;
  hash: string;
}

export interface SyncAdapter {
  name: string;
  manifest(): Promise<SyncFile[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array, mtime: number): Promise<void>;
  remove(path: string): Promise<void>;
}

export type SyncOp = 'push' | 'pull' | 'conflict' | 'delete-local' | 'delete-remote';
export interface SyncAction {
  op: SyncOp;
  path: string;
  /** conflict: which side keeps the name */
  winner?: 'local' | 'remote';
}

export interface SyncResult {
  actions: SyncAction[];
  pushed: number;
  pulled: number;
  conflicts: number;
  deleted: number;
  errors: { path: string; message: string }[];
  base: Record<string, string>;
  dryRun: boolean;
}

export function planSync(local: SyncFile[], remote: SyncFile[], base: Record<string, string> | null): SyncAction[] {
  const L = new Map(local.map((f) => [f.path, f]));
  const R = new Map(remote.map((f) => [f.path, f]));
  const B = base || {};
  const out: SyncAction[] = [];
  for (const path of [...new Set([...L.keys(), ...R.keys()])].sort()) {
    const l = L.get(path);
    const r = R.get(path);
    const b = B[path];
    if (l && r) {
      if (l.hash === r.hash) continue;
      if (b === l.hash) out.push({ op: 'pull', path });
      else if (b === r.hash) out.push({ op: 'push', path });
      else out.push({ op: 'conflict', path, winner: l.mtime >= r.mtime ? 'local' : 'remote' });
    } else if (l) {
      if (b && b === l.hash) out.push({ op: 'delete-local', path });
      else out.push({ op: 'push', path });
    } else if (r) {
      if (b && b === r.hash) out.push({ op: 'delete-remote', path });
      else out.push({ op: 'pull', path });
    }
  }
  return out;
}

export function conflictName(path: string, side: string, date = new Date()): string {
  const m = path.match(/^(.*?)(\.[^./]+)?$/)!;
  return `${m[1]} (conflict ${side} ${date.toISOString().slice(0, 10)})${m[2] || ''}`;
}

/** Plans and runs a sync. dryRun only plans. */
export async function runSync(local: SyncAdapter, remote: SyncAdapter, base: Record<string, string> | null, opt: { dryRun?: boolean; hash: (d: Uint8Array) => Promise<string> }): Promise<SyncResult> {
  const [lm, rm] = await Promise.all([local.manifest(), remote.manifest()]);
  const actions = planSync(lm, rm, base);
  const res: SyncResult = { actions, pushed: 0, pulled: 0, conflicts: 0, deleted: 0, errors: [], base: {}, dryRun: !!opt.dryRun };
  const state = new Map<string, string>();
  for (const f of lm) state.set(f.path, f.hash);
  for (const f of rm) if (!state.has(f.path)) state.set(f.path, f.hash);
  if (opt.dryRun) return res;
  const lmap = new Map(lm.map((f) => [f.path, f]));
  const rmap = new Map(rm.map((f) => [f.path, f]));
  for (const a of actions) {
    try {
      if (a.op === 'push') {
        await remote.write(a.path, await local.read(a.path), lmap.get(a.path)!.mtime);
        state.set(a.path, lmap.get(a.path)!.hash);
        res.pushed++;
      } else if (a.op === 'pull') {
        await local.write(a.path, await remote.read(a.path), rmap.get(a.path)!.mtime);
        state.set(a.path, rmap.get(a.path)!.hash);
        res.pulled++;
      } else if (a.op === 'delete-local') {
        await local.remove(a.path);
        state.delete(a.path);
        res.deleted++;
      } else if (a.op === 'delete-remote') {
        await remote.remove(a.path);
        state.delete(a.path);
        res.deleted++;
      } else {
        const [ld, rd] = await Promise.all([local.read(a.path), remote.read(a.path)]);
        const winner = a.winner === 'local' ? ld : rd;
        const loser = a.winner === 'local' ? rd : ld;
        const loserSide = a.winner === 'local' ? remote.name : local.name;
        const copy = conflictName(a.path, loserSide);
        const now = Date.now();
        await local.write(a.path, winner, now);
        await remote.write(a.path, winner, now);
        await local.write(copy, loser, now);
        await remote.write(copy, loser, now);
        state.set(a.path, await opt.hash(winner));
        state.set(copy, await opt.hash(loser));
        res.conflicts++;
      }
    } catch (e) {
      res.errors.push({ path: a.path, message: (e as Error).message });
      // keep the old base for this path, so the next sync tries again
      if (base?.[a.path]) state.set(a.path, base[a.path]!);
      else state.delete(a.path);
    }
  }
  res.base = Object.fromEntries(state);
  return res;
}
