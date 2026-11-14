// Where a project file lives: copy the project path or the full path on this computer, or show it in the file manager.
// The full path and the file manager only exist on the computer that runs WorkCraft, not over the home network or in browser mode.
import { api, backend } from '../app/backend.js';
import { toast, notifyError } from '../app/notifications.js';
import { t } from '../app/i18n.js';

export const canLocate = (): boolean => !backend.browser && document.documentElement.dataset.backend !== 'remote';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('{what} copied', { what }), 'success', text);
  } catch {
    toast(t('Copy did not work'), 'error', text);
  }
}

export const copyProjectPath = (path: string) => copy(path, t('Path'));

export async function copyFullPath(path: string): Promise<void> {
  try {
    const r = await api.get<{ path: string }>(`/api/files/location?path=${encodeURIComponent(path)}`);
    await copy(r.path, t('Full path'));
  } catch (e) {
    notifyError(e);
  }
}

export async function revealInFileManager(path: string): Promise<void> {
  try {
    await api.send('POST', '/api/files/reveal', { path });
  } catch (e) {
    notifyError(e);
  }
}
