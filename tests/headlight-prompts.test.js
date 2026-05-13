// Lock the prompt + strength preset behavior.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  STRICT_RETRY_PROMPT,
  STRENGTH_PRESETS,
  DEFAULT_STRENGTH,
  resolveStrength,
} from '../api/_lib/headlight/prompts.js';

test('default prompt is the strict full-image ChatGPT-style one', () => {
  // Must explicitly say "do not redesign" to push the model toward restoration.
  assert.match(DEFAULT_PROMPT, /do not redesign/i);
  assert.match(DEFAULT_PROMPT, /less yellow/i);
  assert.match(DEFAULT_PROMPT, /more transparent/i);
  // Must lock everything else as off-limits.
  assert.match(DEFAULT_PROMPT, /not modify the car body/i);
  assert.match(DEFAULT_PROMPT, /background/i);
  assert.match(DEFAULT_PROMPT, /camera angle/i);
  // Must NOT include aggressive language that invites redesign.
  assert.doesNotMatch(DEFAULT_PROMPT, /reconstruct/i);
  assert.doesNotMatch(DEFAULT_PROMPT, /reinvent/i);
});

test('STRICT_RETRY_PROMPT is even more conservative than DEFAULT_PROMPT', () => {
  assert.ok(STRICT_RETRY_PROMPT.length > 0);
  // Should explicitly mention pixel-identical preservation.
  assert.match(STRICT_RETRY_PROMPT, /pixel-identical/i);
  // Should still say what to actually do.
  assert.match(STRICT_RETRY_PROMPT, /yellow oxidation/i);
  assert.match(STRICT_RETRY_PROMPT, /clearer|cleaner|more transparent/i);
  // Must explicitly forbid redesign.
  assert.match(STRICT_RETRY_PROMPT, /not redesign|not reinterpret/i);
});

test('negative prompt explicitly rejects redesign + altered shape', () => {
  assert.match(DEFAULT_NEGATIVE_PROMPT, /different headlight design/i);
  assert.match(DEFAULT_NEGATIVE_PROMPT, /altered headlight shape/i);
  assert.match(DEFAULT_NEGATIVE_PROMPT, /distorted geometry/i);
});

test('STRENGTH_PRESETS exposes restore as the most conservative preset', () => {
  assert.ok('restore' in STRENGTH_PRESETS, 'restore preset must exist');
  assert.equal(STRENGTH_PRESETS.restore.openaiFidelity, 'high');
  assert.equal(STRENGTH_PRESETS.restore.openaiQuality, 'medium');
});

test('resolveStrength defaults to "restore"', () => {
  assert.equal(DEFAULT_STRENGTH, 'restore');
  assert.equal(resolveStrength().label, 'restore');
  assert.equal(resolveStrength(undefined).label, 'restore');
  assert.equal(resolveStrength('garbage').label, 'restore');
});

test('resolveStrength returns the named preset when valid', () => {
  for (const key of ['restore', 'low', 'medium', 'high']) {
    assert.equal(resolveStrength(key).label, key);
  }
});

test('high strength is more aggressive than restore', () => {
  // restore: high fidelity (preserve), high: low fidelity (let it diverge)
  assert.equal(STRENGTH_PRESETS.restore.openaiFidelity, 'high');
  assert.equal(STRENGTH_PRESETS.high.openaiFidelity, 'low');
});
