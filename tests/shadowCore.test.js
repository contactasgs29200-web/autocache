// Tests du cœur d'extraction de l'ombre réelle (shadowCore) sur des scènes
// synthétiques : sol uniforme, silhouette de voiture (masque binaire) et
// zones d'ombre peintes dans la luminance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeShadowMatte,
  estimateFloorBrightness,
  dilateMask,
  keepConnectedToCar,
  EXTRACT_MODEL,
} from '../src/shadowCore.js';

const W = 400, H = 160;
const FLOOR = 180, SHADOW = 90; // assombrissement de 50 %

function rect(arr, x1, x2, y1, y2, v) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++) arr[y * W + x] = v;
}

// Scène de référence : sol uniforme, bas de voiture en haut du cadre
// (x∈[100,300], y∈[0,79]) et vraie ombre au sol sous la voiture
// (x∈[90,310], y∈[80,112]).
function makeScene() {
  const lum = new Float32Array(W * H).fill(FLOOR);
  const isCar = new Uint8Array(W * H);
  rect(isCar, 100, 300, 0, 79, 1);
  rect(lum, 90, 310, 80, 112, SHADOW);
  return { lum, isCar };
}

test("l'ombre réelle est détectée avec sa densité d'origine", () => {
  const { lum, isCar } = makeScene();
  const { matte, meanAlpha } = computeShadowMatte(lum, isCar, W, H);
  // Au cœur de l'ombre : densité ≈ (180-90)/180 = 0.5, préservée par le
  // lissage léger (pas de double flou qui dilue).
  const v = matte[96 * W + 200];
  assert.ok(v > 0.35, `ombre trop faible: ${v.toFixed(3)}`);
  assert.ok(v <= EXTRACT_MODEL.maxAlpha + 0.01, `ombre trop dense: ${v.toFixed(3)}`);
  assert.ok(meanAlpha > 0.02, `meanAlpha=${meanAlpha.toFixed(4)}`);
});

test("aucune ombre n'est peinte sur la carrosserie", () => {
  const { lum, isCar } = makeScene();
  const { matte } = computeShadowMatte(lum, isCar, W, H);
  // Profondément dans le masque voiture (loin du bord + flou) : rien.
  assert.ok(matte[30 * W + 200] < 0.02, `ombre sur la voiture: ${matte[30 * W + 200].toFixed(3)}`);
});

test('les taches sombres non rattachées au véhicule sont rejetées', () => {
  const { lum, isCar } = makeScene();
  // Tache d'huile / joint de carrelage isolé, loin de la voiture.
  rect(lum, 30, 60, 115, 135, SHADOW);
  const { matte } = computeShadowMatte(lum, isCar, W, H);
  assert.ok(matte[125 * W + 45] < 0.02, `tache isolée conservée: ${matte[125 * W + 45].toFixed(3)}`);
  // La vraie ombre, elle, survit.
  assert.ok(matte[96 * W + 200] > 0.35);
});

test("un assombrissement négligeable ne crée pas d'ombre (noise gate)", () => {
  const lum = new Float32Array(W * H).fill(FLOOR);
  const isCar = new Uint8Array(W * H);
  rect(isCar, 100, 300, 0, 79, 1);
  // Léger voile sous la voiture : 3 % d'assombrissement, sous le seuil.
  rect(lum, 90, 310, 80, 112, FLOOR * 0.97);
  const { matte, meanAlpha } = computeShadowMatte(lum, isCar, W, H);
  assert.ok(meanAlpha < 0.005, `meanAlpha=${meanAlpha.toFixed(4)}`);
  assert.ok(matte[96 * W + 200] < 0.05);
});

test('sol uniforme sans ombre → matte vide (meanAlpha ≈ 0)', () => {
  const lum = new Float32Array(W * H).fill(FLOOR);
  const isCar = new Uint8Array(W * H);
  rect(isCar, 100, 300, 0, 79, 1);
  const { matte, meanAlpha } = computeShadowMatte(lum, isCar, W, H);
  assert.ok(meanAlpha < 0.005, `meanAlpha=${meanAlpha.toFixed(4)}`);
  let max = 0;
  for (let i = 0; i < W * H; i++) max = Math.max(max, matte[i]);
  assert.ok(max < 0.06, `résidu max=${max.toFixed(3)}`);
});

test('silhouette vide → matte vide sans erreur (rien de rattaché)', () => {
  const lum = new Float32Array(W * H).fill(FLOOR);
  rect(lum, 90, 310, 80, 112, SHADOW); // du sombre, mais pas de voiture
  const isCar = new Uint8Array(W * H);
  const { matte, meanAlpha } = computeShadowMatte(lum, isCar, W, H);
  assert.ok(matte.every(v => v < 0.02));
  assert.ok(meanAlpha < 0.005);
});

test("l'ombre meurt en douceur aux bords de la zone analysée", () => {
  const { lum, isCar } = makeScene();
  // Ombre prolongée jusqu'au bord gauche du cadre.
  rect(lum, 0, 310, 80, 112, SHADOW);
  const { matte } = computeShadowMatte(lum, isCar, W, H);
  const edge = matte[96 * W + 2], mid = matte[96 * W + 60];
  assert.ok(edge < 0.08, `bord non fondu: ${edge.toFixed(3)}`);
  assert.ok(mid > 0.3, `ombre absente hors fondu: ${mid.toFixed(3)}`);
  assert.ok(edge < mid);
});

test("une ombre couvrant des blocs entiers ne devient pas sa propre référence sol", () => {
  const lum = new Float32Array(W * H).fill(FLOOR);
  const isCar = new Uint8Array(W * H);
  rect(isCar, 100, 300, 0, 79, 1);
  // Nappe d'ombre dense sur toute la largeur de la voiture, plus haute
  // qu'un bloc (32 px) : sans garde-fou, le percentile par bloc renverrait
  // la luminance de l'ombre et la ferait disparaître du matte.
  rect(lum, 100, 300, 80, 125, SHADOW);
  const floorRef = estimateFloorBrightness(lum, isCar, W, H);
  assert.ok(floorRef[100 * W + 200] > 150,
    `référence sol contaminée par l'ombre: ${floorRef[100 * W + 200].toFixed(1)}`);
  const { matte } = computeShadowMatte(lum, isCar, W, H);
  assert.ok(matte[100 * W + 200] > 0.3, `cœur d'ombre troué: ${matte[100 * W + 200].toFixed(3)}`);
});

test("opacity et extraBlurPx s'appliquent au matte", () => {
  const { lum, isCar } = makeScene();
  const full = computeShadowMatte(lum, isCar, W, H).matte;
  const half = computeShadowMatte(lum, isCar, W, H, { opacity: 0.5 }).matte;
  assert.ok(Math.abs(half[96 * W + 200] - full[96 * W + 200] * 0.5) < 0.01);
  const zero = computeShadowMatte(lum, isCar, W, H, { opacity: 0 }).matte;
  assert.ok(zero.every(v => v < 0.005));
  // Flou supplémentaire : la transition au bord de l'ombre s'étale.
  const blurred = computeShadowMatte(lum, isCar, W, H, { extraBlurPx: 6 }).matte;
  const outside = 118; // 6 px sous le bord bas de l'ombre (y=112)
  assert.ok(blurred[outside * W + 200] > full[outside * W + 200],
    `flou sans effet: ${blurred[outside * W + 200].toFixed(3)} vs ${full[outside * W + 200].toFixed(3)}`);
});

test('dilateMask étend un pixel isolé en carré (2r+1)²', () => {
  const m = new Uint8Array(W * H);
  m[50 * W + 50] = 1;
  const d = dilateMask(m, W, H, 2);
  let count = 0;
  for (let i = 0; i < W * H; i++) count += d[i];
  assert.equal(count, 25);
  assert.equal(d[48 * W + 48], 1);
  assert.equal(d[52 * W + 52], 1);
  assert.equal(d[47 * W + 50], 0);
});

test('keepConnectedToCar conserve le connexe et purge le reste', () => {
  const matte = new Float32Array(W * H);
  const car = new Uint8Array(W * H);
  rect(car, 100, 300, 0, 79, 1);
  rect(matte, 100, 300, 80, 100, 0.5);  // touche la voiture
  rect(matte, 10, 30, 120, 140, 0.5);   // îlot isolé
  keepConnectedToCar(matte, car, W, H);
  assert.ok(matte[90 * W + 200] === 0.5);
  assert.ok(matte[130 * W + 20] === 0);
});
