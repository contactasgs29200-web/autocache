// =============================================================================
//  Showroom interactif — logique pure de la capture guidée et du visualiseur.
//
//  L'utilisateur fait le tour du véhicule ; l'app le guide et déclenche
//  automatiquement à chaque vue. Les prises retenues repartent ensuite dans le
//  pipeline habituel (cache plaque, fond, colorimétrie), puis s'assemblent en
//  un tour 360° que l'acheteur fait pivoter au doigt.
//
//  Coût marginal : ZÉRO appel API. Les contrôles qualité (flou, cadrage,
//  exposition) sont des calculs locaux sur le flux vidéo — aucune image ne
//  quitte l'appareil pendant la capture.
//
//  Aucune dépendance navigateur dans ce fichier : tout est testable en Node.
//  Les composants React (ShowroomCapture, Spin360) n'y ajoutent que l'UI et
//  l'accès caméra.
// =============================================================================

// ── Plan de capture ──────────────────────────────────────────────────────────

export const DEFAULT_VIEWS = 24;   // 1 vue tous les 15° — fluide sans être lourd
export const MIN_VIEWS = 8;
export const MAX_VIEWS = 48;

// Tolérance pour considérer qu'on est arrivé sur une vue cible. Trop serré,
// l'utilisateur n'arrive jamais à déclencher ; trop large, les vues sont mal
// réparties et la rotation saccade.
export const ANGLE_TOLERANCE_DEG = 7;

// Sauts de boussole au-delà de ce seuil = décrochage magnétique, pas un
// déplacement réel : on se resynchronise sans compter la distance.
const MAX_PLAUSIBLE_STEP_DEG = 45;
// En deçà, c'est du tremblement de main : ignoré pour ne pas dériver.
const MIN_SIGNIFICANT_STEP_DEG = 0.4;

// ── Seuils qualité ───────────────────────────────────────────────────────────
// Calibrés pour un smartphone tenu à hauteur de hanche à ~3 m du véhicule.
// Volontairement permissifs : mieux vaut accepter une prise moyenne que
// bloquer l'utilisateur en plein tour.
export const QUALITY = {
  minBlurVar: 45,   // variance du laplacien — en dessous, flou de bougé
  minFill: 0.16,    // le véhicule doit occuper une part suffisante du cadre
  maxFill: 0.94,    // ... sans déborder complètement (trop près)
  minLuma: 26,      // sous-exposé (contre-jour, nuit)
  maxLuma: 234,     // surexposé (soleil de face)
};

// ── Angles ───────────────────────────────────────────────────────────────────

/** Ramène un angle quelconque dans [0, 360). */
export function normalizeAngle(deg) {
  if (!Number.isFinite(deg)) return 0;
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * Écart signé le plus court de `from` vers `to`, dans [-180, 180].
 * Positif = sens horaire.
 */
export function angularDelta(from, to) {
  const d = normalizeAngle(to) - normalizeAngle(from);
  if (d > 180) return d - 360;
  if (d <= -180) return d + 360;
  return d;
}

/** Angles cibles répartis uniformément sur le tour, en partant de 0°. */
export function targetAngles(views = DEFAULT_VIEWS) {
  const n = clampViews(views);
  return Array.from({ length: n }, (_, i) => (i * 360) / n);
}

/** Borne le nombre de vues dans la plage supportée. */
export function clampViews(views) {
  const n = Math.round(Number(views) || DEFAULT_VIEWS);
  return Math.min(MAX_VIEWS, Math.max(MIN_VIEWS, n));
}

/**
 * Suit la progression angulaire autour du véhicule à partir du cap boussole.
 *
 * En tournant autour d'une voiture pour la garder dans le cadre, le cap de
 * l'appareil décrit lui aussi un tour complet : le cumul des écarts de cap est
 * donc une bonne approximation de l'angle parcouru autour du sujet.
 *
 * Le cumul est SIGNÉ : sens horaire positif, antihoraire négatif. L'appelant
 * regarde `Math.abs(travelled)` pour la progression et le signe pour le sens.
 */
export function createOrbitTracker() {
  let last = null;
  let travelled = 0;

  return {
    /** Intègre un nouveau cap (degrés). Renvoie la distance cumulée signée. */
    push(heading) {
      if (!Number.isFinite(heading)) return travelled;
      const h = normalizeAngle(heading);
      if (last === null) { last = h; return travelled; }

      const d = angularDelta(last, h);
      const step = Math.abs(d);
      if (step > MAX_PLAUSIBLE_STEP_DEG) {
        last = h;               // décrochage boussole : resync sans compter
      } else if (step >= MIN_SIGNIFICANT_STEP_DEG) {
        travelled += d;
        last = h;
      }
      return travelled;
    },
    get travelled() { return travelled; },
    /** Angle parcouru en valeur absolue, borné à 360°. */
    get progress() { return Math.min(360, Math.abs(travelled)); },
    /** +1 horaire, -1 antihoraire, 0 tant qu'aucun sens n'est établi. */
    get direction() {
      if (Math.abs(travelled) < ANGLE_TOLERANCE_DEG) return 0;
      return travelled > 0 ? 1 : -1;
    },
    reset() { last = null; travelled = 0; },
  };
}

/**
 * Faut-il déclencher ? Vrai quand l'angle parcouru a rattrapé la prochaine vue
 * attendue, à la tolérance près.
 */
export function shouldCapture(progressDeg, capturedCount, views = DEFAULT_VIEWS) {
  const n = clampViews(views);
  if (capturedCount >= n) return false;
  if (capturedCount === 0) return true;         // 1re vue : dès que prêt
  const target = (capturedCount * 360) / n;
  return progressDeg >= target - ANGLE_TOLERANCE_DEG;
}

/** Degrés restants avant la prochaine vue (0 si on peut déclencher). */
export function degreesToNext(progressDeg, capturedCount, views = DEFAULT_VIEWS) {
  const n = clampViews(views);
  if (capturedCount >= n) return 0;
  const target = (capturedCount * 360) / n;
  return Math.max(0, target - progressDeg);
}

// ── Analyse d'image (buffers de luminance, aucun canvas) ─────────────────────

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
 * Estime la part du cadre occupée par le sujet, sans modèle ni appel réseau.
 *
 * Un véhicule bien cadré remplit le centre de l'image de contours (arêtes de
 * carrosserie, vitrages, jantes) alors qu'un fond de parking ou de ciel est
 * lisse. On mesure donc la fraction de pixels à fort gradient — proxy grossier
 * mais suffisant pour distinguer « voiture dans le cadre » de « je filme le
 * bitume » ou « je suis trop loin ».
 */
export function subjectFill(gray, w, h) {
  if (!gray || w < 3 || h < 3) return 0;
  // Seuil de gradient relatif au contraste global : robuste à l'exposition.
  let gsum = 0, gn = 0;
  const grads = new Float32Array((w - 2) * (h - 2));
  let k = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      const g = Math.abs(gx) + Math.abs(gy);
      grads[k++] = g;
      gsum += g; gn++;
    }
  }
  if (!gn) return 0;
  const meanG = gsum / gn;
  // Un fond uniforme a un gradient moyen quasi nul : pas de sujet.
  if (meanG < 1.5) return 0;
  const thr = Math.max(6, meanG * 1.4);
  let strong = 0;
  for (let i = 0; i < k; i++) if (grads[i] >= thr) strong++;
  return strong / k;
}

/**
 * Verdict qualité d'une prise. Renvoie un motif de rejet lisible : c'est ce
 * texte que l'utilisateur voit à l'écran, il doit dire quoi corriger.
 */
export function frameQuality({ blurVar, fill, luma }, thresholds = QUALITY) {
  const t = { ...QUALITY, ...thresholds };
  if (luma < t.minLuma) {
    return { ok: false, code: 'dark', message: 'Trop sombre — cherchez de la lumière' };
  }
  if (luma > t.maxLuma) {
    return { ok: false, code: 'bright', message: 'Surexposé — évitez le soleil de face' };
  }
  if (blurVar < t.minBlurVar) {
    return { ok: false, code: 'blur', message: 'Photo floue — stabilisez l’appareil' };
  }
  if (fill < t.minFill) {
    return { ok: false, code: 'far', message: 'Véhicule trop loin — rapprochez-vous' };
  }
  if (fill > t.maxFill) {
    return { ok: false, code: 'near', message: 'Véhicule trop près — reculez' };
  }
  return { ok: true, code: 'ok', message: 'Prêt' };
}

// ── Visualiseur 360 ──────────────────────────────────────────────────────────

/**
 * Index de vue pour un glissement horizontal.
 * `sensitivity` = nombre de largeurs d'écran pour un tour complet.
 */
export function frameIndexFromDrag(startIndex, dx, width, count, sensitivity = 1) {
  if (!count || !width) return 0;
  const framesPerPx = count / (width * sensitivity);
  // Glisser vers la gauche fait tourner le véhicule dans le sens de la marche.
  const idx = Math.round(startIndex - dx * framesPerPx);
  return ((idx % count) + count) % count;
}

/** Index de la vue la plus proche d'un angle donné. */
export function frameIndexFromAngle(angleDeg, count) {
  if (!count) return 0;
  const a = normalizeAngle(angleDeg);
  return Math.round((a / 360) * count) % count;
}

/**
 * Un tour est-il exploitable ? Sous 8 vues la rotation saccade trop pour être
 * présentable à un acheteur ; les trous d'angle en fin de tour sont tolérés.
 */
export function isSpinUsable(frameCount, views = DEFAULT_VIEWS) {
  return frameCount >= Math.min(MIN_VIEWS, clampViews(views));
}

/** Nom de fichier ordonné — l'ordre du tour doit survivre à l'export. */
export function frameFileName(index, total, prefix = 'showroom360') {
  const width = String(clampViews(total)).length;
  return `${prefix}_${String(index + 1).padStart(width, '0')}.jpg`;
}

// =============================================================================
//  Couverture 2D — le « scan » proprement dit.
//
//  Un simple tour horizontal laisse le bas de caisse et le pavillon non
//  couverts. On découpe donc la surface à parcourir en une grille
//  azimut × élévation : l'utilisateur doit remplir toutes les cases, guidé par
//  des consignes directionnelles, comme un enrôlement d'empreinte remplit la
//  surface du doigt.
// =============================================================================

export const AZIMUTH_SECTORS = 12;          // 12 secteurs de 30° autour du véhicule
export const BANDS = ['low', 'mid', 'high'];

export const BAND_LABELS = {
  low: 'bas de caisse',
  mid: 'ligne médiane',
  high: 'toit et vitrage',
};

// Tangage de visée, en degrés : 0 = appareil vertical (visée horizontale),
// négatif = caméra inclinée vers le bas, positif = vers le haut.
export const BAND_PITCH_LIMITS = { lowMax: -12, highMin: 12 };

/**
 * Convertit l'angle `beta` de DeviceOrientation en tangage de visée.
 * beta ≈ 90 quand l'appareil est tenu verticalement, écran face à soi.
 */
export function pitchFromBeta(beta) {
  if (!Number.isFinite(beta)) return 0;
  return beta - 90;
}

/** Bande d'élévation visée pour un tangage donné. */
export function bandFromPitch(pitchDeg) {
  const p = Number.isFinite(pitchDeg) ? pitchDeg : 0;
  if (p <= BAND_PITCH_LIMITS.lowMax) return 'low';
  if (p >= BAND_PITCH_LIMITS.highMin) return 'high';
  return 'mid';
}

/** Secteur azimutal (0..sectors-1) pour un angle parcouru. */
export function sectorFromAngle(progressDeg, sectors = AZIMUTH_SECTORS) {
  const n = Math.max(1, Math.round(sectors));
  return Math.floor(normalizeAngle(progressDeg) / (360 / n)) % n;
}

/** Distance circulaire entre deux secteurs, en nombre de secteurs. */
export function sectorDistance(a, b, sectors = AZIMUTH_SECTORS) {
  const n = Math.max(1, Math.round(sectors));
  const d = Math.abs(((a - b) % n + n) % n);
  return Math.min(d, n - d);
}

/**
 * Grille de couverture azimut × élévation.
 * Chaque case retient l'index de la prise qui l'a remplie (ou null).
 */
export function createCoverageMap(sectors = AZIMUTH_SECTORS, bands = BANDS) {
  const n = Math.max(1, Math.round(sectors));
  const cells = new Map();                       // "sector:band" → shotIndex
  const key = (s, b) => `${s}:${b}`;

  return {
    sectors: n,
    bands: [...bands],
    get total() { return n * bands.length; },
    get filled() { return cells.size; },
    get ratio() { return cells.size / (n * bands.length); },
    get complete() { return cells.size >= n * bands.length; },

    isCovered(sector, band) { return cells.has(key(sector, band)); },
    mark(sector, band, shotIndex) {
      if (cells.has(key(sector, band))) return false;
      cells.set(key(sector, band), shotIndex);
      return true;
    },
    /** Retire la dernière prise (bouton « Reprendre »). */
    unmarkShot(shotIndex) {
      for (const [k, v] of cells) if (v === shotIndex) { cells.delete(k); return true; }
      return false;
    },
    /** Cases encore vides, dans l'ordre secteur puis bande. */
    missing() {
      const out = [];
      for (let s = 0; s < n; s++) {
        for (const b of bands) if (!cells.has(key(s, b))) out.push({ sector: s, band: b });
      }
      return out;
    },
    /** Vue à plat pour le rendu de la grille. */
    snapshot() {
      return bands.map(b => ({
        band: b,
        cells: Array.from({ length: n }, (_, s) => cells.has(key(s, b))),
      }));
    },
  };
}

/**
 * Consigne à afficher, d'après la position visée et ce qu'il reste à couvrir.
 *
 * Priorité : si la case visée est vide, on y déclenche. Sinon on désigne la
 * case manquante la plus proche, en privilégiant un changement de hauteur
 * (geste immédiat, sans se déplacer) sur un changement de secteur.
 */
export function guidanceFor(coverage, sector, band, direction = 1) {
  if (!coverage) return { action: 'wait', message: 'Initialisation…' };
  if (coverage.complete) return { action: 'done', message: 'Scan complet' };

  if (!coverage.isCovered(sector, band)) {
    return { action: 'capture', message: `Maintenez — ${BAND_LABELS[band]}`, sector, band };
  }

  const bands = coverage.bands;
  const bandIndex = b => bands.indexOf(b);
  let best = null;
  for (const cell of coverage.missing()) {
    // Tourner coûte plus cher que lever ou baisser le téléphone : le poids 3
    // pousse à finir les trois hauteurs d'un secteur avant d'avancer.
    const cost = sectorDistance(cell.sector, sector, coverage.sectors) * 3
      + Math.abs(bandIndex(cell.band) - bandIndex(band));
    if (!best || cost < best.cost) best = { ...cell, cost };
  }
  if (!best) return { action: 'done', message: 'Scan complet' };

  const dBand = bandIndex(best.band) - bandIndex(band);
  const dSector = sectorDistance(best.sector, sector, coverage.sectors);

  if (dSector === 0) {
    return dBand > 0
      ? { action: 'tilt_up', message: `Levez l’appareil — ${BAND_LABELS[best.band]}`, target: best }
      : { action: 'tilt_down', message: `Baissez l’appareil — ${BAND_LABELS[best.band]}`, target: best };
  }

  // Sens de marche : on renvoie l'utilisateur en avant par défaut, en arrière
  // seulement si la case manquante est nettement derrière lui.
  const n = coverage.sectors;
  const ahead = ((best.sector - sector) * (direction >= 0 ? 1 : -1) % n + n) % n;
  return ahead <= n / 2
    ? { action: 'advance', message: 'Continuez d’avancer autour du véhicule', target: best }
    : { action: 'back', message: 'Revenez en arrière — une zone a été sautée', target: best };
}

/**
 * Un scan est-il exploitable ? On tolère des trous, mais pas un tour amputé :
 * la ligne médiane doit être complète (c'est elle qui porte le tour 360°) et la
 * couverture globale doit dépasser les deux tiers.
 */
export function isScanUsable(coverage) {
  if (!coverage) return false;
  const midMissing = coverage.missing().filter(c => c.band === 'mid').length;
  return midMissing === 0 && coverage.ratio >= 0.66;
}
