import test from 'node:test';
import assert from 'node:assert/strict';

import { LENS_HALO_THRESHOLDS } from '../api/_lib/headlight/mask.js';

test('LENS_HALO_THRESHOLDS exports all required fields', () => {
  assert.ok('meanRingMax' in LENS_HALO_THRESHOLDS);
  assert.ok('pctRingChangedMax' in LENS_HALO_THRESHOLDS);
  assert.ok('darkLineMax' in LENS_HALO_THRESHOLDS);
});

test('halo meanRingMax is tighter than full-image threshold (18)', () => {
  assert.ok(
    LENS_HALO_THRESHOLDS.meanRingMax < 18,
    `lens halo meanRingMax (${LENS_HALO_THRESHOLDS.meanRingMax}) must be < full-image (18)`,
  );
});

test('halo meanRingMax is tighter than refine threshold (22)', () => {
  assert.ok(
    LENS_HALO_THRESHOLDS.meanRingMax < 22,
    `lens halo meanRingMax (${LENS_HALO_THRESHOLDS.meanRingMax}) must be < refine (22)`,
  );
});

test('halo pctRingChangedMax is reasonable (< 10%)', () => {
  assert.ok(LENS_HALO_THRESHOLDS.pctRingChangedMax <= 10);
  assert.ok(LENS_HALO_THRESHOLDS.pctRingChangedMax > 0);
});

test('halo darkLineMax is strict (< 1%)', () => {
  assert.ok(LENS_HALO_THRESHOLDS.darkLineMax < 1);
  assert.ok(LENS_HALO_THRESHOLDS.darkLineMax > 0);
});
