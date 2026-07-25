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

const MODEL_URL = '/models/plate-keypoints.onnx';
const IMGSZ = 640;
const CONF_THRESHOLD = 0.30;

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

// Letterbox (mise à l'échelle en conservant le ratio + padding gris) vers
// IMGSZ×IMGSZ, puis conversion en tenseur CHW normalisé [0,1].
function preprocess(img) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const scale = Math.min(IMGSZ / W, IMGSZ / H);
  const newW = Math.round(W * scale), newH = Math.round(H * scale);
  const padX = Math.floor((IMGSZ - newW) / 2), padY = Math.floor((IMGSZ - newH) / 2);

  const c = document.createElement('canvas');
  c.width = IMGSZ; c.height = IMGSZ;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(114,114,114)'; // couleur de padding YOLO
  ctx.fillRect(0, 0, IMGSZ, IMGSZ);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, padX, padY, newW, newH);

  const { data } = ctx.getImageData(0, 0, IMGSZ, IMGSZ);
  const area = IMGSZ * IMGSZ;
  const chw = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    chw[i]           = data[i * 4]     / 255; // R
    chw[i + area]    = data[i * 4 + 1] / 255; // G
    chw[i + 2 * area] = data[i * 4 + 2] / 255; // B
  }
  return { chw, scale, padX, padY, W, H };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

  let img;
  try { img = await loadImageFromInput(imageInput); }
  catch (e) { console.warn('[Keypoints] chargement image échoué:', e?.message); return null; }

  const { chw, scale, padX, padY, W, H } = preprocess(img);

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
  const data = out.data;
  const nA = out.dims[out.dims.length - 1]; // 8400
  // canaux : 0..3 boîte (cx,cy,w,h), 4 confiance, 5.. keypoints (x,y,vis)×4

  let best = -1, bestConf = 0;
  for (let a = 0; a < nA; a++) {
    const conf = data[4 * nA + a];
    if (conf > bestConf) { bestConf = conf; best = a; }
  }
  if (best < 0 || bestConf < CONF_THRESHOLD) {
    // Pas de plaque fiable pour ce modèle → on laisse la chaîne de secours
    // (Plate Recognizer/Claude) décider plutôt que d'affirmer « pas de plaque ».
    return null;
  }

  // 4 keypoints en espace 640 (letterbox) → repère original normalisé [0,1].
  const kp = [];
  for (let i = 0; i < 4; i++) {
    const kx = data[(5 + i * 3) * nA + best];
    const ky = data[(6 + i * 3) * nA + best];
    const ox = (kx - padX) / scale / W;
    const oy = (ky - padY) / scale / H;
    kp.push({ x: clamp01(ox), y: clamp01(oy) });
  }
  // kp est déjà dans l'ordre d'annotation tl, tr, br, bl (index 0..3).
  const corners = kp;
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  const bbox = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };

  console.log(`[Keypoints] plaque détectée conf=${bestConf.toFixed(2)} — coins maison`);
  return { found: true, conf: bestConf, bbox, corners, source: 'keypoints' };
}
