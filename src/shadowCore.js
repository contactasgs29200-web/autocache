// shadowCore.js — génération de l'ombre au sol du mode showroom, en pur
// JavaScript (aucune dépendance navigateur) → testable en isolation.
//
// Modèle « occlusion ambiante » : l'ombre est dérivée colonne par colonne de
// la silhouette réelle du véhicule (canal alpha du détourage), de sorte
// qu'elle épouse les courbes de la carrosserie comme sur la photo d'origine :
//   • sous les pneus : contact au sol → ombre dense et nette ;
//   • entre les roues : le bas de caisse surplombe le sol → zone sombre
//     bornée par la ligne de sol, pénombre plus large ;
//   • sous les porte-à-faux (boucliers) : suspension haute → ombre légère ;
//   • autour de l'empreinte : flaque douce qui s'étale sur le sol (côté
//     caméra et autour des extrémités), comme sous un éclairage diffus.
// L'ombre reste liée à l'empreinte du véhicule (± flaque et flou), sans
// projection cisaillée qui déborde du gabarit.

export const SHADOW_MODEL = {
  alphaThreshold: 0.08,   // seuil d'opacité pour appartenir à la silhouette
  intensityMax: 0.78,     // densité au contact pneu/sol
  underFloor: 0.55,       // part minimale de densité sous caisse (haut suspendu)
  hangFalloffFrac: 0.12,  // décroissance de densité avec la garde au sol (× carH)
  penumbraFrac: 0.040,    // demi-largeur de pénombre sous la ligne de sol (× carH)
  penumbraHangBoost: 1.4, // élargissement de la pénombre quand la caisse est haute
  overlapFrac: 0.012,     // remontée de l'ombre SOUS la carrosserie (× carH, masquée par la voiture)
  blurFrac: 0.006,        // flou de finition (× carW)
  ambientWeight: 0.42,    // halo doux grande échelle (part de la densité)
  ambientBlurMult: 4.0,   // rayon du halo (× flou de finition)
  lateralFeatherFrac: 0.03, // fondu latéral aux extrémités du gabarit (× carW)
  // ── Flaque au sol (réalisme « photo studio ») ──
  // Sur une vraie photo, l'ombre ne s'arrête pas à l'aplomb de la caisse :
  // elle s'étale doucement sur le sol autour de l'empreinte, surtout côté
  // caméra. Sans elle, la voiture semble posée sur une bande grise.
  poolFrac: 0.14,         // profondeur de la flaque sous la ligne de sol (× carH)
  poolIntensity: 0.34,    // densité de la flaque au ras de la ligne de sol
  poolEndWrapFrac: 0.6,   // enveloppement de la flaque autour des extrémités (× poolH)
  // ── Défenses contre les débris de détourage sous la voiture ──
  // Le pixel bas d'une colonne doit appartenir à une masse opaque continue
  // d'au moins 10 % de la hauteur du véhicule : un pneu est connecté à la
  // caisse, un débris (reste d'ombre, poussière) est un îlot fin détaché.
  minThickFrac: 0.10,     // épaisseur opaque minimale d'une colonne du contour (× carH)
  depthOutlierFrac: 0.05, // tolérance sous la ligne des appuis (percentile 90) avant rejet (× carH)
  hangCapFrac: 0.20,      // garde au sol maximale utilisée pour peindre (× carH)
};

// Flou gaussien séparable sur un masque Float32 (bords étirés).
export function gaussianBlurMask(mask, W, H, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const temp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let val = 0;
      for (let j = -r; j <= r; j++) val += mask[y * W + Math.min(W - 1, Math.max(0, x + j))] * k[j + r];
      temp[y * W + x] = val;
    }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let val = 0;
      for (let j = -r; j <= r; j++) val += temp[Math.min(H - 1, Math.max(0, y + j)) * W + x] * k[j + r];
      out[y * W + x] = val;
    }
  return out;
}

// Lissage du contour par moyenne glissante (ignore les colonnes invalides -1).
export function smoothContourMovingAverage(contour, width, windowSize) {
  const out = new Float32Array(width);
  const half = Math.floor(windowSize / 2);
  for (let x = 0; x < width; x++) {
    if (contour[x] < 0) { out[x] = -1; continue; }
    let sum = 0, count = 0;
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      if (nx >= 0 && nx < width && contour[nx] >= 0) { sum += contour[nx]; count++; }
    }
    out[x] = count > 0 ? sum / count : -1;
  }
  return out;
}

// Invalide les colonnes dont la valeur saute brutalement par rapport aux
// voisines (poussières du détourage sous la voiture).
export function filterContourArtifacts(contour, width, maxGap) {
  for (let x = 0; x < width; x++) {
    if (contour[x] < 0) continue;
    let leftY = -1, rightY = -1;
    for (let lx = x - 1; lx >= Math.max(0, x - 5); lx--) {
      if (contour[lx] >= 0) { leftY = contour[lx]; break; }
    }
    for (let rx = x + 1; rx <= Math.min(width - 1, x + 5); rx++) {
      if (contour[rx] >= 0) { rightY = contour[rx]; break; }
    }
    if (leftY >= 0 && Math.abs(contour[x] - leftY) > maxGap) contour[x] = -1;
    else if (rightY >= 0 && Math.abs(contour[x] - rightY) > maxGap) contour[x] = -1;
  }
}

// Contour bas de la silhouette : pour chaque colonne, le pixel opaque le plus
// bas appartenant à une masse d'au moins minThick pixels d'épaisseur — les
// poussières fines du détourage (restes d'ombre, brins d'herbe) sous la
// voiture sont ignorées, sinon elles tirent le contour (donc l'ombre) vers
// le bas. Les colonnes de la plaque (cache posé par-dessus) sont exclues
// puis interpolées entre leurs voisines pour ne pas creuser le contour.
export function computeBottomContour(alpha, W, H, carBounds, plateZone, alphaThreshold = SHADOW_MODEL.alphaThreshold, minThick = 1) {
  const carL = Math.max(0, carBounds.x);
  const carR = Math.min(W - 1, carBounds.x + carBounds.w);
  const contour = new Float32Array(W).fill(-1);
  for (let x = carL; x <= carR; x++) {
    if (plateZone && x >= plateZone.x1 && x <= plateZone.x2) continue;
    let y = H - 1;
    while (y >= 0) {
      if (alpha[y * W + x] > alphaThreshold) {
        let run = 1;
        while (run < minThick && y - run >= 0 && alpha[(y - run) * W + x] > alphaThreshold) run++;
        if (run >= minThick) { contour[x] = y; break; }
        y -= run; // amas trop fin (débris) : continue la recherche au-dessus
      } else y--;
    }
  }
  if (plateZone && plateZone.x1 > carL && plateZone.x2 < carR) {
    const leftY = contour[Math.max(carL, plateZone.x1 - 1)];
    const rightY = contour[Math.min(carR, plateZone.x2 + 1)];
    if (leftY >= 0 && rightY >= 0) {
      for (let x = plateZone.x1; x <= plateZone.x2; x++) {
        const t = (x - plateZone.x1) / (plateZone.x2 - plateZone.x1);
        contour[x] = leftY + (rightY - leftY) * t;
      }
    } else if (leftY >= 0) {
      for (let x = plateZone.x1; x <= plateZone.x2; x++) contour[x] = leftY;
    } else if (rightY >= 0) {
      for (let x = plateZone.x1; x <= plateZone.x2; x++) contour[x] = rightY;
    }
  }
  return contour;
}

// Comble par interpolation linéaire les trous (-1) internes du contour.
export function fillContourGaps(contour, width) {
  let first = -1, last = -1;
  for (let x = 0; x < width; x++) if (contour[x] >= 0) { if (first < 0) first = x; last = x; }
  if (first < 0) return contour;
  let x = first;
  while (x <= last) {
    if (contour[x] >= 0) { x++; continue; }
    const gapStart = x;
    while (x <= last && contour[x] < 0) x++;
    const leftY = contour[gapStart - 1], rightY = contour[x];
    for (let gx = gapStart; gx < x; gx++) {
      const t = (gx - gapStart + 1) / (x - gapStart + 1);
      contour[gx] = leftY + (rightY - leftY) * t;
    }
  }
  return contour;
}

// Rejette les colonnes du contour nettement plus basses que le « niveau
// d'appui » : la profondeur maximale SOUTENUE sur au moins une largeur de
// pneu (érosion morphologique 1D puis maximum). Un pneu est large → il
// soutient sa profondeur ; un débris de détourage (reste d'ombre, poussière)
// est étroit → il ne la soutient pas et se fait rejeter, sinon il
// empoisonne la ligne de sol et l'ombre « coule » loin sous la voiture.
export function rejectDepthOutliers(contour, width, maxBelowRef, supportWidth = 8) {
  let first = -1, last = -1;
  for (let x = 0; x < width; x++) if (contour[x] >= 0) { if (first < 0) first = x; last = x; }
  if (first < 0 || last - first < supportWidth) return contour;
  // Érosion (filtre min glissant) : une colonne invalide casse la fenêtre.
  let supportY = -1;
  for (let x = first; x <= last - supportWidth + 1; x++) {
    let winMin = Infinity;
    for (let dx = 0; dx < supportWidth; dx++) {
      const v = contour[x + dx];
      if (v < 0) { winMin = -1; break; }
      if (v < winMin) winMin = v;
    }
    if (winMin > supportY) supportY = winMin;
  }
  if (supportY < 0) return contour;
  for (let x = 0; x < width; x++) {
    if (contour[x] >= 0 && contour[x] > supportY + maxBelowRef) contour[x] = -1;
  }
  return contour;
}

// Ligne de sol estimée : DROITE INCLINÉE passant par les deux points d'appui
// (un par moitié du gabarit — typiquement roue avant et roue arrière), comme
// le vrai plan du sol vu en perspective. Un cône à pente fixe ne suffit pas :
// sur une vue 3/4 marquée, la roue proche caméra est bien plus basse dans
// l'image que la roue éloignée, et le sol doit « remonter » linéairement de
// l'une à l'autre. Chaque appui = profondeur maximale SOUTENUE sur une
// largeur de pneu (érosion 1D, insensible aux débris étroits). La ligne est
// ensuite plaquée sur le contour là où il descend plus bas (contact exact).
// Garde au sol h(x) = ground(x) − contour(x) ≥ 0.
export function estimateGroundLine(contour, width, supportWidth = 8) {
  const g = new Float32Array(width).fill(-1);
  let first = -1, last = -1;
  for (let x = 0; x < width; x++) if (contour[x] >= 0) { if (first < 0) first = x; last = x; }
  if (first < 0) return g;

  // Appui le plus profond soutenu sur supportWidth colonnes, dans [x1..x2].
  const anchorIn = (x1, x2) => {
    let bestY = -1, bestX = -1;
    for (let x = x1; x <= x2 - supportWidth + 1; x++) {
      let winMin = Infinity;
      for (let dx = 0; dx < supportWidth; dx++) {
        const v = contour[x + dx];
        if (v < 0) { winMin = -1; break; }
        if (v < winMin) winMin = v;
      }
      if (winMin > bestY) { bestY = winMin; bestX = x + (supportWidth >> 1); }
    }
    return bestY >= 0 ? { x: bestX, y: bestY } : null;
  };

  const mid = (first + last) >> 1;
  const a = anchorIn(first, mid);
  const b = anchorIn(mid, last);

  let lineAt;
  if (a && b && (b.x - a.x) > (last - first) * 0.2) {
    const slope = (b.y - a.y) / (b.x - a.x);
    lineAt = (x) => a.y + slope * (x - a.x);
  } else {
    // Appuis dégénérés (vue de face, gabarit étroit) : sol horizontal au
    // niveau de l'appui le plus profond.
    const flat = Math.max(a ? a.y : -1, b ? b.y : -1);
    if (flat < 0) return g;
    lineAt = () => flat;
  }

  for (let x = first; x <= last; x++) {
    const line = lineAt(x);
    // Le sol touche le contour aux contacts (pneus légèrement sous la ligne).
    g[x] = contour[x] >= 0 ? Math.max(line, contour[x]) : line;
  }
  return g;
}

// Masque d'ombre complet (Float32 W×H, valeurs 0..1).
// params : { opacity=1, spread=1, yOffsetPx=0, extraBlurPx=0 } — sémantique
// identique aux réglages debug existants (shadowControls).
export function buildShadowMask(alpha, W, H, carBounds, plateZone, params = {}) {
  const M = SHADOW_MODEL;
  const opacity = params.opacity ?? 1;
  const spread = params.spread ?? 1;
  const yOff = Math.round(params.yOffsetPx ?? 0);
  const extraBlur = params.extraBlurPx ?? 0;

  const carW = Math.max(1, carBounds.w);
  const carH = Math.max(1, carBounds.h);

  const minThick = Math.max(2, Math.round(M.minThickFrac * carH));
  let contour = computeBottomContour(alpha, W, H, carBounds, plateZone, M.alphaThreshold, minThick);
  rejectDepthOutliers(contour, W, Math.max(3, M.depthOutlierFrac * carH), Math.max(8, Math.round(carW * 0.06)));
  contour = smoothContourMovingAverage(contour, W, Math.max(3, Math.round(carW * 0.02)));
  filterContourArtifacts(contour, W, Math.max(4, carH * 0.06));
  fillContourGaps(contour, W);

  let first = -1, last = -1, deepestContour = -1;
  for (let x = 0; x < W; x++) {
    if (contour[x] >= 0) {
      if (first < 0) first = x;
      last = x;
      if (contour[x] > deepestContour) deepestContour = contour[x];
    }
  }
  const mask = new Float32Array(W * H);
  if (first < 0 || last - first < 3) return mask; // silhouette inexploitable

  const ground = estimateGroundLine(contour, W, Math.max(8, Math.round(carW * 0.06)));

  // Hauteur effective recalculée depuis le contour nettoyé : carBounds peut
  // être gonflé par des débris de détourage sous la voiture, ce qui
  // surdimensionnerait pénombre et garde au sol.
  const effH = Math.max(10, deepestContour - carBounds.y);

  const H0 = Math.max(2, M.hangFalloffFrac * effH * spread);
  const penBase = Math.max(1.5, M.penumbraFrac * effH * spread);
  const overlapPx = Math.max(2, Math.round(M.overlapFrac * effH));
  const featherW = Math.max(3, M.lateralFeatherFrac * carW);

  const hangCap = M.hangCapFrac * effH * spread;
  const poolH = Math.max(2, M.poolFrac * effH * spread);
  const poolI = M.poolIntensity;
  for (let x = first; x <= last; x++) {
    const c = contour[x];
    if (c < 0 || ground[x] < 0) continue;
    // Garde au sol plafonnée : si la ligne de sol a malgré tout été tirée
    // vers le bas (débris non filtré), l'ombre reste bornée près de la caisse.
    const hang = Math.min(Math.max(0, ground[x] - c), hangCap);
    const gl = c + hang;
    const hangK = Math.exp(-hang / H0);        // 1 = contact, →0 = suspendu
    // Densité : maximale au contact, plancher sous les zones suspendues
    // (dessous de caisse jamais totalement éclairé).
    const density = M.intensityMax * (M.underFloor + (1 - M.underFloor) * hangK);
    // Pénombre : nette au contact des pneus, diffuse sous la caisse haute.
    const pen = penBase * (1 + M.penumbraHangBoost * (1 - hangK));
    // Fondu latéral en bout de gabarit (coins de boucliers).
    const dEdge = Math.min(x - first, last - x);
    let lateral = 1;
    if (dEdge < featherW) { const t = dEdge / featherW; lateral = t * t * (3 - 2 * t); }

    const yTop = Math.max(0, Math.round(c - overlapPx) + yOff);
    const yGround = gl + yOff;
    const yEnd = Math.min(H - 1, Math.round(yGround + Math.max(pen * 3, poolH * 2.2)));
    for (let y = yTop; y <= yEnd; y++) {
      // Cœur (zone occluse + pénombre) — fondu latéral aux extrémités.
      let vCore;
      if (y <= yGround) {
        vCore = density;                        // zone occluse sous la caisse
      } else {
        const d = (y - yGround) / pen;          // pénombre gaussienne au sol
        vCore = density * Math.exp(-0.5 * d * d);
      }
      vCore *= lateral;
      // Flaque : étalement doux sur le sol autour de l'empreinte — c'est
      // elle qui « ancre » la voiture comme sur une vraie photo studio.
      // PAS de fondu latéral : elle se prolonge au-delà des extrémités
      // (voir enveloppement ci-dessous) sans couture.
      const dp = Math.max(0, y - yGround) / poolH;
      const vPool = poolI * Math.exp(-dp * dp);
      const v = Math.max(vCore, vPool) * opacity;
      const idx = y * W + x;
      if (v > mask[idx]) mask[idx] = v;
    }
  }

  // Enveloppement de la flaque autour des extrémités (avant/arrière) : sur la
  // photo réelle l'ombre déborde légèrement du gabarit au sol, en arrondi,
  // au pied des boucliers — sinon la flaque s'arrête net au premier pixel.
  const wrapW = Math.round(poolH * M.poolEndWrapFrac * 2.5);
  for (const [endX, dir] of [[first, -1], [last, 1]]) {
    const gEnd = ground[endX] + yOff;
    if (gEnd < 0) continue;
    for (let dx = 1; dx <= wrapW; dx++) {
      const x = endX + dir * dx;
      if (x < 0 || x >= W) break;
      const kx = dx / wrapW;
      const yEnd = Math.min(H - 1, Math.round(gEnd + poolH * 2.2));
      for (let y = Math.max(0, Math.round(gEnd - poolH * 0.4)); y <= yEnd; y++) {
        const dp = Math.max(0, y - gEnd) / poolH;
        const v = poolI * Math.exp(-(dp * dp + kx * kx * 3)) * opacity;
        const idx = y * W + x;
        if (v > mask[idx]) mask[idx] = v;
      }
    }
  }

  // Finition : flou fin (anti-aliasing du modèle) + halo ambiant large.
  const sigma = Math.max(1.5, M.blurFrac * carW + extraBlur);
  const base = gaussianBlurMask(mask, W, H, sigma);
  const ambient = gaussianBlurMask(mask, W, H, sigma * M.ambientBlurMult);
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    out[i] = Math.max(base[i], ambient[i] * M.ambientWeight);
  }
  return out;
}
