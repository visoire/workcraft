// Content-addressed store of a project (.workcraft/objects/ab/cdef…): file versions of the
// project graph and snapshots share it, so the same content is stored once.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { META_DIR } from './paths.js';

export const MAX_OBJECT = 25 * 1024 * 1024;
export const hashOf = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const dirOf = (root: string) => join(root, META_DIR, 'objects');
const fileOf = (root: string, hash: string) => {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid object hash');
  return join(dirOf(root), hash.slice(0, 2), hash.slice(2));
};

/** Stores data and returns its hash. Data above 25 MB is not stored (hash only). */
export function putObject(root: string, data: Uint8Array): { hash: string; stored: boolean } {
  const hash = hashOf(data);
  if (data.byteLength > MAX_OBJECT) return { hash, stored: false };
  const f = fileOf(root, hash);
  if (!existsSync(f)) {
    mkdirSync(join(dirOf(root), hash.slice(0, 2)), { recursive: true });
    writeFileSync(f, data);
  }
  return { hash, stored: true };
}

export function hasObject(root: string, hash: string): boolean {
  return existsSync(fileOf(root, hash));
}

export function getObject(root: string, hash: string): Uint8Array {
  return new Uint8Array(readFileSync(fileOf(root, hash)));
}

/** Deletes objects that no snapshot and no file version uses. Returns freed bytes. */
export function gcObjects(root: string, keep: Set<string>): number {
  const base = dirOf(root);
  if (!existsSync(base)) return 0;
  let freed = 0;
  for (const d of readdirSync(base)) {
    const sub = join(base, d);
    for (const f of readdirSync(sub)) {
      if (keep.has(d + f)) continue;
      const p = join(sub, f);
      freed += statSync(p).size;
      rmSync(p, { force: true });
    }
  }
  return freed;
}

export function objectsSize(root: string): { count: number; bytes: number } {
  const base = dirOf(root);
  let count = 0;
  let bytes = 0;
  if (!existsSync(base)) return { count, bytes };
  for (const d of readdirSync(base)) for (const f of readdirSync(join(base, d))) {
    count++;
    bytes += statSync(join(base, d, f)).size;
  }
  return { count, bytes };
}
