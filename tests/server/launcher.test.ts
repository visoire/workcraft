import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain ES module without types
import { serverCommand, windowsStartupScript, windowsUrlShortcut, macLaunchAgent, linuxDesktopEntry, linuxSystemdUnit, pickNodeRelease, nodeArchive, LABEL } from '../../scripts/launcher/autostart-lib.mjs';

const cmd = serverCommand({ node: 'C:\\Program Files\\nodejs\\node.exe', entry: 'C:\\wc\\dist-server\\server\\index.js', lan: true, port: 5200, home: 'D:\\wc data' });

test('The server command carries the flags and the environment of the setup', () => {
  assert.deepEqual(cmd.args, ['C:\\wc\\dist-server\\server\\index.js', '--lan']);
  assert.deepEqual(cmd.env, { WORKCRAFT_PORT: '5200', WORKCRAFT_HOME: 'D:\\wc data' });
  assert.deepEqual(serverCommand({ node: 'n', entry: 'e' }).env, {});
});

test('Windows: a hidden VBScript with the paths quoted, and an Internet Shortcut', () => {
  const vbs = windowsStartupScript(cmd, 'C:\\wc');
  assert.match(vbs, /CreateObject\("WScript\.Shell"\)/);
  assert.match(vbs, /sh\.CurrentDirectory = "C:\\wc"/);
  assert.match(vbs, /sh\.Environment\("Process"\)\("WORKCRAFT_PORT"\) = "5200"/);
  assert.match(vbs, /sh\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\wc\\dist-server\\server\\index\.js"" ""--lan""", 0, False/);
  assert.match(vbs, /\r\n/);
  assert.equal(windowsUrlShortcut('http://127.0.0.1:5175/'), '[InternetShortcut]\r\nURL=http://127.0.0.1:5175/\r\nIconIndex=0\r\n');
});

test('macOS: a per-user LaunchAgent that runs at login, escapes XML and keeps a log', () => {
  const plist = macLaunchAgent(serverCommand({ node: '/usr/local/bin/node', entry: '/Users/a & b/wc/dist-server/server/index.js' }), '/Users/a & b/wc', '/Users/a/workcraft/logs/server.log');
  assert.match(plist, new RegExp(`<key>Label</key><string>${LABEL}</string>`));
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /a &amp; b/);
  assert.ok(!plist.includes('a & b'));
  assert.match(plist, /StandardOutPath/);
  assert.ok(!/sudo|\/Library\/LaunchDaemons/.test(plist), 'a user agent, never a system daemon');
});

test('Linux: an autostart entry and a systemd user unit, no root', () => {
  const d = linuxDesktopEntry(serverCommand({ node: '/usr/bin/node', entry: "/opt/it's/index.js", port: 5300 }), '/opt/it\'s');
  assert.match(d, /^\[Desktop Entry\]/);
  assert.match(d, /Exec=sh -c /);
  assert.match(d, /WORKCRAFT_PORT=/);
  assert.match(d, /X-GNOME-Autostart-enabled=true/);
  const u = linuxSystemdUnit(cmd, '/opt/wc');
  assert.match(u, /WantedBy=default\.target/);
  assert.match(u, /Restart=on-failure/);
});

test('Node download: newest v22 of the index, the right archive per system', () => {
  const index = [{ version: 'v24.1.0' }, { version: 'v22.14.0' }, { version: 'v22.13.1' }, { version: 'v20.0.0' }];
  assert.equal(pickNodeRelease(index), 'v22.14.0');
  assert.equal(pickNodeRelease([{ version: 'v24.0.0' }]), null);
  assert.equal(nodeArchive('v22.14.0', 'win32', 'x64'), 'node-v22.14.0-win-x64.zip');
  assert.equal(nodeArchive('v22.14.0', 'darwin', 'arm64'), 'node-v22.14.0-darwin-arm64.tar.gz');
  assert.equal(nodeArchive('v22.14.0', 'linux', 'x64'), 'node-v22.14.0-linux-x64.tar.gz');
  assert.equal(nodeArchive('v22.14.0', 'linux', 'ia32'), null);
  assert.equal(nodeArchive('v22.14.0', 'freebsd', 'x64'), null);
});

test('The launchers exist, need no administrator rights and check what they download', () => {
  const root = new URL('../../', import.meta.url);
  const sh = readFileSync(new URL('start-workcraft.sh', root), 'utf8');
  const ps = readFileSync(new URL('scripts/launcher/bootstrap.ps1', root), 'utf8');
  const cmdFile = readFileSync(new URL('Start WorkCraft.cmd', root), 'utf8');
  for (const [name, text] of [['sh', sh], ['ps1', ps]] as const) {
    assert.match(text, /SHASUMS256\.txt/, `${name} checks the checksum`);
    assert.match(text, /nodejs\.org\/dist/, `${name} downloads from nodejs.org only`);
    assert.ok(!/sudo|runas|RunAs|-Verb/i.test(text), `${name} never asks for administrator rights`);
  }
  assert.match(cmdFile, /bootstrap\.ps1/);
  assert.match(readFileSync(new URL('Start WorkCraft.command', root), 'utf8'), /start-workcraft\.sh/);
  assert.match(readFileSync(new URL('scripts/setup.mjs', root), 'utf8'), /--remove-autostart/);
});
