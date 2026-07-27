import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomRect, acceptZoom } from '../src/plateKeypoints.js';

// Photo type de la concession : 4000×3000, plaque de 720 px (18 % de la
// largeur) centrée dans le bas de l'image.
const W = 4000, H = 3000;
const quad = (cx, cy, w, h) => [
  { x: cx - w / 2, y: cy - h / 2 }, // tl
  { x: cx + w / 2, y: cy - h / 2 }, // tr
  { x: cx + w / 2, y: cy + h / 2 }, // br
  { x: cx - w / 2, y: cy + h / 2 }, // bl
];
const contains = (r, c) =>
  c.every(p => p.x >= r.sx && p.x <= r.sx + r.sw && p.y >= r.sy && p.y <= r.sy + r.sh);

test('plaque de 18 % : recadrage centré, ratio de la photo conservé', () => {
  const c = quad(2000, 2200, 720, 155);
  const r = zoomRect(c, W, H);
  assert.ok(r, 'un recadrage doit être proposé');
  assert.equal(Math.round(r.sw), 1800);              // 720 / 0.40
  assert.ok(Math.abs(r.sw / r.sh - W / H) < 1e-9);   // même ratio → même letterbox
  assert.ok(Math.abs(r.zoom - 2.222) < 0.01);
  assert.ok(contains(r, c), 'la plaque doit rester dans le recadrage');
});

test('plaque déjà grande dans le cadre : pas de 2e passe', () => {
  assert.equal(zoomRect(quad(2000, 2200, 1200, 260), W, H), null);
});

test('plaque minuscule : zoom plafonné à ZOOM_MAX', () => {
  const c = quad(2000, 2200, 200, 43);
  const r = zoomRect(c, W, H);
  assert.ok(r);
  assert.ok(r.zoom <= 4.0 + 1e-9, `zoom ${r.zoom} doit rester ≤ 4`);
  assert.ok(contains(r, c));
});

test('plaque contre le bord gauche : recadrage recalé, plaque toujours dedans', () => {
  const c = quad(400, 2200, 720, 155);
  const r = zoomRect(c, W, H);
  assert.ok(r);
  assert.equal(r.sx, 0);
  assert.ok(contains(r, c));
});

test('plaque dans le coin bas-droit : recadrage dans les bornes de la photo', () => {
  const c = quad(3800, 2900, 720, 155);
  const r = zoomRect(c, W, H);
  assert.ok(r);
  assert.ok(r.sx >= 0 && r.sy >= 0);
  assert.ok(r.sx + r.sw <= W && r.sy + r.sh <= H);
});

test('quadrilatère dégénéré : aucun recadrage', () => {
  assert.equal(zoomRect(quad(2000, 2200, 6, 2), W, H), null);
});

test('photo portrait : ratio conservé et bornes respectées', () => {
  const PW = 3024, PH = 4032;
  const c = quad(1500, 3000, 540, 116);
  const r = zoomRect(c, PW, PH);
  assert.ok(r);
  assert.ok(Math.abs(r.sw / r.sh - PW / PH) < 1e-9);
  assert.ok(r.sx + r.sw <= PW && r.sy + r.sh <= PH);
  assert.ok(contains(r, c));
});

// ── Choix de la passe à laquelle on se fie ──
const pass = (conf, cx, cy, w, h) => ({ conf, corners: quad(cx, cy, w, h) });

test('passe 2 cohérente et sûre → adoptée', () => {
  assert.equal(acceptZoom(pass(0.85, 2000, 2200, 720, 155),
                          pass(0.88, 2004, 2198, 726, 158)), true);
});

test('passe 2 absente (rien détecté sur le recadrage) → passe 1', () => {
  assert.equal(acceptZoom(pass(0.85, 2000, 2200, 720, 155), null), false);
});

test('effondrement de confiance (hors domaine) → passe 1', () => {
  assert.equal(acceptZoom(pass(0.90, 2000, 2200, 720, 155),
                          pass(0.40, 2000, 2200, 720, 155)), false);
});

test('passe 2 partie sur un autre objet → passe 1', () => {
  assert.equal(acceptZoom(pass(0.85, 2000, 2200, 720, 155),
                          pass(0.85, 2600, 2200, 720, 155)), false);
});

test('passe 2 au quadrilatère aberrant → passe 1', () => {
  assert.equal(acceptZoom(pass(0.85, 2000, 2200, 720, 155),
                          pass(0.85, 2000, 2200, 1500, 320)), false);
});
