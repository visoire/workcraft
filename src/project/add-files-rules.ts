// Pure rules of the "+" menu's file entries (no DOM, so they are unit-tested): which entries a device gets, where the files go, what a picture is called.

export type AddKind = 'upload' | 'scan';

/**
 * The entries of the "+" menu for this device. Everyone gets **Upload files** (the file picker; on an iPad its sheet also offers Take Photo and, under
 * Choose Files, Apple's Scan Documents). An iPad gets a second entry, **Scan a document**: our own scanner with the camera (src/project/doc-scanner.ts),
 * because a web page cannot call the scanner of iPadOS directly.
 */
export function addEntriesFor(device: { ipad: boolean }): AddKind[] {
  return device.ipad ? ['upload', 'scan'] : ['upload'];
}

/** The folder a kind of file goes to. */
export const folderFor = (kind: AddKind): string => (kind === 'scan' ? '/Scans' : '/Uploads');

/** A name for a picture that came without a useful one (a camera picture is "image.jpg" on iPadOS): "Scan 2026-11-18 14-05.jpg". */
export function scanName(original: string, now: Date, index: number): string {
  const ext = original.includes('.') ? original.slice(original.lastIndexOf('.') + 1).toLowerCase() : 'jpg';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}`;
  const generic = /^(image|img_\d+|photo|scan|document)(\s*\(\d+\))?\.[a-z0-9]+$/i.test(original);
  return generic ? `Scan ${stamp}${index ? ` ${index + 1}` : ''}.${ext}` : original;
}
