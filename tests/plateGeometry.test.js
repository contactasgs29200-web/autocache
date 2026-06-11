import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderQuad, quadArea } from '../src/plateGeometry.js';

// orderQuad doit renvoyer les coins dans l'ordre TL, TR, BR, BL quelle que
// soit la permutation d'entrée (Plate Recognizer ne garantit pas l'ordre).
test('orderQuad normalise un quad axe-aligné dans le désordre', () => {
  const tl = [10, 20], tr = [110, 22], br = [112, 60], bl = [8, 58];
  const shuffled = [br, tl, bl, tr];
  const [oTL, oTR, oBR, oBL] = orderQuad(shuffled);
  assert.deepEqual(oTL, tl);
  assert.deepEqual(oTR, tr);
  assert.deepEqual(oBR, br);
  assert.deepEqual(oBL, bl);
});

test('orderQuad gère une plaque inclinée', () => {
  // Plaque pivotée ~15° : les coins restent classables par somme/différence.
  const tl = [30, 10], tr = [120, 30], br = [110, 70], bl = [20, 50];
  const [oTL, oTR, oBR, oBL] = orderQuad([tr, bl, br, tl]);
  assert.deepEqual(oTL, tl);
  assert.deepEqual(oTR, tr);
  assert.deepEqual(oBR, br);
  assert.deepEqual(oBL, bl);
});

// quadArea (shoelace) — aire d'un rectangle 100×40 = 4000, indépendante de
// l'ordre/sens de parcours.
test('quadArea calcule l\'aire d\'un rectangle', () => {
  const rect = [[0, 0], [100, 0], [100, 40], [0, 40]];
  assert.equal(quadArea(rect), 4000);
  // sens horaire inversé -> même aire (valeur absolue)
  assert.equal(quadArea([...rect].reverse()), 4000);
});

test('quadArea départage un grand et un petit quad', () => {
  const big   = [[0, 0], [200, 0], [200, 80], [0, 80]];   // 16000
  const small = [[0, 0], [50, 0], [50, 20], [0, 20]];     // 1000
  assert.ok(quadArea(big) > quadArea(small));
});
