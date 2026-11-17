// The Home Screen tip of the iPad: who gets it and when it comes back.
//   npx tsx --test tests/server/install-tip.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTALL_STEPS, SNOOZE_MS, neverAgain, shouldOfferInstall, snoozed } from '../../src/app/install-tip-rules.js';

const now = 1_800_000_000_000;

test('Only an iPad in a Safari tab gets the tip', () => {
  assert.equal(shouldOfferInstall({ ipad: true, standalone: false, state: null, now }), true);
  assert.equal(shouldOfferInstall({ ipad: false, standalone: false, state: null, now }), false, 'a computer');
  assert.equal(shouldOfferInstall({ ipad: true, standalone: true, state: null, now }), false, 'already on the Home Screen');
});

test('Not now brings it back after two weeks, Do not remind me never', () => {
  assert.equal(shouldOfferInstall({ ipad: true, standalone: false, state: snoozed(now), now: now + 1000 }), false);
  assert.equal(shouldOfferInstall({ ipad: true, standalone: false, state: snoozed(now), now: now + SNOOZE_MS + 1 }), true);
  assert.equal(shouldOfferInstall({ ipad: true, standalone: false, state: neverAgain(), now: now + 10 * SNOOZE_MS }), false);
});

test('The tutorial has four steps that name Share and Add to Home Screen', () => {
  assert.equal(INSTALL_STEPS.length, 4);
  assert.ok(INSTALL_STEPS[1]!.includes('Share') && INSTALL_STEPS[2]!.includes('Add to Home Screen'));
});
