// A backup of the whole workspace in one ZIP: every project (the same ZIP that "Export as ZIP" makes, with files, chats and
// layout) next to a small manifest. A restore only ever ADDS: a project whose name is already in use comes back as a
// copy ("Name (restored 2026-11-18)"), nothing is overwritten or deleted. Pure functions, no DOM and no Node.
//
// The idea (one file for the whole library, a manifest, restore that only adds) comes from the backup of OwlLuna, the open
// source notes app for iPad by owaisazmal (MIT): see SOURCES.md. The code is written fresh for WorkCraft.

export const BACKUP_FORMAT = 'workcraft-backup/1';
export const MANIFEST_NAME = 'workcraft-backup.json';

export interface BackupProject {
  id: string;
  name: string;
  /** The nested project ZIP inside the backup, e.g. projects/01-my-project.zip */
  file: string;
  updated?: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  /** The WorkCraft version that wrote the backup */
  version: string;
  created: string;
  projects: BackupProject[];
}

/** Backup name: workcraft-backup-2026-11-18.zip */
export function backupFileName(date = new Date()): string {
  return `workcraft-backup-${date.toISOString().slice(0, 10)}.zip`;
}

/** The path of a project ZIP inside the backup: numbered, so two projects with the same name stay apart. */
export function projectEntryName(index: number, name: string): string {
  const slug = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  return `projects/${String(index + 1).padStart(2, '0')}-${slug}.zip`;
}

export function makeManifest(version: string, projects: { id: string; name: string; updated?: string }[], created = new Date()): BackupManifest {
  return { format: BACKUP_FORMAT, version, created: created.toISOString(), projects: projects.map((p, i) => ({ id: p.id, name: p.name, file: projectEntryName(i, p.name), ...(p.updated ? { updated: p.updated } : {}) })) };
}

/** Reads the manifest text. Null when it is not a WorkCraft backup (the caller says so). Entries that point outside projects/ are dropped. */
export function parseManifest(text: string): BackupManifest | null {
  try {
    const j = JSON.parse(text) as Partial<BackupManifest>;
    if (j.format !== BACKUP_FORMAT || !Array.isArray(j.projects)) return null;
    const projects = j.projects
      .filter((p): p is BackupProject => !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.file === 'string' && /^projects\/[^/\\]+\.zip$/.test(p.file) && !p.file.includes('..'))
      .map((p) => ({ id: p.id, name: p.name.slice(0, 120), file: p.file, ...(p.updated ? { updated: String(p.updated) } : {}) }));
    return { format: BACKUP_FORMAT, version: String(j.version || ''), created: String(j.created || ''), projects };
  } catch {
    return null;
  }
}

export interface RestoreStep {
  file: string;
  /** The name the project is imported under */
  name: string;
  /** True when the name was taken and the project comes back as a copy */
  copy: boolean;
}

/** What a restore does: every project comes back; a name that is taken gets "(restored DATE)" and a number if even that is taken. */
export function planRestore(projects: BackupProject[], existingNames: string[], date = new Date()): RestoreStep[] {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const stamp = date.toISOString().slice(0, 10);
  const steps: RestoreStep[] = [];
  for (const p of projects) {
    let name = p.name;
    let copy = false;
    if (taken.has(name.toLowerCase())) {
      copy = true;
      name = `${p.name} (restored ${stamp})`;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${p.name} (restored ${stamp} ${n})`;
    }
    taken.add(name.toLowerCase());
    steps.push({ file: p.file, name, copy });
  }
  return steps;
}

/** A sentence for the end of a restore. */
export function restoreSummary(steps: RestoreStep[], failed: number): string {
  const copies = steps.filter((s) => s.copy).length;
  const ok = steps.length - failed;
  const parts = [`${ok} project${ok === 1 ? '' : 's'} restored`];
  if (copies) parts.push(`${copies} as a copy because the name was already in use`);
  if (failed) parts.push(`${failed} could not be restored`);
  return parts.join(', ') + '.';
}
