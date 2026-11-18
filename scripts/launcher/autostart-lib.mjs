// What the autostart files look like, as pure functions (no file writes here), so a test can check them.
// Nothing needs administrator rights: Windows uses the Startup folder of the user, macOS a LaunchAgent in ~/Library,
// Linux an autostart entry in ~/.config/autostart.

export const LABEL = 'cc.workcraft.workspace';

/** The command that starts the server: the Node that was used for the setup, the built server, the chosen flags. */
export function serverCommand({ node, entry, lan = false, port, home }) {
  return { node, args: [entry, ...(lan ? ['--lan'] : [])], env: { ...(port ? { WORKCRAFT_PORT: String(port) } : {}), ...(home ? { WORKCRAFT_HOME: home } : {}) } };
}

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Windows: a small VBScript in the Startup folder that starts the server without a console window. */
export function windowsStartupScript(cmd, cwd) {
  const env = Object.entries(cmd.env)
    .map(([k, v]) => `sh.Environment("Process")("${k}") = "${v}"`)
    .join('\r\n');
  return [
    "' WorkCraft: starts the local server when you sign in (no window, no administrator rights). Remove this file to stop that.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = ${q(cwd)}`,
    env,
    `sh.Run ${q(`${q(cmd.node)} ${cmd.args.map(q).join(' ')}`)}, 0, False`,
  ]
    .filter(Boolean)
    .join('\r\n') + '\r\n';
}

/** Windows: an Internet Shortcut that opens the workspace (Desktop and Start menu). */
export function windowsUrlShortcut(url) {
  return `[InternetShortcut]\r\nURL=${url}\r\nIconIndex=0\r\n`;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** macOS: a LaunchAgent (per user, no sudo). RunAtLoad starts it at sign-in, KeepAlive brings it back if it stops. */
export function macLaunchAgent(cmd, cwd, logPath) {
  const env = Object.entries(cmd.env)
    .map(([k, v]) => `      <key>${xml(k)}</key><string>${xml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[cmd.node, ...cmd.args].map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
${env ? `  <key>EnvironmentVariables</key>\n  <dict>\n${env}\n  </dict>\n` : ''}  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Linux: an autostart entry for the desktop session (per user, no root). */
export function linuxDesktopEntry(cmd, cwd) {
  const env = Object.entries(cmd.env)
    .map(([k, v]) => `${k}=${sh(v)} `)
    .join('');
  return `[Desktop Entry]
Type=Application
Name=WorkCraft
Comment=Starts the local WorkCraft server when you sign in
Exec=sh -c ${sh(`cd ${sh(cwd)} && ${env}exec ${[cmd.node, ...cmd.args].map(sh).join(' ')}`)}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}

/** Linux: the same as a systemd user service, for headless machines (systemctl --user, still no root). */
export function linuxSystemdUnit(cmd, cwd) {
  const env = Object.entries(cmd.env)
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join('\n');
  return `[Unit]
Description=WorkCraft local server

[Service]
WorkingDirectory=${cwd}
${env ? env + '\n' : ''}ExecStart=${[cmd.node, ...cmd.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

/** The Node release to download when the machine has none that is new enough: the newest v22 of nodejs.org's index. */
export function pickNodeRelease(index, major = 22) {
  const hit = index.find((r) => r.version.startsWith(`v${major}.`));
  return hit ? hit.version : null;
}

/** File name of the portable Node archive for a platform and CPU (what nodejs.org calls it). */
export function nodeArchive(version, platform, arch) {
  const cpu = { x64: 'x64', arm64: 'arm64' }[arch];
  if (!cpu) return null;
  if (platform === 'win32') return `node-${version}-win-${cpu}.zip`;
  if (platform === 'darwin') return `node-${version}-darwin-${cpu}.tar.gz`;
  if (platform === 'linux') return `node-${version}-linux-${cpu}.tar.gz`;
  return null;
}
