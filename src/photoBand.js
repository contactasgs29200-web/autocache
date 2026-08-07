// ── Bandeau photo ─────────────────────────────────────────────────────────
// Une bande posée en haut de la photo : fond uni ou dégradé (ou rien du tout,
// pour poser un logo seul), avec un titre, un sous-titre et un logo à gauche
// ou à droite.
//
// Ce module réunit la configuration, la géométrie et le dessin de la bande.
// La partie géométrie ne touche à rien du navigateur : elle est testable en
// Node. Le dessin reçoit son contexte canvas et la police déjà résolue, sans
// rien connaître de l'application — la bande peut ainsi être rendue à
// l'identique dans l'aperçu du panneau et dans l'export.

export const BAND_FILLS          = ["solid", "gradient", "none"];
export const BAND_LOGO_POSITIONS = ["none", "left", "right"];
export const BAND_SCOPES         = ["all", "first", "selected"];

// Hauteur exprimée en fraction de la LARGEUR de la photo (et non de sa
// hauteur) : deux photos au même cadrage mais de formats différents donnent
// alors la même bande, et le texte garde la même taille apparente.
export const BAND_HEIGHT_MIN = 0.05;
export const BAND_HEIGHT_MAX = 0.30;

// Taille du logo, en fraction de la hauteur utile de la bande (hors marges).
// Le maximum dépasse 1 : un logo peut mordre sur les marges sans sortir de la
// bande (les marges valent 14 % de sa hauteur de chaque côté), et un écusson
// rond a besoin de cette place pour ne pas paraître perdu au milieu du vide.
export const BAND_LOGO_SCALE_MIN = 0.35;
export const BAND_LOGO_SCALE_MAX = 1.2;

export const DEFAULT_BAND = {
  enabled:      false,
  scope:        "all",          // "all" | "first" | "selected"
  height:       0.12,
  fill:         "solid",        // "solid" | "gradient" | "none"
  color1:       "#0d2b6b",
  color2:       "#f26522",
  opacity:      1,              // 0.2–1 : laisse voir la photo sous la bande
  title:        "",
  titleColor:   "#ffffff",
  subtitle:     "",
  subtitleColor:"#ffffff",
  font:         "rajdhani",     // clé dans WALL_FONTS (App.jsx)
  logoPos:      "none",         // "none" | "left" | "right"
  logoScale:    1,
};

const clamp  = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const oneOf  = (v, list, fallback) => (list.includes(v) ? v : fallback);
const asNum  = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const asText = (v) => (typeof v === "string" ? v : "");
// Les couleurs partent vers `ctx.fillStyle` : n'accepter que du #rrggbb évite
// qu'une valeur relue d'un localStorage trafiqué change autre chose que la
// couleur (un `fillStyle` invalide est silencieusement ignoré par le canvas,
// et la bande sortirait alors dans la couleur du calque précédent).
const asColor = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(asText(v)) ? v : fallback);

// Ramène n'importe quelle entrée — objet partiel, valeurs relues du
// localStorage, `null` — à une configuration complète et bornée.
export function normalizeBand(raw) {
  const r = (raw && typeof raw === "object") ? raw : {};
  return {
    enabled:       r.enabled === true,
    scope:         oneOf(r.scope, BAND_SCOPES, DEFAULT_BAND.scope),
    height:        clamp(asNum(r.height, DEFAULT_BAND.height), BAND_HEIGHT_MIN, BAND_HEIGHT_MAX),
    fill:          oneOf(r.fill, BAND_FILLS, DEFAULT_BAND.fill),
    color1:        asColor(r.color1, DEFAULT_BAND.color1),
    color2:        asColor(r.color2, DEFAULT_BAND.color2),
    opacity:       clamp(asNum(r.opacity, DEFAULT_BAND.opacity), 0.2, 1),
    title:         asText(r.title),
    titleColor:    asColor(r.titleColor, DEFAULT_BAND.titleColor),
    subtitle:      asText(r.subtitle),
    subtitleColor: asColor(r.subtitleColor, DEFAULT_BAND.subtitleColor),
    font:          asText(r.font) || DEFAULT_BAND.font,
    logoPos:       oneOf(r.logoPos, BAND_LOGO_POSITIONS, DEFAULT_BAND.logoPos),
    logoScale:     clamp(asNum(r.logoScale, DEFAULT_BAND.logoScale), BAND_LOGO_SCALE_MIN, BAND_LOGO_SCALE_MAX),
  };
}

// Y a-t-il quelque chose à dessiner ? Une bande cochée mais vide (fond
// « aucun », sans texte ni logo) ne doit pas relancer un ré-encodage de la
// photo pour n'y rien ajouter.
export function bandHasContent(cfg, hasLogo = false) {
  const c = normalizeBand(cfg);
  if (c.fill !== "none") return true;
  if (c.title.trim() || c.subtitle.trim()) return true;
  return c.logoPos !== "none" && !!hasLogo;
}

// Portée : toutes les photos, la première seule, ou une sélection.
export function bandAppliesTo(cfg, index, id, selectedIds) {
  const c = normalizeBand(cfg);
  if (c.scope === "first")    return index === 0;
  if (c.scope === "selected") return !!(selectedIds && selectedIds.has && selectedIds.has(id));
  return true;
}

// Géométrie de la bande pour une photo de `width` pixels de large.
// `logoAspect` = largeur/hauteur du logo (0 s'il n'y en a pas).
// Toutes les valeurs renvoyées sont en pixels dans le repère de la photo.
export function computeBandLayout({ cfg, width, logoAspect = 0 }) {
  const c = normalizeBand(cfg);
  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(W * c.height));
  const pad = Math.max(1, Math.round(H * 0.14));
  const inner = Math.max(1, H - pad * 2);

  const hasTitle = !!c.title.trim();
  const hasSub   = !!c.subtitle.trim();

  const showLogo = c.logoPos !== "none" && logoAspect > 0;
  let logo = null;
  if (showLogo) {
    let h = Math.max(1, Math.round(inner * c.logoScale));
    let w = Math.max(1, Math.round(h * logoAspect));
    // Un logo panoramique traverserait la bande de part en part : on le borne
    // en largeur, en gardant ses proportions. La moitié de la bande lui est
    // laissée quand il partage la place avec du texte, tout l'espace utile
    // sinon (logo seul, sans écriture).
    const maxW = (hasTitle || hasSub) ? Math.round(W * 0.45) : Math.max(1, W - pad * 2);
    if (w > maxW) { w = maxW; h = Math.max(1, Math.round(w / logoAspect)); }
    logo = {
      x: c.logoPos === "left" ? pad : W - pad - w,
      y: Math.round((H - h) / 2),
      w, h,
    };
  }

  // Le texte occupe la largeur restante, du côté opposé au logo.
  const gap  = showLogo ? Math.round(pad * 1.2) : 0;
  const used = showLogo ? logo.w + gap : 0;
  const textX = (showLogo && c.logoPos === "left") ? pad + used : pad;
  const textW = Math.max(1, W - pad * 2 - used);

  const titleSize = Math.max(1, Math.round(inner * (hasSub ? 0.54 : 0.66)));
  const subSize   = Math.max(1, Math.round(inner * 0.30));
  const lineGap   = Math.round(inner * 0.10);

  const blockH = (hasTitle ? titleSize : 0)
               + (hasTitle && hasSub ? lineGap : 0)
               + (hasSub ? subSize : 0);
  const blockTop = (H - blockH) / 2;

  return {
    W, H, pad, inner,
    logo,
    text: { x: textX, w: textW, cx: textX + textW / 2 },
    // `cy` est la ligne médiane du texte : le dessin utilise
    // textBaseline = "middle", comme le reste des calques de l'application.
    title:    { show: hasTitle, size: titleSize, cy: blockTop + titleSize / 2 },
    subtitle: { show: hasSub,   size: subSize,   cy: blockTop + blockH - subSize / 2 },
  };
}

// ── Dessin ────────────────────────────────────────────────────────────────
// `font` est une entrée de WALL_FONTS ({ family, weight }) : le module ne
// choisit pas la police, il l'applique.

// Écrit une ligne centrée sur `cx`, rétrécie si elle déborde de `maxW` : un
// nom d'enseigne long doit tenir dans la bande, pas déborder sur le logo.
export function drawBandText(ctx, text, color, font, size, cx, cy, maxW) {
  if (!text) return;
  let s = size;
  ctx.font = `${font.weight} ${s}px ${font.family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW && w > 0) {
    s = Math.max(6, Math.floor(s * maxW / w));
    ctx.font = `${font.weight} ${s}px ${font.family}`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy, maxW);
}

// Dessine la bande sur un contexte où la photo est déjà posée.
// `W` est la largeur de la photo, en pixels du canvas.
export function drawBand(ctx, W, cfg, logoImg, font) {
  const c = normalizeBand(cfg);
  const aspect = logoImg
    ? (logoImg.naturalWidth || logoImg.width) / (logoImg.naturalHeight || logoImg.height)
    : 0;
  const L = computeBandLayout({ cfg: c, width: W, logoAspect: aspect });
  ctx.save();
  if (c.fill !== "none") {
    // L'opacité ne s'applique qu'au fond : un titre à moitié transparent
    // devient illisible, alors qu'une bande translucide reste lisible.
    ctx.globalAlpha = c.opacity;
    if (c.fill === "gradient") {
      // Toujours de gauche à droite. Le sens n'est pas proposé : c'est un
      // réglage de plus à comprendre pour un gain à peu près nul, et un
      // dégradé vertical sur une bande large ne se lit de toute façon pas.
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, c.color1);
      g.addColorStop(1, c.color2);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = c.color1;
    }
    ctx.fillRect(0, 0, W, L.H);
    ctx.globalAlpha = 1;
  }
  if (logoImg && L.logo) ctx.drawImage(logoImg, L.logo.x, L.logo.y, L.logo.w, L.logo.h);
  if (L.title.show)    drawBandText(ctx, c.title.trim(),    c.titleColor,    font, L.title.size,    L.text.cx, L.title.cy,    L.text.w);
  if (L.subtitle.show) drawBandText(ctx, c.subtitle.trim(), c.subtitleColor, font, L.subtitle.size, L.text.cx, L.subtitle.cy, L.text.w);
  ctx.restore();
}
