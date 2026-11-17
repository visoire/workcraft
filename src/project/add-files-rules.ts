// Pure rules of the "+" menu's file entries (no DOM, so they are unit-tested): which entry a device gets, where the files go, what a scan is called.

export type AddKind = 'upload' | 'scan';

/** Which of the two entries the "+" menu offers on this device: a scan where there is a document scanner (iPad), an upload everywhere else. */
export function addKindFor(device: { ipad: boolean }): AddKind {
  return device.ipad ? 'scan' : 'upload';
}

/** The folder a kind of file goes to. */
export const folderFor = (kind: AddKind): string => (kind === 'scan' ? '/Scans' : '/Uploads');

/** A name for a file that came without a useful one (a camera picture is "image.jpg" on iPadOS): "Scan 2026-11-18 14-05.jpg". */
export function scanName(original: string, now: Date, index: number): string {
  const ext = original.includes('.') ? original.slice(original.lastIndexOf('.') + 1).toLowerCase() : 'jpg';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}`;
  const generic = /^(image|img_\d+|photo|scan|document)(\s*\(\d+\))?\.[a-z0-9]+$/i.test(original);
  return generic ? `Scan ${stamp}${index ? ` ${index + 1}` : ''}.${ext}` : original;
}
