// refinePlate.js — affinage des coins d'une plaque, 100% client, sans dépendance.
//
// Rôle dans AutoCache : la détection (YOLO / bbox) fournit une boîte approximative
// de la plaque. Sur une plaque vue de biais, un cache axis-aligned ne suit pas
// l'angle. Ce module estime l'inclinaison réelle de la plaque et, si elle est
// significative, renvoie un quad incliné ; sinon un rectangle droit.
//
// MÉTHODE (robuste, indépendante de la couleur de la voiture) :
//   Le TEXTE de la plaque est toujours sombre sur fond clair, quelle que soit la
//   carrosserie (blanche, grise, argentée...). On binarise (Otsu), on prend les
//   pixels sombres (texte + bandes), et on calcule leurs MOMENTS d'image :
//   l'axe principal du nuage de texte donne l'inclinaison de la plaque.
//   À partir de cet angle + la boîte (= AABB de la plaque), on reconstruit le
//   rectangle incliné inscrit. Pas de composantes connexes, pas de rejet de
//   bord — ce qui faisait échouer l'ancienne version sur boîte serrée.
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
//     reliable: boolean,                            // true = plaque localisée
//     metrics: { tiltDeg, ratio, asymPct, fillRatio, elongation, darkFrac }
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

// Analyse les pixels sombres (texte) de la plaque dans la boîte.
// Renvoie { theta, cx, cy, elongation, darkFrac, n, x0, y0, rw, rh } ou null.
function analyzeInk(imageData, box) {
  const W = imageData.width, H = imageData.height, data = imageData.data;
  // Petite marge pour ne pas couper le texte si la boîte est légèrement serrée.
  const pad = Math.round(0.08 * Math.max(box.w, box.h));
  const x0 = Math.max(0, Math.round(box.x - pad)), y0 = Math.max(0, Math.round(box.y - pad));
  const x1 = Math.min(W, Math.round(box.x + box.w + pad)), y1 = Math.min(H, Math.round(box.y + box.h + pad));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 8 || rh < 8) return null;

  const gray = new Uint8Array(rw * rh);
  for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
    const si = ((y0 + yy) * W + (x0 + xx)) * 4;
    gray[yy * rw + xx] = (data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114) | 0;
  }
  const thr = otsu(gray);

  // Composantes connexes des pixels SOMBRES (4-connexité). On distingue le TEXTE
  // (petites composantes : caractères, traits) des grosses zones sombres pleines
  // (renfoncement de pare-chocs, ombre, calandre, bandes) qui fausseraient l'angle.
  // Seules les composantes « texte » (aire <= maxTextArea) alimentent les moments.
  const lab = new Int32Array(rw * rh);  // 0 = clair / non visité
  const stack = new Int32Array(rw * rh);
  const compArea = [0];
  let cur = 0;
  const maxTextArea = 0.07 * box.w * box.h;
  for (let p = 0; p < gray.length; p++) {
    if (gray[p] > thr || lab[p]) continue; // sombre & non labellisé
    cur++; let sp = 0; stack[sp++] = p; lab[p] = cur; let area = 0;
    while (sp) {
      const q = stack[--sp], qx = q % rw, qy = (q / rw) | 0; area++;
      if (qx > 0 && gray[q - 1] <= thr && !lab[q - 1]) { lab[q - 1] = cur; stack[sp++] = q - 1; }
      if (qx < rw - 1 && gray[q + 1] <= thr && !lab[q + 1]) { lab[q + 1] = cur; stack[sp++] = q + 1; }
      if (qy > 0 && gray[q - rw] <= thr && !lab[q - rw]) { lab[q - rw] = cur; stack[sp++] = q - rw; }
      if (qy < rh - 1 && gray[q + rw] <= thr && !lab[q + rw]) { lab[q + rw] = cur; stack[sp++] = q + rw; }
    }
    compArea[cur] = area;
  }

  // Moments des pixels de TEXTE, en coordonnées globales.
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
    const L = lab[yy * rw + xx];
    if (!L || compArea[L] > maxTextArea) continue; // ni clair, ni grosse zone sombre
    const gx = x0 + xx, gy = y0 + yy;
    n++; sx += gx; sy += gy; sxx += gx * gx; syy += gy * gy; sxy += gx * gy;
  }
  const darkFrac = n / (rw * rh);
  if (n < 12) return null;

  const cx = sx / n, cy = sy / n;
  const cxx = sxx / n - cx * cx, cyy = syy / n - cy * cy, cxy = sxy / n - cx * cy;
  // Angle de l'axe principal (orientation du nuage de texte).
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  // Valeurs propres → élongation (le texte d'une plaque est large, pas rond).
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const elongation = l1 / Math.max(l2, 1e-6);

  return { theta, cx, cy, elongation, darkFrac, n };
}

// Reconstruit le rectangle incliné de la plaque inscrit dans la boîte (AABB),
// à partir de l'angle theta. Renvoie les coins [HG,HD,BD,BG] px.
function plateQuadFromTilt(box, theta, cxIn, cyIn, expand) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const cos2 = c * c - s * s; // cos(2θ)
  let pw, ph;
  if (Math.abs(cos2) > 0.15) {
    // W = pw·|c| + ph·|s| ; H = pw·|s| + ph·|c|  →  inversion
    const ac = Math.abs(c), as = Math.abs(s);
    pw = (box.w * ac - box.h * as) / cos2;
    ph = (box.h * ac - box.w * as) / cos2;
  } else { pw = box.w; ph = box.h; }
  if (!(pw > 0) || !(ph > 0)) { pw = box.w; ph = box.h; }
  const hw = (pw / 2) * expand, hh = (ph / 2) * expand;
  const cx = cxIn, cy = cyIn;
  const rot = (dx, dy) => [cx + dx * c - dy * s, cy + dx * s + dy * c];
  return { corners: [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)], pw, ph, cx, cy };
}

export function refinePlate(imageData, box) {
  const ink = analyzeInk(imageData, box);

  let tiltDeg = 0, ratio = 0, elongation = 0, darkFrac = 0;
  const blank = { mode: 'rect', corners: null, reliable: false,
    rect: { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w: box.w, h: box.h },
    metrics: { tiltDeg: 0, ratio: 0, asymPct: 0, fillRatio: 0, elongation: 0, darkFrac: 0 } };

  if (!ink) return blank;
  elongation = ink.elongation;
  darkFrac = ink.darkFrac;
  tiltDeg = ink.theta * 180 / Math.PI;
  // Normalise dans [-90, 90] (atan2/2 le garantit déjà), puis on ne traite que
  // des inclinaisons plausibles de plaque (texte horizontal).
  if (tiltDeg > 90) tiltDeg -= 180; else if (tiltDeg < -90) tiltDeg += 180;

  // Fiabilité : nuage de texte large (élongation), proportion de sombre
  // raisonnable (sinon : pas de plaque claire, ou boîte sur zone sombre), et
  // inclinaison dans une plage exploitable.
  const reliable =
    elongation >= 1.8 &&
    darkFrac >= 0.02 && darkFrac <= 0.75 &&
    Math.abs(tiltDeg) <= 35;

  if (!reliable) {
    return { ...blank, metrics: { tiltDeg, ratio: 0, asymPct: 0, fillRatio: 0, elongation, darkFrac } };
  }

  const angled = Math.abs(tiltDeg) >= 5;
  const q = plateQuadFromTilt(box, ink.theta, ink.cx, ink.cy, angled ? 1.08 : 1.05);
  ratio = q.pw / Math.max(q.ph, 1e-6);

  const metrics = { tiltDeg, ratio, asymPct: 0, fillRatio: darkFrac, elongation, darkFrac };

  if (angled) {
    return { mode: 'quad', corners: q.corners, rect: null, reliable: true, metrics };
  }
  // Plaque de face : rectangle droit recalé sur la plaque mesurée.
  return {
    mode: 'rect', corners: null, reliable: true,
    rect: { cx: q.cx, cy: q.cy, w: q.pw * 1.05, h: q.ph * 1.05 },
    metrics,
  };
}
