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
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
}

// Plaque rectangulaire (axis-aligned), centrée, ratio ~4.
function drawStraightPlate(img, cx, cy, L, Hp, v = 220) {
  for (let y = Math.round(cy - Hp / 2); y <= Math.round(cy + Hp / 2); y++)
    for (let x = Math.round(cx - L / 2); x <= Math.round(cx + L / 2); x++)
      setPx(img, x, y, v);
}

// Plaque inclinée de `deg` degrés (rotation autour du centre).
function drawTiltedPlate(img, cx, cy, L, Hp, deg, v = 220) {
  const th = (deg * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const dx = x - cx, dy = y - cy;
      const u = dx * co + dy * si, w = -dx * si + dy * co;
      if (Math.abs(u) <= L / 2 && Math.abs(w) <= Hp / 2) setPx(img, x, y, v);
    }
}

test('plaque de face → mode rect (pas de faux angle)', () => {
  const img = makeImage(200, 100);
  drawStraightPlate(img, 100, 50, 140, 34);
  const box = { x: 30, y: 33, w: 140, h: 34 };
  const r = refinePlate(img, box);
  assert.equal(r.mode, 'rect');
  assert.ok(Math.abs(r.metrics.tiltDeg) < 5, `tilt attendu <5°, obtenu ${r.metrics.tiltDeg}`);
});

test('plaque inclinée → mode quad qui épouse les 4 coins', () => {
  const img = makeImage(200, 100);
  const deg = 12;
  drawTiltedPlate(img, 100, 50, 140, 34, deg);
  // bbox approximative de la plaque inclinée (comme un détecteur axis-aligned).
  const box = { x: 28, y: 21, w: 144, h: 58 };
  const r = refinePlate(img, box);
  assert.equal(r.mode, 'quad');
  assert.equal(r.corners.length, 4);
  assert.ok(Math.abs(r.metrics.tiltDeg) >= 5, `tilt attendu >=5°, obtenu ${r.metrics.tiltDeg}`);
  // l'inclinaison détectée doit être dans le bon ordre de grandeur
  assert.ok(Math.abs(Math.abs(r.metrics.tiltDeg) - deg) < 6,
    `tilt ~${deg}° attendu, obtenu ${r.metrics.tiltDeg}`);
});

test('détection non fiable (pas de plaque) → rect = boîte d\'entrée', () => {
  const img = makeImage(200, 100); // uniforme, aucune plaque
  const box = { x: 30, y: 33, w: 140, h: 34 };
  const r = refinePlate(img, box);
  assert.equal(r.mode, 'rect');
  assert.equal(r.rect.cx, box.x + box.w / 2);
  assert.equal(r.rect.w, box.w);
});
