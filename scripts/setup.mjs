#!/usr/bin/env node
// One command that sets WorkCraft up and starts it, for people and for AI agents ("setup workcraft").
//
//   node scripts/setup.mjs                 set up (first time only), start, open the browser, ask about autostart
//   node scripts/setup.mjs --yes           no questions: autostart on, browser opens (what an AI agent runs)
//   node scripts/setup.mjs --status        is it running, where, what version (add --json for a machine readable answer)
//   node scripts/setup.mjs --stop          stop the server this script started
//   node scripts/setup.mjs --autostart | --no-autostart | --remove-autostart
//   other flags: --port N  --lan (share on the home network for an iPad)  --no-open  --skip-install  --dry-run
//
// No administrator rights, nothing is installed outside this folder and the WorkCraft data folder (~/workcraft), except the
// autostart entry of the current user and a shortcut. It needs Node 22 or newer: the launchers next to it (Start WorkCraft.cmd,
// start-workcraft.sh) fetch a private copy of Node into .runtime/ when the computer has none.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { serverCommand, windowsStartupScript, windowsUrlShortcut, macLaunchAgent, linuxDesktopEntry, LABEL } from './launcher/autostart-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORT = Number(val('--port') || process.env.WORKCRAFT_PORT || 5175);
const DATA = process.env.WORKCRAFT_HOME || join(homedir(), 'workcraft');
const PID = join(DATA, 'server.pid');
const LOG = join(DATA, 'logs', 'server.log');
const URL_ = `http://127.0.0.1:${PORT}/`;
const ENTRY = join(ROOT, 'dist-server', 'server', 'index.js');
const DRY = has('--dry-run');
const JSON_OUT = has('--json');
const YES = has('--yes');
const OS = osPlatform();

const say = (m) => !JSON_OUT && console.log(m);
const steps = [];
const note = (what, ok = true, detail = '') => {
  steps.push({ step: what, ok, detail });
  say(`${ok ? '  ok ' : ' FAIL'} ${what}${detail ? ': ' + detail : ''}`);
};

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  console.error(`WorkCraft needs Node 22 or newer, this is Node ${process.versions.node}. Start it with "Start WorkCraft.cmd" (Windows) or start-workcraft.sh (macOS, Linux): they fetch a private copy of Node.`);
  process.exit(2);
}

async function healthy(port = PORT) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok ? await r.json().catch(() => ({})) : null;
  } catch {
    return null;
  }
}

function run(command, args, opt = {}) {
  if (DRY) {
    say(`  (dry run) ${command} ${args.join(' ')}`);
    return 0;
  }
  const r = spawnSync(command, args, { cwd: ROOT, stdio: opt.quiet ? 'ignore' : 'inherit', shell: false, env: { ...process.env, ...(opt.env || {}) } });
  return r.status ?? 1;
}

/** npm of the Node that runs this script (a private Node in .runtime has its own), else the one on the PATH. */
function npmCommand() {
  const bin = dirname(process.execPath);
  const candidates = [join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = candidates.find((p) => existsSync(p));
  return cli ? { command: process.execPath, pre: [cli] } : { command: OS === 'win32' ? 'npm.cmd' : 'npm', pre: [] };
}
const npm = (args) => {
  const n = npmCommand();
  if (OS === 'win32' && n.command.endsWith('.cmd')) return run('cmd.exe', ['/c', 'npm', ...args]);
  return run(n.command, [...n.pre, ...args]);
};

function version() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

const sourceCheckout = () => existsSync(join(ROOT, 'src')) && existsSync(join(ROOT, 'vite.config.js'));

function prepare() {
  const hasDeps = existsSync(join(ROOT, 'node_modules', 'hono'));
  if (!hasDeps && !has('--skip-install')) {
    say('First start: fetching the components WorkCraft needs (one time, a few minutes) ...');
    const code = npm(sourceCheckout() ? ['ci', '--no-audit', '--no-fund'] : ['ci', '--omit=dev', '--no-audit', '--no-fund']);
    if (code) {
      note('install the components (npm ci)', false, `npm exited with ${code}. Check the internet connection and run this again.`);
      return false;
    }
    note('install the components (npm ci)');
  } else note('components are installed');
  if (!existsSync(ENTRY)) {
    if (!sourceCheckout()) {
      note('find the built server', false, 'dist-server is missing and this folder has no source to build it from. Download the "workcraft-local" file of a release.');
      return false;
    }
    say('Building WorkCraft (one time, a few minutes) ...');
    const code = npm(['run', 'build']);
    if (code || (!DRY && !existsSync(ENTRY))) {
      note('build WorkCraft', false, `the build exited with ${code}`);
      return false;
    }
    note('build WorkCraft');
  } else note('the built server is there');
  return true;
}

function openBrowser(url) {
  if (DRY || has('--no-open')) return;
  try {
    if (OS === 'win32') spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn(OS === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the address is printed anyway */
  }
}

async function start() {
  const up = await healthy();
  if (up) {
    note('WorkCraft is already running', true, URL_);
    return true;
  }
  if (DRY) {
    note('start the server (dry run)', true, `${process.execPath} ${ENTRY}`);
    return true;
  }
  mkdirSync(dirname(LOG), { recursive: true });
  const flags = has('--lan') ? ['--lan'] : [];
  if (OS === 'win32') {
    // A server started with spawn() would inherit the pipes of whoever runs this script (an AI agent, a terminal) and keep them open
    // for as long as it lives. Windows Script Host starts it with clean handles, in a hidden window, with its output in the log.
    const vbs = join(DATA, 'start-server.vbs');
    const vb = (x) => '"' + String(x).replace(/"/g, '""') + '"'; // a VBScript string
    const cmdq = (x) => '"' + x + '"'; // a path for cmd.exe
    const line = 'cmd.exe /d /c ' + cmdq(`${cmdq(process.execPath)} ${cmdq(ENTRY)} ${flags.join(' ')} >> ${cmdq(LOG)} 2>&1`);
    writeFileSync(vbs, ['Set sh = CreateObject("WScript.Shell")', `sh.CurrentDirectory = ${vb(ROOT)}`, `sh.Environment("Process")("WORKCRAFT_PORT") = "${PORT}"`, `sh.Run ${vb(line)}, 0, False`].join('\r\n') + '\r\n');
    spawnSync('wscript.exe', ['//B', '//Nologo', vbs], { stdio: 'ignore', windowsHide: true });
  } else {
    const out = openSync(LOG, 'a');
    const child = spawn(process.execPath, [ENTRY, ...flags], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: { ...process.env, WORKCRAFT_PORT: String(PORT) } });
    child.unref();
    writeFileSync(PID, String(child.pid));
  }
  for (let i = 0; i < 120; i++) {
    if (await healthy()) {
      note('start the server', true, URL_);
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  note('start the server', false, `it did not answer within a minute, see ${LOG}`);
  return false;
}

/** The process that listens on the port (Windows: asked from PowerShell, because the server was started through Windows Script Host). */
function pidOnPort() {
  if (OS !== 'win32') return 0;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: 'utf8', windowsHide: true });
  return Number((r.stdout || '').trim()) || 0;
}

async function stop() {
  let pid = 0;
  try {
    pid = Number(readFileSync(PID, 'utf8'));
  } catch {
    /* no pid file */
  }
  if (!pid) pid = pidOnPort();
  if (!pid) {
    say(pid === 0 && (await healthy()) ? 'WorkCraft is running but was not started by this script (no pid file). Close it where it was started.' : 'WorkCraft is not running.');
    return;
  }
  if (OS === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  rmSync(PID, { force: true });
  say('WorkCraft stopped.');
}

// ---------------------------------------------------------------- autostart and shortcuts

function autostartPaths() {
  if (OS === 'win32') {
    const startup = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    return { file: join(startup, 'WorkCraft.vbs') };
  }
  if (OS === 'darwin') return { file: join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`) };
  return { file: join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'workcraft.desktop') };
}

function installAutostart() {
  const cmd = serverCommand({ node: process.execPath, entry: ENTRY, lan: has('--lan'), port: PORT === 5175 ? undefined : PORT, home: process.env.WORKCRAFT_HOME });
  const { file } = autostartPaths();
  const body = OS === 'win32' ? windowsStartupScript(cmd, ROOT) : OS === 'darwin' ? macLaunchAgent(cmd, ROOT, LOG) : linuxDesktopEntry(cmd, ROOT);
  if (DRY) return note('autostart (dry run)', true, file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (OS === 'darwin') {
    spawnSync('launchctl', ['unload', file], { stdio: 'ignore' });
    spawnSync('launchctl', ['load', file], { stdio: 'ignore' });
  }
  note('WorkCraft starts when you sign in', true, file);
}

function removeAutostart() {
  const { file } = autostartPaths();
  if (OS === 'darwin') spawnSync('launchctl', ['unload', file], { stdio: 'ignore' });
  if (existsSync(file) && !DRY) rmSync(file, { force: true });
  note('autostart removed', true, file);
}

function shortcuts() {
  if (DRY) return;
  try {
    if (OS === 'win32') {
      const desktop = join(process.env.USERPROFILE || homedir(), 'Desktop');
      const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      for (const dir of [desktop, menu]) if (existsSync(dir)) writeFileSync(join(dir, 'WorkCraft.url'), windowsUrlShortcut(URL_));
      note('shortcut "WorkCraft" on the Desktop and in the Start menu', true);
    } else if (OS === 'linux') {
      const dir = join(homedir(), '.local', 'share', 'applications');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'workcraft.desktop'), `[Desktop Entry]\nType=Application\nName=WorkCraft\nExec=xdg-open ${URL_}\nTerminal=false\nCategories=Office;\n`);
      note('WorkCraft in the applications menu', true);
    }
  } catch (e) {
    note('shortcut', false, e.message);
  }
}

async function ask(question) {
  if (!process.stdin.isTTY || YES) return YES;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`${question} [Y/n] `, r));
  rl.close();
  return !/^n/i.test(answer.trim());
}

// ---------------------------------------------------------------- main

if (has('--status')) {
  const h = await healthy();
  const out = { running: !!h, url: URL_, port: PORT, version: version(), data: DATA, log: LOG, autostart: existsSync(autostartPaths().file), built: existsSync(ENTRY), installed: existsSync(join(ROOT, 'node_modules', 'hono')) };
  console.log(JSON_OUT ? JSON.stringify(out) : Object.entries(out).map(([k, v]) => `${k.padEnd(10)} ${v}`).join('\n'));
  process.exit(0);
}
if (has('--stop')) {
  await stop();
  process.exit(0);
}
if (has('--remove-autostart')) {
  removeAutostart();
  process.exit(0);
}

say(`WorkCraft ${version()}: setting up in ${ROOT}`);
let ok = prepare();
if (ok) ok = await start();
if (ok) {
  shortcuts();
  if (has('--autostart')) installAutostart();
  else if (!has('--no-autostart') && (YES || (await ask('Start WorkCraft automatically when you sign in to this computer?')))) installAutostart();
  openBrowser(URL_);
  say(`\nWorkCraft is ready: ${URL_}`);
  say(`Your files are in ${join(DATA, 'projects')}. Stop it with: node scripts/setup.mjs --stop`);
  if (has('--lan')) say('Home network sharing is on: the iPad address and QR code are in Settings, iPad and network.');
}
if (JSON_OUT) console.log(JSON.stringify({ ok, url: URL_, steps }));
process.exit(ok ? 0 : 1);
