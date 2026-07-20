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

// ═══════════════════════════════════════════════════════════════════════════
// Extraction du quad plaque par SEGMENTATION (zone claire + bandes bleues).
// Bien plus robuste que l'ajustement bord à bord : retrouve la plaque même
// si le quad du modèle est décalé ou aplati, tant qu'elle est dans le crop.
// Développé et validé sur photos réelles (voir tests).
// ═══════════════════════════════════════════════════════════════════════════

// Extracteur de quad plaque par segmentation : la plaque est la région
// CLAIRE (blanc) + bandes BLEUES (eurobande / vignette dépt) la plus
// cohérente avec le quad-graine (modèle) et la bande de caractères.
// Pur JS, pensé pour être porté tel quel dans src/plateGeometry.js.

// Seuil d'Otsu sur un histogramme de luminance 0-255.
export function otsuThreshold(lum) {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.max(0, Math.min(255, lum[i] | 0))]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 127, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

// Masque « plaque » : pixels clairs OU bleu franc. Le seuil de clarté est
// ANCRÉ sur la luminosité de la plaque elle-même : percentile élevé de la
// zone des caractères (le fond blanc entre les glyphes), moins une marge.
// Bien plus fiable qu'un Otsu global quand la plaque n'occupe qu'une petite
// fraction du crop (sol carrelé et carrosserie claire fusionnent sinon).
export function plateMask(lum, rgb, W, H, anchorBox, fixedT = null, erode = 1) {
  let T;
  if (fixedT) {
    T = fixedT;
  } else if (anchorBox) {
    const vals = [];
    const x1 = Math.max(0, anchorBox.x1 | 0), x2 = Math.min(W - 1, anchorBox.x2 | 0);
    const y1 = Math.max(0, anchorBox.y1 | 0), y2 = Math.min(H - 1, anchorBox.y2 | 0);
    for (let y = y1; y <= y2; y += 2) for (let x = x1; x <= x2; x += 2) vals.push(lum[y * W + x]);
    vals.sort((a, b) => a - b);
    const p70 = vals[Math.floor(vals.length * 0.7)] ?? 170;
    T = Math.max(120, p70 - 22);
  } else {
    T = Math.max(120, Math.min(210, otsuThreshold(lum)));
  }
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (lum[i] >= T) { mask[i] = 1; continue; }
    if (rgb) {
      const r = rgb[i * 4], g = rgb[i * 4 + 1], b = rgb[i * 4 + 2];
      if (b > 60 && b > r + 25 && b > g + 8) mask[i] = 1; // bleu plaque
    }
  }
  // Érosion (1 px par passe) : coupe les ponts fins (jonc chromé, reflet)
  // entre la plaque et d'autres zones claires.
  let cur = mask;
  for (let e = 0; e < erode; e++) {
    const er = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cur[i] && cur[i - 1] && cur[i + 1] && cur[i - W] && cur[i + W]) er[i] = 1;
    }
    cur = er;
  }
  return cur;
}

// Composantes connexes (4-voisinage) sur le masque ; renvoie labels + stats.
export function components(mask, W, H) {
  const labels = new Int32Array(W * H); // 0 = fond
  const stats = [null];
  const qx = new Int32Array(W * H), qy = new Int32Array(W * H);
  let next = 1;
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const si = sy * W + sx;
    if (!mask[si] || labels[si]) continue;
    const id = next++;
    let head = 0, tail = 0;
    qx[tail] = sx; qy[tail] = sy; tail++;
    labels[si] = id;
    let area = 0, minX = sx, maxX = sx, minY = sy, maxY = sy, cx = 0, cy = 0;
    while (head < tail) {
      const x = qx[head], y = qy[head]; head++;
      area++; cx += x; cy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[y * W + x - 1] && !labels[y * W + x - 1]) { labels[y * W + x - 1] = id; qx[tail] = x - 1; qy[tail] = y; tail++; }
      if (x < W - 1 && mask[y * W + x + 1] && !labels[y * W + x + 1]) { labels[y * W + x + 1] = id; qx[tail] = x + 1; qy[tail] = y; tail++; }
      if (y > 0 && mask[(y - 1) * W + x] && !labels[(y - 1) * W + x]) { labels[(y - 1) * W + x] = id; qx[tail] = x; qy[tail] = y - 1; tail++; }
      if (y < H - 1 && mask[(y + 1) * W + x] && !labels[(y + 1) * W + x]) { labels[(y + 1) * W + x] = id; qx[tail] = x; qy[tail] = y + 1; tail++; }
    }
    stats.push({ id, area, minX, maxX, minY, maxY, cx: cx / area, cy: cy / area });
  }
  return { labels, stats };
}

// Enveloppe convexe (Andrew monotone chain) d'un nuage de points [[x,y],…].
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length <= 2) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Quad à partir d'une composante : contour → hull → axes PCA → 4 coins =
// extrêmes (±u ±v), puis ajustement fin de chaque bord par moindres carrés
// sur les points du hull proches de ce bord.
export function quadFromComponent(labels, id, W, H) {
  // Points de contour de la composante (bord du masque).
  const pts = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (labels[y * W + x] !== id) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
        labels[y * W + x - 1] !== id || labels[y * W + x + 1] !== id ||
        labels[(y - 1) * W + x] !== id || labels[(y + 1) * W + x] !== id) {
      pts.push([x, y]);
    }
  }
  if (pts.length < 8) return null;
  const hull = convexHull(pts);
  if (hull.length < 4) return null;

  // Axes principaux (PCA 2x2).
  let mx = 0, my = 0;
  for (const [x, y] of hull) { mx += x; my += y; }
  mx /= hull.length; my /= hull.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of hull) {
    const dx = x - mx, dy = y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
  let ux = sxy, uy = l1 - sxx;
  let un = Math.hypot(ux, uy);
  if (un < 1e-6) {
    // Cas dégénéré (rectangle aligné aux axes : sxy = 0) : axe long = axe
    // dominant du nuage.
    ux = sxx >= syy ? 1 : 0; uy = sxx >= syy ? 0 : 1; un = 1;
  }
  ux /= un; uy /= un;                                        // axe long
  if (ux < 0) { ux = -ux; uy = -uy; }                        // u ≈ +x écran
  let vx = -uy, vy = ux;                                     // axe court
  if (vy < 0) { vx = -vx; vy = -vy; }                        // v ≈ +y écran

  // Points du hull projetés dans le repère (u = axe long, v = axe court).
  const proj = hull.map(([x, y]) => ({ x, y, u: (x - mx) * ux + (y - my) * uy, v: (x - mx) * vx + (y - my) * vy }));
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of proj) {
    if (p.u < uMin) uMin = p.u; if (p.u > uMax) uMax = p.u;
    if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v;
  }
  const uSpan = uMax - uMin || 1, vSpan = vMax - vMin || 1;

  // Chaque bord = droite ajustée (PCA 1D) sur la BANDE de points du hull
  // proche de ce côté — indépendant de coins initiaux, robuste aux coins
  // rongés par une ombre (le reste de la bande porte la droite).
  const fitBand = (sel, fallbackDir) => {
    if (sel.length === 0) return null;
    if (sel.length < 3) {
      // Hull très épuré (rectangle net) : droite passant par la moyenne des
      // points de la bande, orientée selon l'axe attendu.
      let mx2 = 0, my2 = 0;
      for (const p of sel) { mx2 += p.x; my2 += p.y; }
      return { p: { x: mx2 / sel.length, y: my2 / sel.length }, d: fallbackDir };
    }
    let m2x = 0, m2y = 0;
    for (const p of sel) { m2x += p.x; m2y += p.y; }
    m2x /= sel.length; m2y /= sel.length;
    let a2 = 0, b2 = 0, c2 = 0;
    for (const p of sel) {
      const ddx = p.x - m2x, ddy = p.y - m2y;
      a2 += ddx * ddx; b2 += ddx * ddy; c2 += ddy * ddy;
    }
    const tr_ = a2 + c2, det_ = a2 * c2 - b2 * b2;
    const lam = tr_ / 2 + Math.sqrt(Math.max(0, tr_ * tr_ / 4 - det_));
    let ex = b2, ey = lam - a2;
    const en = Math.hypot(ex, ey);
    if (en < 1e-6) return { p: { x: m2x, y: m2y }, d: fallbackDir };
    // Garde-fou : la droite d'un bord haut/bas doit rester proche de l'axe
    // long (et gauche/droit de l'axe court) — sinon la bande a capté un coin.
    const d = { x: ex / en, y: ey / en };
    if (Math.abs(d.x * fallbackDir.x + d.y * fallbackDir.y) < 0.8) return { p: { x: m2x, y: m2y }, d: fallbackDir };
    return { p: { x: m2x, y: m2y }, d };
  };
  const U = { x: ux, y: uy }, V = { x: vx, y: vy };
  const top    = fitBand(proj.filter(p => p.v <= vMin + vSpan * 0.25), U);
  const bottom = fitBand(proj.filter(p => p.v >= vMax - vSpan * 0.25), U);
  const left   = fitBand(proj.filter(p => p.u <= uMin + uSpan * 0.10), V);
  const right  = fitBand(proj.filter(p => p.u >= uMax - uSpan * 0.10), V);
  if (!top || !bottom || !left || !right) return null;
  const inter = (L1, L2) => {
    const dt = L1.d.x * L2.d.y - L1.d.y * L2.d.x;
    if (Math.abs(dt) < 1e-9) return null;
    const t = ((L2.p.x - L1.p.x) * L2.d.y - (L2.p.y - L1.p.y) * L2.d.x) / dt;
    return { x: L1.p.x + L1.d.x * t, y: L1.p.y + L1.d.y * t };
  };
  const qtl = inter(top, left), qtr = inter(top, right), qbr = inter(bottom, right), qbl = inter(bottom, left);
  if (!qtl || !qtr || !qbr || !qbl) return null;
  return { tl: qtl, tr: qtr, br: qbr, bl: qbl };
}


// Extraction complète : masque → composantes → choix de la meilleure
// candidate (géométrie plaque + cohérence avec graine/chars) → quad.
// Renvoie null si aucune candidate plausible (l'appelant garde son quad).
export function plateQuadFromCrop(lum, rgb, W, H, seedQuad, charsBox) {
  const seedBBox = seedQuad ? {
    x1: Math.min(seedQuad.tl.x, seedQuad.bl.x), y1: Math.min(seedQuad.tl.y, seedQuad.tr.y),
    x2: Math.max(seedQuad.tr.x, seedQuad.br.x), y2: Math.max(seedQuad.bl.y, seedQuad.br.y),
  } : null;
  // Cascade : seuil ancré sur la zone de texte, puis seuils fixes de secours
  // (utile quand la graine est décalée et que l'ancre tombe sur la carrosserie).
  const attempts = [
    { anchor: charsBox ?? seedBBox, fixedT: null, erode: 1 },
    { anchor: null, fixedT: 175, erode: 2 },
    { anchor: null, fixedT: 150, erode: 3 },
  ];
  for (const at of attempts) {
    const q = plateQuadAttempt(lum, rgb, W, H, seedQuad, charsBox, seedBBox, at.anchor, at.fixedT, at.erode);
    if (q) return q;
  }
  return null;
}

function plateQuadAttempt(lum, rgb, W, H, seedQuad, charsBox, seedBBox, anchorBox, fixedT, erode = 1) {
  const mask = plateMask(lum, rgb, W, H, anchorBox, fixedT, erode);
  const { labels, stats } = components(mask, W, H);
  const seedC = seedQuad
    ? { x: (seedQuad.tl.x + seedQuad.tr.x + seedQuad.br.x + seedQuad.bl.x) / 4,
        y: (seedQuad.tl.y + seedQuad.tr.y + seedQuad.br.y + seedQuad.bl.y) / 4 }
    : { x: W / 2, y: H / 2 };
  const charsC = charsBox ? { x: (charsBox.x1 + charsBox.x2) / 2, y: (charsBox.y1 + charsBox.y2) / 2 } : null;
  const charsArea = charsBox ? Math.max(1, (charsBox.x2 - charsBox.x1) * (charsBox.y2 - charsBox.y1)) : null;

  let best = null, bestScore = -Infinity;
  for (let i = 1; i < stats.length; i++) {
    const s = stats[i];
    const bw = s.maxX - s.minX + 1, bh = s.maxY - s.minY + 1;
    if (s.area < W * H * 0.002 || s.area > W * H * 0.5) continue;   // trop petit / trop grand
    if (bw / bh < 1.3 || bw / bh > 14) continue;                      // pas une bande
    // Remplissage : les glyphes/vignettes trouent la plaque (~35-45 % pleins
    // après érosion) ; en dessous de 0,32 c'est du bruit épars.
    if (s.area / (bw * bh) < 0.32) continue;
    if (bw < W * 0.12) continue;                                      // trop étroit
    if (seedBBox && bw > (seedBBox.x2 - seedBBox.x1) * 1.8) continue; // bien plus large que la graine : fusion
    if (charsArea && (s.area < charsArea * 0.5 || s.area > charsArea * 8)) continue;
    // Score : proximité de la graine + contenir le centre des chars + taille.
    const d = Math.hypot(s.cx - seedC.x, s.cy - seedC.y) / Math.max(W, H);
    let score = -d * 3 + Math.min(1, s.area / (W * H * 0.05));
    if (charsC && s.minX <= charsC.x && charsC.x <= s.maxX && s.minY <= charsC.y && charsC.y <= s.maxY) score += 2;
    if (plateQuadFromCrop.debug) plateQuadFromCrop.debug.push({ id: s.id, bbox: `${bw}x${bh}@(${s.minX},${s.minY})`, score: score.toFixed(2) });
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best) return null;
  if (plateQuadFromCrop.debug) plateQuadFromCrop.debug.push({ chosen: best.id });
  const quad = quadFromComponent(labels, best.id, W, H);
  if (!quad) return null;
  // Sanity : proportions de plaque + chars couvert (si fourni).
  const w = (Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y) + Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y)) / 2;
  const h = (Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y) + Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y)) / 2;
  if (h < 4 || w / h < 1.3 || w / h > 12) return null;
  // Cohérence : le quad contient le texte lu, OU (graine décalée) reste à
  // portée de la graine — jamais un objet à l'autre bout du crop.
  const qc = { x: (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4, y: (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4 };
  const seedH = seedBBox ? (seedBBox.y2 - seedBBox.y1) : h;
  const okChars = charsC && pointInQuad(charsC, quad, 2);
  // Graine décalée tolérée jusqu'à ~1,3 hauteur de plaque — au-delà c'est un
  // autre objet (reflet, sol) et on laisse la cascade continuer.
  const okSeed = Math.hypot(qc.x - seedC.x, qc.y - seedC.y) <= Math.max(seedH, h) * 1.3;
  if (!okChars && !okSeed) return null;
  return quad;
}

// Dilate un quad autour de son centre (marge de sécurité du cache : couvre
// bord à bord même si l'extraction est au pixel près).
export function expandQuad(quad, kx = 1.03, ky = 1.08) {
  const cx = (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4;
  const cy = (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4;
  const m = p => ({ x: cx + (p.x - cx) * kx, y: cy + (p.y - cy) * ky });
  return { tl: m(quad.tl), tr: m(quad.tr), br: m(quad.br), bl: m(quad.bl) };
}
