// Mask geometry — pure JS, no DOM required.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp01,
  normalizeHeadlight,
  isMeaningfulHeadlight,
  expandLightPoints,
  filterToSafeBand,
  MASK_GUARDS,
} from '../api/_lib/headlight/mask.js';

test('clamp01 clips out-of-range values', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(0.42), 0.42);
  assert.equal(clamp01('nope'), 0);
});

test('normalizeHeadlight clamps coordinates and tolerates array points', () => {
  const out = normalizeHeadlight({
    x: -0.1, y: 0.2, w: 0.5, h: 0.4,
    points: [[0.1, 0.2], { x: 1.5, y: 0.3 }],
  });
  assert.equal(out.x, 0);
  assert.equal(out.y, 0.2);
  assert.equal(out.points.length, 2);
  assert.equal(out.points[1].x, 1);
});

test('isMeaningfulHeadlight rejects tiny detections', () => {
  assert.equal(isMeaningfulHeadlight({ w: 0.005, h: 0.5 }), false);
  assert.equal(isMeaningfulHeadlight({ w: 0.05, h: 0.05 }), true);
});

test('expandLightPoints grows polygons outward and stays inside [0,1]', () => {
  const light = normalizeHeadlight({
    x: 0.4, y: 0.4, w: 0.2, h: 0.2,
    points: [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.4, y: 0.6 },
    ],
  });
  const expanded = expandLightPoints(light, 0.05);
  for (const p of expanded.points) {
    assert.ok(p.x >= 0 && p.x <= 1, `x within range: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 1, `y within range: ${p.y}`);
  }
  // bounding box of expanded points must be larger than original
  const xs = expanded.points.map(p => p.x);
  const ys = expanded.points.map(p => p.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 0.2);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.2);
});

test('expandLightPoints synthesizes ellipse when no polygon points', () => {
  const light = normalizeHeadlight({ x: 0.3, y: 0.3, w: 0.2, h: 0.1 });
  const expanded = expandLightPoints(light, 0.05);
  assert.ok(expanded.points.length >= 16, 'should produce a smooth polygon');
});

test('filterToSafeBand drops lights overlapping plate guard', () => {
  const lights = [
    { x: 0.1, y: 0.4,  w: 0.2, h: 0.1 },   // ok
    { x: 0.6, y: 0.85, w: 0.2, h: 0.10 },  // crosses bottom guard
    { x: 0.7, y: 0.01, w: 0.1, h: 0.02 },  // crosses top guard
    { x: 0.5, y: 0.5,  w: 0.005, h: 0.5 }, // too thin
  ];
  const filtered = filterToSafeBand(lights);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].x, 0.1);
});

test('MASK_GUARDS keeps a margin against the plate area', () => {
  assert.ok(MASK_GUARDS.PLATE_GUARD_BOTTOM < 1);
  assert.ok(MASK_GUARDS.PLATE_GUARD_BOTTOM > 0.8);
});
