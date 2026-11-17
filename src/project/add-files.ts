// The "+" menu: bring files into the project from the device.
//   upload   the file picker (any device except an iPad, where the next one is shown): files go to /Uploads/ and the first one opens in its app
//   scan     iPad only: the same picker, asked for images and PDFs without a file filter that hides the sheet of iPadOS, so the sheet
//            offers Scan Documents, Take Photo and the Files app. A scan lands in /Scans/ as it comes (a PDF or a picture) and opens.
// Pure helpers are exported for the tests (tests/server/add-files.test.ts); the DOM part stays small.

import { basename, normPath } from '../app/util.js';
import { folderFor, scanName, type AddKind } from './add-files-rules.js';
import { toast, notifyError } from '../app/notifications.js';
import { t } from '../app/i18n.js';
import { fs } from './fs.js';
import { workspace } from '../workspace/layout.js';

export { addKindFor, folderFor, scanName, type AddKind } from './add-files-rules.js';

/** Writes the picked files into the project and opens the first one. Returns the paths. */
export async function takeFiles(files: File[], kind: AddKind, now = new Date()): Promise<string[]> {
  const out: string[] = [];
  try {
    for (const [i, f] of files.entries()) {
      const name = kind === 'scan' ? scanName(f.name, now, i) : basename(f.name);
      const path = fs.uniquePath(normPath(`${folderFor(kind)}/${name}`));
      await fs.write(path, await f.arrayBuffer());
      out.push(path);
    }
  } catch (e) {
    notifyError(e);
  }
  if (out.length) {
    toast(out.length === 1 ? t('{n} file added to the project', { n: 1 }) : t('{n} files added to the project', { n: out.length }), 'success');
    await workspace.openFile(out[0]!);
  }
  return out;
}

/** Opens the picker for a kind and takes what was picked. */
export function pickFiles(kind: AddKind): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  // For a scan no "capture" attribute (it would open the camera only) and no strict filter: the sheet of iPadOS then lists Scan Documents
  if (kind === 'scan') input.accept = 'image/*,application/pdf';
  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    input.remove();
    if (files.length) void takeFiles(files, kind);
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.append(input);
  input.click();
}
