import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_CROP, resizeCropBox, squareCropBox } from '../src/logoCrop.js';

const inside = (b) => b.x >= -1e-9 && b.y >= -1e-9
  && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9
  && b.w > 0 && b.h > 0;

// « Carré » se juge en pixels, pas en fractions : sur un logo 2:1, une
// sélection carrée occupe deux fois plus de hauteur relative que de largeur.
const isSquareInPixels = (b, aspect) => Math.abs(b.w * aspect - b.h) < 1e-9;

// ── squareCropBox ────────────────────────────────────────────────────────

test('squareCropBox : logo carré → la sélection ne bouge pas', () => {
  const b = squareCropBox({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 1);
  assert.ok(isSquareInPixels(b, 1));
  assert.equal(b.w, 0.5);
  assert.equal(b.h, 0.5);
});

test('squareCropBox : logo large (2:1) → hauteur doublée en fraction', () => {
  const b = squareCropBox({ x: 0, y: 0, w: 0.4, h: 0.9 }, 2);
  assert.ok(isSquareInPixels(b, 2));
  assert.equal(b.w, 0.4);
  assert.equal(b.h, 0.8);
  assert.ok(inside(b));
});

test('squareCropBox : logo haut (1:2) → largeur réduite', () => {
  const b = squareCropBox({ x: 0, y: 0, w: 0.9, h: 0.9 }, 0.5);
  assert.ok(isSquareInPixels(b, 0.5));
  assert.ok(inside(b));
});

// Sur un logo très allongé, le disque le plus grand possible est limité par le
// petit côté : la sélection ne doit pas déborder pour autant.
test('squareCropBox : sélection trop grande ramenée dans l\'image', () => {
  for (const aspect of [0.2, 0.5, 1, 2, 5]) {
    const b = squareCropBox({ x: 0.3, y: 0.3, w: 1, h: 1 }, aspect);
    assert.ok(isSquareInPixels(b, aspect), `aspect ${aspect}`);
    assert.ok(inside(b), `aspect ${aspect} : ${JSON.stringify(b)}`);
  }
});

test('squareCropBox : aspect absent → traité comme carré, sans NaN', () => {
  const b = squareCropBox({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 0);
  assert.ok(Number.isFinite(b.w) && Number.isFinite(b.h));
  assert.ok(inside(b));
});

// ── resizeCropBox, mode rectangle ────────────────────────────────────────

test('déplacement : la taille est conservée', () => {
  const b = resizeCropBox({ x: 0.2, y: 0.2, w: 0.5, h: 0.4 }, 'move', 0.1, -0.05);
  assert.equal(b.w, 0.5);
  assert.equal(b.h, 0.4);
  assert.ok(Math.abs(b.x - 0.3) < 1e-9);
  assert.ok(Math.abs(b.y - 0.15) < 1e-9);
});

test('déplacement : la sélection reste dans l\'image', () => {
  const b = resizeCropBox({ x: 0.6, y: 0.6, w: 0.4, h: 0.4 }, 'move', 0.9, 0.9);
  assert.ok(inside(b));
  assert.ok(Math.abs(b.x - 0.6) < 1e-9, 'butée à droite');
  assert.ok(Math.abs(b.y - 0.6) < 1e-9, 'butée en bas');
});

test('coin bas-droit : agrandit sans déplacer l\'origine', () => {
  const b = resizeCropBox({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, 'br', 0.2, 0.1);
  assert.equal(b.x, 0.1);
  assert.equal(b.y, 0.1);
  assert.ok(Math.abs(b.w - 0.6) < 1e-9);
  assert.ok(Math.abs(b.h - 0.5) < 1e-9);
});

test('coin haut-gauche : déplace l\'origine, le coin opposé reste fixe', () => {
  const start = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  const b = resizeCropBox(start, 'tl', 0.1, 0.1);
  assert.ok(Math.abs((b.x + b.w) - (start.x + start.w)) < 1e-9);
  assert.ok(Math.abs((b.y + b.h) - (start.y + start.h)) < 1e-9);
});

test('la sélection ne peut pas être réduite sous le minimum', () => {
  const b = resizeCropBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 'br', -0.9, -0.9);
  assert.ok(b.w >= MIN_CROP);
  assert.ok(b.h >= MIN_CROP);
});

// ── resizeCropBox, mode rond ─────────────────────────────────────────────

test('mode rond : la sélection reste carrée en pixels sur les quatre coins', () => {
  const aspect = 2; // logo deux fois plus large que haut
  const start = squareCropBox({ x: 0.2, y: 0.1, w: 0.3, h: 0.3 }, aspect);
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    for (const [dx, dy] of [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1], [0.08, 0.05]]) {
      const b = resizeCropBox(start, corner, dx, dy, aspect);
      assert.ok(isSquareInPixels(b, aspect), `${corner} ${dx}/${dy} → ${JSON.stringify(b)}`);
      assert.ok(inside(b), `${corner} ${dx}/${dy} sort de l'image : ${JSON.stringify(b)}`);
    }
  }
});

test('mode rond : tirer le coin bas-droit agrandit le disque', () => {
  const aspect = 1;
  const start = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
  const b = resizeCropBox(start, 'br', 0.15, 0.15, aspect);
  assert.ok(b.w > start.w);
  assert.ok(isSquareInPixels(b, aspect));
});

test('mode rond : tirer le coin haut-gauche vers l\'extérieur agrandit aussi', () => {
  const aspect = 1;
  const start = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 };
  const b = resizeCropBox(start, 'tl', -0.1, -0.1, aspect);
  assert.ok(b.w > start.w, 'un geste vers le haut-gauche doit agrandir');
  assert.ok(isSquareInPixels(b, aspect));
  assert.ok(inside(b));
});

test('mode rond : le déplacement reste libre et carré', () => {
  const aspect = 2;
  const start = squareCropBox({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, aspect);
  const b = resizeCropBox(start, 'move', 0.2, 0.1, aspect);
  assert.ok(isSquareInPixels(b, aspect));
  assert.equal(b.w, start.w);
  assert.ok(inside(b));
});

test('mode rond : un geste démesuré ne fait pas sortir la sélection', () => {
  for (const aspect of [0.4, 1, 3]) {
    const start = squareCropBox({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, aspect);
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const b = resizeCropBox(start, corner, 5, 5, aspect);
      assert.ok(inside(b), `aspect ${aspect} ${corner} : ${JSON.stringify(b)}`);
      assert.ok(isSquareInPixels(b, aspect));
    }
  }
});
