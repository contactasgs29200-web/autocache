import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeShowroom,
  SHOWROOM_MONTHLY_QUOTA,
  TRIAL_SHOWROOM_LIMIT,
} from '../api/showroom-cutout.js';

test('premium_showroom sous quota → autorisé, compteur showroom_used', () => {
  const a = authorizeShowroom({ plan: 'premium_showroom', showroom_used: 10 });
  assert.deepEqual(a, { allowed: true, counterKey: 'showroom_used', used: 10 });
});

test('premium_showroom sans compteur → autorisé à 0', () => {
  const a = authorizeShowroom({ plan: 'premium_showroom' });
  assert.equal(a.allowed, true);
  assert.equal(a.used, 0);
});

test('premium_showroom au quota → 402', () => {
  const a = authorizeShowroom({ plan: 'premium_showroom', showroom_used: SHOWROOM_MONTHLY_QUOTA });
  assert.equal(a.allowed, false);
  assert.equal(a.status, 402);
});

test('essai sous la limite offerte → autorisé, compteur showroom_trial_used', () => {
  const a = authorizeShowroom({ plan: 'trial', showroom_trial_used: TRIAL_SHOWROOM_LIMIT - 1 });
  assert.equal(a.allowed, true);
  assert.equal(a.counterKey, 'showroom_trial_used');
});

test('essai épuisé → 402', () => {
  const a = authorizeShowroom({ plan: 'trial', showroom_trial_used: TRIAL_SHOWROOM_LIMIT });
  assert.equal(a.allowed, false);
  assert.equal(a.status, 402);
});

test('métadonnées absentes → traité comme essai', () => {
  const a = authorizeShowroom(undefined);
  assert.equal(a.allowed, true);
  assert.equal(a.counterKey, 'showroom_trial_used');
});

test('pro (base) → 403', () => {
  assert.equal(authorizeShowroom({ plan: 'pro' }).status, 403);
});

test('ancien plan unique "premium" → 403 (showroom local uniquement, jamais Photoroom)', () => {
  assert.equal(authorizeShowroom({ plan: 'premium' }).status, 403);
});

test('ancien plan "essential" → 403', () => {
  assert.equal(authorizeShowroom({ plan: 'essential' }).status, 403);
});
