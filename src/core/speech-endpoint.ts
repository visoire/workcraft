// A speech server for voice input: any service that speaks the OpenAI transcription API (POST <base>/audio/transcriptions,
// multipart: file, model, optional language, answer {"text": "..."}). OpenAI and Groq do, and so do the local servers
// (faster-whisper-server, Speaches, LocalAI, whisper.cpp started with an OpenAI compatible path).
//
// This is what makes voice input work where Handy cannot run: in browser mode (workcraft.cc/app, an iPad on its own).
// The browser sends the recording straight to the server the user entered, nothing else. Pure functions, no DOM and
// no Node, so the browser, the backend proxy and the tests share them.

export interface SpeechServer {
  url: string;
  model: string;
  /** Optional: a key for a hosted service. Kept in memory only (never saved), like the keys of browser mode. */
  key?: string;
  language?: string;
}

export interface SpeechPreset {
  id: string;
  label: string;
  url: string;
  model: string;
  /** Where the audio goes: 'device' (stays on this computer or network) or 'cloud' */
  where: 'device' | 'cloud';
  needsKey: boolean;
}

export const SPEECH_PRESETS: SpeechPreset[] = [
  { id: 'local', label: 'A server on this computer or network (faster-whisper-server, Speaches, LocalAI)', url: 'http://127.0.0.1:8000/v1', model: 'whisper-1', where: 'device', needsKey: false },
  { id: 'groq', label: 'Groq (Whisper, your key)', url: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', where: 'cloud', needsKey: true },
  { id: 'openai', label: 'OpenAI (your key)', url: 'https://api.openai.com/v1', model: 'whisper-1', where: 'cloud', needsKey: true },
  { id: 'custom', label: 'Another server', url: '', model: 'whisper-1', where: 'device', needsKey: false },
];

/** The full address of the transcription call for what the user typed ("http://host:8000/v1", with or without the last part). */
export function transcriptionUrl(base: string): string {
  const b = base.trim().replace(/\/+$/, '');
  if (/\/audio\/transcriptions$/i.test(b)) return b;
  return `${b}/audio/transcriptions`;
}

/** Empty when the address can be used, otherwise a sentence. Only http and https; a page on https cannot call plain http on another machine. */
export function checkSpeechUrl(base: string, o: { pageSecure?: boolean } = {}): string {
  const raw = base.trim();
  if (!raw) return 'Enter the address of the speech server.';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'That is not a web address. It looks like https://host/v1.';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https addresses work.';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname);
  if (o.pageSecure && u.protocol === 'http:' && !local) return 'This page is on https, so the browser blocks a plain http address on another machine. Use an https address, or the desktop version of WorkCraft.';
  return '';
}

/** The text of an answer: {"text": "..."} (OpenAI, Groq, local servers) or plain text (response_format text). */
export function parseTranscription(body: string): string {
  const t = body.trim();
  if (!t) return '';
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as { text?: unknown; error?: unknown };
      return typeof j.text === 'string' ? j.text.trim() : '';
    } catch {
      return '';
    }
  }
  return t;
}

/** A sentence for a failed call, in words a person can act on. */
export function speechErrorText(status: number, body = ''): string {
  let detail = '';
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; detail?: unknown; message?: unknown };
    const e = typeof j.error === 'string' ? j.error : (j.error as { message?: unknown } | undefined)?.message;
    detail = String(e ?? j.detail ?? j.message ?? '').slice(0, 200);
  } catch {
    detail = body.slice(0, 160);
  }
  const more = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) return `The speech server refused the key${more}. Check the key in Settings.`;
  if (status === 404) return `The speech server has no transcription address there${more}. The address usually ends in /v1.`;
  if (status === 413) return `The recording is too large for the speech server${more}. Record less at a time.`;
  if (status === 429) return `The speech server says too many requests${more}. Wait a moment and try again.`;
  if (status === 400 || status === 422) return `The speech server did not accept the request${more}. Check the model name in Settings.`;
  return `The speech server answered with an error (${status})${more}.`;
}

/** The multipart body of the call. `wav` is a 16 kHz mono 16-bit WAV. */
export function speechForm(wav: Uint8Array, cfg: SpeechServer): FormData {
  const form = new FormData();
  form.append('file', new Blob([wav as unknown as ArrayBuffer], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', cfg.model || 'whisper-1');
  form.append('response_format', 'json');
  if (cfg.language) form.append('language', cfg.language.slice(0, 2).toLowerCase());
  return form;
}

/** Sends the recording to the speech server and returns the text. `fetchImpl` is injectable for the tests. */
export async function transcribeWith(wav: Uint8Array, cfg: SpeechServer, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(transcriptionUrl(cfg.url), { method: 'POST', headers: cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}, body: speechForm(wav, cfg) });
  const body = await res.text();
  if (!res.ok) throw Object.assign(new Error(speechErrorText(res.status, body)), { code: 'SPEECH_SERVER', status: res.status });
  return parseTranscription(body);
}
