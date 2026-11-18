import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { transcriptionUrl, checkSpeechUrl, parseTranscription, speechErrorText, transcribeWith, SPEECH_PRESETS } from '../../src/core/speech-endpoint.ts';
import { resolveEngine, encodeWav16 } from '../../src/chat/voice-audio.ts';

test('The address of the transcription call is built from what is typed', () => {
  assert.equal(transcriptionUrl('http://127.0.0.1:8000/v1'), 'http://127.0.0.1:8000/v1/audio/transcriptions');
  assert.equal(transcriptionUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(transcriptionUrl('http://x/v1/audio/transcriptions'), 'http://x/v1/audio/transcriptions');
});

test('Addresses: only http and https, and a secure page cannot call plain http on another machine', () => {
  assert.match(checkSpeechUrl(''), /Enter the address/);
  assert.match(checkSpeechUrl('not a url'), /not a web address/);
  assert.match(checkSpeechUrl('file:///etc/passwd'), /Only http/);
  assert.equal(checkSpeechUrl('http://127.0.0.1:8000/v1', { pageSecure: true }), '');
  assert.equal(checkSpeechUrl('http://localhost:8000/v1', { pageSecure: true }), '');
  assert.match(checkSpeechUrl('http://192.168.1.20:8000/v1', { pageSecure: true }), /blocks a plain http/);
  assert.equal(checkSpeechUrl('http://192.168.1.20:8000/v1', { pageSecure: false }), '');
  assert.equal(checkSpeechUrl('https://api.openai.com/v1', { pageSecure: true }), '');
});

test('Answers: json text, plain text, nothing', () => {
  assert.equal(parseTranscription('{"text": " Hello there "}'), 'Hello there');
  assert.equal(parseTranscription('Hello there\n'), 'Hello there');
  assert.equal(parseTranscription('{"text": ""}'), '');
  assert.equal(parseTranscription(''), '');
  assert.equal(parseTranscription('{broken'), '');
});

test('Errors say what to do', () => {
  assert.match(speechErrorText(401, '{"error":{"message":"Invalid API key"}}'), /refused the key.*Invalid API key/);
  assert.match(speechErrorText(404), /ends in \/v1/);
  assert.match(speechErrorText(429), /too many requests/);
  assert.match(speechErrorText(400, '{"detail":"model not found"}'), /model not found.*model name/);
  assert.match(speechErrorText(500), /error \(500\)/);
});

test('The engine: Handy first, then the speech server, then the browser; a fixed choice is honoured', () => {
  const none = { handyReady: false, handyAvailable: false, browserSpeech: false };
  assert.equal(resolveEngine('auto', { ...none, handyAvailable: true, handyReady: true, serverConfigured: true, browserSpeech: true }).engine, 'handy');
  assert.equal(resolveEngine('auto', { ...none, serverConfigured: true, browserSpeech: true }).engine, 'server');
  assert.equal(resolveEngine('auto', { ...none, browserSpeech: true }).engine, 'browser');
  assert.equal(resolveEngine('auto', none).engine, null);
  assert.equal(resolveEngine('server', { ...none, serverConfigured: true }).engine, 'server');
  assert.match(resolveEngine('server', none).reason, /speech server/);
});

test('Presets: a local one, Groq, OpenAI and another; hosted ones need a key', () => {
  assert.deepEqual(SPEECH_PRESETS.map((p) => p.id), ['local', 'groq', 'openai', 'custom']);
  assert.ok(SPEECH_PRESETS.filter((p) => p.where === 'cloud').every((p) => p.needsKey && p.url.startsWith('https://')));
});

test('A recording goes to the server as multipart with the key, and the text comes back', async () => {
  let seen: { auth?: string; type?: string; body: string } | null = null;
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      seen = { auth: req.headers.authorization, type: String(req.headers['content-type']), body: Buffer.concat(chunks).toString('latin1') };
      if (req.url !== '/v1/audio/transcriptions') {
        res.writeHead(404).end('{"error":"nope"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"text":"open the sheet"}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as AddressInfo).port;
  try {
    const wav = encodeWav16(new Float32Array(1600));
    const text = await transcribeWith(wav, { url: `http://127.0.0.1:${port}/v1`, model: 'whisper-test', key: 'k-123', language: 'de-DE' });
    assert.equal(text, 'open the sheet');
    assert.equal(seen!.auth, 'Bearer k-123');
    assert.match(seen!.type!, /^multipart\/form-data; boundary=/);
    assert.match(seen!.body, /name="model"\r\n\r\nwhisper-test/);
    assert.match(seen!.body, /name="language"\r\n\r\nde/);
    assert.match(seen!.body, /name="file"; filename="speech.wav"/);
    // a wrong address is a sentence, not a stack trace
    await assert.rejects(() => transcribeWith(wav, { url: `http://127.0.0.1:${port}/wrong`, model: 'm' }), /no transcription address/);
  } finally {
    srv.close();
  }
});
