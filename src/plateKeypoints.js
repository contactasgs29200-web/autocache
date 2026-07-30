// src/plateKeypoints.js
// Détection des 4 coins de plaque par modèle maison YOLOv8-pose, exécuté
// DANS LE NAVIGATEUR via onnxruntime-web (aucun coût par photo, aucun serveur).
//
// Le modèle est entraîné sur les photos réelles de la concession et exporté
// en ONNX (entrée 1×3×640×640, sortie 1×17×8400 = 4 boîte + 1 confiance +
// 4 keypoints × 3). Les 4 keypoints sont, dans l'ordre d'annotation :
//   index 0 = tl (haut-gauche), 1 = tr (haut-droite),
//   index 2 = br (bas-droite),  3 = bl (bas-gauche).
//
// Contrat de sortie identique aux autres détecteurs de plaque
// (detectPlatePlateRecognizer / detectPlateFable) pour s'insérer sans friction
// dans detectPlate() :
//   { found:true, conf, bbox:{x1,y1,x2,y2}, corners:[{x,y}×4], source:'keypoints' }
//   ou null (modèle indisponible, erreur, ou aucune plaque fiable → la chaîne
//   de secours Plate Recognizer/Claude prend le relais).
//
// Drapeaux d'URL, pour comparer deux rendus sur les mêmes photos :
//   ?keypoints=off  désactive ce détecteur (chaîne de secours seule)
//   ?letterbox=on   ancien prétraitement letterbox au lieu de l'étirement
//   ?zoom=on        active la 2e passe sur recadrage (désactivée par défaut)

import { freeCanvas, releaseImg, openPhoto } from './imageMemory.js';

const MODEL_URL = '/models/plate-keypoints.onnx';
const IMGSZ = 640;
const CONF_THRESHOLD = 0.30;

// ── Double passe (zoom) ──────────────────────────────────────────────────
// Sur une photo de 4000 px ramenée à 640, la plaque ne fait plus que
// ~110 px de large et ~25 px de haut : le modèle place ses 4 coins sur cette
// vignette, et chaque pixel d'imprécision est RE-MULTIPLIÉ par ~6 au retour
// dans la photo d'origine. D'où un cache légèrement décalé ou penché.
//
// Parade : une 2e inférence du MÊME modèle sur un recadrage plein format
// autour de la plaque trouvée en passe 1. La plaque y occupe ~40 % du cadre
// au lieu de ~18 % → 2 à 3 fois plus de pixels pour poser les mêmes points.
// Les coordonnées renvoyées ne sont jamais retouchées : on change ce qu'on
// DONNE au modèle, pas ce qu'il RÉPOND.
//
// Réglage : le modèle n'ayant été entraîné QUE sur des voitures entières, un
// recadrage trop serré le sort de son domaine et sa confiance s'effondre
// (constaté : ×2,4 à ×3,8 rejetés, 0,56 → 0,40 sur la seule retenue). On vise
// donc un zoom modéré — moins de pixels gagnés, mais une passe 2 exploitable.
// Un réentraînement avec augmentation « Crop/Zoom » lèvera cette limite.
const ZOOM_TARGET_FRAC = 0.28; // largeur de plaque visée dans le recadrage
const ZOOM_MIN = 1.4;          // en dessous, le gain ne vaut pas l'inférence
const ZOOM_MAX = 2.2;          // au delà, le modèle décroche (hors domaine)
const ZOOM_CONF_RATIO = 0.85;  // passe 2 moins sûre que la 1 → on garde la 1

// Version d'onnxruntime-web alignée sur celle du lockfile (embarquée via @imgly).
const ORT_VERSION = '1.21.0';

let ortModPromise = null;
let sessionPromise = null;
let modelUnavailable = false; // mémorisé : évite de re-tenter un modèle absent à chaque photo

// Chargement paresseux d'onnxruntime-web (hors bundle principal).
function getOrt() {
  if (!ortModPromise) {
    ortModPromise = import('onnxruntime-web').then((ort) => {
      // numThreads=1 : évite le besoin de SharedArrayBuffer (COOP/COEP) — marche
      // partout, y compris sans en-têtes d'isolation cross-origin.
      ort.env.wasm.numThreads = 1;
      // Les binaires wasm sont servis depuis le CDN correspondant à la version.
      // (On pourra les bundler dans /public plus tard pour un fonctionnement
      // 100 % hors-ligne ; le CDN suffit pour démarrer.)
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      return ort;
    }).catch((e) => { ortModPromise = null; throw e; });
  }
  return ortModPromise;
}

function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await getOrt();
      return ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
    })().catch((e) => { sessionPromise = null; throw e; });
  }
  return sessionPromise;
}

// Précharge le modèle (à appeler quand l'utilisateur ouvre l'app, comme le
// préchauffage du détourage @imgly). Silencieux si le modèle est absent.
export async function preloadPlateKeypoints() {
  if (modelUnavailable) return;
  try { await getSession(); }
  catch (e) { modelUnavailable = true; console.log('[Keypoints] modèle non déployé — chaîne de secours utilisée'); }
}

function loadImageFromInput(input) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let url = null;
    img.onload = () => { if (url) URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (url) URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    if (typeof input === 'string') {
      img.src = input; // dataURL
    } else {
      url = URL.createObjectURL(input); // File / Blob
      img.src = url;
    }
  });
}

// Mise au format d'entrée du modèle : IMGSZ×IMGSZ, tenseur CHW normalisé [0,1].
// `rect` = zone SOURCE de l'image à donner au modèle, en pixels d'origine
// (l'image entière en passe 1, le recadrage autour de la plaque en passe 2).
//
// ÉTIREMENT, pas letterbox. Roboflow exporte les images du dataset étirées en
// 640×640 (« Resize: Stretch », son réglage par défaut) — vérifié sur l'export
// : les 640×640 ne portent aucune bande de padding, et le rapport mesuré des
// plaques (médiane 2,44 au lieu de 4,7) correspond bien à des photos 4:3 et 3:4
// écrasées vers le carré. Le modèle n'a donc JAMAIS vu de letterbox.
//
// Lui en envoyer un revenait à l'interroger sur une géométrie inconnue : les
// proportions ne correspondaient pas et des bandes grises occupaient un quart
// de l'image. D'où des coins posés de travers en production alors que la
// validation — qui tourne, elle, sur les images étirées — affichait 0,943 de
// mAP50-95. Un décalage de prétraitement ne se voit jamais dans les métriques.
//
// `?letterbox=on` rétablit l'ancien comportement pour comparer.
function preprocess(img, rect) {
  const { sx, sy, sw, sh } = rect;
  const letterbox = typeof window !== 'undefined'
    && window.location.search.includes('letterbox=on');

  const scaleX = letterbox ? Math.min(IMGSZ / sw, IMGSZ / sh) : IMGSZ / sw;
  const scaleY = letterbox ? scaleX : IMGSZ / sh;
  const drawW = sw * scaleX, drawH = sh * scaleY;
  const padX = Math.floor((IMGSZ - drawW) / 2), padY = Math.floor((IMGSZ - drawH) / 2);

  const c = document.createElement('canvas');
  c.width = IMGSZ; c.height = IMGSZ;
  const ctx = c.getContext('2d');
  if (letterbox) {
    ctx.fillStyle = 'rgb(114,114,114)'; // couleur de padding YOLO
    ctx.fillRect(0, 0, IMGSZ, IMGSZ);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, padX, padY, drawW, drawH);

  const { data } = ctx.getImageData(0, 0, IMGSZ, IMGSZ);
  freeCanvas(c); // pixels lus : on rend le backing-store tout de suite
  const area = IMGSZ * IMGSZ;
  const chw = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    chw[i]           = data[i * 4]     / 255; // R
    chw[i + area]    = data[i * 4 + 1] / 255; // G
    chw[i + 2 * area] = data[i * 4 + 2] / 255; // B
  }
  return { chw, scaleX, scaleY, padX, padY, sx, sy };
}

// Une inférence sur la zone `rect`. Renvoie les 4 coins en PIXELS de la photo
// d'origine (repère commun aux deux passes) ou null si rien de fiable.
async function runPass(ort, session, img, rect) {
  const { chw, scaleX, scaleY, padX, padY, sx, sy } = preprocess(img, rect);

  let out;
  try {
    const tensor = new ort.Tensor('float32', chw, [1, 3, IMGSZ, IMGSZ]);
    const res = await session.run({ [session.inputNames[0]]: tensor });
    out = res[session.outputNames[0]];
  } catch (e) {
    console.warn('[Keypoints] inférence échouée:', e?.message);
    return null;
  }

  // Sortie [1, 17, 8400] rangée par canal : data[canal * nA + ancre].
  // canaux : 0..3 boîte (cx,cy,w,h), 4 confiance, 5.. keypoints (x,y,vis)×4
  const data = out.data;
  const nA = out.dims[out.dims.length - 1]; // 8400

  let best = -1, bestConf = 0;
  for (let a = 0; a < nA; a++) {
    const conf = data[4 * nA + a];
    if (conf > bestConf) { bestConf = conf; best = a; }
  }
  if (best < 0 || bestConf < CONF_THRESHOLD) return null;

  // Espace 640 du modèle → pixels de la photo d'origine (l'étirement se
  // défait avec un facteur par axe ; padX/padY ne servent qu'en ?letterbox=on).
  const corners = [];
  for (let i = 0; i < 4; i++) {
    const kx = data[(5 + i * 3) * nA + best];
    const ky = data[(6 + i * 3) * nA + best];
    corners.push({ x: (kx - padX) / scaleX + sx, y: (ky - padY) / scaleY + sy });
  }
  return { conf: bestConf, corners }; // ordre d'annotation tl, tr, br, bl
}

const spanOf = (corners) => {
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  const x1 = Math.min(...xs), x2 = Math.max(...xs);
  const y1 = Math.min(...ys), y2 = Math.max(...ys);
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
};

// Zone à donner au modèle en passe 2 : centrée sur la plaque de la passe 1,
// au ratio de la photo d'origine — l'entrée subit le même écrasement que la
// passe 1, donc le modèle retrouve les proportions qu'il connaît.
// null = zoom inutile ou impossible.
export function zoomRect(corners, W, H) {
  const s = spanOf(corners);
  if (s.w < 8 || s.h < 4) return null; // plaque trop petite : mesure peu sûre

  let cw = s.w / ZOOM_TARGET_FRAC;
  const zoom = W / cw;
  if (zoom < ZOOM_MIN) return null;            // déjà assez grande dans le cadre
  if (zoom > ZOOM_MAX) cw = W / ZOOM_MAX;      // reste dans le domaine connu
  let ch = cw * (H / W);
  // La plaque doit garder du contexte vertical (pare-chocs, calandre) : c'est
  // ce qui permet au modèle de la reconnaître comme une plaque.
  if (ch < s.h * 3) { ch = s.h * 3; cw = ch * (W / H); }
  if (cw > W || ch > H) return null;

  // Centrage sur la plaque, puis recalage dans les bords de la photo.
  const sx = Math.max(0, Math.min(W - cw, s.cx - cw / 2));
  const sy = Math.max(0, Math.min(H - ch, s.cy - ch / 2));
  return { sx, sy, sw: cw, sh: ch, zoom: W / cw };
}

// La passe 2 remplace-t-elle la passe 1 ? Ce n'est PAS une correction des
// coordonnées : c'est le choix de la passe à laquelle on se fie. Un modèle
// sorti de son domaine s'effondre en confiance ou part ailleurs — dans ces
// deux cas on garde la passe 1, donc jamais de régression.
export function acceptZoom(p1, p2) {
  if (!p2) return { ok: false, why: 'rien détecté sur le recadrage' };
  if (p2.conf < p1.conf * ZOOM_CONF_RATIO) {
    return { ok: false, why: `confiance ${p1.conf.toFixed(2)}→${p2.conf.toFixed(2)}` };
  }
  const a = spanOf(p1.corners), b = spanOf(p2.corners);
  const drift = Math.hypot(b.cx - a.cx, b.cy - a.cy);
  if (drift > a.w * 0.5) { // parti sur un autre objet
    return { ok: false, why: `centre décalé de ${Math.round((drift / a.w) * 100)} % de la plaque` };
  }
  const ratio = (b.w * b.h) / (a.w * a.h || 1);
  if (ratio <= 0.5 || ratio >= 2) return { ok: false, why: `aire ×${ratio.toFixed(2)}` };
  return { ok: true };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// La 2e passe est DÉSACTIVÉE par défaut. Mesuré en production sur 4 photos :
// le modèle actuel décroche sur tout recadrage, même modéré —
//   ×1,8 : 0,56 → 0,35   ×1,7 : 0,68 → 0,58
//   ×2,2 : 0,83 → 0,62   ×2,2 : 0,92 → 0,54
// La passe 2 est donc systématiquement écartée : elle coûterait une inférence
// par photo pour rien. `?zoom=on` la réactive — à repasser par défaut une fois
// le modèle réentraîné avec une augmentation d'échelle (scale=0.9).
function zoomEnabled() {
  if (typeof window === 'undefined') return false;
  return window.location.search.includes('zoom=on');
}

// Détection principale. imageInput : File/Blob (photo d'origine) ou dataURL.
export async function detectPlateKeypoints(imageInput) {
  if (modelUnavailable) return null;
  if (typeof window !== 'undefined' && window.location.search.includes('keypoints=off')) return null;

  let session, ort;
  try {
    ort = await getOrt();
    session = await getSession();
  } catch (e) {
    modelUnavailable = true;
    console.log('[Keypoints] modèle indisponible — bascule sur Plate Recognizer/Claude');
    return null;
  }

  // L'entrée du modèle est un 640×640 : décoder la photo en plein format (48 Mo
  // pour 12 Mpx) n'apporte rien ici, et c'est un des pics qui faisaient tuer
  // l'onglet pendant un lot sur mobile. On décode donc à une taille de travail
  // modeste. Les coins sont normalisés (÷ W,H) en sortie : travailler à une
  // autre échelle ne change RIEN au résultat.
  // Exception : `?zoom=on` (passe 2 de débogage) veut le détail natif, puisque
  // c'est précisément ce qu'elle mesure.
  const WORK_MAX_PX = 1600;
  let img, releaseSource = null;
  try {
    if (typeof imageInput === 'string' || zoomEnabled()) {
      img = await loadImageFromInput(imageInput);
      releaseSource = () => releaseImg(img);
    } else {
      const photo = await openPhoto(imageInput);
      const scale = Math.min(1, WORK_MAX_PX / Math.max(photo.natW, photo.natH));
      const src = await photo.pixels(Math.round(photo.natW * scale), Math.round(photo.natH * scale));
      img = src.src;
      releaseSource = () => { src.release(); photo.release(); };
    }
  } catch (e) { console.warn('[Keypoints] chargement image échoué:', e?.message); return null; }

  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;

  try {
    // ── Passe 1 : photo entière, pour localiser la plaque ──
    const p1 = await runPass(ort, session, img, { sx: 0, sy: 0, sw: W, sh: H });
    if (!p1) {
      // Pas de plaque fiable pour ce modèle → on laisse la chaîne de secours
      // (Plate Recognizer/Claude) décider plutôt que d'affirmer « pas de plaque ».
      return null;
    }

    // ── Passe 2 : recadrage plein format autour de la plaque, pour la POSER ──
    let final = p1, note = 'passe unique';
    if (zoomEnabled()) {
      const rect = zoomRect(p1.corners, W, H);
      if (rect) {
        const p2 = await runPass(ort, session, img, rect);
        const verdict = acceptZoom(p1, p2);
        if (verdict.ok) {
          final = p2;
          note = `zoom ×${rect.zoom.toFixed(1)} retenu, conf ${p1.conf.toFixed(2)}→${p2.conf.toFixed(2)}`;
        } else {
          note = `zoom ×${rect.zoom.toFixed(1)} écarté — ${verdict.why} (passe 1 conservée)`;
        }
      } else {
        note = 'zoom inutile (plaque déjà grande)';
      }
    }

    // Pixels d'origine → repère normalisé [0,1] attendu par detectPlate().
    const corners = final.corners.map((p) => ({ x: clamp01(p.x / W), y: clamp01(p.y / H) }));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const bbox = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };

    console.log(`[Keypoints] plaque détectée conf=${final.conf.toFixed(2)} — coins maison (${note})`);
    return { found: true, conf: final.conf, bbox, corners, source: 'keypoints' };
  } finally {
    // Bitmap rendu dès la dernière passe, sans attendre le ramasse-miettes.
    // Sur mobile, plusieurs détections en vol pendant un lot suffisaient
    // sinon à faire tuer l'onglet.
    try { releaseSource?.(); } catch (_) {}
  }
}
