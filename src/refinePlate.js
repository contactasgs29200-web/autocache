// refinePlate.js — affinage des 4 coins d'une plaque, 100% client, sans dépendance.
//
// Rôle dans AutoCache : la détection (backend YOLO / OpenCV / keypoints) fournit
// une géométrie de plaque. Quand cette géométrie est un simple rectangle droit
// (cas `bbox_stable` ou fallback bbox), un cache axis-aligned déborde sur une
// plaque vue de biais — et si la bbox est trop petite, il la couvre mal. Ce
// module reprend l'ImageData de l'image complète + la boîte approximative et :
//   - SI une vraie inclinaison est détectée → renvoie un quad incliné (mode 'quad')
//   - SINON → renvoie un rectangle droit recalé sur la plaque réelle (mode 'rect')
// La bascule est automatique et basée sur l'inclinaison, jamais l'asymétrie.
//
// Robustesse voitures peu contrastées (plaque blanche / pare-chocs argenté) :
//   - normalisation de contraste (étirement par percentiles) avant Otsu
//   - ROI de recherche généreuse (récupère une bbox trop petite/carrée)
//   - sélection de la composante la plus « plaque » (ratio + remplissage + aire)
//
// Les coins/rect renvoyés sont dans le MÊME repère pixel que l'ImageData fournie.
//
// Entrée :
//   imageData : ImageData de l'image COMPLÈTE (ctx.getImageData(0,0,W,H))
//   box       : { x, y, w, h } boîte approximative de la plaque (px image).
// Sortie :
//   {
//     mode: 'quad' | 'rect',
//     corners: [[x,y],[x,y],[x,y],[x,y]] | null,   // HG, HD, BD, BG (si 'quad')
//     rect: { cx, cy, w, h } | null,                // centre + dims (si 'rect')
//     reliable: boolean,                            // true = plaque réellement localisée
//     metrics: { tiltDeg, ratio, asymPct, fillRatio }
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

// Étirement de contraste par percentiles (2% / 98%). Sépare une plaque claire
// d'un pare-chocs de luminosité voisine (voitures grises/argentées), là où un
// Otsu brut sur l'image d'origine fusionne les deux.
function stretchContrast(gray) {
  const h = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  const total = gray.length;
  let acc = 0, lo = 0, hi = 255;
  const loN = total * 0.02, hiN = total * 0.98;
  for (let t = 0; t < 256; t++) { acc += h[t]; if (acc >= loN) { lo = t; break; } }
  acc = 0;
  for (let t = 255; t >= 0; t--) { acc += h[t]; if (acc >= total - hiN) { hi = t; break; } }
  if (hi - lo < 8) return gray; // contraste déjà nul → on ne force pas
  const out = new Uint8Array(gray.length), scale = 255 / (hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = (gray[i] - lo) * scale;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v | 0;
  }
  return out;
}

const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ANG = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;

// Détecte le quad de la plaque dans la boîte. Renvoie [HG,HD,BD,BG] (px image) ou null.
function detectQuad(imageData, box) {
  const W = imageData.width, H = imageData.height, data = imageData.data;
  // ROI généreuse : padding proportionnel au plus grand côté de la boîte, afin
  // de récupérer la plaque même si la bbox de détection est trop petite/carrée.
  const pad = Math.round(0.35 * Math.max(box.w, box.h));
  const x0 = Math.max(0, Math.round(box.x - pad)), y0 = Math.max(0, Math.round(box.y - pad));
  const x1 = Math.min(W, Math.round(box.x + box.w + pad)), y1 = Math.min(H, Math.round(box.y + box.h + pad));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 6 || rh < 6) return null;

  // niveaux de gris sur la ROI
  const gray0 = new Uint8Array(rw * rh);
  for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
    const si = ((y0 + yy) * W + (x0 + xx)) * 4;
    gray0[yy * rw + xx] = (data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114) | 0;
  }
  const gray = stretchContrast(gray0);
  const thr = otsu(gray);
  const bin = new Uint8Array(rw * rh);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] > thr ? 1 : 0;

  // composantes connexes (4-connexité) ; on garde la plus « plaque » (ratio +
  // remplissage + aire), en ignorant celles qui touchent le bord de la ROI
  // (= arrière-plan / carrosserie qui déborde).
  const lab = new Int32Array(rw * rh);
  const stack = new Int32Array(rw * rh);
  let cur = 0, bestScore = 0, bestQ = null;
  const minArea = 0.015 * rw * rh;
  for (let p = 0; p < bin.length; p++) {
    if (!bin[p] || lab[p]) continue;
    cur++; let sp = 0; stack[sp++] = p; lab[p] = cur; let n = 0;
    let sMin = 1e9, sMax = -1e9, dMin = 1e9, dMax = -1e9, tl = 0, br = 0, tr = 0, bl = 0;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    while (sp) {
      const q = stack[--sp], qx = q % rw, qy = (q / rw) | 0; n++;
      const s = qx + qy, df = qx - qy;
      if (s < sMin) { sMin = s; tl = q; } if (s > sMax) { sMax = s; br = q; }
      if (df > dMax) { dMax = df; tr = q; } if (df < dMin) { dMin = df; bl = q; }
      if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
      if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
      if (qx > 0 && bin[q - 1] && !lab[q - 1]) { lab[q - 1] = cur; stack[sp++] = q - 1; }
      if (qx < rw - 1 && bin[q + 1] && !lab[q + 1]) { lab[q + 1] = cur; stack[sp++] = q + 1; }
      if (qy > 0 && bin[q - rw] && !lab[q - rw]) { lab[q - rw] = cur; stack[sp++] = q - rw; }
      if (qy < rh - 1 && bin[q + rw] && !lab[q + rw]) { lab[q + rw] = cur; stack[sp++] = q + rw; }
    }
    if (n < minArea) continue;
    if (minX <= 1 || minY <= 1 || maxX >= rw - 2 || maxY >= rh - 2) continue; // touche le bord
    const C = q => [(q % rw) + x0, ((q / rw) | 0) + y0];
    const Q = [C(tl), C(tr), C(br), C(bl)];
    const top = D(Q[0], Q[1]), bot = D(Q[2], Q[3]), lft = D(Q[0], Q[3]), rgt = D(Q[1], Q[2]);
    const ratio = ((top + bot) / 2) / Math.max((lft + rgt) / 2, 1);
    // remplissage de la composante dans son propre rectangle englobant
    const extArea = Math.max((maxX - minX) * (maxY - minY), 1);
    const fill = n / extArea;
    const like = Math.exp(-Math.pow((ratio - 4) / 2.5, 2)); // pic vers le ratio plaque réel
    const score = n * like * (0.5 + 0.5 * Math.min(1, fill / 0.6));
    if (score > bestScore) { bestScore = score; bestQ = Q; }
  }
  return bestQ;
}

export function refinePlate(imageData, box) {
  const q = detectQuad(imageData, box);
  const boxArea = Math.max(box.w * box.h, 1);

  // métriques
  let tiltDeg = 0, ratio = 0, asymPct = 0, fillRatio = 0;
  if (q) {
    const top = D(q[0], q[1]), bot = D(q[2], q[3]), left = D(q[0], q[3]), right = D(q[1], q[2]);
    ratio = ((top + bot) / 2) / Math.max((left + right) / 2, 1);
    tiltDeg = (ANG(q[0], q[1]) + ANG(q[3], q[2])) / 2;
    asymPct = Math.abs(left - right) / Math.max(left, right) * 100;
    let a = 0; for (let i = 0; i < 4; i++) { const u = q[i], v = q[(i + 1) % 4]; a += u[0] * v[1] - v[0] * u[1]; }
    fillRatio = Math.abs(a / 2) / boxArea;
  }

  // DÉCISION :
  // - la perspective ne se déclenche que sur une INCLINAISON réelle (≥5°) ;
  //   l'asymétrie seule n'est PAS un déclencheur (plaque de face penchée à tort).
  // - `reliable` indique qu'on a bien localisé une plaque (ratio plausible +
  //   surface suffisante) ; il autorise aussi le recalage du RECTANGLE.
  const reliable = !!q && ratio >= 2.2 && ratio <= 7 && fillRatio >= 0.3;
  const angled = reliable && Math.abs(tiltDeg) >= 5;   // seuil : ~5°

  if (angled) {
    // léger élargissement (~8%) pour bien couvrir la plaque (bandes incluses)
    const cgx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
    const cgy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const corners = q.map(p => [cgx + (p[0] - cgx) * 1.08, cgy + (p[1] - cgy) * 1.08]);
    return { mode: 'quad', corners, rect: null, reliable: true, metrics: { tiltDeg, ratio, asymPct, fillRatio } };
  }

  // sinon : rectangle droit. Si la détection est fiable on recale sur la boîte
  // englobante du quad (corrige une bbox trop petite/décalée) ; sinon on garde
  // la boîte de détection telle quelle.
  let cx, cy, w, h;
  if (reliable) {
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    cx = (minX + maxX) / 2; cy = (minY + maxY) / 2; w = (maxX - minX) * 1.05; h = (maxY - minY) * 1.05;
  } else {
    cx = box.x + box.w / 2; cy = box.y + box.h / 2; w = box.w; h = box.h;
  }
  return { mode: 'rect', corners: null, rect: { cx, cy, w, h }, reliable, metrics: { tiltDeg, ratio, asymPct, fillRatio } };
}
