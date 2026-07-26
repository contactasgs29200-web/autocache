// showroomGeometry.js — géométrie de la ROI de détourage du mode showroom,
// pure (aucune dépendance navigateur) → testable en isolation.
//
// Principe directeur : la ROI n'est qu'une OPTIMISATION DE RÉSOLUTION (donner
// au détourage le plus de pixels possible sur le véhicule). Ce n'est JAMAIS un
// séparateur sémantique. Un rectangle aligné sur les axes ne peut pas séparer
// deux voitures qui se chevauchent — sur un parking, en vue 3/4, la bbox du
// voisin recouvre toujours l'arrière du sujet. Tenter la séparation au
// rectangle ampute la voiture avant même que le détourage ne la voie
// (arrière tranché net à la verticale). L'exclusion des voisins est le travail
// des masques en aval, pas celui du cadre.

// Marges autour de la bbox du véhicule, en fraction de ses dimensions.
// La bbox vient d'un LLM (`/api/detect-vehicles`) : elle est approximative et
// souvent trop courte d'un côté, d'autant plus quand deux véhicules de même
// couleur se chevauchent. Ces marges sont généreuses par construction, et
// rien ne doit les réduire.
export const ROI_MARGINS = { left: 0.30, right: 0.30, top: 0.25, bottom: 0.20 };

// Marges du repli « plaque seule » : sans bbox véhicule on ne sait rien de
// l'empattement, on prend large.
const PLATE_MARGINS = { left: 0.45, right: 0.45, top: 0.58, bottom: 0.18 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ROI normalisée (0-1) autour du véhicule principal.
// `null` → aucun ancrage fiable, l'appelant utilise la photo entière.
export function vehicleROI(mainVehicle, plateBox, margins = ROI_MARGINS) {
  if (mainVehicle?.bbox) {
    const b = mainVehicle.bbox;
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    return {
      x1: clamp01(b.x1 - bw * margins.left),
      y1: clamp01(b.y1 - bh * margins.top),
      x2: clamp01(b.x2 + bw * margins.right),
      y2: clamp01(b.y2 + bh * margins.bottom),
    };
  }
  if (plateBox) {
    const pcx = ((plateBox.x1 ?? 0) + (plateBox.x2 ?? 0)) / 2;
    const pcy = ((plateBox.y1 ?? 0) + (plateBox.y2 ?? 0)) / 2;
    return {
      x1: clamp01(pcx - PLATE_MARGINS.left),
      y1: clamp01(pcy - PLATE_MARGINS.top),
      x2: clamp01(pcx + PLATE_MARGINS.right),
      y2: clamp01(pcy + PLATE_MARGINS.bottom),
    };
  }
  return null;
}

// Bords où la CARROSSERIE OPAQUE touche le cadre : le détourage y est amputé.
//
// `counts` = nombre de pixels opaques relevés dans une bande le long de chaque
// bord du cutout recadré, plus ses dimensions {left,right,top,bottom,W,H}.
//
// Un bord confondu avec le bord de la PHOTO est ignoré : la voiture y est
// réellement coupée par le cadrage du photographe, il n'y a rien à récupérer
// en réélargissant.
export function clippedEdges(counts, roi, { minCount = 8, fraction = 0.01, eps = 1e-3 } = {}) {
  if (!counts) return [];
  const r = roi ?? { x1: 0, y1: 0, x2: 1, y2: 1 };
  const threshold = (len) => Math.max(minCount, Math.round(len * fraction));
  const out = [];
  // Bords verticaux : la bande fait H pixels de haut ; horizontaux : W de large.
  if (counts.left   >= threshold(counts.H) && r.x1 > eps)     out.push('left');
  if (counts.right  >= threshold(counts.H) && r.x2 < 1 - eps) out.push('right');
  if (counts.top    >= threshold(counts.W) && r.y1 > eps)     out.push('top');
  if (counts.bottom >= threshold(counts.W) && r.y2 < 1 - eps) out.push('bottom');
  return out;
}

// ROI réélargie pour rattraper une amputation : chaque bord fautif est
// repoussé de `amount` × la dimension courante de la ROI. Les autres bords ne
// bougent pas — on ne perd pas de résolution là où le détourage allait bien.
export function widenROI(roi, edges, amount = 0.6) {
  const r = { ...(roi ?? { x1: 0, y1: 0, x2: 1, y2: 1 }) };
  const w = r.x2 - r.x1, h = r.y2 - r.y1;
  for (const e of edges) {
    if (e === 'left')   r.x1 = clamp01(r.x1 - w * amount);
    if (e === 'right')  r.x2 = clamp01(r.x2 + w * amount);
    if (e === 'top')    r.y1 = clamp01(r.y1 - h * amount);
    if (e === 'bottom') r.y2 = clamp01(r.y2 + h * amount);
  }
  return r;
}

// Une ROI qui couvre (presque) toute la photo n'apporte plus rien : autant
// détourer la photo entière et éviter un aller-retour de recadrage.
export function isFullFrameROI(roi, { eps = 1e-3 } = {}) {
  if (!roi) return true;
  return roi.x1 <= eps && roi.y1 <= eps && roi.x2 >= 1 - eps && roi.y2 >= 1 - eps;
}
