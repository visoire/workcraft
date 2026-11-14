// HTTPS for the home network (iPad over Wi-Fi).
//
// Over http://192.168.x.x Safari treats the page as insecure: no WebGPU, no service worker (so no offline
// use), no OPFS, no persistent storage. With a certificate the iPad trusts, all of that works again.
// The certificate comes from mkcert (npm run lan:cert): a local certificate authority that you install
// once on the PC and once on the iPad, and a certificate for the PC's addresses.
//
// Switching on (any of these):
//   npm run start:lan -- --https           files in <data folder>/certs/ or ./certs/ (cert.pem and key.pem)
//   WORKCRAFT_HTTPS=1                      the same, from the environment
//   --tls-cert=<file> --tls-key=<file>     explicit files (or WORKCRAFT_TLS_CERT and WORKCRAFT_TLS_KEY)
// Without a request nothing changes: plain HTTP as before. A request with missing files is reported and the
// server starts on HTTP, so a typo never locks you out of your own workspace.

import { existsSync, readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';

export interface TlsFiles {
  key: Buffer;
  cert: Buffer;
  keyPath: string;
  certPath: string;
}

export type TlsResolution = { enabled: true; tls: TlsFiles } | { enabled: false; reason?: string };

export interface TlsRequest {
  env: Record<string, string | undefined>;
  argv: readonly string[];
  /** The data folder (WORKCRAFT_HOME) */
  home: string;
  cwd: string;
  /** Test hook */
  read?: (path: string) => Buffer;
  exists?: (path: string) => boolean;
}

const arg = (argv: readonly string[], name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

export function resolveTls(req: TlsRequest): TlsResolution {
  const exists = req.exists ?? existsSync;
  const read = req.read ?? ((p: string) => readFileSync(p));
  const certArg = arg(req.argv, 'tls-cert') ?? req.env.WORKCRAFT_TLS_CERT;
  const keyArg = arg(req.argv, 'tls-key') ?? req.env.WORKCRAFT_TLS_KEY;
  const asked = req.argv.includes('--https') || req.env.WORKCRAFT_HTTPS === '1' || !!certArg || !!keyArg;
  if (!asked) return { enabled: false };

  let certPath = certArg ? resolve(req.cwd, certArg) : '';
  let keyPath = keyArg ? resolve(req.cwd, keyArg) : '';
  if (!certPath || !keyPath) {
    for (const dir of [join(req.home, 'certs'), join(req.cwd, 'certs')]) {
      if (exists(join(dir, 'cert.pem')) && exists(join(dir, 'key.pem'))) {
        certPath ||= join(dir, 'cert.pem');
        keyPath ||= join(dir, 'key.pem');
        break;
      }
    }
  }
  if (!certPath || !keyPath) return { enabled: false, reason: 'HTTPS was requested but no certificate was found. Run: npm run lan:cert' };
  for (const p of [certPath, keyPath]) if (!exists(p)) return { enabled: false, reason: `HTTPS was requested but ${p} does not exist. Run: npm run lan:cert` };
  try {
    return { enabled: true, tls: { cert: read(certPath), key: read(keyPath), certPath, keyPath } };
  } catch (e) {
    return { enabled: false, reason: `HTTPS was requested but the certificate could not be read: ${(e as Error).message}` };
  }
}

/**
 * Things that make a certificate useless on the iPad, as sentences: expired, expiring, or not valid for the
 * address the iPad uses (the usual mkcert mistake: a certificate made for localhost only).
 */
export function certProblems(cert: Buffer, hosts: readonly string[], now: Date = new Date(), parse: (pem: Buffer) => Pick<X509Certificate, 'validTo' | 'checkIP' | 'checkHost'> = (b) => new X509Certificate(b)): string[] {
  let x: Pick<X509Certificate, 'validTo' | 'checkIP' | 'checkHost'>;
  try {
    x = parse(cert);
  } catch {
    return ['the certificate file is not a valid PEM certificate'];
  }
  const out: string[] = [];
  const end = new Date(x.validTo).getTime();
  if (Number.isFinite(end)) {
    if (end < now.getTime()) out.push(`the certificate expired on ${x.validTo}`);
    else if (end - now.getTime() < 30 * 86400_000) out.push(`the certificate expires on ${x.validTo}`);
  }
  for (const h of hosts) {
    const ok = isIP(h) ? x.checkIP(h) : x.checkHost(h);
    if (!ok) out.push(`the certificate is not valid for ${h}: create it again with npm run lan:cert while the iPad is on this network`);
  }
  return out;
}

export const schemeOf = (tls: boolean): 'http' | 'https' => (tls ? 'https' : 'http');
