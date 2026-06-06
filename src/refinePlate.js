// refinePlate.js — affinage des coins d'une plaque, 100% client, sans dépendance.
//
// Approche : RECTANGLE PIVOTÉ (pas un quad libre à 4 coins indépendants).
//   - angle calculé par les MOMENTS de l'image (tous les pixels de la composante
//     → robuste), pas par 2 points extrêmes ;
//   - côtés opposés parallèles et égaux par construction → ne peut pas partir
//     en vrille sur une plaque sombre/sale/avec sticker ;
//   - décision sur l'ANGLE uniquement (asymPct n'est plus un déclencheur).
//
// Entrée :
//   imageData : ImageData de l'image COMPLÈTE (ctx.getImageData(0,0,W,H))
//   box       : { x, y, w, h } boîte approximative (px image native), de la
//               détection (YOLO / Plate Recognizer).
// Sortie :
//   {
//     mode: 'quad' | 'rect',
//     corners: [[x,y],[x,y],[x,y],[x,y]] | null,   // HG, HD, BD, BG (si 'quad')
//     rect: { cx, cy, w, h } | null,                // (si 'rect')
//     metrics: { tiltDeg, ratio, fillRatio }
//   }

function otsu(gray) {
  const h = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * h[t];
  let wB = 0, sumB = 0, best = -1, thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += h[t]; if (!wB) continue;
    const wF = gray.length - wB; if (!wF) break;
    sumB += t * h[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

// Détecte un RECTANGLE PIVOTÉ ajusté à la plaque. Renvoie {corners:[TL,TR,BR,BL], thetaDeg} ou null.
function detectPlateRect(imageData, box) {
  const W = imageData.width, H = imageData.height, data = imageData.data;
  const pad = Math.round(0.18 * box.h);
  const x0 = Math.max(0, Math.round(box.x - pad)), y0 = Math.max(0, Math.round(box.y - pad));
  const x1 = Math.min(W, Math.round(box.x + box.w + pad)), y1 = Math.min(H, Math.round(box.y + box.h + pad));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 6 || rh < 6) return null;

  const gray = new Uint8Array(rw * rh);
  for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
    const si = ((y0 + yy) * W + (x0 + xx)) * 4;
    gray[yy * rw + xx] = (data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114) | 0;
  }
  const thr = otsu(gray);
  const bin = new Uint8Array(rw * rh);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] > thr ? 1 : 0;

  // composantes connexes ; on garde la plus "plaque" (aire x proximité du ratio 4),
  // en ignorant celles qui touchent le bord. On accumule les sommes pour les moments.
  const lab = new Int32Array(rw * rh);
  const stack = new Int32Array(rw * rh);
  let cur = 0, bestScore = 0, bestLabel = 0, bestStats = null;
  const minArea = 0.03 * rw * rh;
  for (let p = 0; p < bin.length; p++) {
    if (!bin[p] || lab[p]) continue;
    cur++; let sp = 0; stack[sp++] = p; lab[p] = cur;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    while (sp) {
      const q = stack[--sp], qx = q % rw, qy = (q / rw) | 0;
      n++; sx += qx; sy += qy; sxx += qx * qx; syy += qy * qy; sxy += qx * qy;
      if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
      if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
      if (qx > 0 && bin[q - 1] && !lab[q - 1]) { lab[q - 1] = cur; stack[sp++] = q - 1; }
      if (qx < rw - 1 && bin[q + 1] && !lab[q + 1]) { lab[q + 1] = cur; stack[sp++] = q + 1; }
      if (qy > 0 && bin[q - rw] && !lab[q - rw]) { lab[q - rw] = cur; stack[sp++] = q - rw; }
      if (qy < rh - 1 && bin[q + rw] && !lab[q + rw]) { lab[q + rw] = cur; stack[sp++] = q + rw; }
    }
    if (n < minArea) continue;
    if (minX <= 1 || minY <= 1 || maxX >= rw - 2 || maxY >= rh - 2) continue;
    const ratio = (maxX - minX) / Math.max(maxY - minY, 1);
    const like = Math.exp(-Math.pow((ratio - 4) / 2.5, 2));
    const score = n * like;
    if (score > bestScore) { bestScore = score; bestLabel = cur; bestStats = { n, sx, sy, sxx, syy, sxy }; }
  }
  if (!bestLabel) return null;

  // ANGLE par moments centraux (robuste, tous les pixels)
  const { n, sx, sy, sxx, syy, sxy } = bestStats;
  const cx = sx / n, cy = sy / n;
  const mu20 = sxx / n - cx * cx, mu02 = syy / n - cy * cy, mu11 = sxy / n - cx * cy;
  const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
  const c = Math.cos(theta), s = Math.sin(theta);

  // étendue projetée sur les axes pivotés -> dimensions du rectangle
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
    if (lab[yy * rw + xx] !== bestLabel) continue;
    const u = (xx - cx) * c + (yy - cy) * s, v = -(xx - cx) * s + (yy - cy) * c;
    if (u < umin) umin = u; if (u > umax) umax = u;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  const toImg = (uu, vv) => [cx + uu * c - vv * s + x0, cy + uu * s + vv * c + y0];
  const corners = [toImg(umin, vmin), toImg(umax, vmin), toImg(umax, vmax), toImg(umin, vmax)]; // TL,TR,BR,BL
  return { corners, thetaDeg: theta * 180 / Math.PI };
}

export function refinePlate(imageData, box) {
  const det = detectPlateRect(imageData, box);
  const boxArea = Math.max(box.w * box.h, 1);
  let tiltDeg = 0, ratio = 0, fillRatio = 0, corners = null;
  if (det) {
    corners = det.corners; tiltDeg = det.thetaDeg;
    const top = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]);
    const left = Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1]);
    ratio = top / Math.max(left, 1);
    let a = 0; for (let i = 0; i < 4; i++) { const u = corners[i], v = corners[(i + 1) % 4]; a += u[0] * v[1] - v[0] * u[1]; }
    fillRatio = Math.abs(a / 2) / boxArea;
  }
  // Perspective seulement si la détection est NETTE et FRANCHEMENT inclinée.
  // La détection d'angle par contraste est peu fiable sur plaques sombres :
  // garde-fou strict → en cas de doute, cache DROIT (fiable) par défaut.
  const reliable = !!corners
    && fillRatio >= 0.45
    && ratio >= 3.0 && ratio <= 6.0   // une vraie plaque ; rejette les ratio ~2.7 (zone fausse)
    && Math.abs(tiltDeg) <= 35;        // au-delà, c'est forcément une erreur de détection
  const angled = reliable && Math.abs(tiltDeg) >= 8;  // angle franc requis

  if (angled) {
    const cgx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    const cgy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
    const C = corners.map(p => [cgx + (p[0] - cgx) * 1.08, cgy + (p[1] - cgy) * 1.08]); // marge couverture
    return { mode: 'quad', corners: C, rect: null, reliable: true, metrics: { tiltDeg, ratio, fillRatio } };
  }
  let cx, cy, w, h;
  if (reliable) {
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const mnx = Math.min(...xs), mxx = Math.max(...xs), mny = Math.min(...ys), mxy = Math.max(...ys);
    cx = (mnx + mxx) / 2; cy = (mny + mxy) / 2; w = (mxx - mnx) * 1.04; h = (mxy - mny) * 1.04;
  } else { cx = box.x + box.w / 2; cy = box.y + box.h / 2; w = box.w; h = box.h; }
  return { mode: 'rect', corners: null, rect: { cx, cy, w, h }, reliable: !!reliable, metrics: { tiltDeg, ratio, fillRatio } };
}
