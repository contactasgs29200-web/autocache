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

/** Rapport largeur/hauteur d'une plaque française (520 × 110 mm). */
export const PLATE_ASPECT = 520 / 110;

/**
 * Position du cache plaque dans le viseur, en coordonnées normalisées.
 * `cy` est légèrement sous le milieu : une plaque se trouve en bas de calandre,
 * et viser pile le centre obligerait à pointer l'appareil vers le sol.
 * `w` est la largeur MAXIMALE du gabarit (atteinte de face) ; les vues 3/4
 * la réduisent — voir plateWidthForYaw.
 */
export const PLATE_FRAME = { cx: 0.5, cy: 0.56, w: 0.26 };

// Basculement du cache sur les vues 3/4 : le bord proche paraît plus haut que
// le bord lointain. Sans ça, le gabarit ne ressemblerait à aucune plaque réelle
// vue de biais.
const PERSPECTIVE_TILT = 0.15;

// Véhicule de référence (mètres) pour dimensionner le gabarit. Une plaque ne
// rétrécit pas seulement du cosinus de l'angle : sur une vue 3/4, la LONGUEUR
// du véhicule entre dans le cadre, donc à cadrage constant tout le reste
// rapetisse. Ignorer ce terme donnerait un cache deux fois trop grand sur les
// vues 3/4 — l'utilisateur devrait coller le pare-chocs pour l'y faire entrer.
const CAR = { width: 1.82, length: 4.5, plate: 0.52 };
// Part de la largeur du viseur occupée par le véhicule sur une photo d'annonce.
const CAR_FILL = 0.9;
// Plancher : sous ~16 % de la largeur, viser dans le cache devient pénible et
// la plaque sort trop petite dans le fichier. Mieux vaut un gabarit un peu
// généreux — le cache de repli couvrira large, ce qui est le bon sens du
// risque : un cache débordant sur le pare-chocs s'ajuste, une plaque lisible
// non.
const MIN_PLATE_W = 0.16;

/**
 * Les quatre prises du parcours, dans l'ordre de marche autour du véhicule :
 * on commence à l'avant gauche, on passe devant, on continue vers l'avant
 * droit, puis on contourne jusqu'à l'arrière. Aucun aller-retour.
 *
 * `yaw` = angle de la face photographiée par rapport à l'axe de visée.
 * `near` = côté du cadre où le bord de la plaque est le plus proche.
 */
export const GUIDED_STEPS = [
  {
    id: 'front_left_34',
    label: '3/4 avant gauche',
    slug: 'avant-34-gauche',
    instruction: 'Placez-vous à l’avant gauche du véhicule',
    detail: 'On doit voir la calandre et le flanc conducteur.',
    yaw: -32,
    near: 'left',
  },
  {
    id: 'front',
    label: 'Face avant',
    slug: 'avant',
    instruction: 'Placez-vous pile en face de l’avant',
    detail: 'Calandre bien parallèle à l’écran.',
    yaw: 0,
    near: null,
  },
  {
    id: 'front_right_34',
    label: '3/4 avant droit',
    slug: 'avant-34-droit',
    instruction: 'Passez à l’avant droit du véhicule',
    detail: 'On doit voir la calandre et le flanc passager.',
    yaw: 32,
    near: 'right',
  },
  {
    id: 'rear',
    label: 'Arrière',
    slug: 'arriere',
    instruction: 'Contournez le véhicule et placez-vous derrière',
    detail: 'Hayon bien parallèle à l’écran.',
    yaw: 0,
    near: null,
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

/**
 * Largeur du cache dans le viseur, en fraction de la largeur d'écran, pour une
 * face vue sous l'angle `yaw` — véhicule cadré en pleine largeur.
 *
 * Vue de face (yaw = 0) : 0,52 m de plaque sur 1,82 m de largeur de véhicule,
 * lui-même occupant 90 % du cadre → ~26 %. Vue de 3/4, le véhicule présente sa
 * largeur ET sa longueur : il paraît deux fois plus large, tout rapetisse.
 */
export function plateWidthForYaw(yaw) {
  const rad = ((Number.isFinite(yaw) ? yaw : 0) * Math.PI) / 180;
  const carApparent = CAR.width * Math.abs(Math.cos(rad)) + CAR.length * Math.abs(Math.sin(rad));
  if (carApparent <= 0) return MIN_PLATE_W;
  return CAR_FILL * (CAR.plate * Math.abs(Math.cos(rad))) / carApparent;
}

/**
 * Gabarit du cache plaque pour une étape, en coordonnées normalisées du
 * viseur (0–1 sur la largeur et la hauteur de la zone visible).
 *
 * `aspect` = largeur/hauteur de la zone visible. Il est indispensable : la
 * plaque doit garder son rapport 520/110 à l'écran, or les coordonnées
 * normalisées x et y n'ont pas la même échelle en pixels.
 */
export function plateQuadForStep(stepId, aspect = 3 / 4, frame = PLATE_FRAME) {
  const step = stepById(stepId) ?? GUIDED_STEPS[0];
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 3 / 4;
  const yaw = Number.isFinite(step.yaw) ? step.yaw : 0;
  const rad = (yaw * Math.PI) / 180;

  const w = Math.max(MIN_PLATE_W, Math.min(frame.w, plateWidthForYaw(yaw)));
  const h = (w * a) / PLATE_ASPECT;

  // Bord proche plus haut que le bord lointain — sur une vue de face, tilt = 0
  // et le gabarit redevient un rectangle.
  const tilt = PERSPECTIVE_TILT * Math.abs(Math.sin(rad));
  const hNear = h * (1 + tilt);
  const hFar = h * (1 - tilt);
  const hLeft = step.near === 'left' ? hNear : step.near === 'right' ? hFar : h;
  const hRight = step.near === 'right' ? hNear : step.near === 'left' ? hFar : h;

  const x1 = frame.cx - w / 2;
  const x2 = frame.cx + w / 2;
  return {
    tl: { x: clamp01(x1), y: clamp01(frame.cy - hLeft / 2) },
    tr: { x: clamp01(x2), y: clamp01(frame.cy - hRight / 2) },
    br: { x: clamp01(x2), y: clamp01(frame.cy + hRight / 2) },
    bl: { x: clamp01(x1), y: clamp01(frame.cy + hLeft / 2) },
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

/** Résumé d'avancement affiché sous le viseur. */
export function tourProgress(shots) {
  const done = doneStepIds(shots).length;
  const total = GUIDED_STEPS.length;
  return { done, total, bonus: bonusCount(shots), complete: done >= total };
}
