// Real terminal processes.
//
// With node-pty as a full terminal (Windows: ConPTY with PowerShell or cmd.exe,
// macOS and Linux: $SHELL). Without node-pty, or when no shell starts, line mode runs:
// every input line runs as its own command in PowerShell, cmd.exe or /bin/sh.
// Line mode remembers the working directory (cd).

import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { broadcast } from './events.js';

interface Session {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  mode: 'pty' | 'line';
  shell: string;
}

type PtyProcess = {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(c: number, r: number): void;
  kill(): void;
};
type PtyModule = { spawn(file: string, args: string[], opts: Record<string, unknown>): PtyProcess };

// node-pty on Windows (ConPTY): kill() reads the console process list in a promise without a
// catch. When the shell is already gone, that list is undefined and the rejection would end the
// whole backend (closing a terminal panel took the workspace offline). Only this cleanup error is
// ignored; every other unhandled rejection is rethrown and behaves as before.
process.on('unhandledRejection', (reason) => {
  const stack = String((reason as Error | undefined)?.stack || reason);
  if (/windowsPtyAgent|conpty/i.test(stack)) {
    console.warn('Terminal: node-pty cleanup on Windows failed and was ignored:', (reason as Error)?.message || reason);
    return;
  }
  throw reason;
});

let ptyModule: PtyModule | null | undefined;
async function pty(): Promise<PtyModule | null> {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = (await import('node-pty')) as unknown as PtyModule;
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

const sessions = new Map<string, Session>();

// ---------------------------------------------------------------- Shell-Auswahl

export type ShellKind = 'powershell' | 'cmd' | 'posix';
export interface ShellCandidate {
  kind: ShellKind;
  file: string;
  /** Arguments for an interactive session (PTY) */
  args: string[];
}

/** Shells in the order they are tried. The parameters allow tests without Windows. */
export function shellCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): ShellCandidate[] {
  if (platform === 'win32') {
    const sysRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
    const ps = `${sysRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const cmd = env.ComSpec || env.COMSPEC || `${sysRoot}\\System32\\cmd.exe`;
    const list: ShellCandidate[] = [];
    list.push({ kind: 'powershell', file: exists(ps) ? ps : 'powershell.exe', args: ['-NoLogo'] });
    list.push({ kind: 'cmd', file: exists(cmd) ? cmd : 'cmd.exe', args: [] });
    return list;
  }
  const list: ShellCandidate[] = [];
  for (const f of [env.SHELL, '/bin/bash', '/bin/zsh', '/bin/sh']) if (f && !list.some((c) => c.file === f) && exists(f)) list.push({ kind: 'posix', file: f, args: [] });
  if (!list.length) list.push({ kind: 'posix', file: '/bin/sh', args: [] });
  return list;
}

/** Builds the call for a single command. Output on Windows in UTF-8 (umlauts and other characters). */
export function commandInvocation(sh: ShellCandidate, command: string): { file: string; args: string[]; options: SpawnOptions } {
  if (sh.kind === 'powershell') {
    // No progress stream: with -EncodedCommand it arrives on stderr as "#< CLIXML" XML noise ("Preparing modules for first use")
    const script = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ${command}`;
    // -EncodedCommand avoids every quoting problem in the command line
    return { file: sh.file, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], options: { windowsHide: true } };
  }
  if (sh.kind === 'cmd') return { file: sh.file, args: ['/d', '/s', '/c', `"chcp 65001>nul & ${command}"`], options: { windowsVerbatimArguments: true, windowsHide: true } };
  return { file: sh.file, args: ['-c', command], options: {} };
}

/** Shell kinds available on this machine (Windows: PowerShell and Command Prompt). */
export function shellKinds(): ShellKind[] {
  return [...new Set(shellCandidates().map((c) => c.kind))];
}

/** Candidates with the wanted kind first (the others stay as fallbacks). */
function ordered(want?: ShellKind): ShellCandidate[] {
  const list = shellCandidates();
  return want ? [...list.filter((c) => c.kind === want), ...list.filter((c) => c.kind !== want)] : list;
}

/** First shell for single commands (line mode, run-command). */
function lineShell(want?: ShellKind): ShellCandidate {
  return ordered(want)[0]!;
}

const env = (): Record<string, string> => ({ ...(process.env as Record<string, string>), TERM: 'xterm-256color', COLORTERM: 'truecolor', WORKCRAFT: '1' });

// ---------------------------------------------------------------- Sitzungen

export async function openTerminal(id: string, cwd: string, cols = 100, rows = 30, want?: ShellKind): Promise<'pty' | 'line'> {
  closeTerminal(id);
  const p = await pty();
  if (p) {
    for (const sh of ordered(want)) {
      let proc: PtyProcess;
      try {
        proc = p.spawn(sh.file, sh.args, { name: 'xterm-256color', cols, rows, cwd, env: env(), useConpty: true });
      } catch (e) {
        console.warn(`Terminal: ${sh.file} does not start (${(e as Error).message}), next shell`);
        continue;
      }
      const session: Session = { mode: 'pty', shell: sh.file, write: (d) => proc.write(d), resize: (c, r) => proc.resize(c, r), kill: () => proc.kill() };
      // Report output and exit only while this shell is the current session of the ID.
      // Otherwise reopening (reloading the page) would report the end of the old shell.
      proc.onData((data) => sessions.get(id) === session && broadcast({ t: 'term:data', id, data }));
      proc.onExit(({ exitCode }) => {
        if (sessions.get(id) !== session) return;
        sessions.delete(id);
        broadcast({ t: 'term:exit', id, code: exitCode });
      });
      sessions.set(id, session);
      broadcast({ t: 'term:shell', id, kind: sh.kind, file: nodePath.basename(sh.file) });
      return 'pty';
    }
  }
  openLineTerminal(id, cwd, want);
  return 'line';
}

/** Line mode: every line its own process, cd and clear are handled here. */
function openLineTerminal(id: string, startCwd: string, want?: ShellKind) {
  const sh = lineShell(want);
  let cwd = startCwd;
  let line = '';
  let running: ReturnType<typeof spawn> | null = null;
  const out = (data: string) => sessions.get(id) === session && broadcast({ t: 'term:data', id, data });
  const crlf = (b: Buffer | string) => String(b).replace(/\r?\n/g, '\r\n');
  const prompt = () => out(`\r\n\x1b[38;2;51;92;255m${nodePath.basename(cwd) || cwd}\x1b[0m ${sh.kind === 'cmd' ? '>' : '$'} `);

  const run = (cmd: string) => {
    const cd = cmd.match(/^(?:cd|chdir|set-location|sl)(?:\s+(.+))?$/i);
    if (cd) {
      const target = (cd[1] || '').trim().replace(/^["']|["']$/g, '');
      if (!target) out(cwd);
      else {
        const next = nodePath.resolve(cwd, target === '~' ? process.env.USERPROFILE || process.env.HOME || cwd : target);
        if (existsSync(next) && statSync(next).isDirectory()) cwd = next;
        else out(`\x1b[31mFolder not found: ${target}\x1b[0m`);
      }
      return prompt();
    }
    if (/^(cls|clear)$/i.test(cmd)) {
      out('\x1b[2J\x1b[H');
      return prompt();
    }
    const inv = commandInvocation(sh, cmd);
    try {
      running = spawn(inv.file, inv.args, { ...inv.options, cwd, env: env() });
    } catch (e) {
      out(`\x1b[31m${(e as Error).message}\x1b[0m`);
      return prompt();
    }
    running.stdout?.on('data', (b: Buffer) => out(crlf(b)));
    running.stderr?.on('data', (b: Buffer) => out(`\x1b[31m${crlf(b)}\x1b[0m`));
    running.on('error', (e) => out(`\x1b[31m${e.message}\x1b[0m`));
    running.on('close', () => {
      running = null;
      prompt();
    });
  };

  const session: Session = {
    mode: 'line',
    shell: sh.file,
    write(d) {
      for (const ch of d) {
        if (ch === '\r') {
          out('\r\n');
          const cmd = line.trim();
          line = '';
          if (!cmd) prompt();
          else run(cmd);
        } else if (ch === '\x7f' || ch === '\b') {
          if (line) {
            line = line.slice(0, -1);
            out('\b \b');
          }
        } else if (ch === '\x03') {
          running?.kill();
          line = '';
          out('^C');
          if (!running) prompt();
        } else if (ch >= ' ') {
          line += ch;
          out(ch);
        }
      }
    },
    resize() {},
    kill: () => running?.kill(),
  };
  sessions.set(id, session);
  broadcast({ t: 'term:shell', id, kind: sh.kind, file: nodePath.basename(sh.file) });
  out(`Line mode with ${nodePath.basename(sh.file)} (node-pty not available). Every line runs as its own command, cd is remembered.`);
  prompt();
}

export function writeTerminal(id: string, data: string): void {
  sessions.get(id)?.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (cols > 0 && rows > 0) sessions.get(id)?.resize(cols, rows);
}

export function closeTerminal(id: string): void {
  const s = sessions.get(id);
  sessions.delete(id);
  try {
    s?.kill();
  } catch {
    /* Prozess bereits beendet */
  }
}

/** Close all terminals (for example before deleting a project: otherwise Windows locks the folder). */
export function closeAllTerminals(): void {
  for (const id of [...sessions.keys()]) closeTerminal(id);
}

/**
 * Windows PowerShell started with -EncodedCommand writes its error and progress streams to stderr as CLIXML
 * ("#< CLIXML" and an <Objs> document). Turns that back into the error text and drops the progress records, so the
 * output of run-command is what a person would see in a terminal.
 */
export function cleanClixml(text: string): string {
  if (!text.includes('#< CLIXML')) return text;
  const decode = (s: string) =>
    s
      .replace(/_x000D__x000A_/g, '\n')
      .replace(/_x000A_/g, '\n')
      .replace(/_x000D_/g, '')
      .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  return text.replace(/#< CLIXML\r?\n?<Objs[\s\S]*?<\/Objs>/g, (block) => {
    const errors = [...block.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => decode(m[1]!));
    return errors.join('').replace(/\n{3,}/g, '\n\n').trim();
  });
}

/** Single command for the MCP tool run-command (time limit, limited output). */
export function runCommand(command: string, cwd: string, timeoutMs = 60_000): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const inv = commandInvocation(lineShell(), command);
    let output = '';
    // stderr apart from stdout: PowerShell wraps it in CLIXML, which cannot be cleaned when the two streams are interleaved
    let errors = '';
    let timedOut = false;
    const add = (b: Buffer) => {
      if (output.length < 200_000) output += String(b);
    };
    const addErr = (b: Buffer) => {
      if (errors.length < 100_000) errors += String(b);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(inv.file, inv.args, { ...inv.options, cwd, env: env() });
    } catch (e) {
      return resolve({ code: 1, output: (e as Error).message, timedOut: false });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.on('data', add);
    child.stderr?.on('data', addErr);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 1, output: e.message, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = [output, cleanClixml(errors)].map((s) => s.replace(/\r\n/g, '\n').trim()).filter(Boolean).join('\n');
      resolve({ code: code ?? (timedOut ? null : 1), output: text.length > 20000 ? text.slice(0, 20000) + '\n[shortened]' : text, timedOut });
    });
  });
}
