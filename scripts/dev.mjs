#!/usr/bin/env node
// Starts the backend (Hono, port 5176) and Vite (port 5175) together.
// Vite forwards /api, /mcp and /ws to the backend.
//
//   --lan     home network mode (the iPad pairs with the pairing address printed by the backend).
//             `npm run dev` passes it; `npm run dev:local` leaves it out and listens on this computer only
//   --https   Vite serves HTTPS with the certificate from `npm run lan:cert`; the backend stays on plain HTTP
//             behind the Vite proxy and only prints https pairing addresses (WORKCRAFT_UI_SCHEME)
import { spawn } from 'node:child_process';

const PORT = process.env.WORKCRAFT_PORT || '5176';
const UI_PORT = process.env.WORKCRAFT_UI_PORT || '5175';
const LAN = process.env.WORKCRAFT_LAN === '1' || process.argv.includes('--lan');
const HTTPS = process.env.WORKCRAFT_HTTPS === '1' || process.argv.includes('--https');
const base = { ...process.env, WORKCRAFT_DEV: '1', WORKCRAFT_PORT: PORT, WORKCRAFT_UI_PORT: UI_PORT, ...(LAN ? { WORKCRAFT_LAN: '1' } : {}) };
// The backend must not start TLS itself in development: Vite is the front door
const { WORKCRAFT_HTTPS: _drop, ...backendBase } = base;
const backendEnv = { ...backendBase, ...(HTTPS ? { WORKCRAFT_UI_SCHEME: 'https' } : {}) };
const viteEnv = { ...base, ...(HTTPS ? { WORKCRAFT_HTTPS: '1' } : {}) };
const procs = [
  // Restart only when code in src/ changes. Watching every imported module also restarted the
  // backend on unrelated file events on Windows (for example in the temp folder).
  spawn(process.execPath, ['--import', 'tsx', '--watch-path=src', '--watch-preserve-output', 'src/server/index.ts'], { env: backendEnv, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', LAN ? '0.0.0.0' : '127.0.0.1', '--port', UI_PORT, '--strictPort'], { env: viteEnv, stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
console.log(`\nWorkCraft: ${HTTPS ? 'https' : 'http'}://localhost:${UI_PORT}/${LAN ? '\n  Home network mode: open the pairing address from the backend output on the iPad (same Wi-Fi).\n  If Windows asks, allow Node.js on private networks.' : ''}\n`);
