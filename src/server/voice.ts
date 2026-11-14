// Voice input on the desktop: speech to text with Handy (https://github.com/cjpais/Handy), offline.
//
// The browser records the microphone and sends a 16 kHz mono WAV here; this module hands it to the Handy that is
// installed on the computer (`handy --transcribe-file <wav> --json`, the same engine and models as the Handy app:
// Whisper, Parakeet, Nemotron Streaming ...). Nothing leaves the computer. Handy has no server of its own, so
// the only things this module needs are the path of the program and a model that was downloaded in Handy.
//
// An iPad on the home network uses the Handy of the desktop PC the same way (the audio goes to the PC, not to a cloud).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir, platform as osPlatform } from 'node:os';
import { join, extname } from 'node:path';

export interface HandyModel {
  id: string;
  name: string;
  downloaded: boolean;
  streaming: boolean;
  recommended: boolean;
  sizeMb: number;
  languages: string[];
}

/** The Handy release WorkCraft is built and tested for (v0.10: GGUF models, language detection, long recordings with VAD). */
export const HANDY_LATEST = '0.10.0';
/** The oldest Handy that can transcribe a file from the command line. */
export const HANDY_MIN = '0.9.8';

/** Compares dotted versions ("0.10.0" is newer than "0.9.8"); anything that is not a number counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(3, pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The version of the installed Handy. Running `handy --version` could open the app window, so the version is read from
 * the file instead (Windows: the file's product version; macOS: Info.plist). Null when it cannot be read.
 */
export async function handyVersion(bin: string): Promise<string | null> {
  try {
    if (osPlatform() === 'win32') {
      const ps = `(Get-Item -LiteralPath '${bin.replace(/'/g, "''")}').VersionInfo.ProductVersion`;
      const r = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 8000);
      return /^\d+\.\d+(\.\d+)?/.exec(r.stdout.trim())?.[0] ?? null;
    }
    if (osPlatform() === 'darwin') {
      const plist = join(bin, '..', '..', 'Info.plist');
      if (existsSync(plist)) return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(plist, 'utf8'))?.[1] ?? null;
    }
  } catch {
    /* unreadable */
  }
  return null;
}

export interface VoiceStatus {
  engine: 'handy';
  /** The handy program was found and answers */
  installed: boolean;
  path: string | null;
  /** Installed version, when it can be read, the newest version this build knows and whether the installed one is older */
  version: string | null;
  latest: string;
  outdated: boolean;
  /** Models that are downloaded in Handy */
  models: HandyModel[];
  /** At least one model is downloaded: transcription can run */
  ready: boolean;
  /** One plain sentence for the interface when it is not ready */
  message: string;
}

/** Where Handy lives by default. Order: the setting, the environment, the installer's folders, the PATH. */
export function handyCandidates(opt: { setting?: string; env?: Record<string, string | undefined>; platform?: string; home?: string }): string[] {
  const env = opt.env || process.env;
  const plat = opt.platform || osPlatform();
  const home = opt.home || homedir();
  const list: string[] = [];
  if (opt.setting?.trim()) list.push(opt.setting.trim());
  if (env.HANDY_PATH?.trim()) list.push(env.HANDY_PATH.trim());
  if (plat === 'win32') {
    if (env.LOCALAPPDATA) list.push(join(env.LOCALAPPDATA, 'Handy', 'handy.exe'), join(env.LOCALAPPDATA, 'Programs', 'Handy', 'handy.exe'));
    if (env.ProgramFiles) list.push(join(env.ProgramFiles, 'Handy', 'handy.exe'));
  } else if (plat === 'darwin') {
    list.push('/Applications/Handy.app/Contents/MacOS/handy', join(home, 'Applications', 'Handy.app', 'Contents', 'MacOS', 'handy'));
  } else {
    list.push('/usr/bin/handy', '/usr/local/bin/handy', join(home, '.local', 'bin', 'handy'));
  }
  return [...new Set(list)];
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs the Handy program headless. A path ending in .mjs or .js runs through Node (the tests use a stand-in). */
export function runHandy(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  const script = ['.mjs', '.js', '.cjs'].includes(extname(bin).toLowerCase());
  return runProcess(script ? process.execPath : bin, script ? [bin, ...args] : args, timeoutMs);
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString('utf8')).slice(-4000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || e.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** The model list of `handy --list-models --json`; tolerant of text before the array. */
export function parseModels(stdout: string): HandyModel[] {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try {
    const raw = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>[];
    return raw
      .filter((m) => typeof m.id === 'string')
      .map((m) => ({
        id: String(m.id),
        name: String(m.name || m.id),
        // v0.10 builds its catalog from a package; accept the camelCase spelling next to the snake_case one of 0.9
        downloaded: m.is_downloaded === true || m.isDownloaded === true || m.downloaded === true,
        streaming: m.supports_streaming === true || m.supportsStreaming === true,
        recommended: m.is_recommended === true || m.isRecommended === true,
        sizeMb: Number(m.size_mb ?? m.sizeMb) || 0,
        languages: Array.isArray(m.supported_languages ?? m.supportedLanguages) ? ((m.supported_languages ?? m.supportedLanguages) as unknown[]).map(String) : [],
      }));
  } catch {
    return [];
  }
}

/** The result line of `handy --transcribe-file --json`: the last line that is a JSON object with a text. */
export function parseTranscript(stdout: string): { text: string; model: string; audioSecs: number; ms: number } | null {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const j = JSON.parse(t) as { text?: unknown; model?: unknown; audio_secs?: unknown; best_ms?: unknown };
      if (typeof j.text === 'string') return { text: j.text.trim(), model: String(j.model || ''), audioSecs: Number(j.audio_secs) || 0, ms: Number(j.best_ms) || 0 };
    } catch {
      /* not this line */
    }
  }
  return null;
}

export interface WavInfo {
  ok: boolean;
  reason?: string;
  seconds?: number;
}

/** Handy accepts 16 kHz mono 16-bit PCM only; check the header here so the answer is a sentence, not an exit code. */
export function checkWav(b: Uint8Array): WavInfo {
  if (b.length < 44) return { ok: false, reason: 'The recording is empty.' };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { ok: false, reason: 'The recording is not a WAV file.' };
  const format = dv.getUint16(20, true);
  const channels = dv.getUint16(22, true);
  const rate = dv.getUint32(24, true);
  const bits = dv.getUint16(34, true);
  if (format !== 1 || channels !== 1 || rate !== 16000 || bits !== 16) return { ok: false, reason: `Expected 16 kHz mono 16-bit audio, got ${rate} Hz, ${channels} channel(s), ${bits}-bit.` };
  const seconds = (b.length - 44) / (16000 * 2);
  return { ok: true, seconds };
}

let cache: { at: number; key: string; status: VoiceStatus } | null = null;
const STATUS_TTL = 30_000;

/** Finds Handy and asks which models are downloaded (a run of Handy takes about a second, so the answer is kept for 30 s). */
export async function voiceStatus(setting?: string, fresh = false): Promise<VoiceStatus> {
  const key = setting || '';
  if (!fresh && cache && cache.key === key && Date.now() - cache.at < STATUS_TTL) return cache.status;
  const none = (message: string): VoiceStatus => ({ engine: 'handy', installed: false, path: null, version: null, latest: HANDY_LATEST, outdated: false, models: [], ready: false, message });
  let status: VoiceStatus = none('Handy was not found on this computer.');
  for (const path of handyCandidates({ setting })) {
    if (!existsSync(path)) continue;
    const version = await handyVersion(path);
    const outdated = !!version && compareVersions(version, HANDY_LATEST) < 0;
    const r = await runHandy(path, ['--list-models', '--json'], 45_000);
    const all = parseModels(r.stdout);
    if (r.code !== 0 || !all.length) {
      status = { engine: 'handy', installed: true, path, version, latest: HANDY_LATEST, outdated, models: [], ready: false, message: `This version of Handy cannot transcribe files from the command line. Update Handy to ${HANDY_MIN} or newer (${HANDY_LATEST} is the current release).` };
      continue;
    }
    const models = all.filter((m) => m.downloaded);
    status = { engine: 'handy', installed: true, path, version, latest: HANDY_LATEST, outdated, models, ready: models.length > 0, message: models.length ? '' : 'Handy has no speech model yet. Open Handy, choose Models and download one (Parakeet or Whisper), then try again. Handy 0.10 uses GGUF models: if you updated from 0.9, its migration screen converts the old ones.' };
    break;
  }
  cache = { at: Date.now(), key, status };
  return status;
}

export class VoiceError extends Error {
  constructor(
    readonly code: 'NOT_INSTALLED' | 'NO_MODEL' | 'BAD_AUDIO' | 'FAILED' | 'TIMEOUT' | 'TOO_LARGE',
    message: string
  ) {
    super(message);
  }
}

export const MAX_WAV_BYTES = 24 * 1024 * 1024;
let chain: Promise<unknown> = Promise.resolve();

/** One transcription at a time: Handy loads its model for every run, two at once would only fight for the GPU. */
export function transcribe(wav: Uint8Array, opt: { setting?: string; model?: string; timeoutMs?: number }): Promise<{ text: string; model: string; audioSecs: number; ms: number }> {
  const job = chain.then(() => run(wav, opt));
  chain = job.catch(() => undefined);
  return job;
}

async function run(wav: Uint8Array, opt: { setting?: string; model?: string; timeoutMs?: number }) {
  if (wav.length > MAX_WAV_BYTES) throw new VoiceError('TOO_LARGE', 'The recording is too long. Keep it under about ten minutes.');
  const info = checkWav(wav);
  if (!info.ok) throw new VoiceError('BAD_AUDIO', info.reason || 'The recording cannot be read.');
  const st = await voiceStatus(opt.setting);
  if (!st.installed || !st.path) throw new VoiceError('NOT_INSTALLED', st.message);
  if (!st.ready) throw new VoiceError('NO_MODEL', st.message);
  if (opt.model && !st.models.some((m) => m.id === opt.model)) throw new VoiceError('NO_MODEL', `The model ${opt.model} is not downloaded in Handy.`);
  const dir = mkdtempSync(join(tmpdir(), 'workcraft-voice-'));
  const file = join(dir, 'speech.wav');
  try {
    writeFileSync(file, wav);
    const args = ['--transcribe-file', file, '--json', ...(opt.model ? ['--model', opt.model] : [])];
    const r = await runHandy(st.path, args, opt.timeoutMs ?? 180_000);
    if (r.timedOut) throw new VoiceError('TIMEOUT', 'Handy took too long. A smaller model is faster.');
    const out = parseTranscript(r.stdout);
    if (r.code !== 0 || !out) {
      const detail = (r.stderr.match(/error:[^\n]*/g) || []).pop() || r.stderr.trim().split('\n').pop() || `exit code ${r.code}`;
      throw new VoiceError('FAILED', `Handy could not transcribe the recording (${detail.slice(0, 200)}).`);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** For tests: forget the cached status. */
export function resetVoiceCache(): void {
  cache = null;
}
