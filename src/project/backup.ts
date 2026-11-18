// Back up everything / Restore from a backup (src/core/backup.ts has the rules): one ZIP with every project, one click each way.
// Works on every device, in browser mode too: the project ZIPs come from and go to the same project routes as "Export as ZIP".

import { api } from '../app/backend.js';
import { h, downloadBlob } from '../app/util.js';
import { toast, notifyError } from '../app/notifications.js';
import { dialog } from '../app/ui.js';
import { shareOrDownload } from '../app/share-file.js';
import { bus } from '../app/bus.js';
import { VERSION } from '../app/status.js';
import { t } from '../app/i18n.js';
import { projects } from './manager.js';
import { MANIFEST_NAME, backupFileName, makeManifest, parseManifest, planRestore, restoreSummary } from '../core/backup.js';

export async function backupEverything(): Promise<void> {
  try {
    const { projects: all } = await projects.list();
    if (!all.length) return void toast(t('There is no project to back up yet'), 'info');
    const { zipSync, strToU8 } = await import('fflate');
    const manifest = makeManifest(VERSION, all);
    const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { [MANIFEST_NAME]: strToU8(JSON.stringify(manifest, null, 2)) };
    for (const p of manifest.projects) files[p.file] = [new Uint8Array(await api.bytes(`/api/projects/${encodeURIComponent(p.id)}/export`)), { level: 0 }];
    const bytes = zipSync(files as never, { level: 0 });
    const name = backupFileName();
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
    // On an iPad the share sheet offers Save to Files (iCloud Drive and every cloud app); elsewhere it is a download
    const how = await shareOrDownload(blob, name).catch(() => (downloadBlob(blob, name), 'downloaded' as const));
    if (how !== 'cancelled') toast(t('Backup saved'), 'success', t('{name}: {n} project(s) with files, chats and layout. Restoring only adds, it never overwrites.', { name, n: String(all.length) }));
  } catch (e) {
    notifyError(e);
  }
}

export async function restoreBackup(file: File): Promise<void> {
  try {
    const { unzipSync, strFromU8 } = await import('fflate');
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const raw = entries[MANIFEST_NAME];
    const manifest = raw ? parseManifest(strFromU8(raw)) : null;
    if (!manifest) return void toast(t('This is not a WorkCraft backup'), 'warning', t('Use "Import project (ZIP)" for the ZIP of one project.'));
    const { projects: existing } = await projects.list();
    const steps = planRestore(manifest.projects, existing.map((p) => p.name));
    if (!steps.length) return void toast(t('The backup has no projects'), 'info');
    const copies = steps.filter((s) => s.copy).length;
    const ok = await dialog({
      title: t('Restore {n} project(s)?', { n: String(steps.length) }),
      body: t('Nothing is overwritten or deleted. Projects are added next to yours{copies}.', { copies: copies ? t(' ({c} with a name that is already in use come back as copies)', { c: String(copies) }) : '' }),
      ok: t('Restore'),
    });
    if (!ok) return;
    let failed = 0;
    for (const s of steps) {
      const zip = entries[s.file];
      if (!zip) {
        failed++;
        continue;
      }
      try {
        await api.send('POST', `/api/projects/import?name=${encodeURIComponent(s.name)}&switch=0`, zip, { 'content-type': 'application/zip' });
      } catch {
        failed++;
      }
    }
    toast(failed === steps.length ? t('Nothing could be restored') : t('Restore finished'), failed ? 'warning' : 'success', restoreSummary(steps, failed));
    bus.emit('project:changed');
  } catch (e) {
    notifyError(e);
  }
}

export function pickBackup(): void {
  const input = h<'input'>('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  input.onchange = () => {
    const f = input.files?.[0];
    input.remove();
    if (f) void restoreBackup(f);
  };
  document.body.append(input);
  input.click();
}
