import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderQuad, quadArea, snapQuadOutward, fitQuadEdges, pointInQuad, quadCoversBox, quadFromBox, plateQuadFromCrop, expandQuad } from '../src/plateGeometry.js';

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

// ── snapQuadOutward — aimantation des bords sur le vrai contour de la plaque ──

const SW = 100, SH = 60;

// Scène : plaque sombre (40) sur fond clair (200), rectangle x∈[20,80] y∈[20,40].
function makePlateLum() {
  const lum = new Float32Array(SW * SH).fill(200);
  for (let y = 20; y <= 40; y++)
    for (let x = 20; x <= 80; x++) lum[y * SW + x] = 40;
  return lum;
}

test('snapQuadOutward élargit un quad trop petit jusqu\'au bord réel', () => {
  const lum = makePlateLum();
  // Quad 4 px À L'INTÉRIEUR de la vraie plaque : les bords doivent ressortir
  // s'aimanter sur la transition sombre/clair (± ~1.5 px).
  const quad = {
    tl: { x: 24, y: 24 }, tr: { x: 76, y: 24 },
    br: { x: 76, y: 36 }, bl: { x: 24, y: 36 },
  };
  const out = snapQuadOutward(lum, SW, SH, quad, 6);
  assert.ok(out.tl.x <= 21.5 && out.tl.x >= 18, `gauche: ${out.tl.x.toFixed(1)}`);
  assert.ok(out.tr.x >= 78.5 && out.tr.x <= 82, `droite: ${out.tr.x.toFixed(1)}`);
  assert.ok(out.tl.y <= 21.5 && out.tl.y >= 18, `haut: ${out.tl.y.toFixed(1)}`);
  assert.ok(out.br.y >= 38.5 && out.br.y <= 42, `bas: ${out.br.y.toFixed(1)}`);
});

test('snapQuadOutward ne bouge pas un quad déjà sur le bord', () => {
  const lum = makePlateLum();
  const quad = {
    tl: { x: 20, y: 20 }, tr: { x: 80, y: 20 },
    br: { x: 80, y: 40 }, bl: { x: 20, y: 40 },
  };
  const out = snapQuadOutward(lum, SW, SH, quad, 6);
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    assert.ok(Math.hypot(out[k].x - quad[k].x, out[k].y - quad[k].y) < 2,
      `coin ${k} a bougé: (${out[k].x.toFixed(1)},${out[k].y.toFixed(1)})`);
  }
});

test('snapQuadOutward n\'invente rien sur une image uniforme', () => {
  const lum = new Float32Array(SW * SH).fill(128);
  const quad = {
    tl: { x: 30, y: 22 }, tr: { x: 70, y: 22 },
    br: { x: 70, y: 38 }, bl: { x: 30, y: 38 },
  };
  const out = snapQuadOutward(lum, SW, SH, quad, 6);
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    assert.ok(Math.abs(out[k].x - quad[k].x) < 0.01 && Math.abs(out[k].y - quad[k].y) < 0.01,
      `coin ${k} déplacé sans gradient`);
  }
});

test('snapQuadOutward ne rétrécit JAMAIS le quad', () => {
  const lum = makePlateLum();
  // Quad trop GRAND (déborde de la plaque) : les bords ne doivent pas rentrer.
  const quad = {
    tl: { x: 15, y: 16 }, tr: { x: 85, y: 16 },
    br: { x: 85, y: 44 }, bl: { x: 15, y: 44 },
  };
  const out = snapQuadOutward(lum, SW, SH, quad, 6);
  const areaIn = quadArea([[quad.tl.x, quad.tl.y], [quad.tr.x, quad.tr.y], [quad.br.x, quad.br.y], [quad.bl.x, quad.bl.y]]);
  const areaOut = quadArea([[out.tl.x, out.tl.y], [out.tr.x, out.tr.y], [out.br.x, out.br.y], [out.bl.x, out.bl.y]]);
  assert.ok(areaOut >= areaIn - 0.01, `aire réduite: ${areaIn} → ${areaOut}`);
});

// ── pointInQuad / quadCoversBox / quadFromBox — ancrage sur les caractères ──

const RECT_QUAD = {
  tl: { x: 20, y: 20 }, tr: { x: 120, y: 20 },
  br: { x: 120, y: 50 }, bl: { x: 20, y: 50 },
};

test('pointInQuad distingue intérieur, extérieur et tolérance', () => {
  assert.ok(pointInQuad({ x: 70, y: 35 }, RECT_QUAD));
  assert.ok(!pointInQuad({ x: 70, y: 55 }, RECT_QUAD));       // 5 px sous le bord
  assert.ok(pointInQuad({ x: 70, y: 55 }, RECT_QUAD, 6));      // toléré à 6 px
  assert.ok(!pointInQuad({ x: 10, y: 35 }, RECT_QUAD));        // à gauche
});

test('pointInQuad fonctionne sur un quad en perspective', () => {
  // Trapèze : côté gauche plus grand (véhicule tourné vers la droite).
  const trap = {
    tl: { x: 20, y: 10 }, tr: { x: 110, y: 22 },
    br: { x: 110, y: 48 }, bl: { x: 20, y: 60 },
  };
  assert.ok(pointInQuad({ x: 60, y: 35 }, trap));
  assert.ok(!pointInQuad({ x: 60, y: 5 }, trap));
  assert.ok(!pointInQuad({ x: 115, y: 35 }, trap));
});

test('quadCoversBox accepte un quad englobant la bande de texte', () => {
  assert.ok(quadCoversBox(RECT_QUAD, { x1: 32, y1: 27, x2: 108, y2: 43 }));
});

test('quadCoversBox rejette un quad décalé d\'une hauteur de plaque (bug réel)', () => {
  // Le bug observé : le bord HAUT du quad longe le bord BAS réel de la
  // plaque — la bande de caractères reste au-dessus, hors du quad.
  const chars = { x1: 32, y1: 27, x2: 108, y2: 43 };
  const shifted = {
    tl: { x: 20, y: 50 }, tr: { x: 120, y: 50 },
    br: { x: 120, y: 80 }, bl: { x: 20, y: 80 },
  };
  assert.ok(!quadCoversBox(shifted, chars, (chars.y2 - chars.y1) * 0.15));
  // ... et la reconstruction depuis la bande de texte recouvre les caractères.
  const rebuilt = quadFromBox(chars);
  assert.ok(quadCoversBox(rebuilt, chars));
});

test('quadFromBox dilate autour du centre aux proportions plaque', () => {
  const q = quadFromBox({ x1: 40, y1: 30, x2: 140, y2: 50 }, 1.25, 1.5);
  // centre préservé
  assert.equal((q.tl.x + q.br.x) / 2, 90);
  assert.equal((q.tl.y + q.br.y) / 2, 40);
  // dimensions ×1.25 / ×1.5
  assert.equal(q.tr.x - q.tl.x, 125);
  assert.equal(q.bl.y - q.tl.y, 30);
});

// ── fitQuadEdges — ajustement avec inclinaison (perspective) ──

// Plaque sombre INCLINÉE (vue 3/4) : le bord haut descend de y=20 à y=26,
// le bord bas de y=38 à y=44 (parallélogramme).
function makeTiltedPlateLum() {
  const plate = {
    tl: { x: 20, y: 20 }, tr: { x: 80, y: 26 },
    br: { x: 80, y: 44 }, bl: { x: 20, y: 38 },
  };
  const lum = new Float32Array(SW * SH).fill(200);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++)
      if (pointInQuad({ x: x + 0.5, y: y + 0.5 }, plate)) lum[y * SW + x] = 40;
  return lum;
}

test('fitQuadEdges retrouve la perspective d\'une plaque inclinée', () => {
  const lum = makeTiltedPlateLum();
  // Le modèle a renvoyé un rectangle DROIT (bbox de la plaque) : les bords
  // haut/bas doivent s'incliner pour épouser le vrai contour.
  const quad = {
    tl: { x: 20, y: 20 }, tr: { x: 80, y: 20 },
    br: { x: 80, y: 44 }, bl: { x: 20, y: 44 },
  };
  const chars = { x1: 30, y1: 28, x2: 70, y2: 36 };
  const out = fitQuadEdges(lum, SW, SH, quad, chars, 8, 8);
  assert.ok(Math.abs(out.tl.y - 20) <= 3, `tl.y: ${out.tl.y.toFixed(1)}`);
  assert.ok(Math.abs(out.tr.y - 26) <= 3, `tr.y: ${out.tr.y.toFixed(1)}`);
  assert.ok(Math.abs(out.bl.y - 38) <= 3, `bl.y: ${out.bl.y.toFixed(1)}`);
  assert.ok(Math.abs(out.br.y - 44) <= 3, `br.y: ${out.br.y.toFixed(1)}`);
  // La bande de caractères reste couverte.
  assert.ok(quadCoversBox(out, chars, 1));
});

test('fitQuadEdges ne rogne jamais la bande de caractères', () => {
  const lum = makeTiltedPlateLum();
  const quad = {
    tl: { x: 20, y: 20 }, tr: { x: 80, y: 20 },
    br: { x: 80, y: 44 }, bl: { x: 20, y: 44 },
  };
  // Ancre presque aussi grande que le quad : aucun mouvement intérieur possible.
  const chars = { x1: 21, y1: 21, x2: 79, y2: 43 };
  const out = fitQuadEdges(lum, SW, SH, quad, chars, 8, 8);
  assert.ok(quadCoversBox(out, chars, 1.5), 'bande de caractères rognée');
});

test('fitQuadEdges reste stable sur une image uniforme', () => {
  const lum = new Float32Array(SW * SH).fill(128);
  const quad = {
    tl: { x: 30, y: 22 }, tr: { x: 70, y: 22 },
    br: { x: 70, y: 38 }, bl: { x: 30, y: 38 },
  };
  const out = fitQuadEdges(lum, SW, SH, quad, { x1: 35, y1: 26, x2: 65, y2: 34 }, 8, 8);
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    assert.ok(Math.abs(out[k].x - quad[k].x) < 0.01 && Math.abs(out[k].y - quad[k].y) < 0.01,
      `coin ${k} déplacé sans gradient`);
  }
});

// ── plateQuadFromCrop — extraction par segmentation (zone claire + bleue) ──

// Scène réaliste : plaque CLAIRE (210) avec bande bleue à gauche et glyphes
// sombres, sur carrosserie grise (110). Optionnellement inclinée.
function makeScene(tilt = 0) {
  const W = 200, H = 100;
  const lum = new Float32Array(W * H).fill(110);
  const rgb = new Uint8ClampedArray(W * H * 4);
  const put = (i, r, g, b) => { rgb[i * 4] = r; rgb[i * 4 + 1] = g; rgb[i * 4 + 2] = b; rgb[i * 4 + 3] = 255; };
  for (let i = 0; i < W * H; i++) put(i, 110, 110, 110);
  // plaque : x 40..160, y haut = 30 + tilt*(x-40)/120, hauteur 34
  for (let x = 40; x <= 160; x++) {
    const yTop = 30 + tilt * (x - 40) / 120;
    for (let y = Math.round(yTop); y <= Math.round(yTop) + 34; y++) {
      const i = y * W + x;
      if (x <= 52) { lum[i] = 70; put(i, 30, 60, 200); }        // bande bleue
      else { lum[i] = 210; put(i, 210, 210, 210); }               // fond blanc
    }
  }
  // glyphes sombres
  for (let gx = 65; gx <= 145; gx += 16) {
    const yTop = 30 + tilt * (gx - 40) / 120;
    for (let y = Math.round(yTop) + 8; y <= Math.round(yTop) + 26; y++)
      for (let x = gx; x < gx + 8; x++) { const i = y * W + x; lum[i] = 40; put(i, 40, 40, 40); }
  }
  return { lum, rgb, W, H };
}

test('plateQuadFromCrop retrouve une plaque droite à ~3 px près', () => {
  const { lum, rgb, W, H } = makeScene(0);
  const seed = { tl: { x: 38, y: 28 }, tr: { x: 162, y: 28 }, br: { x: 162, y: 66 }, bl: { x: 38, y: 66 } };
  const chars = { x1: 60, y1: 36, x2: 150, y2: 58 };
  const q = plateQuadFromCrop(lum, rgb, W, H, seed, chars);
  assert.ok(q, 'extraction échouée');
  assert.ok(Math.abs(q.tl.x - 40) <= 3 && Math.abs(q.tl.y - 30) <= 3, `tl (${q.tl.x.toFixed(1)},${q.tl.y.toFixed(1)})`);
  assert.ok(Math.abs(q.br.x - 160) <= 3 && Math.abs(q.br.y - 64) <= 3, `br (${q.br.x.toFixed(1)},${q.br.y.toFixed(1)})`);
});

test('plateQuadFromCrop retrouve l\'inclinaison d\'une plaque en perspective', () => {
  const { lum, rgb, W, H } = makeScene(-12); // bord haut qui MONTE vers la droite
  const seed = { tl: { x: 38, y: 20 }, tr: { x: 162, y: 20 }, br: { x: 162, y: 66 }, bl: { x: 38, y: 66 } };
  const chars = { x1: 60, y1: 30, x2: 150, y2: 50 };
  const q = plateQuadFromCrop(lum, rgb, W, H, seed, chars);
  assert.ok(q, 'extraction échouée');
  // tl à y≈30, tr à y≈18 : l'inclinaison doit être retrouvée (~12 px)
  const tiltFound = q.tl.y - q.tr.y;
  assert.ok(tiltFound > 7, `inclinaison non retrouvée: tl.y=${q.tl.y.toFixed(1)} tr.y=${q.tr.y.toFixed(1)}`);
});

test('plateQuadFromCrop récupère une graine décalée d\'une hauteur de plaque', () => {
  const { lum, rgb, W, H } = makeScene(0);
  const seed = { tl: { x: 38, y: 62 }, tr: { x: 162, y: 62 }, br: { x: 162, y: 98 }, bl: { x: 38, y: 98 } };
  const chars = { x1: 60, y1: 70, x2: 150, y2: 92 };
  const q = plateQuadFromCrop(lum, rgb, W, H, seed, chars);
  assert.ok(q, 'extraction échouée malgré la plaque présente');
  const cy = (q.tl.y + q.br.y) / 2;
  assert.ok(Math.abs(cy - 47) <= 6, `centre vertical: ${cy.toFixed(1)} (attendu ~47)`);
});

test('plateQuadFromCrop rend null sur un crop sans plaque', () => {
  const W = 200, H = 100;
  const lum = new Float32Array(W * H).fill(115);
  const rgb = new Uint8ClampedArray(W * H * 4).fill(115);
  const seed = { tl: { x: 40, y: 30 }, tr: { x: 160, y: 30 }, br: { x: 160, y: 64 }, bl: { x: 40, y: 64 } };
  assert.equal(plateQuadFromCrop(lum, rgb, W, H, seed, null), null);
});

test('expandQuad dilate autour du centre et contient l\'original', () => {
  const q = { tl: { x: 40, y: 30 }, tr: { x: 160, y: 30 }, br: { x: 160, y: 64 }, bl: { x: 40, y: 64 } };
  const e = expandQuad(q, 1.03, 1.10);
  assert.ok(e.tl.x < 40 && e.tl.y < 30 && e.br.x > 160 && e.br.y > 64);
  for (const k of ['tl', 'tr', 'br', 'bl']) assert.ok(pointInQuad(q[k], e, 0.01), `coin ${k} hors du quad dilaté`);
});

test('snapQuadOutward rend le quad intact s\'il est dégénéré', () => {
  const lum = makePlateLum();
  const quad = {
    tl: { x: 50, y: 30 }, tr: { x: 50.5, y: 30 },
    br: { x: 50.5, y: 30.5 }, bl: { x: 50, y: 30.5 },
  };
  const out = snapQuadOutward(lum, SW, SH, quad, 6);
  assert.deepEqual(out, quad);
});
