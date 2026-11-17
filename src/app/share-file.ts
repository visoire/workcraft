// Hands a file to the user: through the share sheet on a touch device (iPadOS: "Save to Files", which lists iCloud Drive and
// every cloud app that is installed), otherwise as a normal download.
import { downloadBlob } from './util.js';
import { device } from './device.js';

/** True when the share sheet can take a file here (iPad, iPhone, Android with Web Share level 2). */
export function canShareFiles(name = 'x.zip'): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    return device.touchUi && !!nav.canShare?.({ files: [new File([new Blob(['x'])], name, { type: 'application/zip' })] });
  } catch {
    return false;
  }
}

/** Share sheet when available, else a download. Resolves when the sheet closed or the download started; a cancelled sheet is not an error. */
export async function shareOrDownload(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (device.touchUi && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}
