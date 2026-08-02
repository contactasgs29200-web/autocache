import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDED_STEPS, BONUS_STEP, PLATE_ASPECT, PLATE_FRAME,
  stepById, plateQuadForStep, plateWidthForYaw, quadBBox, coverSourceRect,
  doneStepIds, nextPendingStepIndex, isTourComplete, bonusCount,
  tourFileName, orderedShots, tourProgress,
} from '../src/guidedTour.js';

// ── Plan de prise de vue ─────────────────────────────────────────────────────

test('le parcours impose exactement les quatre vues demandées', () => {
  assert.equal(GUIDED_STEPS.length, 4);
  assert.deepEqual(
    GUIDED_STEPS.map(s => s.id),
    ['front_left_34', 'front', 'front_right_34', 'rear'],
  );
});

test('les vues 3/4 sont orientées de part et d’autre de la face avant', () => {
  const [fl, f, fr, rear] = GUIDED_STEPS;
  assert.ok(fl.yaw < 0 && fr.yaw > 0);
  assert.equal(f.yaw, 0);
  assert.equal(rear.yaw, 0);
  assert.equal(fl.near, 'left');
  assert.equal(fr.near, 'right');
});

test('stepById retrouve les étapes, bonus compris', () => {
  assert.equal(stepById('front').label, 'Face avant');
  assert.equal(stepById(BONUS_STEP.id), BONUS_STEP);
  assert.equal(stepById('inconnue'), null);
});

// ── Gabarit du cache plaque ──────────────────────────────────────────────────

test('le cache est centré horizontalement et proche du milieu de l’écran', () => {
  const q = plateQuadForStep('front', 3 / 4);
  const cx = (q.tl.x + q.tr.x) / 2;
  const cy = (q.tl.y + q.bl.y) / 2;
  assert.ok(Math.abs(cx - 0.5) < 1e-9, `cx = ${cx}`);
  assert.equal(cy, PLATE_FRAME.cy);
});

test('le cache garde le rapport d’une plaque française à l’écran', () => {
  // Viseur 1080 × 1440 (portrait) : le rapport se mesure en PIXELS, pas en
  // coordonnées normalisées.
  const W = 1080, H = 1440;
  const q = plateQuadForStep('front', W / H);
  const wPx = (q.tr.x - q.tl.x) * W;
  const hPx = (q.bl.y - q.tl.y) * H;
  assert.ok(Math.abs(wPx / hPx - PLATE_ASPECT) < 1e-6, `rapport = ${wPx / hPx}`);
});

test('le rapport tient aussi en paysage', () => {
  const W = 1440, H = 1080;
  const q = plateQuadForStep('rear', W / H);
  const wPx = (q.tr.x - q.tl.x) * W;
  const hPx = (q.bl.y - q.tl.y) * H;
  assert.ok(Math.abs(wPx / hPx - PLATE_ASPECT) < 1e-6);
});

test('une vue de face donne un rectangle, une vue 3/4 un trapèze', () => {
  const face = plateQuadForStep('front', 3 / 4);
  assert.equal(face.tl.y, face.tr.y);
  assert.equal(face.bl.y, face.br.y);

  const troisQuarts = plateQuadForStep('front_left_34', 3 / 4);
  const hLeft = troisQuarts.bl.y - troisQuarts.tl.y;
  const hRight = troisQuarts.br.y - troisQuarts.tr.y;
  // Bord gauche (proche) plus haut que le bord droit (lointain).
  assert.ok(hLeft > hRight, `${hLeft} vs ${hRight}`);
});

test('une plaque vue de biais est plus étroite qu’une plaque de face', () => {
  const face = plateQuadForStep('front', 3 / 4);
  const biais = plateQuadForStep('front_right_34', 3 / 4);
  assert.ok((biais.tr.x - biais.tl.x) < (face.tr.x - face.tl.x));
});

test('la largeur du gabarit suit l’encombrement apparent du véhicule', () => {
  // De face, une plaque fait environ un quart de la largeur du cadre.
  assert.ok(Math.abs(plateWidthForYaw(0) - 0.257) < 0.005, `${plateWidthForYaw(0)}`);
  // À 32°, la longueur du véhicule entre dans le cadre : tout rapetisse, bien
  // plus que le simple cosinus (qui donnerait 0,218).
  assert.ok(plateWidthForYaw(32) < 0.15, `${plateWidthForYaw(32)}`);
  // Symétrique : viser à gauche ou à droite donne le même gabarit.
  assert.ok(Math.abs(plateWidthForYaw(-32) - plateWidthForYaw(32)) < 1e-12);
  // De profil, la plaque disparaît — le gabarit ne descend jamais à zéro.
  assert.equal(plateQuadForStep('front', 3 / 4).tr.x > 0.5, true);
});

test('le gabarit garde une taille utilisable même très en biais', () => {
  // Plancher : sous ce seuil, viser dans le cache devient impraticable.
  const biais = plateQuadForStep('front_left_34', 3 / 4);
  assert.ok((biais.tr.x - biais.tl.x) >= 0.16 - 1e-9);
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
  const q = plateQuadForStep('n’existe pas', NaN);
  assert.ok(Number.isFinite(q.tl.x) && Number.isFinite(q.tl.y));
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
