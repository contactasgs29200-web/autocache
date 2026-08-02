// ── Fichiers image produits par l'application ─────────────────────────────
// Deux utilitaires purs partagés par les chemins d'enregistrement (bouton DL,
// « Tout télécharger », export rogné). La logique d'enregistrement elle-même
// vit dans App.jsx : elle dépend du navigateur (partage natif, ancre <a>).

// Convertit une data URL en Blob, de façon SYNCHRONE : le partage natif exige
// un geste utilisateur encore « frais », et un fetch/await avant l'appel le
// périme sur iOS.
export function dataURLToBlob(dataURL) {
  const comma = String(dataURL).indexOf(',');
  if (comma < 0) throw new Error('data URL invalide');
  const head = dataURL.slice(0, comma);
  const mime = (head.match(/data:([^;,]+)/) || [, 'image/jpeg'])[1];
  const bin = atob(dataURL.slice(comma + 1));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

// Le nom de sortie reprend celui de la photo importée (souvent .png ou .heic)
// alors que l'export est en JPEG. Sans remplacement de l'extension, iOS ajoute
// la sienne et produit « autocache_IMG_5432.png.jpeg ».
export function withImageExt(name, mime) {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const base = String(name ?? '').trim() || 'photo';
  return base.replace(/\.[^./\\]+$/, '') + '.' + ext;
}
