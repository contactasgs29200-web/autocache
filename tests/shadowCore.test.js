// Tests du modèle d'ombre showroom (shadowCore) sur une silhouette
// synthétique de voiture vue de profil : caisse rectangulaire + deux roues
// qui dépassent + porte-à-faux avant/arrière.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShadowMask,
  computeBottomContour,
  estimateGroundLine,
  fillContourGaps,
} from '../src/shadowCore.js';

const W = 600, H = 360;

// Silhouette : caisse de x=100 à x=500, bas de caisse à y=240 ;
// roues (rectangles arrondis grossiers) x∈[140,200] et x∈[400,460]
// descendant à y=280 ; le reste du canevas est transparent.
function makeCarAlpha() {
  const alpha = new Float32Array(W * H);
  const paint = (x1, x2, y1, y2) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) alpha[y * W + x] = 1;
  };
  paint(100, 500, 120, 240);   // caisse
  paint(140, 200, 240, 280);   // roue avant
  paint(400, 460, 240, 280);   // roue arrière
  return alpha;
}
const carBounds = { x: 100, y: 120, w: 400, h: 160 };

test('computeBottomContour suit le bas de la silhouette', () => {
  const contour = computeBottomContour(makeCarAlpha(), W, H, carBounds, null);
  assert.equal(contour[170], 280); // sous la roue avant
  assert.equal(contour[300], 240); // sous la caisse entre les roues
  assert.equal(contour[430], 280); // sous la roue arrière
  assert.equal(contour[50], -1);   // hors gabarit
});

test('computeBottomContour interpole la zone plaque', () => {
  // Plaque sur la caisse entre les roues : le contour doit rester ~240,
  // pas -1, pas une valeur aberrante.
  const contour = computeBottomContour(makeCarAlpha(), W, H, carBounds, { x1: 280, x2: 330 });
  for (let x = 280; x <= 330; x++) {
    assert.ok(Math.abs(contour[x] - 240) < 2, `contour[${x}]=${contour[x]}`);
  }
});

test('fillContourGaps comble les trous internes', () => {
  const c = new Float32Array(W).fill(-1);
  c[100] = 200; c[101] = 200; c[110] = 210;
  fillContourGaps(c, W);
  assert.ok(c[105] > 200 && c[105] < 210);
  assert.equal(c[50], -1);  // hors plage : intact
  assert.equal(c[200], -1);
});

test('estimateGroundLine touche les appuis et surplombe le bas de caisse', () => {
  const contour = computeBottomContour(makeCarAlpha(), W, H, carBounds, null);
  fillContourGaps(contour, W);
  const g = estimateGroundLine(contour, W, 0.06);
  // Aux roues : le sol touche le contour
  assert.ok(Math.abs(g[170] - 280) < 1);
  assert.ok(Math.abs(g[430] - 280) < 1);
  // Entre les roues : le sol reste sous le bas de caisse (garde au sol > 0)
  assert.ok(g[300] > 250, `g[300]=${g[300]}`);
  // Jamais au-dessus du contour
  for (let x = 100; x <= 500; x++) {
    if (contour[x] >= 0) assert.ok(g[x] >= contour[x] - 0.01);
  }
});

test("l'ombre reste dans l'empreinte du véhicule (± flou)", () => {
  const mask = buildShadowMask(makeCarAlpha(), W, H, carBounds, null, {});
  const margin = 40; // tolérance flou ambiant
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = mask[y * W + x];
      if (v > 0.02) {
        assert.ok(x >= carBounds.x - margin && x <= carBounds.x + carBounds.w + margin,
          `ombre hors gabarit en x=${x},y=${y} (v=${v.toFixed(3)})`);
      }
    }
});

test("pas d'ombre au-dessus du bas de caisse", () => {
  const mask = buildShadowMask(makeCarAlpha(), W, H, carBounds, null, {});
  // Au-dessus du contour (moins l'overlap + flou), le masque doit être nul :
  // l'ombre ne doit pas remonter sur la carrosserie.
  for (let x = 220; x <= 380; x++) {
    for (let y = 0; y < 225; y++) {
      assert.ok(mask[y * W + x] < 0.03,
        `ombre au-dessus de la caisse en x=${x},y=${y}`);
    }
  }
});

test("l'ombre est plus dense au contact des roues qu'en bout de porte-à-faux", () => {
  const mask = buildShadowMask(makeCarAlpha(), W, H, carBounds, null, {});
  const colMax = (x) => {
    let m = 0;
    for (let y = 0; y < H; y++) m = Math.max(m, mask[y * W + x]);
    return m;
  };
  const wheelDark = colMax(170);         // sous la roue avant
  const overhangDark = colMax(105);      // sous le porte-à-faux avant
  assert.ok(wheelDark > overhangDark, `roue=${wheelDark.toFixed(3)} porte-à-faux=${overhangDark.toFixed(3)}`);
  assert.ok(wheelDark > 0.35, `contact roue trop clair: ${wheelDark.toFixed(3)}`);
});

test("l'ombre suit le contour : présente sous le bas de caisse entre les roues", () => {
  const mask = buildShadowMask(makeCarAlpha(), W, H, carBounds, null, {});
  // Entre les roues, juste sous le bas de caisse (y ≈ 245-275), l'ombre doit
  // exister (zone occluse) — c'était le cœur du bug : une nappe déconnectée
  // de la silhouette.
  let maxBetween = 0;
  for (let x = 260; x <= 340; x++)
    for (let y = 245; y <= 275; y++)
      maxBetween = Math.max(maxBetween, mask[y * W + x]);
  assert.ok(maxBetween > 0.25, `ombre sous caisse trop faible: ${maxBetween.toFixed(3)}`);
});

test('opacity=0 → masque vide, spread/yOffset appliqués sans erreur', () => {
  const alpha = makeCarAlpha();
  const off = buildShadowMask(alpha, W, H, carBounds, null, { opacity: 0 });
  assert.ok(off.every(v => v < 0.005));
  const shifted = buildShadowMask(alpha, W, H, carBounds, null, { yOffsetPx: 10, spread: 1.4, extraBlurPx: 2 });
  let any = 0;
  for (let i = 0; i < shifted.length; i++) any = Math.max(any, shifted[i]);
  assert.ok(any > 0.2);
});

test('silhouette vide → masque vide sans erreur', () => {
  const empty = new Float32Array(W * H);
  const mask = buildShadowMask(empty, W, H, { x: 0, y: 0, w: 10, h: 10 }, null, {});
  assert.ok(mask.every(v => v === 0));
});
