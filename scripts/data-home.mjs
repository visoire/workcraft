// The data folder for scripts that only need to find it (vite.config.js, scripts/lan-cert.mjs): WORKCRAFT_HOME, else
// ~/workcraft, else an earlier name that is still there (~/Workspace). The same rules as src/server/home.ts, without the
// rename: a build tool must never move a user's data.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function dataHome(env = process.env, home = homedir(), exists = existsSync) {
  if (env.WORKCRAFT_HOME) return resolve(env.WORKCRAFT_HOME);
  for (const name of ['workcraft', 'Workspace', 'WorkCraft', 'OpenCraft']) if (exists(join(home, name))) return resolve(home, name);
  return resolve(home, 'workcraft');
}