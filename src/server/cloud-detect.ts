// Finds the folders of cloud services that sync by themselves (Dropbox, OneDrive, Google Drive for desktop, MEGA, Proton Drive)
// on the computer that runs WorkCraft, so the user presses one button instead of typing a path. iCloud Drive has its own finder
// (icloudRoot in cloud.ts). The folder is the whole integration: the service's desktop app syncs it, WorkCraft mirrors a project
// into WorkCraft/<project> inside it. Pure: the file system and the environment are passed in, tests/server/cloud-detect.test.ts.

export interface DetectDeps {
  home: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  /** Does this path exist (a folder)? */
  exists(path: string): boolean;
  /** Names inside a folder, or [] when it cannot be read */
  list(path: string): string[];
  /** Join with the separator of the platform */
  join(...parts: string[]): string;
}

export interface FoundFolder {
  /** dropbox, onedrive, gdrive, mega, proton */
  id: string;
  name: string;
  path: string;
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** Every sync folder that exists, one per service (the first one found), in a stable order. */
export function detectSyncFolders(d: DetectDeps): FoundFolder[] {
  const { home, env, join } = d;
  const first = (paths: (string | undefined)[]): string | null => uniq(paths.filter((p): p is string => !!p)).find((p) => d.exists(p)) ?? null;
  /** Folders of the home folder whose name starts with `prefix` ("OneDrive - Company"), and the same inside macOS's CloudStorage */
  const withPrefix = (prefix: string, also: string[] = []): string[] => {
    const out: string[] = [];
    for (const base of [home, join(home, 'Library', 'CloudStorage'), ...also]) for (const n of d.list(base)) if (n.toLowerCase().startsWith(prefix.toLowerCase())) out.push(join(base, n));
    return out;
  };
  // Windows: Google Drive for desktop is a drive letter with "My Drive" inside
  const letters = d.platform === 'win32' ? 'GHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\My Drive`) : [];

  const found: FoundFolder[] = [];
  const add = (id: string, name: string, path: string | null) => path && found.push({ id, name, path });

  add('dropbox', 'Dropbox', first([env.DROPBOX_PATH, join(home, 'Dropbox'), ...withPrefix('Dropbox')]));
  add('onedrive', 'OneDrive', first([env.OneDriveConsumer, env.OneDrive, env.OneDriveCommercial, join(home, 'OneDrive'), ...withPrefix('OneDrive')]));
  add('gdrive', 'Google Drive', first([...letters, join(home, 'Google Drive'), join(home, 'My Drive'), ...withPrefix('GoogleDrive')]));
  add('mega', 'MEGA', first([join(home, 'MEGA'), join(home, 'MEGAsync')]));
  add('proton', 'Proton Drive', first([join(home, 'Proton Drive'), join(home, 'ProtonDrive'), ...withPrefix('ProtonDrive')]));
  return found;
}
