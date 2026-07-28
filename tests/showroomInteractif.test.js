import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAngle, angularDelta, targetAngles, clampViews,
  createOrbitTracker, shouldCapture, degreesToNext,
  blurScore, meanLuma, subjectFill, frameQuality,
  frameIndexFromDrag, frameIndexFromAngle, isSpinUsable, frameFileName,
  DEFAULT_VIEWS, MIN_VIEWS, MAX_VIEWS, ANGLE_TOLERANCE_DEG, QUALITY,
} from '../src/showroomInteractif.js';

// ── Angles ───────────────────────────────────────────────────────────────────

test('normalizeAngle ramène tout dans [0, 360)', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.equal(normalizeAngle(359), 359);
  assert.equal(normalizeAngle(360), 0);
  assert.equal(normalizeAngle(370), 10);
  assert.equal(normalizeAngle(-10), 350);
  assert.equal(normalizeAngle(-370), 350);
  assert.equal(normalizeAngle(NaN), 0);
});

test('angularDelta prend toujours le chemin le plus court', () => {
  assert.equal(angularDelta(0, 10), 10);
  assert.equal(angularDelta(10, 0), -10);
  // Passage par le nord : 350° → 10° fait +20°, pas -340°.
  assert.equal(angularDelta(350, 10), 20);
  assert.equal(angularDelta(10, 350), -20);
  // Demi-tour : borné à ±180.
  assert.ok(Math.abs(angularDelta(0, 180)) === 180);
});

test('targetAngles répartit les vues uniformément', () => {
  const a = targetAngles(24);
  assert.equal(a.length, 24);
  assert.equal(a[0], 0);
  assert.equal(a[1], 15);
  assert.equal(a[23], 345);
});

test('clampViews borne le nombre de vues', () => {
  assert.equal(clampViews(24), 24);
  assert.equal(clampViews(2), MIN_VIEWS);
  assert.equal(clampViews(500), MAX_VIEWS);
  assert.equal(clampViews(undefined), DEFAULT_VIEWS);
});

// ── Suivi de l'orbite ────────────────────────────────────────────────────────

test('createOrbitTracker cumule un tour horaire complet', () => {
  const t = createOrbitTracker();
  for (let h = 0; h <= 360; h += 10) t.push(h % 360);
  assert.ok(Math.abs(t.progress - 360) < 1, `progress=${t.progress}`);
  assert.equal(t.direction, 1);
});

test('createOrbitTracker gère le sens antihoraire', () => {
  const t = createOrbitTracker();
  for (let i = 0; i <= 18; i++) t.push(normalizeAngle(-i * 10));
  assert.ok(t.travelled < 0, `travelled=${t.travelled}`);
  assert.equal(t.direction, -1);
  assert.ok(Math.abs(t.progress - 180) < 1);
});

test('createOrbitTracker ignore le tremblement de main', () => {
  const t = createOrbitTracker();
  t.push(100);
  for (let i = 0; i < 50; i++) t.push(100 + (i % 2 ? 0.2 : -0.2));
  assert.equal(t.progress, 0);
});

test('createOrbitTracker se resynchronise sur un décrochage boussole', () => {
  const t = createOrbitTracker();
  t.push(0); t.push(10); t.push(20);
  const before = t.progress;
  t.push(200);            // saut invraisemblable : ne doit rien cumuler
  assert.equal(t.progress, before);
  t.push(210);            // reprise normale depuis la nouvelle référence
  assert.ok(t.progress > before);
});

test('createOrbitTracker.reset repart de zéro', () => {
  const t = createOrbitTracker();
  t.push(0); t.push(90);
  t.reset();
  assert.equal(t.progress, 0);
  assert.equal(t.direction, 0);
});

// ── Déclenchement ────────────────────────────────────────────────────────────

test('shouldCapture déclenche la première vue immédiatement', () => {
  assert.equal(shouldCapture(0, 0, 24), true);
});

test('shouldCapture attend la vue suivante', () => {
  // 24 vues → une tous les 15°. Après 1 prise, la cible est 15°.
  assert.equal(shouldCapture(5, 1, 24), false);
  assert.equal(shouldCapture(15 - ANGLE_TOLERANCE_DEG, 1, 24), true);
  assert.equal(shouldCapture(20, 1, 24), true);
});

test('shouldCapture s’arrête une fois le tour complet', () => {
  assert.equal(shouldCapture(360, 24, 24), false);
});

test('degreesToNext décroît vers zéro', () => {
  assert.equal(degreesToNext(0, 1, 24), 15);
  assert.equal(degreesToNext(10, 1, 24), 5);
  assert.equal(degreesToNext(30, 1, 24), 0);
  assert.equal(degreesToNext(0, 24, 24), 0);
});

// ── Analyse d'image ──────────────────────────────────────────────────────────

// Aide : image de bruit (haute fréquence = nette) vs dégradé lisse (flou).
function noiseImage(w, h, seed = 1) {
  const g = new Float32Array(w * h);
  let s = seed;
  for (let i = 0; i < g.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    g[i] = (s % 256);
  }
  return g;
}
function flatImage(w, h, value = 128) {
  return new Float32Array(w * h).fill(value);
}
function gradientImage(w, h) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = (x / w) * 255;
  return g;
}

test('blurScore sépare une image nette d’une image lisse', () => {
  const sharp = blurScore(noiseImage(32, 32), 32, 32);
  const smooth = blurScore(gradientImage(32, 32), 32, 32);
  assert.ok(sharp > smooth * 10, `sharp=${sharp} smooth=${smooth}`);
});

test('blurScore vaut 0 sur une image uniforme ou dégénérée', () => {
  assert.equal(blurScore(flatImage(16, 16), 16, 16), 0);
  assert.equal(blurScore(null, 16, 16), 0);
  assert.equal(blurScore(flatImage(2, 2), 2, 2), 0);
});

test('meanLuma calcule la luminance moyenne', () => {
  assert.equal(meanLuma(flatImage(8, 8, 100)), 100);
  assert.equal(meanLuma([]), 0);
});

test('subjectFill est nul sur un fond uniforme', () => {
  assert.equal(subjectFill(flatImage(32, 32), 32, 32), 0);
});

test('subjectFill remonte sur une image texturée', () => {
  const fill = subjectFill(noiseImage(32, 32), 32, 32);
  assert.ok(fill > 0.1, `fill=${fill}`);
});

// ── Verdict qualité ──────────────────────────────────────────────────────────

test('frameQuality accepte une prise correcte', () => {
  const v = frameQuality({ blurVar: 500, fill: 0.4, luma: 120 });
  assert.equal(v.ok, true);
  assert.equal(v.code, 'ok');
});

test('frameQuality rejette le flou avec un motif exploitable', () => {
  const v = frameQuality({ blurVar: 5, fill: 0.4, luma: 120 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'blur');
  assert.match(v.message, /flou/i);
});

test('frameQuality distingue trop loin et trop près', () => {
  assert.equal(frameQuality({ blurVar: 500, fill: 0.02, luma: 120 }).code, 'far');
  assert.equal(frameQuality({ blurVar: 500, fill: 0.99, luma: 120 }).code, 'near');
});

test('frameQuality diagnostique l’exposition avant le reste', () => {
  // Une photo noire est forcément aussi « floue » : le motif utile est
  // l'exposition, c'est lui qui doit remonter.
  assert.equal(frameQuality({ blurVar: 0, fill: 0, luma: 5 }).code, 'dark');
  assert.equal(frameQuality({ blurVar: 0, fill: 0, luma: 250 }).code, 'bright');
});

test('frameQuality accepte des seuils personnalisés', () => {
  const strict = frameQuality({ blurVar: 100, fill: 0.4, luma: 120 }, { minBlurVar: 200 });
  assert.equal(strict.code, 'blur');
  const lax = frameQuality({ blurVar: 10, fill: 0.4, luma: 120 }, { minBlurVar: 5 });
  assert.equal(lax.ok, true);
});

test('QUALITY expose des seuils cohérents', () => {
  assert.ok(QUALITY.minFill < QUALITY.maxFill);
  assert.ok(QUALITY.minLuma < QUALITY.maxLuma);
});

// ── Visualiseur ──────────────────────────────────────────────────────────────

test('frameIndexFromDrag boucle sans jamais sortir de la plage', () => {
  const count = 24;
  for (const dx of [-5000, -300, -1, 0, 1, 300, 5000]) {
    const i = frameIndexFromDrag(0, dx, 360, count);
    assert.ok(Number.isInteger(i) && i >= 0 && i < count, `dx=${dx} → ${i}`);
  }
});

test('frameIndexFromDrag tourne dans le sens du glissement', () => {
  // Glisser une largeur d'écran complète = un tour complet = retour au départ.
  assert.equal(frameIndexFromDrag(0, -360, 360, 24), 0);
  // Glisser vers la gauche (dx négatif) fait avancer l'index.
  const forward = frameIndexFromDrag(0, -15, 360, 24);
  const backward = frameIndexFromDrag(12, 15, 360, 24);
  assert.equal(forward, 1);
  assert.equal(backward, 11);
});

test('frameIndexFromDrag survit aux entrées dégénérées', () => {
  assert.equal(frameIndexFromDrag(0, 100, 0, 24), 0);
  assert.equal(frameIndexFromDrag(0, 100, 360, 0), 0);
});

test('frameIndexFromAngle mappe l’angle sur la bonne vue', () => {
  assert.equal(frameIndexFromAngle(0, 24), 0);
  assert.equal(frameIndexFromAngle(15, 24), 1);
  assert.equal(frameIndexFromAngle(180, 24), 12);
  assert.equal(frameIndexFromAngle(360, 24), 0);
  assert.equal(frameIndexFromAngle(-15, 24), 23);
});

test('isSpinUsable exige un minimum de vues', () => {
  assert.equal(isSpinUsable(3, 24), false);
  assert.equal(isSpinUsable(MIN_VIEWS, 24), true);
  assert.equal(isSpinUsable(24, 24), true);
});

test('frameFileName préserve l’ordre du tour au tri alphabétique', () => {
  const names = Array.from({ length: 24 }, (_, i) => frameFileName(i, 24));
  const sorted = [...names].sort();
  assert.deepEqual(sorted, names);
  assert.equal(names[0], 'showroom360_01.jpg');
  assert.equal(names[23], 'showroom360_24.jpg');
});
