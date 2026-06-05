import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refinePlate } from '../src/refinePlate.js';

// ImageData synthétique (refinePlate n'utilise que width/height/data).
function makeImage(W, H, fill = 150) {
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

// Plaque réaliste : fond clair `plateV`, texte sombre `textV` (barres verticales),
// inclinée de `deg` degrés autour de (cx,cy). bg = carrosserie.
function drawPlate(img, cx, cy, L, Hp, deg, { plateV = 210, textV = 35 } = {}) {
  const th = (deg * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  const x0 = Math.floor(cx - L), x1 = Math.ceil(cx + L);
  const y0 = Math.floor(cy - L), y1 = Math.ceil(cy + L);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - cx, dy = y - cy;
    const u = dx * co + dy * si, w = -dx * si + dy * co; // repère plaque
    if (Math.abs(u) > L / 2 || Math.abs(w) > Hp / 2) continue;
    // fond de plaque
    let v = plateV;
    // texte : barres verticales dans la bande centrale (~6 caractères)
    const inText = Math.abs(w) < Hp * 0.32 && (Math.floor((u + L / 2) / (L / 12)) % 2 === 0);
    if (inText) v = textV;
    setPx(img, x, y, v);
  }
}

test('plaque de face (avec texte) → mode rect, pas de faux angle', () => {
  const img = makeImage(220, 110, 150);
  drawPlate(img, 110, 55, 150, 34, 0);
  const box = { x: 35, y: 38, w: 150, h: 34 };
  const r = refinePlate(img, box);
  assert.equal(r.reliable, true);
  assert.equal(r.mode, 'rect');
  assert.ok(Math.abs(r.metrics.tiltDeg) < 5, `tilt attendu <5°, obtenu ${r.metrics.tiltDeg}`);
});

test('plaque inclinée → mode quad, angle correct', () => {
  const img = makeImage(260, 160, 150);
  const deg = 14;
  drawPlate(img, 130, 80, 150, 34, deg);
  const box = { x: 48, y: 50, w: 164, h: 60 }; // AABB approx de la plaque inclinée
  const r = refinePlate(img, box);
  assert.equal(r.reliable, true);
  assert.equal(r.mode, 'quad');
  assert.equal(r.corners.length, 4);
  assert.ok(Math.abs(Math.abs(r.metrics.tiltDeg) - deg) < 5,
    `tilt ~${deg}° attendu, obtenu ${r.metrics.tiltDeg.toFixed(1)}`);
});

test('voiture argentée, plaque blanche peu contrastée → localisée via le texte', () => {
  // pare-chocs gris (150) ≈ plaque (185), MAIS texte bien sombre (40).
  const img = makeImage(220, 110, 150);
  drawPlate(img, 110, 55, 150, 34, 0, { plateV: 185, textV: 40 });
  const box = { x: 35, y: 38, w: 150, h: 34 };
  const r = refinePlate(img, box);
  assert.equal(r.reliable, true, 'le texte sombre doit permettre de localiser la plaque');
});

test('aucune plaque (uniforme) → non fiable, rect = boîte', () => {
  const img = makeImage(220, 110, 150);
  const box = { x: 35, y: 38, w: 150, h: 34 };
  const r = refinePlate(img, box);
  assert.equal(r.reliable, false);
  assert.equal(r.rect.w, box.w);
});

// Remplit un rectangle sombre plein (renfoncement de pare-chocs / ombre).
function fillDarkBlock(img, x, y, w, h, v = 45) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(img, xx, yy, v);
}

test('zone sombre pleine dans la boîte (renfoncement) → ignorée, angle correct', () => {
  // cas Dacia : boîte qui déborde à droite sur une zone sombre du pare-chocs.
  const img = makeImage(280, 160, 150);
  const deg = 11;
  drawPlate(img, 120, 80, 150, 34, deg);
  fillDarkBlock(img, 205, 55, 40, 55, 45); // bloc sombre collé à droite de la plaque
  const box = { x: 40, y: 55, w: 205, h: 55 }; // déborde sur le bloc sombre
  const r = refinePlate(img, box);
  assert.equal(r.reliable, true, 'la plaque doit rester localisée malgré la zone sombre');
  assert.ok(Math.abs(Math.abs(r.metrics.tiltDeg) - deg) < 6,
    `tilt ~${deg}° attendu, obtenu ${r.metrics.tiltDeg.toFixed(1)} (zone sombre mal filtrée ?)`);
});

test('boîte serrée sur la plaque → localisée (régression: ancienne version échouait)', () => {
  const img = makeImage(220, 110, 150);
  drawPlate(img, 110, 55, 150, 34, 0);
  // boîte qui colle exactement à la plaque (cas production / boîte tracée main)
  const box = { x: 110 - 75, y: 55 - 17, w: 150, h: 34 };
  const r = refinePlate(img, box);
  assert.equal(r.reliable, true);
});
