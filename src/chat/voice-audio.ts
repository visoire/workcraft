// Audio helpers of voice input. Pure functions, no browser objects, so they are tested in Node.
//
//   resampleTo16k()   any sample rate to the 16 kHz Handy wants (box filter down, linear interpolation up)
//   encodeWav16()     Float32 samples to a 16-bit mono PCM WAV file
//   levelOf()         0 to 1 loudness of a chunk for the waveform
//   VoiceLevels       the last N levels, for the bars
//   speechSupport()   which recognizer can be used where

export const TARGET_RATE = 16_000;

/** Samples at `from` Hz to 16 kHz. Down: average of the source samples under each target sample (a cheap low-pass). */
export function resampleTo16k(input: Float32Array, from: number): Float32Array {
  if (!input.length) return new Float32Array(0);
  if (from === TARGET_RATE) return input;
  const ratio = from / TARGET_RATE;
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(input.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = a; j < b; j++) sum += input[j]!;
      out[i] = sum / (b - a);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const a = Math.floor(pos);
      const f = pos - a;
      const x = input[a]!;
      const y = input[Math.min(input.length - 1, a + 1)]!;
      out[i] = x + (y - x) * f;
    }
  }
  return out;
}

/** 16-bit mono PCM WAV at the given rate (default 16 kHz). Samples are clipped to -1..1. */
export function encodeWav16(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const bytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const dv = new DataView(buf);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + bytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  tag(36, 'data');
  dv.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Loudness of a chunk, 0 to 1, with a curve that makes quiet speech visible (speech RMS is about 0.01 to 0.2). */
export function levelOf(chunk: Float32Array): number {
  if (!chunk.length) return 0;
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i]! * chunk[i]!;
  const rms = Math.sqrt(sum / chunk.length);
  return Math.min(1, Math.sqrt(rms * 6));
}

/** Peak (largest absolute sample) and RMS of a recording, 0 to 1. */
export function measure(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
    sum += samples[i]! * samples[i]!;
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 };
}

/**
 * What goes to the speech model: the recording without a DC offset, brought up to a healthy level when the
 * microphone is quiet (at most 16 times, about 24 dB; a loud recording is left alone), and half a second of silence
 * before and after. Handy's voice activity detection (v0.10 chunks long recordings with it) drops quiet speech and
 * the first syllable of a recording that starts at once, which showed up as "No speech was heard".
 */
export function prepareForSpeech(samples16k: Float32Array, o: { pad?: number; targetPeak?: number; maxGain?: number } = {}): Float32Array {
  const pad = Math.round((o.pad ?? 0.5) * TARGET_RATE);
  const targetPeak = o.targetPeak ?? 0.85;
  const maxGain = o.maxGain ?? 16;
  const n = samples16k.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples16k[i]!;
  mean = n ? mean / n : 0;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples16k[i]! - mean));
  const gain = peak > 0.0005 && peak < 0.5 ? Math.min(maxGain, targetPeak / peak) : 1;
  const out = new Float32Array(n + pad * 2);
  for (let i = 0; i < n; i++) out[pad + i] = Math.max(-1, Math.min(1, (samples16k[i]! - mean) * gain));
  return out;
}

/** Joins chunks recorded one after another. */
export function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Fixed-size history of levels for the bars of the waveform. */
export class VoiceLevels {
  readonly values: number[];
  constructor(readonly size = 24) {
    this.values = Array(size).fill(0);
  }
  push(v: number): void {
    this.values.push(Math.max(0, Math.min(1, v)));
    if (this.values.length > this.size) this.values.shift();
  }
  reset(): void {
    this.values.fill(0);
  }
}

export type SpeechEngine = 'handy' | 'browser' | 'server';

/**
 * Which recognizer to use. auto: Handy when the computer has it with a model (offline, private), otherwise the
 * browser's own recognizer, otherwise none. A fixed choice is honoured and says why it cannot work.
 */
export function resolveEngine(pref: 'auto' | SpeechEngine, o: { handyReady: boolean; handyAvailable: boolean; browserSpeech: boolean; serverConfigured?: boolean }): { engine: SpeechEngine | null; reason: string } {
  const handy = o.handyAvailable && o.handyReady;
  if (pref === 'server') return o.serverConfigured ? { engine: 'server', reason: '' } : { engine: null, reason: 'Enter the address of a speech server in Settings, Voice input.' };
  if (pref === 'handy') return handy ? { engine: 'handy', reason: '' } : { engine: null, reason: o.handyAvailable ? 'Handy has no speech model yet.' : 'Handy needs the desktop version of WorkCraft with Handy installed.' };
  if (pref === 'browser') return o.browserSpeech ? { engine: 'browser', reason: '' } : { engine: null, reason: 'This browser has no speech recognition.' };
  if (handy) return { engine: 'handy', reason: '' };
  // A server the person entered (a local Whisper server, or a hosted one with their key) comes before the browser's own cloud recognizer
  if (o.serverConfigured) return { engine: 'server', reason: '' };
  if (o.browserSpeech) return { engine: 'browser', reason: '' };
  return { engine: null, reason: o.handyAvailable ? 'Handy has no speech model yet, and this browser has no speech recognition.' : 'No speech recognition is available. Install Handy on the computer that runs WorkCraft.' };
}

/** A sentence for a failed microphone request or recognizer error (DOMException names and SpeechRecognition error codes). */
export function voiceErrorText(name: string, o: { secure?: boolean; ipad?: boolean; handy?: boolean } = {}): string {
  const where = o.ipad ? 'In Settings, Safari, Microphone, choose Ask or Allow, then reload WorkCraft.' : 'Click the lock icon in the address bar, allow the microphone for this site and try again.';
  switch (name) {
    case 'NotAllowedError':
    case 'not-allowed':
    case 'service-not-allowed':
    case 'SecurityError':
      return o.secure === false ? 'The browser only allows the microphone on a secure page. Open WorkCraft over HTTPS (see the iPadOS guide) or on localhost.' : `The microphone is blocked. ${where}`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect one and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'audio-capture':
      return 'The microphone is in use by another app. Close it there and try again.';
    case 'no-speech':
      return 'No speech was heard. Speak closer to the microphone and try again.';
    case 'too-short':
      return 'That was too short. Wait a moment after pressing the microphone, then speak.';
    case 'quiet':
      return 'The microphone picked up almost nothing. Check that the right one is selected and not muted, or raise its input level.';
    case 'not-recognized':
      return 'The recording was heard but no words came out. Speak a little slower and closer, or try a larger speech model in Handy.';
    case 'network':
      return o.handy
        ? 'The browser could not reach its speech service. Set Voice engine to Handy in Settings for offline speech.'
        : 'The browser could not reach its speech service (Chrome and Edge need internet access to Google or Microsoft). Check the connection or a VPN/firewall, or install Handy (handy.computer), download a model in it, and set Voice engine to Handy in Settings.';
    case 'language-not-supported':
      return 'The browser does not support the chosen voice language. Change Voice language in Settings.';
    case 'aborted':
      return '';
    default:
      return 'Voice input did not work. Try again.';
  }
}
