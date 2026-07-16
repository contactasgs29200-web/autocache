// shadowCore.js — extraction de la VRAIE ombre de la photo d'origine, en pur
// JavaScript (aucune dépendance navigateur) → testable en isolation.
//
// Principe : dans la bande au sol autour du véhicule, l'ombre est simplement
// « ce qui est plus sombre que le sol nu ». On estime la luminosité du sol
// nu par blocs (percentile haut, insensible à l'ombre elle-même), puis la
// densité d'ombre de chaque pixel = son assombrissement relatif par rapport
// à cette référence. Le matte est ensuite nettoyé (bruit, taches non
// rattachées au véhicule) et très légèrement lissé : la forme et le dégradé
// réels de l'ombre sont préservés pour la retranscrire à l'identique dans
// le showroom.

export const EXTRACT_MODEL = {
  blockSize: 32,          // taille des blocs de la grille « sol nu »
  floorPercentile: 0.85,  // percentile de luminance retenu comme sol nu du bloc
  minFloorLum: 15,        // référence sol sous ce niveau → pixel inexploitable
  carDilateRadius: 2,     // dilatation du masque voiture (halo du détourage)
  noiseGate: 0.045,       // assombrissement minimal pour compter comme ombre
  maxAlpha: 0.85,         // densité maximale transcrite
  smoothSigma: 1.6,       // lissage anti-bruit (préserve la forme réelle)
  edgeFadeFrac: 0.12,     // fondu aux bords de la zone analysée (× min(W,H))
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

// Dilatation binaire (élément carré), séparable en deux passes.
export function dilateMask(mask, W, H, radius) {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return Uint8Array.from(mask);
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let dx = -r; dx <= r && !v; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < W && mask[y * W + nx]) v = 1;
      }
      tmp[y * W + x] = v;
    }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let dy = -r; dy <= r && !v; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < H && tmp[ny * W + x]) v = 1;
      }
      out[y * W + x] = v;
    }
  return out;
}

// Luminosité du « sol nu » : grille de blocs, percentile haut des pixels hors
// voiture (le percentile ignore l'ombre, plus sombre que le sol qui l'entoure),
// trous comblés par les voisins, lissage 3×3, ré-échantillonnage bilinéaire.
export function estimateFloorBrightness(lum, isCar, W, H, blockSize = EXTRACT_MODEL.blockSize, percentile = EXTRACT_MODEL.floorPercentile) {
  const BLK = blockSize;
  const gW = Math.ceil(W / BLK), gH = Math.ceil(H / BLK);
  const grid = new Float32Array(gW * gH);

  for (let gy = 0; gy < gH; gy++)
    for (let gx = 0; gx < gW; gx++) {
      const vals = [];
      const x1 = gx * BLK, x2 = Math.min(x1 + BLK, W);
      const y1 = gy * BLK, y2 = Math.min(y1 + BLK, H);
      for (let y = y1; y < y2; y++)
        for (let x = x1; x < x2; x++)
          if (!isCar[y * W + x]) vals.push(lum[y * W + x]);
      vals.sort((a, b) => a - b);
      grid[gy * gW + gx] = vals.length > 2 ? vals[Math.floor(vals.length * percentile)] : -1;
    }

  // Un bloc ENTIÈREMENT dans l'ombre deviendrait sa propre référence (le
  // percentile y renvoie la luminance de l'ombre) et l'ombre disparaîtrait
  // du matte. On invalide donc les blocs nettement plus sombres que le « sol
  // éclairé » de la scène (percentile haut des blocs valides) — ils seront
  // comblés comme les blocs pleine-voiture.
  const valids = [];
  for (let i = 0; i < gW * gH; i++) if (grid[i] >= 0) valids.push(grid[i]);
  let globalRef = 128;
  if (valids.length) {
    valids.sort((a, b) => a - b);
    const litRef = valids[Math.floor((valids.length - 1) * 0.9)];
    globalRef = litRef;
    for (let i = 0; i < gW * gH; i++)
      if (grid[i] >= 0 && grid[i] < litRef * 0.62) grid[i] = -1;
  }

  // Blocs sans sol visible (pleine voiture, aplat d'ombre) : moyenne des
  // voisins valides, sinon référence globale de la scène.
  for (let gy = 0; gy < gH; gy++)
    for (let gx = 0; gx < gW; gx++) {
      if (grid[gy * gW + gx] >= 0) continue;
      let s = 0, c = 0;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const ny = gy + dy, nx = gx + dx;
          if (ny >= 0 && ny < gH && nx >= 0 && nx < gW && grid[ny * gW + nx] >= 0) {
            s += grid[ny * gW + nx]; c++;
          }
        }
      grid[gy * gW + gx] = c > 0 ? s / c : globalRef;
    }

  const sg = new Float32Array(gW * gH);
  for (let gy = 0; gy < gH; gy++)
    for (let gx = 0; gx < gW; gx++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ny = gy + dy, nx = gx + dx;
          if (ny >= 0 && ny < gH && nx >= 0 && nx < gW) { s += grid[ny * gW + nx]; c++; }
        }
      sg[gy * gW + gx] = s / c;
    }

  const result = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const gxf = (x + 0.5) / BLK - 0.5;
      const gyf = (y + 0.5) / BLK - 0.5;
      const gx0 = Math.max(0, Math.floor(gxf));
      const gy0 = Math.max(0, Math.floor(gyf));
      const gx1 = Math.min(gW - 1, gx0 + 1);
      const gy1 = Math.min(gH - 1, gy0 + 1);
      const fx = Math.max(0, Math.min(1, gxf - gx0));
      const fy = Math.max(0, Math.min(1, gyf - gy0));
      result[y * W + x] =
        sg[gy0 * gW + gx0] * (1 - fx) * (1 - fy) +
        sg[gy0 * gW + gx1] * fx * (1 - fy) +
        sg[gy1 * gW + gx0] * (1 - fx) * fy +
        sg[gy1 * gW + gx1] * fx * fy;
    }
  return result;
}

// Ne conserve que l'ombre RATTACHÉE au véhicule : l'ombre de contact touche
// toujours la silhouette, alors qu'un joint de carrelage, une tache d'huile
// ou l'ombre d'une autre voiture n'y sont pas connectés → rejetés. Parcours
// en largeur (8-connexité) depuis les pixels d'ombre adjacents au masque
// voiture. Modifie le matte en place.
export function keepConnectedToCar(matte, carMask, W, H) {
  const keep = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let qHead = 0, qTail = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (matte[i] <= 0) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++)
        for (let dx = -1; dx <= 1 && !touches; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && carMask[ny * W + nx]) touches = true;
        }
      if (touches) { keep[i] = 1; queue[qTail++] = i; }
    }
  while (qHead < qTail) {
    const i = queue[qHead++];
    const y = (i / W) | 0, x = i - y * W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
        const ni = ny * W + nx;
        if (!keep[ni] && matte[ni] > 0) { keep[ni] = 1; queue[qTail++] = ni; }
      }
  }
  for (let i = 0; i < W * H; i++) if (!keep[i]) matte[i] = 0;
  return matte;
}

// Matte d'ombre (Float32 W×H, 0..1) extrait de la bande au sol.
//   lum   : luminance de la photo d'origine (Float32 W×H)
//   isCar : masque binaire du véhicule (Uint8 W×H, issu du détourage)
//   opts  : { opacity=1, extraBlurPx=0, noiseGate, maxAlpha, smoothSigma,
//             carDilateRadius, edgeFadeFrac }
// Retourne { matte, meanAlpha } — meanAlpha = densité moyenne de l'ombre
// conservée sur les pixels sol (mesure d'exploitabilité : ~0 = pas d'ombre
// détectable sur la photo d'origine).
export function computeShadowMatte(lum, isCar, W, H, opts = {}) {
  const M = EXTRACT_MODEL;
  const noiseGate = opts.noiseGate ?? M.noiseGate;
  const maxAlpha = opts.maxAlpha ?? M.maxAlpha;
  const sigma = Math.max(0.8, (opts.smoothSigma ?? M.smoothSigma) + (opts.extraBlurPx ?? 0));
  const opacity = opts.opacity ?? 1;
  const edgeFadeFrac = opts.edgeFadeFrac ?? M.edgeFadeFrac;

  const floorRef = estimateFloorBrightness(lum, isCar, W, H);
  const carEx = dilateMask(isCar, W, H, opts.carDilateRadius ?? M.carDilateRadius);

  const matte = new Float32Array(W * H);
  let validCount = 0;
  for (let i = 0; i < W * H; i++) {
    if (carEx[i] || floorRef[i] < M.minFloorLum) continue;
    validCount++;
    const raw = (floorRef[i] - lum[i]) / floorRef[i];
    if (raw >= noiseGate) matte[i] = Math.min(maxAlpha, raw);
  }

  keepConnectedToCar(matte, carEx, W, H);

  let aSum = 0;
  for (let i = 0; i < W * H; i++) aSum += matte[i];
  const meanAlpha = validCount > 0 ? aSum / validCount : 0;

  const out = gaussianBlurMask(matte, W, H, sigma);

  // Fondu aux bords de la zone : l'ombre réelle peut continuer au-delà du
  // cadre analysé — on la laisse mourir en douceur plutôt que la couper net.
  const fade = edgeFadeFrac * Math.min(W, H);
  if (fade > 0) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.min(x, W - 1 - x, y, H - 1 - y);
        if (d < fade) {
          const t = d / fade;
          out[y * W + x] *= t * t * (3 - 2 * t);
        }
      }
  }
  if (opacity !== 1) for (let i = 0; i < W * H; i++) out[i] *= opacity;
  return { matte: out, meanAlpha };
}
