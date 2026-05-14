import test from 'node:test';
import assert from 'node:assert/strict';

import { MASK_MODE_CONFIGS, LENS_HALO_THRESHOLDS } from '../api/_lib/headlight/mask.js';

test('MASK_MODE_CONFIGS.lens exists with fullImage and refine', () => {
  assert.ok(MASK_MODE_CONFIGS.lens, 'lens config must exist');
  assert.ok(MASK_MODE_CONFIGS.lens.fullImage?.layers?.length >= 2, 'lens fullImage needs ≥2 layers');
  assert.ok(MASK_MODE_CONFIGS.lens.refine?.layers?.length >= 2, 'lens refine needs ≥2 layers');
});

test('lens fullImage layers all have negative or zero expand', () => {
  for (const layer of MASK_MODE_CONFIGS.lens.fullImage.layers) {
    assert.ok(layer.expand <= 0, `lens fullImage expand ${layer.expand} must be ≤ 0`);
  }
});

test('lens refine layers all have negative expand', () => {
  for (const layer of MASK_MODE_CONFIGS.lens.refine.layers) {
    assert.ok(layer.expand < 0, `lens refine expand ${layer.expand} must be < 0`);
  }
});

test('lens innermost fullImage expand is ≤ -0.08', () => {
  const innermost = MASK_MODE_CONFIGS.lens.fullImage.layers.at(-1);
  assert.ok(innermost.expand <= -0.08, `innermost expand ${innermost.expand} must be ≤ -0.08`);
});

test('lens feather (blurFactor) is ≤ 0.002 for all layers', () => {
  for (const layer of [...MASK_MODE_CONFIGS.lens.fullImage.layers, ...MASK_MODE_CONFIGS.lens.refine.layers]) {
    assert.ok(layer.blurFactor <= 0.002, `blurFactor ${layer.blurFactor} must be ≤ 0.002`);
  }
});

test('tight fullImage matches current hardcoded values', () => {
  const layers = MASK_MODE_CONFIGS.tight.fullImage.layers;
  assert.equal(layers.length, 3);
  assert.equal(layers[0].expand, 0.06);
  assert.equal(layers[1].expand, 0.04);
  assert.equal(layers[2].expand, 0.02);
  assert.equal(layers[0].blurFactor, 0.006);
  assert.equal(layers[1].blurFactor, 0.003);
  assert.equal(layers[2].blurFactor, 0);
});

test('tight refine matches current hardcoded values', () => {
  const layers = MASK_MODE_CONFIGS.tight.refine.layers;
  assert.equal(layers.length, 2);
  assert.equal(layers[0].expand, 0.01);
  assert.equal(layers[1].expand, -0.02);
});

test('full and tight share the same fullImage config', () => {
  assert.deepEqual(
    MASK_MODE_CONFIGS.full.fullImage,
    MASK_MODE_CONFIGS.tight.fullImage,
    'full and tight fullImage configs must be equivalent',
  );
});

test('all modes have both fullImage and refine configs', () => {
  for (const mode of ['full', 'polygon', 'tight', 'lens']) {
    assert.ok(MASK_MODE_CONFIGS[mode].fullImage?.layers, `${mode} must have fullImage.layers`);
    assert.ok(MASK_MODE_CONFIGS[mode].refine?.layers, `${mode} must have refine.layers`);
  }
});

test('polygon fullImage uses expand close to zero', () => {
  const layers = MASK_MODE_CONFIGS.polygon.fullImage.layers;
  for (const layer of layers) {
    assert.ok(layer.expand <= 0.03, `polygon fullImage expand ${layer.expand} should be close to 0`);
  }
});
