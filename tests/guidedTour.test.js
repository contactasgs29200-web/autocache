import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDED_STEPS, BONUS_STEP, PLATE_FRAME,
  stepById, plateQuadForStep, quadBBox, coverSourceRect,
  doneStepIds, nextPendingStepIndex, isTourComplete, bonusCount,
  tourFileName, orderedShots, tourProgress,
  blurScore, meanLuma, frameAdvice, QUALITY,
} from '../src/guidedTour.js';

// ── Plan de prise de vue ─────────────────────────────────────────────────────

test('le parcours impose exactement les quatre vues demandées', () => {
  assert.equal(GUIDED_STEPS.length, 4);
  assert.deepEqual(
    GUIDED_STEPS.map(s => s.id),
    ['front_left_34', 'front', 'front_right_34', 'rear'],
  );
});

test('les vues 3/4 s’inclinent en sens opposés, les vues droites pas du tout', () => {
  const [fl, f, fr, rear] = GUIDED_STEPS;
  assert.ok(fl.plate.rotation > 0 && fr.plate.rotation < 0);
  assert.equal(f.plate.rotation, 0);
  assert.equal(rear.plate.rotation, 0);
  // Bord proche : côté où la face du véhicule se rapproche de l’appareil.
  assert.equal(fl.plate.near, 'right');
  assert.equal(fr.plate.near, 'left');
  assert.equal(f.plate.near, null);
});

test('stepById retrouve les étapes, bonus compris', () => {
  assert.equal(stepById('front').label, 'Face avant');
  assert.equal(stepById(BONUS_STEP.id), BONUS_STEP);
  assert.equal(stepById('inconnue'), null);
});

// ── Gabarit du cache plaque ──────────────────────────────────────────────────

// Mesure identique à celle faite sur les photos de référence : rectangle
// d'aire minimale autour du quadrilatère. C'est ce qui rend la comparaison
// honnête — sans lui, on testerait les entrées, pas ce que voit l'utilisateur.
function minAreaRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-ang), sn = Math.sin(-ang);
    const us = pts.map(p => p.x * c - p.y * sn);
    const vs = pts.map(p => p.x * sn + p.y * c);
    const w = Math.max(...us) - Math.min(...us);
    const h = Math.max(...vs) - Math.min(...vs);
    if (!best || w * h < best.area) best = { area: w * h, w, h, ang };
  }
  let { w, h, ang } = best;
  if (w < h) { [w, h] = [h, w]; ang += Math.PI / 2; }
  let deg = ang * 180 / Math.PI;
  while (deg > 90) deg -= 180;
  while (deg < -90) deg += 180;
  return { w, h, deg };
}

const measure = (stepId, W, H) => {
  const q = plateQuadForStep(stepId, W / H);
  return minAreaRect([q.tl, q.tr, q.br, q.bl].map(p => ({ x: p.x * W, y: p.y * H })));
};

// Relevé sur les quatre photos de référence traitées par l'app.
// L'arrière y mesurait -1,19° : un tremblement de main, ramené à 0.
const REFERENCE = {
  front_left_34:  { widthPct: 12.30, ratio: 3.56, rotation: 14.1 },
  front:          { widthPct: 23.00, ratio: 5.49, rotation: 0 },
  front_right_34: { widthPct: 12.40, ratio: 3.39, rotation: -18.2 },
  rear:           { widthPct: 22.70, ratio: 5.06, rotation: 0 },
};

test('le gabarit reproduit les mesures des photos de référence', () => {
  const W = 390, H = 640;
  for (const [id, ref] of Object.entries(REFERENCE)) {
    const m = measure(id, W, H);
    assert.ok(Math.abs(m.w / W * 100 - ref.widthPct) < 0.05,
      `${id} : largeur ${(m.w / W * 100).toFixed(2)} % au lieu de ${ref.widthPct} %`);
    assert.ok(Math.abs(m.w / m.h - ref.ratio) < 0.02,
      `${id} : L/H ${(m.w / m.h).toFixed(2)} au lieu de ${ref.ratio}`);
    assert.ok(Math.abs(m.deg - ref.rotation) < 0.05,
      `${id} : inclinaison ${m.deg.toFixed(2)}° au lieu de ${ref.rotation}°`);
  }
});

test('le gabarit ne dépend pas de l’orientation de l’écran', () => {
  // Portrait, paysage, écran très allongé : la forme et l'inclinaison à
  // l'écran ne bougent pas, seule la conversion en coordonnées y change.
  for (const id of Object.keys(REFERENCE)) {
    const p = measure(id, 390, 640);
    const l = measure(id, 1858, 1394);
    const t = measure(id, 320, 900);
    assert.ok(Math.abs(p.w / 390 - l.w / 1858) < 1e-6, `${id} largeur`);
    assert.ok(Math.abs(p.w / p.h - l.w / l.h) < 1e-6, `${id} rapport`);
    assert.ok(Math.abs(p.deg - l.deg) < 1e-6 && Math.abs(p.deg - t.deg) < 1e-6, `${id} inclinaison`);
  }
});

test('le cache reste centré sur le milieu du viseur', () => {
  for (const id of Object.keys(REFERENCE)) {
    const q = plateQuadForStep(id, 3 / 4);
    const cx = (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4;
    const cy = (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4;
    assert.ok(Math.abs(cx - PLATE_FRAME.cx) < 1e-9, `${id} cx = ${cx}`);
    assert.ok(Math.abs(cy - PLATE_FRAME.cy) < 1e-9, `${id} cy = ${cy}`);
  }
});

test('une vue de face donne un rectangle, une vue 3/4 un trapèze incliné', () => {
  const face = plateQuadForStep('front', 3 / 4);
  assert.equal(face.tl.y, face.tr.y);
  assert.equal(face.bl.y, face.br.y);

  // 3/4 avant gauche : le cache descend vers la droite…
  const gauche = plateQuadForStep('front_left_34', 3 / 4);
  assert.ok(gauche.tr.y > gauche.tl.y, 'le bord droit doit descendre');
  // … et son bord droit, plus proche de l’appareil, est le plus épais.
  const hDroite = gauche.br.y - gauche.tr.y;
  const hGauche = gauche.bl.y - gauche.tl.y;
  assert.ok(hDroite > hGauche, `${hDroite} vs ${hGauche}`);

  // 3/4 avant droit : exactement l’inverse.
  const droit = plateQuadForStep('front_right_34', 3 / 4);
  assert.ok(droit.tr.y < droit.tl.y, 'le bord droit doit monter');
  assert.ok((droit.bl.y - droit.tl.y) > (droit.br.y - droit.tr.y));
});

test('une plaque vue de biais est bien plus étroite qu’une plaque de face', () => {
  // Mesuré sur les photos : ~12,3 % contre ~23 %, soit la moitié.
  const face = measure('front', 390, 640).w;
  const biais = measure('front_left_34', 390, 640).w;
  assert.ok(biais / face > 0.5 && biais / face < 0.56, `rapport ${biais / face}`);
});

test('le gabarit reste dans le cadre et sa boîte englobante l’enveloppe', () => {
  for (const s of GUIDED_STEPS) {
    const q = plateQuadForStep(s.id, 9 / 16);
    for (const p of [q.tl, q.tr, q.br, q.bl]) {
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    }
    const b = quadBBox(q);
    assert.ok(b.x1 <= q.tl.x && b.x2 >= q.br.x);
    assert.ok(b.y1 <= q.tl.y && b.y2 >= q.bl.y);
  }
});

test('plateQuadForStep encaisse un aspect absurde et une étape inconnue', () => {
  // Étape inconnue → gabarit de la face avant, plutôt qu'un plantage.
  const q = plateQuadForStep('n’existe pas', NaN);
  assert.ok(Number.isFinite(q.tl.x) && Number.isFinite(q.tl.y));
  assert.deepEqual(q, plateQuadForStep('front', 3 / 4));
  assert.ok(Number.isFinite(plateQuadForStep('front', 0).br.y));
});

test('quadBBox refuse un quadrilatère incomplet', () => {
  assert.equal(quadBBox(null), null);
  assert.equal(quadBBox({ tl: { x: 0, y: 0 }, tr: null, br: null, bl: null }), null);
});

// ── Recadrage « ce qui est visé est ce qui est capturé » ─────────────────────

test('coverSourceRect rogne les côtés d’une vidéo plus large que le viseur', () => {
  // Vidéo 16:9 dans un viseur 3:4 (portrait) : la hauteur est conservée.
  const r = coverSourceRect(1920, 1080, 900, 1200);
  assert.equal(r.sy, 0);
  assert.equal(r.sh, 1080);
  assert.ok(Math.abs(r.sw - 1080 * (900 / 1200)) < 1e-6);
  assert.ok(Math.abs(r.sx - (1920 - r.sw) / 2) < 1e-6);
  // La zone capturée a bien le rapport du viseur : le gabarit tombe au même
  // endroit dans la photo que sur l'écran.
  assert.ok(Math.abs(r.sw / r.sh - 900 / 1200) < 1e-9);
});

test('coverSourceRect rogne en haut et en bas quand la vidéo est plus haute', () => {
  const r = coverSourceRect(1080, 1920, 1200, 900);
  assert.equal(r.sx, 0);
  assert.equal(r.sw, 1080);
  assert.ok(Math.abs(r.sh - 1080 / (1200 / 900)) < 1e-6);
  assert.ok(Math.abs(r.sy - (1920 - r.sh) / 2) < 1e-6);
});

test('coverSourceRect ne rogne rien quand les rapports coïncident', () => {
  const r = coverSourceRect(1600, 1200, 800, 600);
  assert.deepEqual(r, { sx: 0, sy: 0, sw: 1600, sh: 1200 });
});

test('coverSourceRect encaisse des dimensions manquantes', () => {
  assert.equal(coverSourceRect(0, 0, 100, 100), null);
  assert.deepEqual(coverSourceRect(640, 480, 0, 0), { sx: 0, sy: 0, sw: 640, sh: 480 });
});

// ── Avancement ───────────────────────────────────────────────────────────────

const shot = (stepId) => ({ stepId, blob: {}, url: `blob:${stepId}` });

test('nextPendingStepIndex suit l’ordre de marche autour du véhicule', () => {
  assert.equal(nextPendingStepIndex([]), 0);
  assert.equal(nextPendingStepIndex([shot('front_left_34')]), 1);
  assert.equal(nextPendingStepIndex([shot('front_left_34'), shot('front')]), 2);
  // Une vue prise dans le désordre ne bloque pas : on repart sur le premier trou.
  assert.equal(nextPendingStepIndex([shot('rear')]), 0);
});

test('le tour est bouclé quand les quatre vues sont là, bonus indifférents', () => {
  const quatre = GUIDED_STEPS.map(s => shot(s.id));
  assert.ok(isTourComplete(quatre));
  assert.ok(isTourComplete([...quatre, shot(BONUS_STEP.id)]));
  assert.equal(isTourComplete(quatre.slice(0, 3)), false);
  assert.equal(isTourComplete([shot(BONUS_STEP.id)]), false);
});

test('reprendre une vue ne la compte pas deux fois', () => {
  const shots = [shot('front'), shot('front')];
  assert.deepEqual(doneStepIds(shots), ['front']);
  assert.equal(tourProgress(shots).done, 1);
});

test('les photos bonus sont comptées à part', () => {
  const shots = [...GUIDED_STEPS.map(s => shot(s.id)), shot(BONUS_STEP.id), shot(BONUS_STEP.id)];
  assert.equal(bonusCount(shots), 2);
  const p = tourProgress(shots);
  assert.deepEqual(p, { done: 4, total: 4, bonus: 2, complete: true });
});

// ── Nommage et ordre de sortie ───────────────────────────────────────────────

test('tourFileName produit un nom ordonné et lisible', () => {
  assert.equal(tourFileName(0, 'front_left_34'), 'parcours_01_avant-34-gauche.jpg');
  assert.equal(tourFileName(3, 'rear'), 'parcours_04_arriere.jpg');
  assert.equal(tourFileName(4, BONUS_STEP.id, 1), 'parcours_05_bonus-01.jpg');
});

test('orderedShots remet les vues dans l’ordre du parcours, bonus en fin', () => {
  const shots = [
    shot('rear'), shot(BONUS_STEP.id), shot('front'),
    shot('front_right_34'), shot('front_left_34'), shot(BONUS_STEP.id),
  ];
  const out = orderedShots(shots);
  assert.deepEqual(out.map(o => o.stepId), [
    'front_left_34', 'front', 'front_right_34', 'rear', BONUS_STEP.id, BONUS_STEP.id,
  ]);
  // Le tri alphabétique des noms doit redonner l'ordre du parcours.
  const names = out.map(o => o.name);
  assert.deepEqual([...names].sort(), names);
  assert.deepEqual(names, [
    'parcours_01_avant-34-gauche.jpg',
    'parcours_02_avant.jpg',
    'parcours_03_avant-34-droit.jpg',
    'parcours_04_arriere.jpg',
    'parcours_05_bonus-01.jpg',
    'parcours_06_bonus-02.jpg',
  ]);
});

test('orderedShots ne garde que la dernière version d’une vue reprise', () => {
  const premiere = shot('front');
  const reprise = { ...shot('front'), url: 'blob:reprise' };
  const out = orderedShots([premiere, reprise, shot('rear')]);
  assert.equal(out.length, 2);
  assert.equal(out[0].shot.url, 'blob:reprise');
});

test('orderedShots tolère un parcours incomplet', () => {
  const out = orderedShots([shot('rear'), shot(BONUS_STEP.id)]);
  assert.deepEqual(out.map(o => o.stepId), ['rear', BONUS_STEP.id]);
  assert.deepEqual(out.map(o => o.name), ['parcours_01_arriere.jpg', 'parcours_02_bonus-01.jpg']);
});

// ── Contrôle de prise de vue ─────────────────────────────────────────────────

// Bruit = hautes fréquences = net ; dégradé lisse = flou ; uni = rien.
function noiseImage(w, h, seed = 1) {
  const g = new Float32Array(w * h);
  let s = seed;
  for (let i = 0; i < g.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    g[i] = (s % 256);
  }
  return g;
}
const flatImage = (w, h, value = 128) => new Float32Array(w * h).fill(value);
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

test('frameAdvice ne dit rien sur une prise correcte', () => {
  assert.equal(frameAdvice({ blurVar: 500, luma: 120 }), null);
});

test('frameAdvice signale le flou avec un motif exploitable', () => {
  const a = frameAdvice({ blurVar: 5, luma: 120 });
  assert.equal(a.code, 'blur');
  assert.match(a.message, /flou/i);
});

test('frameAdvice diagnostique l’exposition avant la netteté', () => {
  // Une photo noire est forcément aussi « floue » : le motif utile est
  // l'exposition, c'est lui qui doit remonter.
  assert.equal(frameAdvice({ blurVar: 0, luma: 5 }).code, 'dark');
  assert.equal(frameAdvice({ blurVar: 0, luma: 250 }).code, 'bright');
});

test('frameAdvice accepte des seuils personnalisés', () => {
  assert.equal(frameAdvice({ blurVar: 100, luma: 120 }, { minBlurVar: 200 }).code, 'blur');
  assert.equal(frameAdvice({ blurVar: 10, luma: 120 }, { minBlurVar: 5 }), null);
});

test('QUALITY expose des seuils cohérents', () => {
  assert.ok(QUALITY.minLuma < QUALITY.maxLuma);
  assert.ok(QUALITY.minBlurVar > 0);
});
