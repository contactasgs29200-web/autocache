import test from 'node:test';
import assert from 'node:assert/strict';

import { LENS_HALO_THRESHOLDS, FULL_PHOTO_IDENTICAL_THRESHOLDS } from '../api/_lib/headlight/mask.js';

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

test('FULL_PHOTO_IDENTICAL_THRESHOLDS exports all required fields', () => {
  assert.ok('meanInMin' in FULL_PHOTO_IDENTICAL_THRESHOLDS);
  assert.ok('meanOutMax' in FULL_PHOTO_IDENTICAL_THRESHOLDS);
  assert.ok('meanRingMax' in FULL_PHOTO_IDENTICAL_THRESHOLDS);
  assert.ok('pctHighOutMax' in FULL_PHOTO_IDENTICAL_THRESHOLDS);
});

test('FULL_PHOTO_IDENTICAL_THRESHOLDS are more relaxed than default', () => {
  assert.ok(FULL_PHOTO_IDENTICAL_THRESHOLDS.meanOutMax > 20,
    'meanOutMax must be > 20 (default validator uses 20)');
  assert.ok(FULL_PHOTO_IDENTICAL_THRESHOLDS.meanRingMax > 18,
    'meanRingMax must be > 18 (default validator uses 18)');
  assert.ok(FULL_PHOTO_IDENTICAL_THRESHOLDS.pctHighOutMax > 5,
    'pctHighOutMax must be > 5 (default validator uses 5)');
});

test('FULL_PHOTO_IDENTICAL_THRESHOLDS still detect no-ops', () => {
  assert.ok(FULL_PHOTO_IDENTICAL_THRESHOLDS.meanInMin >= 1,
    'must still require visible change inside headlights');
});
