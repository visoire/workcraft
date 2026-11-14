// The polish pass: voice reliability (levels, padding, error sentences), Handy versions, Blip (listening, pixel
// snapping) and the pure parts of the overlay manager. DOM parts are covered by the end-to-end run.
//   npx tsx --test tests/server/polish.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, prepareForSpeech, voiceErrorText, TARGET_RATE } from '../../src/chat/voice-audio.js';
import { compareVersions, HANDY_LATEST, HANDY_MIN } from '../../src/server/voice.js';
import { petStateFor, type PetSnapshot } from '../../src/chat/pet-state.js';
import { snapBlipSize } from '../../src/chat/blip.js';

const tone = (peak: number, seconds = 1) => new Float32Array(TARGET_RATE * seconds).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / TARGET_RATE) * peak);

test('A quiet recording is raised and gets half a second of silence on each side', () => {
  const quiet = tone(0.01);
  const out = prepareForSpeech(quiet);
  assert.equal(out.length, quiet.length + TARGET_RATE);
  assert.ok(out.slice(0, TARGET_RATE / 2).every((s) => s === 0), 'silence before');
  assert.ok(out.slice(-TARGET_RATE / 2).every((s) => s === 0), 'silence after');
  const m = measure(out);
  assert.ok(m.peak > 0.15 && m.peak <= 1, `raised to ${m.peak}`);
});

test('A loud recording keeps its level, silence stays silence, a DC offset goes', () => {
  const loud = tone(0.8);
  assert.ok(Math.abs(measure(prepareForSpeech(loud)).peak - 0.8) < 0.01);
  assert.equal(measure(prepareForSpeech(new Float32Array(8000))).peak, 0);
  const offset = tone(0.02).map((s) => s + 0.1);
  const out = prepareForSpeech(offset);
  const mean = out.reduce((a, b) => a + b, 0) / out.length;
  assert.ok(Math.abs(mean) < 0.01, `mean ${mean}`);
});

test('The gain is capped, so a microphone that only hisses is not turned into noise', () => {
  const hiss = tone(0.001);
  assert.ok(measure(prepareForSpeech(hiss)).peak < 0.05);
});

test('Voice errors say what was wrong', () => {
  assert.match(voiceErrorText('too-short'), /too short/);
  assert.match(voiceErrorText('quiet'), /microphone/);
  assert.match(voiceErrorText('not-recognized'), /no words/);
  assert.match(voiceErrorText('no-speech'), /No speech was heard/);
});

test('Handy versions compare as numbers: 0.10.0 is newer than 0.9.8', () => {
  assert.ok(compareVersions('0.10.0', '0.9.8') > 0);
  assert.ok(compareVersions('0.9.8', '0.10.0') < 0);
  assert.equal(compareVersions('0.10.0', '0.10.0'), 0);
  assert.equal(compareVersions('0.10', '0.10.0'), 0);
  assert.ok(compareVersions(HANDY_LATEST, HANDY_MIN) > 0);
});

const snap = (o: Partial<PetSnapshot>): PetSnapshot => ({ busy: false, thinking: false, tool: null, error: false, offline: false, sinceDoneMs: null, idleMs: 0, ...o });

test('Blip listens while the microphone is open, and the answer states come first', () => {
  assert.equal(petStateFor(snap({ listening: true })), 'listening');
  assert.equal(petStateFor(snap({ listening: true, busy: true, tool: 'read-sheet' })), 'working');
  assert.equal(petStateFor(snap({ listening: true, offline: true })), 'offline');
  assert.equal(petStateFor(snap({ error: true })), 'error');
  assert.equal(petStateFor(snap({ busy: true, tool: 'write-doc' })), 'coding');
  assert.equal(petStateFor(snap({ busy: true, thinking: true })), 'thinking');
  assert.equal(petStateFor(snap({ sinceDoneMs: 500 })), 'success');
  assert.equal(petStateFor(snap({ idleMs: 120_000 })), 'sleep');
  assert.equal(petStateFor(snap({})), 'idle');
});

test('Blip is drawn on whole device pixels', () => {
  assert.equal(snapBlipSize(30, 1), 28);
  assert.equal(snapBlipSize(84, 1), 84);
  assert.equal(snapBlipSize(30, 2), 28);
  // 1.25 scaling: three units are 3.75 device pixels, rounded to four (3.2 css pixels per unit)
  assert.equal(snapBlipSize(84, 1.25), 89.6);
  assert.ok(snapBlipSize(10, 1) >= 28, 'never smaller than one pixel per unit');
});
