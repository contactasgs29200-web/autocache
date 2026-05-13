// Per-headlight crop geometry tests (pure JS, no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeLightCrop,
  transformLightToCrop,
  OPENAI_SUPPORTED_SIZES,
} from '../api/_lib/headlight/crop.js';

const W = 4032;
const H = 3024;

test('computeLightCrop produces an OpenAI-supported size', () => {
  const light = { x: 0.10, y: 0.45, w: 0.20, h: 0.10 };
  const crop = computeLightCrop(light, W, H);
  assert.ok(OPENAI_SUPPORTED_SIZES.includes(crop.size), `size ${crop.size}`);
});

test('computeLightCrop centers the crop on the headlight', () => {
  const light = { x: 0.40, y: 0.45, w: 0.10, h: 0.05 };
  const crop = computeLightCrop(light, W, H);
  const lightCx = (light.x + light.w / 2) * W;
  const lightCy = (light.y + light.h / 2) * H;
  const cropCx = crop.sourceX + crop.sourceW / 2;
  const cropCy = crop.sourceY + crop.sourceH / 2;
  assert.ok(Math.abs(cropCx - lightCx) < 5, `cx delta=${Math.abs(cropCx - lightCx)}`);
  assert.ok(Math.abs(cropCy - lightCy) < 5, `cy delta=${Math.abs(cropCy - lightCy)}`);
});

test('computeLightCrop handles a wide headlight → landscape size', () => {
  const wide = { x: 0.20, y: 0.45, w: 0.30, h: 0.08 };  // 6:1 wide
  const crop = computeLightCrop(wide, W, H);
  assert.equal(crop.size, '1536x1024');
});

test('computeLightCrop handles a tall headlight → portrait size', () => {
  const tall = { x: 0.45, y: 0.30, w: 0.05, h: 0.30 };  // 1:6 tall
  const crop = computeLightCrop(tall, W, H);
  assert.equal(crop.size, '1024x1536');
});

test('computeLightCrop clamps when the headlight is near image edges', () => {
  const edge = { x: 0.00, y: 0.40, w: 0.12, h: 0.10 };
  const crop = computeLightCrop(edge, W, H);
  assert.ok(crop.sourceX >= 0);
  assert.ok(crop.sourceY >= 0);
  assert.ok(crop.sourceX + crop.sourceW <= W);
  assert.ok(crop.sourceY + crop.sourceH <= H);
});

test('computeLightCrop never produces a 0-pixel dimension', () => {
  const tiny = { x: 0.50, y: 0.50, w: 0.001, h: 0.001 };
  const crop = computeLightCrop(tiny, W, H);
  assert.ok(crop.sourceW > 0);
  assert.ok(crop.sourceH > 0);
  assert.ok(OPENAI_SUPPORTED_SIZES.includes(crop.size));
});

test('transformLightToCrop maps headlight center to roughly the middle of the crop', () => {
  const light = { x: 0.20, y: 0.40, w: 0.10, h: 0.06, points: [] };
  const crop = computeLightCrop(light, W, H);
  const local = transformLightToCrop(light, crop, W, H);
  const lcx = local.x + local.w / 2;
  const lcy = local.y + local.h / 2;
  // headlight center should be near 0.5,0.5 in crop coords (within 5%)
  assert.ok(Math.abs(lcx - 0.5) < 0.05, `local cx ${lcx}`);
  assert.ok(Math.abs(lcy - 0.5) < 0.05, `local cy ${lcy}`);
});

test('transformLightToCrop transforms points', () => {
  const light = {
    x: 0.20, y: 0.40, w: 0.10, h: 0.06,
    points: [
      { x: 0.21, y: 0.41 },
      { x: 0.29, y: 0.45 },
    ],
  };
  const crop = computeLightCrop(light, W, H);
  const local = transformLightToCrop(light, crop, W, H);
  assert.equal(local.points.length, 2);
  for (const p of local.points) {
    assert.ok(p.x >= 0 && p.x <= 1, `point x ${p.x} not in [0,1]`);
    assert.ok(p.y >= 0 && p.y <= 1, `point y ${p.y} not in [0,1]`);
  }
});

test('two symmetric headlights produce identical-shaped crops', () => {
  const left  = { x: 0.10, y: 0.45, w: 0.18, h: 0.08 };
  const right = { x: 0.72, y: 0.45, w: 0.18, h: 0.08 };
  const c1 = computeLightCrop(left, W, H);
  const c2 = computeLightCrop(right, W, H);
  assert.equal(c1.size, c2.size, 'same size class');
  assert.equal(c1.sourceW, c2.sourceW, 'same crop width');
  assert.equal(c1.sourceH, c2.sourceH, 'same crop height');
});

test('crop margin grows context by ~60% of bbox size', () => {
  const light = { x: 0.40, y: 0.45, w: 0.10, h: 0.08 };
  const crop = computeLightCrop(light, W, H, 0.6);
  // crop should contain at least 1.5× the bbox width
  const bw = light.w * W;
  assert.ok(crop.sourceW > bw * 1.4, `cropW=${crop.sourceW} vs bw*1.4=${bw * 1.4}`);
});
