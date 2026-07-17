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

// Intersection de deux droites (point + direction).
function intersectLines(p1, d1, p2, d2) {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / det;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
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
