import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refinePlate } from '../src/refinePlate.js';

// ImageData synthétique (refinePlate n'utilise que width/height/data).
function makeImage(W, H, fill = 30) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = fill;
    data[i * 4 + 3] = 255;
  }
  return { width: W, height: H, data };
}
function setPx(img, x, y, v) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
}
// Plaque pleine claire (220) sur fond sombre, inclinée de `deg`.
function drawPlate(img, cx, cy, L, Hp, deg, v = 220) {
  const th = (deg * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  for (let y = Math.floor(cy - L); y <= Math.ceil(cy + L); y++)
    for (let x = Math.floor(cx - L); x <= Math.ceil(cx + L); x++) {
      const dx = x - cx, dy = y - cy;
      const u = dx * co + dy * si, w = -dx * si + dy * co;
      if (Math.abs(u) <= L / 2 && Math.abs(w) <= Hp / 2) setPx(img, x, y, v);
    }
}

test('plaque de face → mode rect (pas de faux angle)', () => {
  const img = makeImage(220, 110);
  drawPlate(img, 110, 55, 150, 32, 0);
  const box = { x: 35, y: 39, w: 150, h: 32 };
  const r = refinePlate(img, box);
  assert.equal(r.mode, 'rect');
  assert.ok(Math.abs(r.metrics.tiltDeg) < 5, `tilt attendu <5°, obtenu ${r.metrics.tiltDeg}`);
});

test('plaque inclinée, fillRatio >= 0.35 → mode quad', () => {
  const img = makeImage(260, 150);
  const deg = 14;
  drawPlate(img, 130, 75, 150, 32, deg);
  const box = { x: 48, y: 46, w: 164, h: 58 }; // AABB approx de la plaque inclinée
  const r = refinePlate(img, box);
  assert.equal(r.mode, 'quad', `attendu quad ; metrics=${JSON.stringify(r.metrics)}`);
  assert.ok(r.metrics.fillRatio >= 0.35, `fillRatio attendu >=0.35, obtenu ${r.metrics.fillRatio}`);
  assert.ok(Math.abs(Math.abs(r.metrics.tiltDeg) - deg) < 5,
    `tilt ~${deg}° attendu, obtenu ${r.metrics.tiltDeg.toFixed(1)}`);
});

test('fragment (fillRatio < 0.35) → mode rect (cas Dacia)', () => {
  // petite plaque dans une grande boîte : le quad ne couvre qu'une fraction.
  const img = makeImage(300, 160);
  drawPlate(img, 150, 80, 70, 16, 8);
  const box = { x: 40, y: 40, w: 220, h: 80 }; // boîte bien plus grande que la plaque
  const r = refinePlate(img, box);
  assert.ok(r.metrics.fillRatio < 0.35, `fillRatio attendu <0.35, obtenu ${r.metrics.fillRatio}`);
  assert.equal(r.mode, 'rect');
});

test('aucune plaque (uniforme) → rect = boîte d\'entrée', () => {
  const img = makeImage(220, 110);
  const box = { x: 35, y: 39, w: 150, h: 32 };
  const r = refinePlate(img, box);
  assert.equal(r.mode, 'rect');
  assert.equal(r.reliable, false);
  assert.equal(r.rect.w, box.w);
});
