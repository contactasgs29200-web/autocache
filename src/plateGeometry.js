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
