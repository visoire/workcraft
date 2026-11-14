// Chat companion (Blip) states and the icons of tool calls. Pure logic, no browser needed.
//   npx tsx --test tests/server/chat-ui.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { petStateFor, SLEEP_MS, SUCCESS_MS, type PetSnapshot } from '../../src/chat/pet-state.js';
import { toolGlyph } from '../../src/chat/tool-icons.js';
import { TOOL_DEFS } from '../../src/mcp/schemas.js';
import { ICONS } from '../../src/app/icons.js';

const calm: PetSnapshot = { busy: false, thinking: false, tool: null, error: false, offline: false, sinceDoneMs: null, idleMs: 0 };

test('Blip follows the AI: thinking, reading, writing, done, error', () => {
  assert.equal(petStateFor(calm), 'idle');
  assert.equal(petStateFor({ ...calm, busy: true, thinking: true }), 'thinking');
  assert.equal(petStateFor({ ...calm, busy: true, tool: 'read-sheet' }), 'working');
  assert.equal(petStateFor({ ...calm, busy: true, tool: 'write-document' }), 'coding');
  assert.equal(petStateFor({ ...calm, busy: true, tool: 'run-command' }), 'coding');
  assert.equal(petStateFor({ ...calm, busy: true }), 'working', 'streaming the answer');
  assert.equal(petStateFor({ ...calm, error: true }), 'error');
  assert.equal(petStateFor({ ...calm, busy: true, error: true }), 'error');
});

test('A running tool beats thinking, and an offline model beats everything', () => {
  assert.equal(petStateFor({ ...calm, busy: true, thinking: true, tool: 'search-files' }), 'working');
  assert.equal(petStateFor({ ...calm, busy: true, tool: 'write-file', offline: true }), 'offline');
});

test('Blip celebrates a finished answer briefly, then rests, then sleeps', () => {
  assert.equal(petStateFor({ ...calm, sinceDoneMs: 400 }), 'success');
  assert.equal(petStateFor({ ...calm, sinceDoneMs: SUCCESS_MS + 1 }), 'idle');
  assert.equal(petStateFor({ ...calm, sinceDoneMs: 60_000, idleMs: SLEEP_MS - 1 }), 'idle');
  assert.equal(petStateFor({ ...calm, sinceDoneMs: 60_000, idleMs: SLEEP_MS }), 'sleep');
  assert.equal(petStateFor({ ...calm, busy: true, idleMs: SLEEP_MS * 2 }), 'working', 'never asleep while working');
});

test('Every built-in tool has a specific icon from the icon set', () => {
  for (const def of TOOL_DEFS) {
    const glyph = toolGlyph(def.name);
    assert.ok(glyph in ICONS, `${def.name}: ${glyph} is not in the icon set`);
    assert.notEqual(glyph, 'bolt', `${def.name} falls back to the generic icon`);
  }
  assert.equal(toolGlyph('ext-photocraft-crop'), 'plug');
  assert.equal(toolGlyph('something-new'), 'bolt');
});

test('The icons the pencil and layout code use exist', () => {
  for (const name of ['eraser', 'keyboard', 'panelTop', 'panelLeft', 'chevronUp', 'pen', 'sidebar']) assert.ok(name in ICONS, name);
});
