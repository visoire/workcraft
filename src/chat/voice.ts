// Voice input of the chat: a microphone button that turns speech into text in the input field.
//
// Two engines behind one state machine (idle, listening, processing, error):
//   handy     the microphone is recorded here (AudioWorklet, 16 kHz mono WAV) and sent to the Handy program on the
//             computer that runs WorkCraft (src/server/voice.ts): Whisper, Parakeet or Nemotron models, offline, nothing
//             goes to a cloud. The text arrives when you stop. An iPad uses the Handy of its desktop PC.
//   server    a speech server the person entered (OpenAI transcription API: a local Whisper server, or Groq/OpenAI with their key).
//             The recording is sent straight to it; this is what works in browser mode and on an iPad on its own.
//   browser   the speech recognition of the browser (Web Speech API): words appear while you speak. Chrome and
//             Edge send the audio to the browser maker's service, Safari to Apple's; Settings says so.
// Which one runs is the setting Voice engine; automatic prefers Handy (private), then the browser.
// The text goes into the draft, never into a sent message. src/chat/voice-text.ts turns "at gridcraft" into @gridcraft.

import { api, backend } from '../app/backend.js';
import { prefs } from '../app/settings.js';
import { ROOT } from '../app/util.js';
import { device } from '../app/device.js';
import { speechKey } from './voice-endpoint.js';
import { transcribeWith, checkSpeechUrl, type SpeechServer } from '../core/speech-endpoint.js';
import { TARGET_RATE, concat, encodeWav16, levelOf, measure, prepareForSpeech, resampleTo16k, resolveEngine, voiceErrorText, VoiceLevels, type SpeechEngine } from './voice-audio.js';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'error';

export interface VoiceServerStatus {
  installed: boolean;
  ready: boolean;
  message: string;
  path: string | null;
  /** Version of the installed Handy (null when it cannot be read) and the newest one WorkCraft is built for */
  version?: string | null;
  latest?: string;
  outdated?: boolean;
  models: { id: string; name: string; streaming: boolean; recommended: boolean }[];
  settings: { handyPath: string; model: string };
}

export interface VoiceEvents {
  state(s: VoiceState, info: { engine: SpeechEngine | null; message: string }): void;
  /** Bars of the waveform (Handy) and seconds recorded */
  level(levels: number[], seconds: number): void;
  /** Text so far while speaking (browser engine) */
  interim(text: string): void;
  /** The result: text for the draft */
  final(text: string): void;
  /** A hint while listening (the microphone delivers silence) */
  hint?(text: string): void;
}

/** Limit of one recording: about five minutes (a 16 kHz WAV is 1.9 MB a minute). */
export const MAX_SECONDS = 300;

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

let statusCache: { at: number; value: VoiceServerStatus | null } | null = null;

/** Handy on this computer (or on the desktop an iPad is paired with). Null in browser mode or when the backend is down. */
export async function voiceStatus(fresh = false): Promise<VoiceServerStatus | null> {
  if (backend.browser) return null;
  if (!fresh && statusCache && Date.now() - statusCache.at < 20_000) return statusCache.value;
  try {
    const value = await api.get<VoiceServerStatus>(`/api/voice${fresh ? '?fresh=1' : ''}`);
    statusCache = { at: Date.now(), value };
    return value;
  } catch {
    statusCache = { at: Date.now(), value: null };
    return null;
  }
}

export const browserSpeechSupported = () => !!recognitionCtor();

/** The speech server of the settings (address, model, the key of this session), or null when none is entered or the address is unusable. */
export function speechServer(): SpeechServer | null {
  const url = prefs.get('voiceServerUrl').trim();
  if (!url || checkSpeechUrl(url, { pageSecure: window.isSecureContext && location.protocol === 'https:' })) return null;
  const lang = (prefs.get('voiceLang') || '').trim();
  return { url, model: prefs.get('voiceServerModel').trim() || 'whisper-1', key: speechKey.value || undefined, language: lang ? lang.slice(0, 2) : undefined };
}

export class VoiceInput {
  state: VoiceState = 'idle';
  engine: SpeechEngine | null = null;
  private levels = new VoiceLevels(28);
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private peak = 0;
  private hinted = false;
  private rate = TARGET_RATE;
  private started = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private rec: Recognition | null = null;
  private heard = '';
  private stopping = false;
  private discard = false;
  private fellBack = false;

  constructor(private ev: VoiceEvents) {}

  get busy(): boolean {
    return this.state === 'listening' || this.state === 'processing';
  }

  private set(state: VoiceState, message = '') {
    this.state = state;
    this.ev.state(state, { engine: this.engine, message });
  }

  /** One click: start, stop (and transcribe), or cancel while it works. */
  async toggle(): Promise<void> {
    if (this.state === 'listening') return this.stop();
    if (this.state === 'processing') return this.cancel();
    return this.start();
  }

  async start(): Promise<void> {
    if (this.busy) return;
    this.discard = false;
    this.stopping = false;
    // The first status check runs Handy (version + model list) and can take several seconds; a cached answer is instant.
    // Giving up after 3 s used to pick the browser engine although Handy was ready, so wait for the real answer.
    const server = await Promise.race([voiceStatus(), new Promise<null>((r) => setTimeout(() => r(null), statusCache ? 3000 : 15000))]);
    const pick = resolveEngine(prefs.get('voiceEngine'), { handyAvailable: !!server?.installed, handyReady: !!server?.ready, browserSpeech: browserSpeechSupported(), serverConfigured: !!speechServer() });
    this.engine = pick.engine;
    if (!pick.engine) return this.set('error', server && !server.ready && server.message ? server.message : pick.reason);
    try {
      if (pick.engine === 'handy' || pick.engine === 'server') await this.startRecording();
      else this.startRecognition();
    } catch (e) {
      this.cleanup();
      this.fail(e);
    }
  }

  /** Stops listening. Handy transcribes now (state processing), the browser delivers its last words. */
  async stop(): Promise<void> {
    if (this.state !== 'listening') return;
    this.stopping = true;
    if (this.engine === 'browser') {
      this.rec?.stop();
      return;
    }
    await this.finishRecording();
  }

  /** Throws the recording away. */
  cancel(): void {
    this.discard = true;
    this.rec?.abort();
    this.cleanup();
    this.ev.interim('');
    this.set('idle');
  }

  /** Back to idle after an error message has been read. */
  clearError(): void {
    if (this.state === 'error') this.set('idle');
  }

  // ---------------------------------------------------------------- Handy: record, send

  private async startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'SecurityError' });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // The recorder asks for 16 kHz; where the browser insists on its own rate the samples are converted when you stop
    try {
      this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      this.ctx = new AudioContext();
    }
    await this.ctx.resume();
    this.rate = this.ctx.sampleRate;
    await this.ctx.audioWorklet.addModule(`${ROOT}voice-worklet.js`);
    this.node = new AudioWorkletNode(this.ctx, 'voice-recorder', { numberOfOutputs: 0 });
    this.chunks = [];
    this.peak = 0;
    this.levels.reset();
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.chunks.push(e.data);
      const lv = levelOf(e.data);
      this.peak = Math.max(this.peak, lv);
      this.levels.push(lv);
    };
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
    this.started = Date.now();
    this.hinted = false;
    this.timer = setInterval(() => {
      const s = (Date.now() - this.started) / 1000;
      this.ev.level(this.levels.values, s);
      // Nothing but silence for a few seconds: say so while there is still time to fix it
      if (!this.hinted && s > 2.5 && this.peak < 0.1) {
        this.hinted = true;
        this.ev.hint?.(voiceErrorText('quiet'));
      }
      if (s >= MAX_SECONDS) void this.stop();
    }, 80);
    this.set('listening');
  }

  private async finishRecording(): Promise<void> {
    const node = this.node;
    node?.port.postMessage('stop');
    // The last chunk arrives as a message right after the stop
    await new Promise((r) => setTimeout(r, 60));
    const seconds = (Date.now() - this.started) / 1000;
    const samples = concat(this.chunks);
    const loud = measure(samples).peak;
    this.cleanup();
    if (this.discard) return;
    // Say what was wrong: nothing pressed long enough, a microphone that delivers silence, or words that did not come out
    if (seconds < 0.4) return this.set('error', voiceErrorText('too-short'));
    if (loud < 0.004) return this.set('error', voiceErrorText('quiet'));
    this.set('processing');
    try {
      // Level raised and silence around it (see prepareForSpeech): a quiet microphone no longer ends as "no speech"
      const wav = encodeWav16(prepareForSpeech(resampleTo16k(samples, this.rate)));
      let text: string;
      if (this.engine === 'server') text = await this.viaServer(wav);
      else text = ((await api.send<{ text: string }>('POST', '/api/voice/transcribe', wav, { 'content-type': 'audio/wav' }))?.text || '').trim();
      if (this.discard) return;
      if (!text) return this.set('error', voiceErrorText(loud < 0.03 ? 'quiet' : 'not-recognized'));
      this.ev.final(text);
      this.set('idle');
    } catch (e) {
      if (!this.discard) this.fail(e);
    }
  }

  /** The recording to the speech server: from the browser itself, or (on the desktop) through the backend, which has no CORS rules. */
  private async viaServer(wav: Uint8Array): Promise<string> {
    const cfg = speechServer();
    if (!cfg) throw Object.assign(new Error('Enter the address of a speech server in Settings, Voice input.'), { code: 'SPEECH_SERVER' });
    if (backend.browser) return (await transcribeWith(wav, cfg)).trim();
    const r = await api.send<{ text: string }>('POST', '/api/voice/remote', wav, { 'content-type': 'audio/wav', 'x-speech-url': cfg.url, 'x-speech-model': cfg.model, ...(cfg.key ? { 'x-speech-key': cfg.key } : {}), ...(cfg.language ? { 'x-speech-language': cfg.language } : {}) });
    return (r?.text || '').trim();
  }

  // ---------------------------------------------------------------- Browser: Web Speech API

  private startRecognition(): void {
    const Ctor = recognitionCtor();
    if (!Ctor) throw Object.assign(new Error('unsupported'), { name: 'not-supported' });
    const rec = new Ctor();
    this.rec = rec;
    this.heard = '';
    rec.lang = prefs.get('voiceLang') || navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let finals = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0]?.transcript || '';
        if (r.isFinal) finals += (finals && !/\s$/.test(finals) ? ' ' : '') + text.trim();
        else interim += text;
      }
      this.heard = (finals + (interim ? ' ' + interim.trim() : '')).trim();
      this.ev.interim(this.heard);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted' || this.discard) return;
      // Chrome reports "no-speech" after a few quiet seconds; with words already heard that is just the end
      if (e.error === 'no-speech' && this.heard) return;
      this.rec = null;
      clearInterval(this.timer);
      this.timer = undefined;
      this.ev.interim('');
      // The browser's cloud speech service is unreachable: switch to Handy (offline) when it is ready, instead of failing
      if (e.error === 'network' && !this.fellBack) {
        this.fellBack = true;
        void this.fallBackToHandy();
        return;
      }
      this.set('error', voiceErrorText(e.error, { secure: window.isSecureContext, ipad: device.info.ipad, handy: !!statusCache?.value?.ready }));
    };
    rec.onend = () => {
      const was = this.state;
      this.rec = null;
      if (this.discard || was !== 'listening') return;
      const text = this.heard.trim();
      this.heard = '';
      this.ev.interim('');
      if (text) this.ev.final(text);
      this.set(text ? 'idle' : 'error', text ? '' : voiceErrorText('no-speech'));
    };
    this.started = Date.now();
    this.timer = setInterval(() => this.ev.level([], (Date.now() - this.started) / 1000), 250);
    rec.start();
    this.set('listening');
  }

  // ---------------------------------------------------------------- Helpers

  private async fallBackToHandy(): Promise<void> {
    const server = await voiceStatus(true);
    if (this.discard) return;
    if (!server?.ready) return this.set('error', voiceErrorText('network', { handy: false }));
    try {
      this.engine = 'handy';
      await this.startRecording();
      this.ev.hint?.('The browser speech service is unreachable. Switched to Handy (offline): speak, then tap the microphone to write the text.');
    } catch (e) {
      this.cleanup();
      this.fail(e);
    }
  }

  private fail(e: unknown) {
    // An answer of the backend has a string code (NO_MODEL ...) and a sentence; a DOMException has a number
    const err = e as { name?: string; code?: unknown; message?: string };
    const text = typeof err.code === 'string' && err.message ? err.message : voiceErrorText(err.name || '', { secure: window.isSecureContext, ipad: device.info.ipad });
    this.set('error', text || voiceErrorText(''));
  }

  private cleanup(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.chunks = [];
  }
}
