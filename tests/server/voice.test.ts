// Voice input: audio conversion, spoken names to @ and / text, engine choice, error sentences, and the Handy bridge
// of the backend with a stand-in program that speaks the same command line as Handy.
//   npx tsx --test tests/server/voice.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resampleTo16k, encodeWav16, levelOf, concat, VoiceLevels, resolveEngine, voiceErrorText, TARGET_RATE } from '../../src/chat/voice-audio.js';
import { normalizeDictation, insertDictation, type KnownNames } from '../../src/chat/voice-text.js';
import { checkWav, parseModels, parseTranscript, handyCandidates, voiceStatus, transcribe, resetVoiceCache, VoiceError } from '../../src/server/voice.js';

// ---------------------------------------------------------------- audio

test('Resampling 48 kHz to 16 kHz keeps a tone and a third of the samples', () => {
  const n = 4800;
  const tone = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
  const out = resampleTo16k(tone, 48000);
  assert.equal(out.length, 1600);
  // The tone is still there: the peak stays close to 1
  assert.ok(Math.max(...out) > 0.95);
  assert.equal(resampleTo16k(tone, 16000), tone, 'no work at the target rate');
  assert.equal(resampleTo16k(new Float32Array(0), 44100).length, 0);
});

test('Resampling 8 kHz up doubles the samples with interpolation', () => {
  const out = resampleTo16k(Float32Array.from([0, 1, 0, -1]), 8000);
  assert.equal(out.length, 8);
  assert.ok(Math.abs(out[1]! - 0.5) < 1e-6);
});

test('The WAV file is 16 kHz mono 16-bit PCM that Handy accepts', () => {
  const wav = encodeWav16(Float32Array.from([0, 0.5, -0.5, 1, -1, 2]));
  assert.equal(wav.length, 44 + 12);
  const info = checkWav(wav);
  assert.equal(info.ok, true);
  const dv = new DataView(wav.buffer);
  assert.equal(dv.getInt16(44 + 6, true), 32767, 'full scale');
  assert.equal(dv.getInt16(44 + 8, true), -32768);
  assert.equal(dv.getInt16(44 + 10, true), 32767, 'values above 1 are clipped');
  assert.equal(checkWav(encodeWav16(new Float32Array(10), 44100)).ok, false);
  assert.equal(checkWav(new Uint8Array(10)).ok, false);
  assert.match(checkWav(new Uint8Array(60)).reason!, /not a WAV/);
});

test('Levels: silence is 0, speech is visible, the history keeps its size', () => {
  assert.equal(levelOf(new Float32Array(100)), 0);
  assert.ok(levelOf(new Float32Array(100).fill(0.05)) > 0.4);
  assert.ok(levelOf(new Float32Array(100).fill(1)) <= 1);
  const lv = new VoiceLevels(3);
  [0.1, 0.2, 0.3, 0.4].forEach((v) => lv.push(v));
  assert.deepEqual(lv.values, [0.2, 0.3, 0.4]);
  assert.equal(concat([Float32Array.from([1]), Float32Array.from([2, 3])]).length, 3);
  assert.equal(TARGET_RATE, 16000);
});

// ---------------------------------------------------------------- spoken text

const known: KnownNames = { mentions: ['wordcraft', 'gridcraft', 'grid-agent', 'finances.xlsx', 'proposal.docx'], commands: ['read-sheet', 'write-document', 'help', 'team'] };

test('"at gridcraft" becomes @gridcraft, "slash read sheet" becomes /read-sheet', () => {
  assert.equal(normalizeDictation('at grid craft sum the revenue', known), '@gridcraft sum the revenue');
  assert.equal(normalizeDictation('slash read sheet at finances dot xlsx', known), '/read-sheet @finances.xlsx');
  assert.equal(normalizeDictation('Ask at grid agent, then write it up.', known), 'Ask @grid-agent, then write it up.');
  assert.equal(normalizeDictation('slash help', known), '/help');
});

test('Names the workspace does not know stay words', () => {
  assert.equal(normalizeDictation('meet me at five tomorrow', known), 'meet me at five tomorrow');
  assert.equal(normalizeDictation('the slash command is cool', known), 'the slash command is cool', 'slash only counts at the start of a sentence');
  assert.equal(normalizeDictation('at unknown file', known), 'at unknown file');
  assert.equal(normalizeDictation('   ', known), '');
});

test('A command after a full stop counts, and the longest name wins', () => {
  assert.equal(normalizeDictation('Done. slash team', known), 'Done. /team');
  assert.equal(normalizeDictation('open at word craft please', known), 'open @wordcraft please');
});

test('Dictation goes in at the caret with sensible spacing', () => {
  assert.deepEqual(insertDictation('', 0, 0, 'hello'), { value: 'hello', caret: 5 });
  assert.deepEqual(insertDictation('Sum', 3, 3, '@gridcraft totals'), { value: 'Sum @gridcraft totals', caret: 21 });
  assert.deepEqual(insertDictation('Hello world', 5, 5, 'there'), { value: 'Hello there world', caret: 11 });
  assert.equal(insertDictation('Hi.', 2, 2, 'there').value, 'Hi there.', 'no space before the full stop');
  assert.equal(insertDictation('line\n', 5, 5, 'next').value, 'line\nnext');
  assert.equal(insertDictation('abc def', 0, 3, 'xyz').value, 'xyz def', 'a selection is replaced');
  assert.deepEqual(insertDictation('keep', 4, 4, '  '), { value: 'keep', caret: 4 });
});

// ---------------------------------------------------------------- engine choice and messages

test('Automatic prefers Handy, then the browser, and says why nothing works', () => {
  assert.equal(resolveEngine('auto', { handyAvailable: true, handyReady: true, browserSpeech: true }).engine, 'handy');
  assert.equal(resolveEngine('auto', { handyAvailable: true, handyReady: false, browserSpeech: true }).engine, 'browser');
  assert.equal(resolveEngine('auto', { handyAvailable: false, handyReady: false, browserSpeech: true }).engine, 'browser');
  const none = resolveEngine('auto', { handyAvailable: true, handyReady: false, browserSpeech: false });
  assert.equal(none.engine, null);
  assert.match(none.reason, /no speech model/);
  assert.match(resolveEngine('handy', { handyAvailable: false, handyReady: false, browserSpeech: true }).reason, /desktop/);
  assert.equal(resolveEngine('browser', { handyAvailable: true, handyReady: true, browserSpeech: false }).engine, null);
});

test('Microphone problems get a sentence a person can act on', () => {
  assert.match(voiceErrorText('NotAllowedError'), /blocked/);
  assert.match(voiceErrorText('NotAllowedError', { ipad: true }), /Settings, Safari, Microphone/);
  assert.match(voiceErrorText('NotAllowedError', { secure: false }), /HTTPS/);
  assert.match(voiceErrorText('NotFoundError'), /No microphone/);
  assert.match(voiceErrorText('NotReadableError'), /in use/);
  assert.match(voiceErrorText('no-speech'), /No speech/);
  assert.equal(voiceErrorText('aborted'), '');
  assert.match(voiceErrorText('whatever'), /did not work/);
});

// ---------------------------------------------------------------- Handy bridge

test('Handy is looked for in the setting, the environment and the installer folders', () => {
  const win = handyCandidates({ setting: 'D:\\tools\\handy.exe', env: { HANDY_PATH: 'E:\\h.exe', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, platform: 'win32', home: 'C:\\Users\\u' });
  assert.equal(win[0], 'D:\\tools\\handy.exe');
  assert.equal(win[1], 'E:\\h.exe');
  assert.ok(win.some((p) => p.endsWith('Handy\\handy.exe') || p.endsWith('Handy/handy.exe')));
  assert.ok(handyCandidates({ platform: 'darwin', env: {}, home: '/Users/u' }).some((p) => p.includes('Handy.app')));
  assert.ok(handyCandidates({ platform: 'linux', env: {}, home: '/home/u' }).includes('/usr/bin/handy'));
});

test('Handy output is read: models, and the result line of a transcription', () => {
  const models = parseModels('log line\n' + JSON.stringify([{ id: 'a/b', name: 'A', is_downloaded: true, supports_streaming: true, is_recommended: false, size_mb: 10, supported_languages: ['en'] }, { id: 'c', is_downloaded: false }]));
  assert.equal(models.length, 2);
  assert.equal(models[0]!.downloaded, true);
  assert.equal(models[1]!.name, 'c');
  assert.deepEqual(parseModels('not json'), []);
  const r = parseTranscript('[INFO] loading\n{"model":"m","audio_secs":2.5,"best_ms":900,"text":"  hello world "}\n');
  assert.deepEqual(r, { text: 'hello world', model: 'm', audioSecs: 2.5, ms: 900 });
  assert.equal(parseTranscript('nothing here'), null);
});

/** A program with Handy's command line: --list-models --json, --transcribe-file <wav> --json [--model id]. */
function stand(models: { id: string; downloaded: boolean }[], reply = 'hello from the stand-in'): string {
  const dir = mkdtempSync(join(tmpdir(), 'workcraft-handy-'));
  const file = join(dir, 'handy.mjs');
  writeFileSync(
    file,
    `import { readFileSync } from 'node:fs';
const a = process.argv.slice(2);
if (a.includes('--list-models')) { console.log(JSON.stringify(${JSON.stringify(models.map((m) => ({ id: m.id, name: m.id, is_downloaded: m.downloaded, supports_streaming: true, is_recommended: false, size_mb: 1, supported_languages: ['en'] })))}, null, 2)); process.exit(0); }
const f = a[a.indexOf('--transcribe-file') + 1];
const head = readFileSync(f).subarray(0, 4).toString();
if (head !== 'RIFF') { console.error('error: not a wav'); process.exit(2); }
const m = a.includes('--model') ? a[a.indexOf('--model') + 1] : 'default-model';
if (${JSON.stringify(reply)} === 'FAIL') { console.error('error: transcribe failed: boom'); process.exit(1); }
console.log('[INFO] model loaded');
console.log(JSON.stringify({ model: m, audio_secs: 1, best_ms: 5, text: ${JSON.stringify(reply)} }));
`
  );
  return file;
}

const speech = () => encodeWav16(new Float32Array(16000).map((_, i) => Math.sin(i / 20) * 0.3));

test('Status: a missing program, a program without models, a ready one', async () => {
  resetVoiceCache();
  const missing = await voiceStatus(join(tmpdir(), 'no-such-handy-' + Date.now() + '.mjs'), true);
  // The real Handy of this computer may be found through the usual places: only the shape is certain
  assert.equal(missing.engine, 'handy');
  resetVoiceCache();
  const empty = await voiceStatus(stand([{ id: 'm1', downloaded: false }]), true);
  assert.equal(empty.installed, true);
  assert.equal(empty.ready, false);
  assert.match(empty.message, /download one/);
  resetVoiceCache();
  const ready = await voiceStatus(stand([{ id: 'm1', downloaded: false }, { id: 'm2', downloaded: true }]), true);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.models.map((m) => m.id), ['m2']);
});

test('Transcription: the recording goes to the program and the text comes back, temporary files are removed', async () => {
  resetVoiceCache();
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith('workcraft-voice-')).length;
  const path = stand([{ id: 'm2', downloaded: true }]);
  const out = await transcribe(speech(), { setting: path });
  assert.equal(out.text, 'hello from the stand-in');
  assert.equal(out.model, 'default-model');
  const withModel = await transcribe(speech(), { setting: path, model: 'm2' });
  assert.equal(withModel.model, 'm2');
  assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith('workcraft-voice-')).length, before, 'no recording is left behind');
});

test('Transcription errors say what to do', async () => {
  resetVoiceCache();
  const noModel = stand([{ id: 'm1', downloaded: false }]);
  await assert.rejects(transcribe(speech(), { setting: noModel }), (e: unknown) => e instanceof VoiceError && e.code === 'NO_MODEL' && /download/.test(e.message));
  resetVoiceCache();
  const ok = stand([{ id: 'm1', downloaded: true }]);
  await assert.rejects(transcribe(speech(), { setting: ok, model: 'other' }), (e: unknown) => e instanceof VoiceError && e.code === 'NO_MODEL');
  await assert.rejects(transcribe(new Uint8Array(100), { setting: ok }), (e: unknown) => e instanceof VoiceError && e.code === 'BAD_AUDIO');
  await assert.rejects(transcribe(encodeWav16(new Float32Array(10), 44100), { setting: ok }), (e: unknown) => e instanceof VoiceError && e.code === 'BAD_AUDIO' && /16 kHz/.test(e.message));
  resetVoiceCache();
  const failing = stand([{ id: 'm1', downloaded: true }], 'FAIL');
  await assert.rejects(transcribe(speech(), { setting: failing }), (e: unknown) => e instanceof VoiceError && e.code === 'FAILED' && /boom/.test(e.message));
  assert.ok(existsSync(tmpdir()));
});

test('Two recordings are transcribed one after the other', async () => {
  resetVoiceCache();
  const path = stand([{ id: 'm1', downloaded: true }]);
  const [a, b] = await Promise.all([transcribe(speech(), { setting: path }), transcribe(speech(), { setting: path })]);
  assert.equal(a.text, b.text);
});
