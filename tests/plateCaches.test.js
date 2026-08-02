import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plateList, plateFields, defaultPlateQuad } from '../src/plateCaches.js';

const quad = (x, y) => ({
  tl: { x, y }, tr: { x: x + 0.3, y },
  br: { x: x + 0.3, y: y + 0.08 }, bl: { x, y: y + 0.08 },
});

test('photo sans cache : liste vide', () => {
  assert.deepEqual(plateList({ corners: null }), []);
  assert.deepEqual(plateList(null), []);
  assert.deepEqual(plateList({ corners: null, extraCorners: [] }), []);
});

test('photo à une voiture : le cache détecté est seul dans la liste', () => {
  const c = quad(0.35, 0.7);
  assert.deepEqual(plateList({ corners: c }), [c]);
});

test('photo à trois voitures : cache détecté en tête, caches manuels ensuite', () => {
  const a = quad(0.10, 0.7), b = quad(0.40, 0.7), c = quad(0.70, 0.7);
  assert.deepEqual(plateList({ corners: a, extraCorners: [b, c] }), [a, b, c]);
});

test('les entrées vides de extraCorners sont ignorées', () => {
  const a = quad(0.1, 0.7), b = quad(0.4, 0.7);
  assert.deepEqual(plateList({ corners: a, extraCorners: [null, b, undefined] }), [a, b]);
});

test('plateFields répartit la liste entre corners et extraCorners', () => {
  const a = quad(0.1, 0.7), b = quad(0.4, 0.7), c = quad(0.7, 0.7);
  assert.deepEqual(plateFields([a, b, c]), { corners: a, extraCorners: [b, c] });
  assert.deepEqual(plateFields([a]), { corners: a, extraCorners: [] });
});

test('plateFields sur une liste vide efface le cache (plaque supprimée)', () => {
  assert.deepEqual(plateFields([]), { corners: null, extraCorners: [] });
  assert.deepEqual(plateFields(null), { corners: null, extraCorners: [] });
});

test('plateList ∘ plateFields : aller-retour sans perte', () => {
  const list = [quad(0.1, 0.7), quad(0.4, 0.7), quad(0.7, 0.7)];
  assert.deepEqual(plateList(plateFields(list)), list);
});

test('un cache supprimé au milieu ne laisse pas de trou', () => {
  const [a, b, c] = [quad(0.1, 0.7), quad(0.4, 0.7), quad(0.7, 0.7)];
  const restant = plateList({ corners: a, extraCorners: [b, c] }).filter(q => q !== b);
  assert.deepEqual(plateFields(restant), { corners: a, extraCorners: [c] });
});

test('supprimer le cache principal promeut le suivant', () => {
  const [a, b] = [quad(0.1, 0.7), quad(0.4, 0.7)];
  const restant = plateList({ corners: a, extraCorners: [b] }).filter(q => q !== a);
  assert.deepEqual(plateFields(restant), { corners: b, extraCorners: [] });
});

test('chaque nouveau cache est décalé du précédent', () => {
  const seen = new Set();
  for (let n = 0; n < 5; n++) {
    const q = defaultPlateQuad(n);
    const key = `${q.tl.x.toFixed(4)},${q.tl.y.toFixed(4)}`;
    assert.ok(!seen.has(key), `le cache ${n} retombe sur un cache déjà posé`);
    seen.add(key);
  }
});

test('les caches par défaut restent dans le cadre et gardent la forme d\'une plaque', () => {
  for (let n = 0; n < 12; n++) {
    const q = defaultPlateQuad(n);
    for (const p of [q.tl, q.tr, q.br, q.bl]) {
      assert.ok(p.x >= 0 && p.x <= 1, `x hors cadre pour n=${n}`);
      assert.ok(p.y >= 0 && p.y <= 1, `y hors cadre pour n=${n}`);
    }
    assert.ok(q.tr.x > q.tl.x, `largeur nulle pour n=${n}`);
    assert.ok(q.bl.y > q.tl.y, `hauteur nulle pour n=${n}`);
    assert.ok(q.tr.x - q.tl.x > q.bl.y - q.tl.y, `plaque plus haute que large pour n=${n}`);
  }
});

test('le premier cache manuel reste centré en bas de la photo', () => {
  const q = defaultPlateQuad(0);
  assert.equal((q.tl.x + q.tr.x) / 2, 0.5);
  assert.ok(q.tl.y > 0.5, 'le cache par défaut se pose dans la moitié basse');
});
