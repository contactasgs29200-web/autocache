// src/imageMemory.js
// Boîte à outils « mémoire images ». Tout ce qui est ici existe pour une seule
// raison : borner la mémoire des images décodées dans l'onglet.
//
// Le contexte : les photos viennent d'un appareil de smartphone (12 Mpx), soit
// ~50 Mo de bitmap chacune une fois décodée par le navigateur — et un canvas
// 2400×1800 en pèse encore 17. WebKit (Safari iOS, y compris l'app installée)
// ne prévient pas quand le cumul dépasse son budget : il tue l'onglet, qui
// recharge sur l'écran d'accueil. D'où deux règles appliquées partout :
//   1. jamais un plein format là où une vignette suffit (grilles, cartes) ;
//   2. tout canvas / toute <img> exploité est rendu immédiatement, sans
//      attendre le ramasse-miettes.

// Appareil mobile (iOS/Android) : les pipelines y plafonnent leurs résolutions
// de travail et leur parallélisme.
export function isMobileDevice() {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

// Libère immédiatement le backing-store (RAM/GPU) d'un canvas temporaire au
// lieu d'attendre le ramasse-miettes. N'affecte ni la résolution ni la qualité
// du rendu final — on ne libère que des canvas déjà exploités.
export function freeCanvas(...cs) {
  for (const c of cs) { if (c) { c.width = 0; c.height = 0; } }
}

// Même idée pour une <img> : réaffecter un pixel transparent 1×1 rend tout de
// suite le bitmap décodé.
export const BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export function releaseImg(...imgs) {
  for (const img of imgs) { try { if (img) img.src = BLANK_PX; } catch (_) {} }
}

export function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// Laisse le navigateur reprendre la main (peinture, ramasse-miettes) entre deux
// étapes lourdes. Sur mobile, une pause franche : c'est là que WebKit récupère
// la mémoire des canvas libérés.
export function breathe(ms = isMobileDevice() ? 150 : 0) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Décodage à la taille de travail ───────────────────────────────────────
// Le vrai gouffre mémoire n'est pas le fichier (3–5 Mo) mais son bitmap : une
// photo iPhone de 4032×3024 occupe 48 Mo dès qu'elle est décodée, même pour
// finir dessinée dans un canvas de 2400 px ou une vignette de 640. Le chemin
// classique (`<img>` + drawImage) matérialise TOUJOURS ce plein format avant de
// le réduire.
//
// `createImageBitmap(file, { resizeWidth, resizeHeight })` évite ce détour : le
// décodeur du système sous-échantillonne pendant le décodage, on ne paie donc
// que la taille finale. Encore faut-il qu'il honore aussi l'orientation EXIF —
// sinon les photos de portrait de l'iPhone sortiraient couchées. On ne le
// suppose pas : on le VÉRIFIE sur l'appareil avec la sonde ci-dessous, et à la
// moindre anomalie on revient au chemin `<img>`, plus coûteux mais sûr.
//
// JPEG de 309 octets, 8×16, portant un EXIF Orientation=6 (rotation 90°) :
// tout décodeur qui applique l'EXIF le présente en 16×8.
const EXIF_PROBE = 'data:image/jpeg;base64,/9j/4QAiRXhpZgAASUkqAAgAAAABABIBAwABAAAABgAAAAAAAAD/2wBDAKBueIx4ZKCMgoy0qqC+8P//8Nzc8P//////////////////////////////////////////////////////////2wBDAaq0tPDS8P//////////////////////////////////////////////////////////////////////////////wAARCAAQAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAYEAEAAwEAAAAAAAAAAAAAAAAAFGKh4f/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwBHtnRYB//Z';

let scaledDecodeProbe = null;
/**
 * Le navigateur sait-il décoder en sous-échantillonné SANS perdre
 * l'orientation EXIF ? Sondé une seule fois, mémorisé.
 * `?scaledDecode=off` force le chemin `<img>` (comparaison sur photos réelles).
 */
export function supportsScaledDecode() {
  if (!scaledDecodeProbe) scaledDecodeProbe = (async () => {
    try {
      if (typeof createImageBitmap !== 'function') return false;
      if (typeof window !== 'undefined' && window.location.search.includes('scaledDecode=off')) return false;
      const blob = await fetch(EXIF_PROBE).then(r => r.blob());
      const bmp = await createImageBitmap(blob, {
        imageOrientation: 'from-image', resizeWidth: 4, resizeQuality: 'high',
      });
      // Attendu : 4×2. 2×4 = orientation ignorée ; 16×8 = resize ignoré.
      const ok = bmp.width === 4 && bmp.height === 2;
      bmp.close?.();
      if (!ok) console.warn('[decode] sous-échantillonnage non fiable — chemin <img> conservé');
      return ok;
    } catch (e) { return false; }
  })();
  return scaledDecodeProbe;
}

/**
 * Taille intrinsèque d'un fichier image, sans dessiner : les métadonnées de
 * l'en-tête suffisent, le bitmap n'a pas à être rasterisé.
 */
export async function imageSize(file) {
  const url = URL.createObjectURL(file);
  let img = null;
  try {
    img = await loadImg(url);
    return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  } finally {
    releaseImg(img);
    URL.revokeObjectURL(url);
  }
}

/**
 * Ouvre une photo pour un pipeline : donne sa taille intrinsèque tout de suite,
 * et ses pixels seulement quand on sait à quelle taille on les veut.
 *
 *   const photo = await openPhoto(file);
 *   //  … calculs à partir de photo.natW / photo.natH …
 *   const src = await photo.pixels(destW, destH);
 *   ctx.drawImage(src.src, 0, 0, destW, destH);
 *   src.release(); photo.release();
 *
 * Navigateur capable de sous-échantillonner : rien n'est rasterisé avant
 * `pixels()`, et jamais en plein format. Sinon : le plein format est décodé UNE
 * fois et réutilisé pour la mesure comme pour le dessin — exactement le
 * comportement d'avant, sans double décodage.
 */
export async function openPhoto(file) {
  if (await supportsScaledDecode()) {
    const { w, h } = await imageSize(file);
    return { natW: w, natH: h, scaled: true, pixels: (pw, ph) => decodeAt(file, pw, ph), release: () => {} };
  }
  const url = URL.createObjectURL(file);
  const img = await loadImg(url);
  URL.revokeObjectURL(url);
  return {
    natW: img.naturalWidth || img.width,
    natH: img.naturalHeight || img.height,
    scaled: false,
    pixels: async () => ({ src: img, release: () => {} }),
    release: () => releaseImg(img),
  };
}

/**
 * Source dessinable pour `file`, décodée à `w`×`h` quand le navigateur le
 * permet (sinon plein format, comme avant). Dans les deux cas l'appelant
 * dessine avec une taille de destination explicite :
 *   ctx.drawImage(src, 0, 0, w, h)
 * puis appelle `release()`.
 */
export async function decodeAt(file, w, h) {
  const dw = Math.max(1, Math.round(w)), dh = Math.max(1, Math.round(h));
  if (await supportsScaledDecode()) {
    try {
      const bmp = await createImageBitmap(file, {
        imageOrientation: 'from-image', resizeWidth: dw, resizeHeight: dh, resizeQuality: 'high',
      });
      return { src: bmp, width: bmp.width, height: bmp.height, scaled: true,
               release: () => { try { bmp.close(); } catch (_) {} } };
    } catch (e) {
      console.warn('[decode] sous-échantillonnage échoué, repli <img>:', e?.message);
    }
  }
  const url = URL.createObjectURL(file);
  const img = await loadImg(url);
  URL.revokeObjectURL(url);
  return { src: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height,
           scaled: false, release: () => releaseImg(img) };
}

// ── Vignettes ─────────────────────────────────────────────────────────────
// Une photo affichée dans une grille de 150 px est quand même décodée EN
// ENTIER par le navigateur. À plusieurs photos, le thread principal n'a plus
// la main pour peindre le reste de la page (des blocs restent invisibles) et
// la mémoire grimpe jusqu'à la mise à mort de l'onglet. Les grilles affichent
// donc les vignettes produites ici ; le plein format reste pour la visionneuse,
// le téléchargement et l'envoi par mail.
// Les tuiles de sélection font ~90 pt de large, soit ~270 px sur un écran ×3 :
// 480 px reste largement au-dessus du nécessaire, pour moitié moins de mémoire.
export const SELECT_THUMB_PX = 480; // grille des photos importées
export const RESULT_THUMB_PX = 700; // grille des photos traitées

// iOS sous pression mémoire renvoie parfois un dataURL vide ("data:,") sans
// lever d'erreur : une vignette invisible serait pire que pas de vignette.
const usable = (dataUrl) => (dataUrl && dataUrl.length > 512 ? dataUrl : null);

/**
 * Vignette JPEG depuis un canvas déjà en mémoire (coût : un petit canvas).
 * null = source déjà assez petite, ou échec : l'appelant retombe alors sur le
 * plein format.
 */
export function thumbFromCanvas(src, maxPx = RESULT_THUMB_PX, quality = 0.82) {
  try {
    const w = src?.width, h = src?.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxPx / Math.max(w, h));
    if (scale === 1) return null;
    const t = document.createElement('canvas');
    t.width  = Math.max(1, Math.round(w * scale));
    t.height = Math.max(1, Math.round(h * scale));
    const tctx = t.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(src, 0, 0, t.width, t.height);
    const out = t.toDataURL('image/jpeg', quality);
    freeCanvas(t);
    return usable(out);
  } catch (e) { return null; }
}

/** Vignette JPEG depuis un rendu déjà produit (dataURL). null si impossible. */
export async function thumbFromDataURL(dataUrl, maxPx = RESULT_THUMB_PX, quality = 0.82) {
  if (!dataUrl) return null;
  let img = null;
  try {
    img = await loadImg(dataUrl);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxPx / Math.max(w, h));
    if (scale === 1) return null;
    const c = document.createElement('canvas');
    c.width  = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', quality);
    freeCanvas(c);
    return usable(out);
  } catch (e) { return null; }
  finally { releaseImg(img); }
}

/**
 * Vignette d'un fichier importé, renvoyée en blob URL — stockée hors du tas JS,
 * contrairement à un dataURL, et révocable. À révoquer par l'appelant quand la
 * photo quitte l'écran. Repli en cas d'échec : l'URL du fichier d'origine (le
 * navigateur affichera le plein format, dégradé mais jamais de case vide).
 */
export async function thumbURLFromFile(file, maxPx = SELECT_THUMB_PX, quality = 0.82) {
  let bmp = null, photo = null, source = null;
  try {
    let tw, th, drawable;
    if (await supportsScaledDecode()) {
      // Aucune mesure préalable : `resizeWidth` seul suffit, la hauteur suit le
      // rapport de l'image. Mesurer d'abord coûterait un décodage plein format,
      // soit exactement le travail qu'on veut éviter sur le thread principal.
      bmp = await createImageBitmap(file, {
        imageOrientation: 'from-image', resizeWidth: maxPx, resizeQuality: 'high',
      });
      drawable = bmp; tw = bmp.width; th = bmp.height;
    } else {
      photo = await openPhoto(file);
      const scale = Math.min(1, maxPx / Math.max(photo.natW, photo.natH));
      tw = Math.max(1, Math.round(photo.natW * scale));
      th = Math.max(1, Math.round(photo.natH * scale));
      source = await photo.pixels(tw, th);
      drawable = source.src;
    }
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(drawable, 0, 0, tw, th);
    bmp?.close?.(); bmp = null;
    source?.release(); source = null;
    photo?.release(); photo = null;
    const blob = await new Promise(res => { try { c.toBlob(res, 'image/jpeg', quality); } catch (e) { res(null); } });
    freeCanvas(c);
    if (blob) return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('[thumb] vignette impossible, original affiché:', e?.message);
  } finally { try { bmp?.close?.(); } catch (_) {} source?.release(); photo?.release(); }
  return URL.createObjectURL(file); // repli : le navigateur affichera l'original
}

// ── Génération des vignettes hors du thread principal ─────────────────────
// Décoder et ré-encoder quatre photos de smartphone occupe le thread principal
// plusieurs secondes d'affilée : mesuré à 8,2 s pour 4 fichiers de 9,5 Mo, en
// UNE seule tâche. Pendant tout ce temps le navigateur ne peut plus repeindre —
// d'où les zones vides ou mauves sur iPhone. Le travail part donc dans un
// worker ; le thread principal ne reçoit qu'un blob prêt à afficher.
let thumbWorker = null, thumbWorkerUsable = null, thumbSeq = 0;
const thumbJobs = new Map();

function getThumbWorker() {
  if (thumbWorkerUsable === false) return null;
  if (thumbWorker) return thumbWorker;
  try {
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function'
        || typeof OffscreenCanvas.prototype.convertToBlob !== 'function') {
      thumbWorkerUsable = false; return null;
    }
    thumbWorker = new Worker(new URL('./thumbWorker.js', import.meta.url), { type: 'module' });
    thumbWorker.onmessage = (e) => {
      const job = thumbJobs.get(e.data?.id);
      if (job) { thumbJobs.delete(e.data.id); job(e.data); }
    };
    thumbWorker.onerror = () => {
      // Worker inutilisable : on rend la main au chemin classique.
      thumbWorkerUsable = false;
      for (const job of thumbJobs.values()) job({ blob: null });
      thumbJobs.clear();
      stopThumbWorker();
    };
    thumbWorkerUsable = true;
    return thumbWorker;
  } catch (e) { thumbWorkerUsable = false; return null; }
}

export function stopThumbWorker() {
  if (thumbWorker) { try { thumbWorker.terminate(); } catch (_) {} thumbWorker = null; }
}

function thumbURLViaWorker(file, maxPx, quality) {
  return new Promise(resolve => {
    const w = getThumbWorker();
    if (!w) return resolve(null);
    const id = ++thumbSeq;
    let settled = false;
    const finish = (url) => { if (!settled) { settled = true; thumbJobs.delete(id); resolve(url); } };
    thumbJobs.set(id, (msg) => finish(msg?.blob ? URL.createObjectURL(msg.blob) : null));
    // Garde-fou : un worker muet ne doit jamais bloquer un import.
    setTimeout(() => finish(null), 20000);
    try { w.postMessage({ id, file, maxPx, quality }); } catch (e) { finish(null); }
  });
}

/**
 * Vignettes d'une série de fichiers, une à la fois (un seul décodage en vol).
 * `onReady(index, url)` est appelé au fil de l'eau : l'appelant décide du
 * rythme d'affichage. Renvoie le tableau des URLs dans l'ordre des fichiers.
 */
export async function thumbURLsFromFiles(files, { maxPx = SELECT_THUMB_PX, quality = 0.82, onReady } = {}) {
  const out = new Array(files.length).fill(null);
  try {
    const viaWorker = await supportsScaledDecode(); // même moteur : orientation déjà validée
    for (let i = 0; i < files.length; i++) {
      let url = viaWorker ? await thumbURLViaWorker(files[i], maxPx, quality) : null;
      if (!url) url = await thumbURLFromFile(files[i], maxPx, quality);
      out[i] = url;
      try { onReady?.(i, url); } catch (e) { /* l'affichage ne doit pas casser la série */ }
      await breathe(0);
    }
  } finally {
    // Série terminée : le worker et sa mémoire sont rendus tout de suite.
    stopThumbWorker();
  }
  return out;
}
