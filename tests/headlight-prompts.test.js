// Lock the prompt + strength preset behavior.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  STRICT_RETRY_PROMPT,
  REFINE_PROMPT,
  REFINE_NEGATIVE_PROMPT,
  LENS_PROMPT_SUFFIX,
  LENS_NEGATIVE_PROMPT_ADDITIONS,
  FULL_PHOTO_IDENTICAL_PROMPT,
  FULL_PHOTO_IDENTICAL_RETRY_PROMPT,
  FULL_PHOTO_IDENTICAL_NEGATIVE_PROMPT,
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

test('REFINE_PROMPT is scoped to a single optic and forbids redesign', () => {
  // Singular wording: the refine pass sees a crop with ONE optic.
  assert.match(REFINE_PROMPT, /refine only this car headlight lens/i);
  // Must forbid redesign and any of the user-reported artifacts.
  assert.match(REFINE_PROMPT, /do not redesign/i);
  assert.match(REFINE_PROMPT, /black line|seams|borders/i);
  assert.match(REFINE_PROMPT, /artifacts/i);
  // Must explicitly mention the goal of the pass.
  assert.match(REFINE_PROMPT, /clearer|sharper|more transparent/i);
});

test('REFINE_NEGATIVE_PROMPT covers the failure modes the validator looks for', () => {
  for (const phrase of [
    'black line',
    'dark border',
    'gray patch',
    'redesigned headlight',
    'changed bodywork',
  ]) {
    assert.ok(
      REFINE_NEGATIVE_PROMPT.toLowerCase().includes(phrase.toLowerCase()),
      `REFINE_NEGATIVE_PROMPT must mention "${phrase}"`,
    );
  }
});

test('high strength is more aggressive than restore', () => {
  // restore: high fidelity (preserve), high: low fidelity (let it diverge)
  assert.equal(STRENGTH_PRESETS.restore.openaiFidelity, 'high');
  assert.equal(STRENGTH_PRESETS.high.openaiFidelity, 'low');
});

test('LENS_PROMPT_SUFFIX mentions transparent headlight lens interior', () => {
  assert.match(LENS_PROMPT_SUFFIX, /transparent headlight lens interior/i);
});

test('LENS_PROMPT_SUFFIX forbids halo and circular patch', () => {
  assert.match(LENS_PROMPT_SUFFIX, /no halo/i);
  assert.match(LENS_PROMPT_SUFFIX, /no circular patch/i);
});

test('LENS_PROMPT_SUFFIX forbids altering bodywork', () => {
  assert.match(LENS_PROMPT_SUFFIX, /hood/i);
  assert.match(LENS_PROMPT_SUFFIX, /fender/i);
  assert.match(LENS_PROMPT_SUFFIX, /bumper/i);
});

test('LENS_NEGATIVE_PROMPT_ADDITIONS covers halo artifacts', () => {
  assert.ok(LENS_NEGATIVE_PROMPT_ADDITIONS.includes('halo around headlight'));
  assert.ok(LENS_NEGATIVE_PROMPT_ADDITIONS.includes('circular repaint'));
  assert.ok(LENS_NEGATIVE_PROMPT_ADDITIONS.includes('dark border around lens'));
});

test('FULL_PHOTO_IDENTICAL_PROMPT preserves entire scene', () => {
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /preserving the image as faithfully as possible/i);
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /framing/i);
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /perspective/i);
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /badges/i);
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /text/i);
});

test('FULL_PHOTO_IDENTICAL_PROMPT targets only headlight lenses', () => {
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /clear, transparent, clean, sharp/i);
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /near-new condition/i);
});

test('FULL_PHOTO_IDENTICAL_PROMPT forbids halos and badge distortion', () => {
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /do not create halos/i);
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /do not distort nearby text/i);
  assert.match(FULL_PHOTO_IDENTICAL_PROMPT, /badges/i);
});

test('FULL_PHOTO_IDENTICAL_RETRY_PROMPT is stricter than first prompt', () => {
  assert.match(FULL_PHOTO_IDENTICAL_RETRY_PROMPT, /pixel-level fidelity/i);
  assert.match(FULL_PHOTO_IDENTICAL_RETRY_PROMPT, /indistinguishable from the input/i);
});

test('FULL_PHOTO_IDENTICAL_NEGATIVE_PROMPT covers all visual artifacts', () => {
  for (const phrase of [
    'halos',
    'circular patches',
    'seams',
    'badge distortion',
    'text distortion',
    'tone shift outside headlights',
    'deformation around headlight edges',
  ]) {
    assert.ok(
      FULL_PHOTO_IDENTICAL_NEGATIVE_PROMPT.includes(phrase),
      `must mention "${phrase}"`,
    );
  }
});
