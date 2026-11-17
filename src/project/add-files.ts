// The "+" menu: bring files into the project from the device.
//   upload   the file picker (every device): files go to /Uploads and the first one opens in its app. On an iPad the sheet of the picker also
//            offers Take Photo and, under Choose Files, the ... menu with Scan Documents (Apple's scanner).
//   scan     iPad only: our own scanner (doc-scanner.ts): camera, corners, straight page, PDF in /Scans.
// The pure rules are in add-files-rules.ts (tests/server/add-files.test.ts).

import { basename, normPath } from '../app/util.js';
import { folderFor, scanName, type AddKind } from './add-files-rules.js';
import { toast, notifyError } from '../app/notifications.js';
import { t } from '../app/i18n.js';
import { fs } from './fs.js';
import { workspace } from '../workspace/layout.js';

export { addEntriesFor, folderFor, scanName, type AddKind } from './add-files-rules.js';

/** Writes the picked files into the project and opens the first one. Returns the paths. */
export async function takeFiles(files: File[], kind: AddKind = 'upload', now = new Date()): Promise<string[]> {
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

/** Upload files: the picker, no filter, so every sheet offered by the device is there. */
export function pickFiles(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    input.remove();
    if (files.length) void takeFiles(files, 'upload');
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.append(input);
  input.click();
}

/** Scan a document: opens the scanner. */
export function scanDocument(): void {
  void import('./doc-scanner.js').then((m) => m.openScanner());
}
