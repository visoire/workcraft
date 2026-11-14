// Which folder holds WorkCraft's data. Pure (no file system access of its own), so the rules are tested without touching a
// real home folder (tests/server/datahome.test.ts). src/server/paths.ts gives it the real one.
//
// One folder for the whole product: `~/workcraft` holds the workspace's projects, config and trash, and the desktop AI chat
// (workcraft-ai) keeps its sessions in `~/workcraft/chat`. Earlier versions used ~/Workspace (and before that ~/WorkCraft and
// ~/OpenCraft): the first one found is renamed to ~/workcraft once. When it cannot be renamed (another program holds it open)
// it is used where it is, so nothing is lost and nothing is copied.
import nodePath from 'node:path';

export const DATA_FOLDER = 'workcraft';
/** Earlier names, newest first. (~/WorkCraft is the same folder as ~/workcraft on Windows and macOS.) */
export const FORMER_FOLDERS = ['Workspace', 'WorkCraft', 'OpenCraft'] as const;

export interface HomeFs {
  exists(path: string): boolean;
  rename(from: string, to: string): void;
}

export function chooseHome(userHome: string, env: { WORKCRAFT_HOME?: string; OPENCRAFT_HOME?: string }, fs: HomeFs, path: typeof nodePath.posix = nodePath): string {
  const fromEnv = env.WORKCRAFT_HOME || env.OPENCRAFT_HOME;
  if (fromEnv) return path.resolve(fromEnv);
  const current = path.join(userHome, DATA_FOLDER);
  if (fs.exists(current)) return path.resolve(current);
  for (const name of FORMER_FOLDERS) {
    const former = path.join(userHome, name);
    if (former === current || !fs.exists(former)) continue;
    try {
      fs.rename(former, current);
      return path.resolve(current);
    } catch {
      return path.resolve(former);
    }
  }
  return path.resolve(current);
}