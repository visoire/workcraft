#!/usr/bin/env node
// Makes the HTTPS certificate for the home network (iPad over Wi-Fi) with mkcert.
//
//   npm run lan:cert
//
// mkcert makes a local certificate authority (CA) and certificates signed by it. You install the CA once on this
// computer (mkcert -install) and once on the iPad. WorkCraft never sees the CA key; it only reads cert.pem and
// key.pem from <data folder>/certs/ (npm run start:lan -- --https). See docs/IPADOS-GUIDE.md.
//
// Run it again when the computer gets a new address on the network: the certificate lists the addresses it is
// valid for, and Safari refuses it for any other.

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { networkInterfaces, hostname } from 'node:os';
import { dataHome } from './data-home.mjs';
import { join, resolve } from 'node:path';

const home = dataHome();
const dir = join(home, 'certs');

const addresses = [];
for (const list of Object.values(networkInterfaces()))
  for (const a of list || []) if (!a.internal && a.family === 'IPv4') addresses.push(a.address);
const names = ['localhost', '127.0.0.1', '::1', ...addresses, `${hostname().toLowerCase()}.local`];

const probe = spawnSync('mkcert', ['-version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (probe.error || probe.status !== 0) {
  console.error('mkcert was not found on this computer.\n');
  console.error('Install it, then run this command again:');
  console.error('  Windows   winget install FiloSottile.mkcert     (or: choco install mkcert)');
  console.error('  macOS     brew install mkcert');
  console.error('  Linux     see https://github.com/FiloSottile/mkcert#installation');
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
const run = (args) => spawnSync('mkcert', args, { stdio: 'inherit', shell: process.platform === 'win32' });

// -install is safe to repeat; it asks for permission to trust the CA on this computer
if (run(['-install']).status !== 0) process.exit(1);
const certFile = join(dir, 'cert.pem');
const keyFile = join(dir, 'key.pem');
if (run(['-cert-file', certFile, '-key-file', keyFile, ...names]).status !== 0) process.exit(1);

const caroot = spawnSync('mkcert', ['-CAROOT'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout.trim();
console.log(`
Certificate for: ${names.join(', ')}
Files:           ${certFile}
                 ${keyFile}

Next, once, on the iPad:
  1. Send ${join(caroot, 'rootCA.pem')} to the iPad (AirDrop, or e-mail it to yourself).
  2. Open it. Settings shows "Profile Downloaded": install it (Settings, General, VPN & Device Management).
  3. Settings, General, About, Certificate Trust Settings: switch the mkcert root on.
  Never share rootCA-key.pem (it stays in ${caroot}).

Then start WorkCraft with HTTPS:
  npm start -- --https                production build
  npm run dev -- --https              development
`);
