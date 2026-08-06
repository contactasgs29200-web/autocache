// ── Géométrie du recadrage de logo ────────────────────────────────────────
// La sélection est exprimée en fractions de l'image ({ x, y, w, h } dans
// 0..1), comme partout ailleurs dans l'application. Le mode rond y ajoute une
// contrainte : la sélection doit être carrée EN PIXELS, ce qui n'est pas la
// même chose qu'un carré en fractions dès que le logo n'est pas carré — sans
// quoi le disque sort en ovale.
//
// `aspect` désigne toujours largeur/hauteur de l'image source.

export const MIN_CROP = 0.05; // côté minimal de la sélection

const clamp01 = (v, size) => Math.max(0, Math.min(1 - size, v));

// Ramène une sélection à un carré en pixels, sans sortir de l'image.
export function squareCropBox(box, aspect) {
  const a = aspect > 0 ? aspect : 1;
  // Côté maximal exprimé en fraction de largeur : au-delà, la hauteur
  // correspondante dépasserait l'image.
  const w = Math.min(box.w, 1 / a, 1);
  const h = Math.min(w * a, 1);
  const w2 = h / a;
  return { x: clamp01(box.x, w2), y: clamp01(box.y, h), w: w2, h };
}

// Applique un glissement à la sélection. `type` vaut "move" ou un coin
// ("tl" | "tr" | "bl" | "br"). `aspect` > 0 force le mode rond.
export function resizeCropBox(start, type, dx, dy, aspect = 0) {
  let { x, y, w, h } = start;
  if (type === "move") {
    x += dx; y += dy;
  } else if (aspect > 0) {
    // En rond il ne reste qu'un degré de liberté : le côté. On le lit sur
    // l'axe le plus déplacé, pour que le geste reste naturel sur les quatre
    // coins ; l'axe vertical est ramené en fraction de largeur.
    const isLeft = type[1] === "l", isTop = type[0] === "t";
    const delta = Math.abs(dx) >= Math.abs(dy)
      ? (isLeft ? -dx : dx)
      : (isTop ? -dy / aspect : dy / aspect);
    const nw = Math.max(MIN_CROP, Math.min(w + delta, 1, 1 / aspect));
    const nh = Math.min(nw * aspect, 1);
    // Un coin haut ou gauche déplace l'origine : le coin opposé reste fixe.
    if (isLeft) x += w - nw;
    if (isTop)  y += h - nh;
    w = nw; h = nh;
  } else {
    if (type[1] === "l") { const nw = w - dx; if (nw > MIN_CROP) { x += dx; w = nw; } }
    else                 { w = Math.max(MIN_CROP, w + dx); }
    if (type[0] === "t") { const nh = h - dy; if (nh > MIN_CROP) { y += dy; h = nh; } }
    else                 { h = Math.max(MIN_CROP, h + dy); }
  }
  w = Math.min(w, 1); h = Math.min(h, 1);
  return { x: clamp01(x, w), y: clamp01(y, h), w, h };
}
