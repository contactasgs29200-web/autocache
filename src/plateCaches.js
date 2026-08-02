// ── Plusieurs caches plaque sur une même photo ────────────────────────────
// Une photo d'annonce peut montrer 2 ou 3 voitures, chacune avec sa plaque.
// Un résultat porte donc :
//   - `corners`      : le cache principal (celui posé par la détection auto)
//   - `extraCorners` : les caches ajoutés à la main par-dessus
// Ces deux champs se manipulent toujours ensemble : `plateList` pour lire la
// liste complète, `plateFields` pour la réécrire dans le résultat.

// Liste complète des caches d'un résultat, cache principal en tête.
export function plateList(r) {
  const list = [];
  if (r?.corners) list.push(r.corners);
  if (Array.isArray(r?.extraCorners)) for (const c of r.extraCorners) if (c) list.push(c);
  return list;
}

// Inverse de plateList : renvoie les champs à fusionner dans le résultat.
export function plateFields(list) {
  const clean = (list || []).filter(Boolean);
  return { corners: clean[0] ?? null, extraCorners: clean.slice(1) };
}

// Quadrilatère par défaut d'un cache posé à la main. `n` = nombre de caches
// déjà présents : chaque nouveau cache est décalé horizontalement pour ne pas
// atterrir pile sur le précédent (photo à 2 ou 3 voitures).
export function defaultPlateQuad(n = 0) {
  const OFFSETS = [0, 0.24, -0.24, 0.12, -0.12];
  const dx = OFFSETS[n % OFFSETS.length];
  const dy = -0.07 * Math.floor(n / OFFSETS.length);
  const cl = v => Math.max(0, Math.min(1, v));
  return {
    tl: { x: cl(0.35 + dx), y: cl(0.70 + dy) },
    tr: { x: cl(0.65 + dx), y: cl(0.70 + dy) },
    br: { x: cl(0.65 + dx), y: cl(0.78 + dy) },
    bl: { x: cl(0.35 + dx), y: cl(0.78 + dy) },
  };
}
