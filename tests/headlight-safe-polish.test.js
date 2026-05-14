import test from 'node:test';
import assert from 'node:assert/strict';

import { SAFE_POLISH_PRESETS } from '../api/_lib/headlight/mask.js';

const REQUIRED_FIELDS = [
  'label', 'yellowThreshold', 'yellowFactor', 'yellowMax',
  'desatYellow', 'dehaze', 'brightness', 'sharpen', 'opacityLift',
];

test('SAFE_POLISH_PRESETS exports soft/medium/strong', () => {
  for (const key of ['soft', 'medium', 'strong']) {
    assert.ok(SAFE_POLISH_PRESETS[key], `${key} preset must exist`);
  }
});

test('each preset has all required fields', () => {
  for (const [name, preset] of Object.entries(SAFE_POLISH_PRESETS)) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in preset, `${name} must have ${field}`);
    }
    assert.ok(Array.isArray(preset.brightness) && preset.brightness.length === 3,
      `${name}.brightness must be [r,g,b]`);
  }
});

test('strong is more aggressive than medium, medium more than soft', () => {
  const s = SAFE_POLISH_PRESETS.soft;
  const m = SAFE_POLISH_PRESETS.medium;
  const h = SAFE_POLISH_PRESETS.strong;

  assert.ok(h.yellowFactor > m.yellowFactor, 'strong yellowFactor > medium');
  assert.ok(m.yellowFactor > s.yellowFactor, 'medium yellowFactor > soft');

  assert.ok(h.yellowThreshold < m.yellowThreshold, 'strong threshold lower (more sensitive)');
  assert.ok(m.yellowThreshold < s.yellowThreshold, 'medium threshold lower than soft');

  assert.ok(h.dehaze > m.dehaze, 'strong dehaze > medium');
  assert.ok(m.dehaze > s.dehaze, 'medium dehaze > soft');

  assert.ok(h.sharpen > m.sharpen, 'strong sharpen > medium');
  assert.ok(m.sharpen > s.sharpen, 'medium sharpen > soft');

  assert.ok(h.desatYellow > m.desatYellow, 'strong desaturation > medium');
  assert.ok(m.desatYellow > s.desatYellow, 'medium desaturation > soft');

  assert.ok(h.opacityLift > m.opacityLift, 'strong opacityLift > medium');
  assert.ok(m.opacityLift > s.opacityLift, 'medium opacityLift > soft');
});

test('medium yellow correction is commercially visible (factor ≥ 0.35)', () => {
  assert.ok(SAFE_POLISH_PRESETS.medium.yellowFactor >= 0.35,
    `medium yellowFactor ${SAFE_POLISH_PRESETS.medium.yellowFactor} must be ≥ 0.35 for visible result`);
});

test('medium dehaze is at least 0.12 for visible contrast', () => {
  assert.ok(SAFE_POLISH_PRESETS.medium.dehaze >= 0.12,
    `medium dehaze ${SAFE_POLISH_PRESETS.medium.dehaze} must be ≥ 0.12`);
});

test('strong yellowMax is capped below 50 to avoid artifacts', () => {
  assert.ok(SAFE_POLISH_PRESETS.strong.yellowMax < 50,
    `strong yellowMax ${SAFE_POLISH_PRESETS.strong.yellowMax} must be < 50`);
});

test('brightness always boosts blue more than red (counteract yellow)', () => {
  for (const [name, preset] of Object.entries(SAFE_POLISH_PRESETS)) {
    const [r, , b] = preset.brightness;
    assert.ok(b >= r, `${name} brightness blue (${b}) must be ≥ red (${r})`);
  }
});

test('desatYellow stays below 0.5 to preserve natural look', () => {
  for (const [name, preset] of Object.entries(SAFE_POLISH_PRESETS)) {
    assert.ok(preset.desatYellow < 0.5,
      `${name} desatYellow ${preset.desatYellow} must be < 0.5`);
  }
});

test('preset labels match their keys', () => {
  for (const [key, preset] of Object.entries(SAFE_POLISH_PRESETS)) {
    assert.equal(preset.label, key, `${key}.label must be "${key}"`);
  }
});
