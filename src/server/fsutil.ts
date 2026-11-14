// File system helpers shared by projects, trash, snapshots and the wipe.
import { cpSync, rmSync, readdirSync, statSync, openSync, writeSync, closeSync, unlinkSync, lstatSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { randomFillSync } from 'node:crypto';
import { join } from 'node:path';

/**
 * Moves a folder or file. On Windows virus scanners, Explorer or shells keep files open for a
 * moment (EPERM, EBUSY). Then it retries several times and finally copies and deletes.
 */
export async function moveDir(from: string, to: string, attempts = 8): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') break;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'ENOTEMPTY') throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Size of a file or folder in bytes. */
export function sizeOf(path: string): number {
  try {
    const st = lstatSync(path);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const d of readdirSync(path)) n += sizeOf(join(path, d));
    return n;
  } catch {
    return 0;
  }
}

/**
 * Overwrites every file once with random bytes, then deletes the folder or file.
 * Best effort: SSDs, copy-on-write file systems and backups can keep old blocks.
 */
export function secureRemove(path: string): number {
  let files = 0;
  const walk = (p: string) => {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return void unlinkSafe(p);
    if (st.isDirectory()) {
      for (const d of readdirSync(p)) walk(join(p, d));
      return;
    }
    try {
      const fd = openSync(p, 'r+');
      const chunk = Buffer.alloc(Math.min(1 << 20, Math.max(1, st.size)));
      let left = st.size;
      let pos = 0;
      while (left > 0) {
        randomFillSync(chunk);
        const n = writeSync(fd, chunk, 0, Math.min(chunk.length, left), pos);
        left -= n;
        pos += n;
      }
      closeSync(fd);
      files++;
    } catch {
      /* locked or read-only: deleted below */
    }
  };
  walk(path);
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return files;
}
const unlinkSafe = (p: string) => {
  try {
    unlinkSync(p);
  } catch {
    /* gone */
  }
};

export const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
