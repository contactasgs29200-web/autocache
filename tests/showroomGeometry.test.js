import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vehicleROI, clippedEdges, widenROI, isFullFrameROI, ROI_MARGINS } from '../src/showroomGeometry.js';

const veh = (x1, y1, x2, y2) => ({ bbox: { x1, y1, x2, y2 } });

// ── vehicleROI ────────────────────────────────────────────────────────────

test('vehicleROI applique les marges autour de la bbox', () => {
  const roi = vehicleROI(veh(0.30, 0.40, 0.70, 0.80));
  // bw = 0.40, bh = 0.40
  assert.ok(Math.abs(roi.x1 - (0.30 - 0.40 * ROI_MARGINS.left)) < 1e-9);
  assert.ok(Math.abs(roi.x2 - (0.70 + 0.40 * ROI_MARGINS.right)) < 1e-9);
  assert.ok(Math.abs(roi.y1 - (0.40 - 0.40 * ROI_MARGINS.top)) < 1e-9);
  assert.ok(Math.abs(roi.y2 - (0.80 + 0.40 * ROI_MARGINS.bottom)) < 1e-9);
});

test('vehicleROI borne la ROI à la photo', () => {
  const roi = vehicleROI(veh(0.02, 0.05, 0.98, 0.95));
  assert.equal(roi.x1, 0);
  assert.equal(roi.y1, 0);
  assert.equal(roi.x2, 1);
  assert.equal(roi.y2, 1);
});

// La régression qui amputait l'arrière des voitures : un véhicule voisin
// collé à droite du sujet ne doit plus rétrécir la marge de ce côté.
test('vehicleROI ignore les véhicules voisins (ils ne rétrécissent plus la ROI)', () => {
  const main = veh(0.30, 0.40, 0.70, 0.80);
  const seul = vehicleROI(main);
  // Un voisin chevauchant l'arrière du sujet : la ROI doit être identique.
  const avecVoisin = vehicleROI(main, null, ROI_MARGINS);
  assert.deepEqual(avecVoisin, seul);
  assert.ok(seul.x2 > 0.70, 'la marge droite reste appliquée malgré un voisin');
});

test('vehicleROI retombe sur la plaque sans bbox véhicule', () => {
  const roi = vehicleROI(null, { x1: 0.45, y1: 0.60, x2: 0.55, y2: 0.66 });
  assert.ok(roi.x1 < 0.5 && roi.x2 > 0.5, 'la ROI encadre la plaque');
  assert.ok(roi.y1 < 0.63, 'la ROI remonte largement au-dessus de la plaque');
});

test('vehicleROI sans aucun ancrage → null (photo entière)', () => {
  assert.equal(vehicleROI(null, null), null);
});

// ── clippedEdges ──────────────────────────────────────────────────────────

const dims = { W: 1000, H: 800 };
const roiInterne = { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 };

test('clippedEdges détecte la carrosserie qui touche un bord interne', () => {
  const counts = { ...dims, left: 0, right: 220, top: 0, bottom: 0 };
  assert.deepEqual(clippedEdges(counts, roiInterne), ['right']);
});

// Le cas du Twingo : bord droit de la ROI confondu avec le bord de la photo →
// la voiture est coupée par le cadrage, réélargir n'y changerait rien.
test('clippedEdges ignore un bord confondu avec le bord de la photo', () => {
  const counts = { ...dims, left: 0, right: 220, top: 0, bottom: 0 };
  const roiAuBord = { x1: 0.1, y1: 0.1, x2: 1, y2: 0.9 };
  assert.deepEqual(clippedEdges(counts, roiAuBord), []);
});

test('clippedEdges tolère quelques pixels isolés (anti-aliasing)', () => {
  const counts = { ...dims, left: 3, right: 0, top: 0, bottom: 0 };
  assert.deepEqual(clippedEdges(counts, roiInterne), []);
});

test('clippedEdges seuil proportionnel à la longueur du bord', () => {
  // Bord vertical : seuil = 1 % de H = 8 px, plancher minCount = 8 → 8.
  assert.deepEqual(clippedEdges({ ...dims, left: 7, right: 0, top: 0, bottom: 0 }, roiInterne), []);
  assert.deepEqual(clippedEdges({ ...dims, left: 8, right: 0, top: 0, bottom: 0 }, roiInterne), ['left']);
});

test('clippedEdges remonte plusieurs bords à la fois', () => {
  const counts = { ...dims, left: 100, right: 100, top: 100, bottom: 100 };
  assert.deepEqual(clippedEdges(counts, roiInterne), ['left', 'right', 'top', 'bottom']);
});

test('clippedEdges sans relevé → aucun bord', () => {
  assert.deepEqual(clippedEdges(null, roiInterne), []);
});

// ── widenROI ──────────────────────────────────────────────────────────────

test('widenROI ne repousse que les bords fautifs', () => {
  const roi = { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.8 };
  const out = widenROI(roi, ['right'], 0.5);
  assert.equal(out.x1, 0.2, 'bord gauche inchangé');
  assert.equal(out.y1, 0.2, 'bord haut inchangé');
  assert.equal(out.y2, 0.8, 'bord bas inchangé');
  assert.ok(Math.abs(out.x2 - (0.6 + 0.4 * 0.5)) < 1e-9, 'bord droit repoussé de 50 % de la largeur');
});

test('widenROI reste borné à la photo', () => {
  const out = widenROI({ x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 }, ['left', 'right', 'top', 'bottom'], 2);
  assert.deepEqual(out, { x1: 0, y1: 0, x2: 1, y2: 1 });
});

test('widenROI sans bord fautif ne change rien', () => {
  const roi = { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.8 };
  assert.deepEqual(widenROI(roi, []), roi);
});

// ── Régression : le Twingo amputé ─────────────────────────────────────────
// Photo de parking, vue 3/4 : une Clio blanche garée derrière le sujet fait
// que la bbox du LLM s'arrête trop tôt à droite (0.72 au lieu de 0.87), et
// l'ancien code rétrécissait EN PLUS la marge droite à 5 % à cause de ce même
// voisin. Résultat : ROI à 0.748 → tout l'arrière du véhicule tranché net.

const CAR_RIGHT = 0.87;               // arrière réel du véhicule
const BBOX = { x1: 0.15, y1: 0.30, x2: 0.72, y2: 0.88 }; // bbox LLM trop courte

test('régression Twingo : la ROI couvre l\'arrière réel malgré un voisin collé', () => {
  const roi = vehicleROI({ bbox: BBOX });
  // Ancien comportement : 0.72 + 0.05 × 0.57 = 0.7485 → amputation.
  assert.ok(roi.x2 > CAR_RIGHT,
    `la ROI (x2=${roi.x2.toFixed(3)}) doit dépasser l'arrière du véhicule (${CAR_RIGHT})`);
});

test('régression Twingo : une bbox très courte est rattrapée par le réélargissement', () => {
  // Cas pire : le LLM s'arrête à 0.55 — même 30 % de marge ne suffit pas.
  const roi = vehicleROI({ bbox: { ...BBOX, x2: 0.55 } });
  assert.ok(roi.x2 < CAR_RIGHT, 'préalable : cette ROI coupe bien le véhicule');

  // Le détourage renvoie de la carrosserie opaque contre le bord droit.
  const counts = { W: 1200, H: 900, left: 0, right: 300, top: 0, bottom: 0 };
  const edges = clippedEdges(counts, roi);
  assert.deepEqual(edges, ['right'], 'le garde-fou doit voir la coupe à droite');

  const wider = widenROI(roi, edges);
  assert.ok(wider.x2 > CAR_RIGHT,
    `après réélargissement (x2=${wider.x2.toFixed(3)}) l'arrière est couvert`);
  assert.equal(wider.x1, roi.x1, 'les bords sains ne bougent pas');
});

// ── isFullFrameROI ────────────────────────────────────────────────────────

test('isFullFrameROI reconnaît la photo entière', () => {
  assert.equal(isFullFrameROI({ x1: 0, y1: 0, x2: 1, y2: 1 }), true);
  assert.equal(isFullFrameROI(null), true);
  assert.equal(isFullFrameROI({ x1: 0, y1: 0, x2: 0.8, y2: 1 }), false);
});
