// plateGeometry.js — petites primitives géométriques pour la plaque, pures
// (aucune dépendance navigateur) → testables en isolation.

// Normalise l'ordre des 4 coins d'un polygone -> TL, TR, BR, BL.
// TL = somme (x+y) min, BR = somme max, TR = différence (x−y) max, BL = min.
export function orderQuad(pts) {
  const bySum  = [...pts].sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const byDiff = [...pts].sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]));
  return [bySum[0], byDiff[byDiff.length - 1], bySum[bySum.length - 1], byDiff[0]];
}

// Aire d'un quadrilatère (formule du lacet / shoelace), valeur absolue.
export function quadArea(poly) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = poly[i], q = poly[(i + 1) % 4];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

// Luminance bilinéaire avec clamp aux bords de l'image.
function lumAt(lum, W, H, x, y) {
  const cx = Math.min(W - 1.001, Math.max(0, x));
  const cy = Math.min(H - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const fx = cx - x0, fy = cy - y0;
  const i = y0 * W + x0;
  return lum[i] * (1 - fx) * (1 - fy) + lum[i + 1] * fx * (1 - fy)
       + lum[i + W] * (1 - fx) * fy + lum[i + W + 1] * fx * fy;
}

// Gradient moyen de luminance perpendiculaire à l'arête (a→b), mesuré sur la
// ligne décalée de d pixels le long de la normale n.
function edgeGradient(lum, W, H, a, b, n, d, samples = 24) {
  let s = 0;
  for (let k = 0; k < samples; k++) {
    const t = (k + 0.5) / samples;
    const px = a.x + (b.x - a.x) * t + n.x * d;
    const py = a.y + (b.y - a.y) * t + n.y * d;
    s += Math.abs(lumAt(lum, W, H, px + n.x, py + n.y) - lumAt(lum, W, H, px - n.x, py - n.y));
  }
  return s / samples;
}

// Un point est-il à l'intérieur d'un quad convexe {tl,tr,br,bl} (repère
// écran, y vers le bas) ? tol > 0 tolère un dépassement de tol pixels.
export function pointInQuad(pt, quad, tol = 0) {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) return false;
    // Parcours TL→TR→BR→BL en y-vers-le-bas : l'intérieur est du côté
    // cross > 0. Distance signée = cross / longueur de l'arête.
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (cross / len < -tol) return false;
  }
  return true;
}

// Le quad couvre-t-il entièrement la boîte {x1,y1,x2,y2} (à tol px près) ?
// Sert d'ancrage : le quad de la plaque doit contenir la bande des
// caractères lus par le modèle, sinon il est décalé.
export function quadCoversBox(quad, box, tol = 0) {
  return [
    { x: box.x1, y: box.y1 }, { x: box.x2, y: box.y1 },
    { x: box.x2, y: box.y2 }, { x: box.x1, y: box.y2 },
  ].every(p => pointInQuad(p, quad, tol));
}

// Quad axe-aligné obtenu en dilatant une boîte autour de son centre
// (kw / kh = facteurs largeur / hauteur). Reconstruction de secours : une
// plaque UE dépasse de sa bande de caractères d'environ ×1.25 en largeur
// (bandes bleues) et ×1.5 en hauteur.
export function quadFromBox(box, kw = 1.25, kh = 1.5) {
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  const hw = (box.x2 - box.x1) / 2 * kw, hh = (box.y2 - box.y1) / 2 * kh;
  return {
    tl: { x: cx - hw, y: cy - hh }, tr: { x: cx + hw, y: cy - hh },
    br: { x: cx + hw, y: cy + hh }, bl: { x: cx - hw, y: cy + hh },
  };
}

// Intersection de deux droites (point + direction).
function intersectLines(p1, d1, p2, d2) {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / det;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

// « Ajuste » chaque bord du quad sur le vrai contour de la plaque en
// autorisant décalage ET INCLINAISON : les deux extrémités de l'arête se
// déplacent indépendamment le long de la normale (d1, d2). Vers l'extérieur
// librement, vers l'intérieur uniquement si la bande de caractères (charsBox)
// reste entièrement couverte — le bord réel de la plaque est forcément entre
// les caractères et la carrosserie. Corrige les quads « aplatis » du modèle
// (rectangle droit renvoyé sur une plaque vue en perspective) et les bords
// qui débordent sur la carrosserie.
export function fitQuadEdges(lum, W, H, quad, charsBox, maxOut = 12, maxIn = 8) {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const boxPts = charsBox ? [
    { x: charsBox.x1, y: charsBox.y1 }, { x: charsBox.x2, y: charsBox.y1 },
    { x: charsBox.x2, y: charsBox.y2 }, { x: charsBox.x1, y: charsBox.y2 },
  ] : null;

  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) return quad;
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    if (n.x * ((a.x + b.x) / 2 - cx) + n.y * ((a.y + b.y) / 2 - cy) < 0) {
      n = { x: -n.x, y: -n.y }; // normale orientée vers l'extérieur
    }
    // Gradient moyen le long de l'arête dont les extrémités sont décalées de
    // d1 (côté a) et d2 (côté b) le long de la normale.
    const grad = (d1, d2) => {
      let s = 0;
      const S = 20;
      for (let k = 0; k < S; k++) {
        const t = (k + 0.5) / S;
        const d = d1 + (d2 - d1) * t;
        const px = a.x + (b.x - a.x) * t + n.x * d;
        const py = a.y + (b.y - a.y) * t + n.y * d;
        s += Math.abs(lumAt(lum, W, H, px + n.x, py + n.y) - lumAt(lum, W, H, px - n.x, py - n.y));
      }
      return s / S;
    };
    // La bande de caractères doit rester du côté intérieur du bord déplacé.
    const keepsChars = (d1, d2) => {
      if (!boxPts) return d1 >= 0 && d2 >= 0; // sans ancre : jamais vers l'intérieur
      const A = { x: a.x + n.x * d1, y: a.y + n.y * d1 };
      const dx = (b.x + n.x * d2) - A.x, dy = (b.y + n.y * d2) - A.y;
      const side = p => dx * (p.y - A.y) - dy * (p.x - A.x);
      const ref = side({ x: cx, y: cy });
      return boxPts.every(p => side(p) * ref > 0);
    };
    const base = grad(0, 0);
    const step = Math.max(1, Math.round((maxOut + maxIn) / 24));
    let best = { d1: 0, d2: 0, s: base };
    for (let d1 = -maxIn; d1 <= maxOut; d1 += step) {
      for (let d2 = -maxIn; d2 <= maxOut; d2 += step) {
        if ((d1 || d2) && keepsChars(d1, d2)) {
          const s = grad(d1, d2);
          if (s > best.s) best = { d1, d2, s };
        }
      }
    }
    if (best.s < base * 1.1) best = { d1: 0, d2: 0 };
    const A = { x: a.x + n.x * best.d1, y: a.y + n.y * best.d1 };
    const B = { x: b.x + n.x * best.d2, y: b.y + n.y * best.d2 };
    const dlen = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    lines.push({ p: A, d: { x: (B.x - A.x) / dlen, y: (B.y - A.y) / dlen } });
  }

  const out = [];
  const lim = (maxOut + maxIn) * 3;
  for (let i = 0; i < 4; i++) {
    const prev = lines[(i + 3) % 4], cur = lines[i];
    const p = intersectLines(prev.p, prev.d, cur.p, cur.d);
    if (!p || Math.hypot(p.x - pts[i].x, p.y - pts[i].y) > lim) return quad;
    out.push(p);
  }
  return { tl: out[0], tr: out[1], br: out[2], bl: out[3] };
}

// « Aimante » chaque bord du quad VERS L'EXTÉRIEUR (0..maxOut px) sur le
// gradient de luminance le plus fort — le vrai bord de la plaque (transition
// plaque claire / carrosserie ou cadre). Jamais vers l'intérieur : le cache ne
// peut que mieux couvrir la plaque, jamais la rogner. Un bord n'est déplacé
// que si un gradient nettement plus franc existe plus loin (sinon les coins
// du modèle sont conservés).
//   lum  : luminance du crop (Float32Array W×H)
//   quad : { tl, tr, br, bl } en PIXELS du crop
export function snapQuadOutward(lum, W, H, quad, maxOut = 6) {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) return quad; // quad dégénéré : intact
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let n = { x: -dir.y, y: dir.x };
    if (n.x * ((a.x + b.x) / 2 - cx) + n.y * ((a.y + b.y) / 2 - cy) < 0) {
      n = { x: -n.x, y: -n.y }; // normale orientée vers l'extérieur
    }
    const base = edgeGradient(lum, W, H, a, b, n, 0);
    let bestD = 0, bestS = base;
    for (let d = 1; d <= maxOut; d++) {
      const s = edgeGradient(lum, W, H, a, b, n, d);
      if (s > bestS) { bestS = s; bestD = d; }
    }
    if (bestS < base * 1.15) bestD = 0; // pas de bord nettement plus franc
    lines.push({ p: { x: a.x + n.x * bestD, y: a.y + n.y * bestD }, d: dir });
  }

  // Nouveaux coins = intersections des arêtes décalées.
  // Coin i = rencontre de l'arête i−1 (qui y arrive) et de l'arête i (qui en part).
  const out = [];
  for (let i = 0; i < 4; i++) {
    const prev = lines[(i + 3) % 4], cur = lines[i];
    const p = intersectLines(prev.p, prev.d, cur.p, cur.d);
    if (!p || Math.hypot(p.x - pts[i].x, p.y - pts[i].y) > maxOut * 3) return quad;
    out.push(p);
  }
  return { tl: out[0], tr: out[1], br: out[2], bl: out[3] };
}
