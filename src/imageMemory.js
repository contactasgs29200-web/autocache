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

// ── Vignettes ─────────────────────────────────────────────────────────────
// Une photo affichée dans une grille de 150 px est quand même décodée EN
// ENTIER par le navigateur. À plusieurs photos, le thread principal n'a plus
// la main pour peindre le reste de la page (des blocs restent invisibles) et
// la mémoire grimpe jusqu'à la mise à mort de l'onglet. Les grilles affichent
// donc les vignettes produites ici ; le plein format reste pour la visionneuse,
// le téléchargement et l'envoi par mail.
export const SELECT_THUMB_PX = 640; // grille des photos importées
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
  const src = URL.createObjectURL(file);
  let img = null;
  try {
    img = await loadImg(src);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxPx / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width  = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    releaseImg(img); img = null;
    const blob = await new Promise(res => { try { c.toBlob(res, 'image/jpeg', quality); } catch (e) { res(null); } });
    freeCanvas(c);
    if (!blob) return src;
    URL.revokeObjectURL(src);
    return URL.createObjectURL(blob);
  } catch (e) {
    return src;
  } finally { releaseImg(img); }
}
