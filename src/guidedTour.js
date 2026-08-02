// =============================================================================
//  Parcours photo guidé — logique pure.
//
//  L'utilisateur photographie son véhicule directement depuis l'app, en quatre
//  prises imposées : 3/4 avant gauche, face avant, 3/4 avant droit, arrière.
//  Il peut ensuite ajouter autant de photos bonus qu'il veut.
//
//  La particularité : le CACHE PLAQUE est déjà dessiné au milieu de l'écran
//  pendant la visée. L'utilisateur n'aligne pas une plaque sur un cache posé
//  après coup — il cadre son véhicule pour que sa plaque tombe dans le cache.
//  La position du cache à l'écran est donc connue AVANT la photo : elle est
//  transmise au pipeline comme indice de localisation (`plateHint`), ce qui
//  évite une passe de localisation et donne un repli fiable si la détection
//  ne trouve rien.
//
//  Aucune dépendance navigateur ici : tout est testable en Node. Le composant
//  React (GuidedTour) n'ajoute que la caméra et l'UI.
// =============================================================================

/**
 * Position du cache plaque dans le viseur, en coordonnées normalisées.
 * `cy` est légèrement sous le milieu : une plaque se trouve en bas de calandre,
 * et viser pile le centre obligerait à pointer l'appareil vers le sol.
 * La TAILLE, elle, dépend de la vue : voir `plate` sur chaque étape.
 */
export const PLATE_FRAME = { cx: 0.5, cy: 0.56 };

// =============================================================================
//  Géométrie du gabarit — mesurée, pas calculée.
//
//  Un modèle de perspective (cosinus de l'angle, encombrement apparent du
//  véhicule) donnait un gabarit plausible mais faux : trop grand sur les vues
//  3/4, et surtout parfaitement horizontal alors qu'un cache réel y est
//  nettement INCLINÉ — c'est pourtant l'inclinaison qui dit à l'utilisateur
//  qu'il est bien placé.
//
//  Les valeurs ci-dessous sont relevées sur quatre photos de référence déjà
//  traitées par l'app, par segmentation du cache puis rectangle d'aire
//  minimale :
//
//    vue                | largeur (% largeur photo) | L/H  | inclinaison
//    3/4 avant gauche   | 12,30 %                   | 3,56 | +14,1°
//    face avant         | 23,04 %                   | 5,49 |   0,0°
//    3/4 avant droit    | 12,43 %                   | 3,39 | −18,2°
//    arrière            | 22,72 %                   | 5,06 |  −1,2°
//
//  Deux relevés ont été arrondis volontairement :
//  - l'arrière passe à 0° (−1,2° est un tremblement de main, pas une propriété
//    de la vue) ;
//  - l'écart d'épaisseur entre bord proche et bord lointain, mesuré entre +5 %
//    et +11 % selon la photo, est fixé à +8 % et attribué au bord proche déduit
//    de la géométrie : la mesure était dans le bruit, et une asymétrie entre
//    les deux vues 3/4 se verrait à l'écran.
//
//  La largeur est une fraction de la LARGEUR du viseur. Elle se transporte
//  d'une orientation à l'autre tant que le véhicule occupe la même part de la
//  largeur du cadre — ~60 % de face, ~75 % en 3/4 sur les photos de référence.
// =============================================================================

// Épaisseur du bord proche rapportée au bord lointain, sur une vue 3/4.
const NEAR_FAR = 1.08;

/**
 * Les quatre prises du parcours, dans l'ordre de marche autour du véhicule :
 * on commence à l'avant gauche, on passe devant, on continue vers l'avant
 * droit, puis on contourne jusqu'à l'arrière. Aucun aller-retour.
 *
 * `plate` = gabarit du cache pour cette vue, relevé sur les photos de
 * référence : `w` en fraction de la largeur du viseur, `ratio` = longueur /
 * hauteur, `rotation` en degrés (positif = le cache descend vers la droite),
 * `near` = côté dont le bord est le plus proche de l'appareil.
 */
export const GUIDED_STEPS = [
  {
    id: 'front_left_34',
    label: '3/4 avant gauche',
    slug: 'avant-34-gauche',
    instruction: 'Placez-vous à l’avant gauche du véhicule',
    detail: 'On doit voir la calandre et le flanc conducteur.',
    plate: { w: 0.123, ratio: 3.56, rotation: 14.1, near: 'right' },
  },
  {
    id: 'front',
    label: 'Face avant',
    slug: 'avant',
    instruction: 'Placez-vous pile en face de l’avant',
    detail: 'Calandre bien parallèle à l’écran.',
    plate: { w: 0.230, ratio: 5.49, rotation: 0, near: null },
  },
  {
    id: 'front_right_34',
    label: '3/4 avant droit',
    slug: 'avant-34-droit',
    instruction: 'Passez à l’avant droit du véhicule',
    detail: 'On doit voir la calandre et le flanc passager.',
    plate: { w: 0.124, ratio: 3.39, rotation: -18.2, near: 'left' },
  },
  {
    id: 'rear',
    label: 'Arrière',
    slug: 'arriere',
    instruction: 'Contournez le véhicule et placez-vous derrière',
    detail: 'Hayon bien parallèle à l’écran.',
    plate: { w: 0.227, ratio: 5.06, rotation: 0, near: null },
  },
];

export const BONUS_STEP = {
  id: 'bonus',
  label: 'Photo bonus',
  slug: 'bonus',
  instruction: 'Cadrage libre',
  detail: 'Intérieur, jantes, détails… le cache plaque sera posé automatiquement.',
};

/** Étape par identifiant (BONUS_STEP compris), ou null. */
export function stepById(id) {
  if (id === BONUS_STEP.id) return BONUS_STEP;
  return GUIDED_STEPS.find(s => s.id === id) ?? null;
}

const clamp01 = v => Math.max(0, Math.min(1, v));

/** Gabarit par défaut : celui de la face avant. */
const DEFAULT_PLATE = GUIDED_STEPS[1].plate;

/**
 * Gabarit du cache plaque pour une étape, en coordonnées normalisées du
 * viseur (0–1 sur la largeur et la hauteur de la zone visible).
 *
 * `aspect` = largeur/hauteur de la zone visible. Il est indispensable : le
 * gabarit doit garder sa forme et son inclinaison à l'écran, or les
 * coordonnées normalisées x et y n'ont pas la même échelle en pixels. Le
 * quadrilatère est donc construit et tourné dans une unité commune — la
 * largeur du viseur — puis reconverti en y à la toute fin.
 */
export function plateQuadForStep(stepId, aspect = 3 / 4, frame = PLATE_FRAME) {
  const step = stepById(stepId);
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 3 / 4;
  const g = step?.plate ?? DEFAULT_PLATE;

  const w = g.w;                                  // en largeurs de viseur
  // `ratio` a été relevé sur le rectangle englobant du cache : la hauteur qu'il
  // décrit est donc celle du bord le PLUS épais, pas une moyenne. Le définir
  // ainsi ici rend le gabarit mesurable exactement comme les photos de
  // référence — sinon les vues 3/4 sortent 4 % trop plates.
  const hNear = w / Math.max(0.01, g.ratio);
  const hFar = g.near ? hNear / NEAR_FAR : hNear;
  const hLeft = g.near === 'left' ? hNear : g.near === 'right' ? hFar : hNear;
  const hRight = g.near === 'right' ? hNear : g.near === 'left' ? hFar : hNear;

  const rad = ((g.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // Rotation autour du centre, y vers le bas : un angle positif fait descendre
  // le bord droit, comme sur une vue 3/4 avant gauche.
  const place = (u, v) => ({
    x: clamp01(frame.cx + (u * cos - v * sin)),
    y: clamp01(frame.cy + (u * sin + v * cos) * a),
  });

  return {
    tl: place(-w / 2, -hLeft / 2),
    tr: place(+w / 2, -hRight / 2),
    br: place(+w / 2, +hRight / 2),
    bl: place(-w / 2, +hLeft / 2),
  };
}

/** Boîte englobante d'un quadrilatère normalisé. */
export function quadBBox(quad) {
  if (!quad) return null;
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  if (pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return {
    x1: Math.min(...xs), y1: Math.min(...ys),
    x2: Math.max(...xs), y2: Math.max(...ys),
  };
}

/**
 * Zone de la vidéo réellement visible sous `object-fit: cover`.
 *
 * Le viseur affiche la vidéo recadrée : capturer l'image vidéo entière
 * donnerait une photo plus large que ce que l'utilisateur a cadré, et le cache
 * plaque ne tomberait plus au même endroit. On capture donc exactement la zone
 * visible — ce que l'utilisateur voit est ce qu'il obtient, et les coordonnées
 * normalisées du viseur valent telles quelles dans la photo produite.
 */
export function coverSourceRect(videoW, videoH, boxW, boxH) {
  const vw = Number(videoW) || 0, vh = Number(videoH) || 0;
  const bw = Number(boxW) || 0, bh = Number(boxH) || 0;
  if (vw <= 0 || vh <= 0) return null;
  if (bw <= 0 || bh <= 0) return { sx: 0, sy: 0, sw: vw, sh: vh };

  const videoRatio = vw / vh, boxRatio = bw / bh;
  if (videoRatio > boxRatio) {
    // Vidéo plus large que le viseur : on rogne les côtés.
    const sw = vh * boxRatio;
    return { sx: (vw - sw) / 2, sy: 0, sw, sh: vh };
  }
  // Vidéo plus haute que le viseur : on rogne en haut et en bas.
  const sh = vw / boxRatio;
  return { sx: 0, sy: (vh - sh) / 2, sw: vw, sh };
}

/**
 * Identifiants des étapes obligatoires déjà photographiées, sans doublon :
 * reprendre une étape la remplace, elle ne compte pas deux fois.
 */
export function doneStepIds(shots) {
  const seen = new Set();
  for (const s of shots || []) {
    if (GUIDED_STEPS.some(st => st.id === s?.stepId)) seen.add(s.stepId);
  }
  return [...seen];
}

/** Index de la prochaine étape obligatoire à faire, ou -1 si le tour est bouclé. */
export function nextPendingStepIndex(shots) {
  const done = new Set(doneStepIds(shots));
  return GUIDED_STEPS.findIndex(s => !done.has(s.id));
}

/** Les quatre prises imposées sont-elles faites ? */
export function isTourComplete(shots) {
  return nextPendingStepIndex(shots) === -1;
}

/** Nombre de photos bonus. */
export function bonusCount(shots) {
  return (shots || []).filter(s => s?.stepId === BONUS_STEP.id).length;
}

/**
 * Nom de fichier ordonné et lisible. L'ordre du parcours doit survivre au tri
 * alphabétique : il structure l'annonce (3/4 gauche, face, 3/4 droit, arrière)
 * jusque dans l'export et l'envoi par mail.
 */
export function tourFileName(index, stepId, bonusIndex = 0) {
  const step = stepById(stepId);
  const n = String(Math.max(0, Math.round(index)) + 1).padStart(2, '0');
  const slug = step?.slug ?? 'photo';
  const suffix = stepId === BONUS_STEP.id && bonusIndex > 0
    ? `${slug}-${String(bonusIndex).padStart(2, '0')}`
    : slug;
  return `parcours_${n}_${suffix}.jpg`;
}

/**
 * Remet les prises dans l'ordre du parcours (les quatre imposées d'abord,
 * dans l'ordre des étapes, puis les bonus dans l'ordre de prise) et leur
 * attribue leur nom de fichier définitif.
 *
 * Renvoie `[{ shot, name, stepId }]`.
 */
export function orderedShots(shots) {
  const list = (shots || []).filter(Boolean);
  const ordered = [];
  for (const step of GUIDED_STEPS) {
    // Une étape reprise plusieurs fois ne garde que sa dernière version.
    const last = [...list].reverse().find(s => s.stepId === step.id);
    if (last) ordered.push(last);
  }
  ordered.push(...list.filter(s => s.stepId === BONUS_STEP.id));

  let bonus = 0;
  return ordered.map((shot, i) => ({
    shot,
    stepId: shot.stepId,
    name: tourFileName(i, shot.stepId, shot.stepId === BONUS_STEP.id ? ++bonus : 0),
  }));
}

// =============================================================================
//  Contrôle de prise de vue — calculs locaux sur le flux vidéo.
//
//  Aucun appel réseau : la netteté et l'exposition se mesurent sur une vignette
//  de luminance. Le verdict est INDICATIF — il conseille, il ne bloque jamais
//  le déclencheur : sur une photo d'annonce à contre-jour, c'est l'utilisateur
//  qui décide.
//
//  Pas de contrôle de cadrage ici : le cadrage est libre (on peut vouloir un
//  détail de jante), et le gabarit du cache suffit à guider les vues imposées.
// =============================================================================

/** Seuils calibrés pour un smartphone tenu à ~3 m du véhicule. */
export const QUALITY = {
  minBlurVar: 45,   // variance du laplacien — en dessous, flou de bougé
  minLuma: 26,      // sous-exposé (contre-jour, nuit)
  maxLuma: 234,     // surexposé (soleil de face)
};

/**
 * Variance du laplacien — mesure de netteté classique.
 * Image nette = beaucoup de hautes fréquences = variance élevée.
 * `gray` : Float32Array|Uint8ClampedArray de luminance, longueur w*h.
 */
export function blurScore(gray, w, h) {
  if (!gray || w < 3 || h < 3) return 0;
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // Noyau laplacien 4-voisins.
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Luminance moyenne (0–255) — détecte contre-jour et surexposition. */
export function meanLuma(gray) {
  if (!gray || !gray.length) return 0;
  let s = 0;
  for (let i = 0; i < gray.length; i++) s += gray[i];
  return s / gray.length;
}

/**
 * Conseil de prise de vue, ou null si rien à signaler. Le message doit dire
 * quoi corriger, pas seulement que c'est raté.
 *
 * L'exposition est diagnostiquée AVANT la netteté : une photo noire est
 * forcément aussi « floue », mais le motif utile pour l'utilisateur est
 * l'exposition.
 */
export function frameAdvice({ blurVar, luma }, thresholds = QUALITY) {
  const t = { ...QUALITY, ...thresholds };
  if (luma < t.minLuma) return { code: 'dark', message: 'Trop sombre — cherchez de la lumière' };
  if (luma > t.maxLuma) return { code: 'bright', message: 'Surexposé — évitez le soleil de face' };
  if (blurVar < t.minBlurVar) return { code: 'blur', message: 'Photo floue — stabilisez l’appareil' };
  return null;
}

/** Résumé d'avancement affiché sous le viseur. */
export function tourProgress(shots) {
  const done = doneStepIds(shots).length;
  const total = GUIDED_STEPS.length;
  return { done, total, bonus: bonusCount(shots), complete: done >= total };
}
