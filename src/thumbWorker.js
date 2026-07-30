// src/thumbWorker.js
// Génère les vignettes des photos importées HORS DU THREAD PRINCIPAL.
//
// Pourquoi un worker : décoder puis ré-encoder quatre photos de smartphone
// occupe le thread principal plusieurs secondes d'affilée. Pendant ce temps le
// navigateur ne peut plus repeindre — sur iPhone, les zones que Safari doit
// redessiner restent vides ou virent au mauve, et la page paraît cassée alors
// qu'elle travaille. Ici, le thread principal ne fait plus que recevoir un blob
// déjà prêt.
//
// Aucune dimension n'est mesurée au préalable : `resizeWidth` suffit, la hauteur
// suit le rapport de l'image. Un aller-retour de mesure coûterait un décodage
// plein format — précisément ce qu'on cherche à éviter.

self.onmessage = async (e) => {
  const { id, file, maxPx = 640, quality = 0.82 } = e.data || {};
  try {
    const bmp = await createImageBitmap(file, {
      imageOrientation: 'from-image', // photos iPhone en portrait : EXIF respecté
      resizeWidth: maxPx,
      resizeQuality: 'high',
    });
    // Seule la largeur est imposée : une photo en portrait ressort donc plus
    // haute que `maxPx`. On ramène le plus grand côté à `maxPx` — le bitmap est
    // déjà petit, ce second passage ne coûte presque rien et aligne le budget
    // mémoire des portraits sur celui des paysages.
    const s = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s));
    const h = Math.max(1, Math.round(bmp.height * s));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    canvas.width = 0; canvas.height = 0;
    self.postMessage({ id, blob });
  } catch (err) {
    // L'appelant repasse alors par le chemin classique sur le thread principal.
    self.postMessage({ id, blob: null, error: String((err && err.message) || err) });
  }
};
