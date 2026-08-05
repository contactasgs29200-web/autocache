// src/moderation.js
// Bannissements et suspensions : forme de la sanction, durée, motif, expiration.
//
// Tout est ici plutôt que dans la route serveur pour deux raisons. D'abord
// parce que ces règles sont testables sans réseau ni base. Ensuite parce que
// l'interface a besoin des MÊMES calculs — l'écran qui annonce « accès suspendu
// jusqu'au 12 mars » doit lire l'échéance exactement comme le serveur qui la
// fait respecter, sans quoi l'un rouvre l'accès pendant que l'autre le refuse.
//
// Ce que porte une sanction :
//   type   "suspension" (temporaire, échéance obligatoire) | "ban" (définitif)
//   reason motif rédigé par l'administrateur — OBLIGATOIRE
//   until  échéance ISO, null pour un bannissement
//   at     date du prononcé, by : qui l'a prononcée
//
// Le motif n'est pas décoratif : il est affiché à la personne concernée. Une
// sanction opposable se motive, et une sanction motivée se conteste — c'est
// aussi ce qui protège l'éditeur en cas de litige.

export const SANCTION_TYPES = ["suspension", "ban"];

export const REASON_MAX = 500;
export const REASON_MIN = 3;

// Bornes de durée d'une suspension : au moins une heure (en deçà, la sanction
// expire avant même d'avoir été constatée), au plus un an (au-delà, c'est un
// bannissement — et il doit être prononcé comme tel, pas déguisé en suspension
// de dix ans).
export const SUSPENSION_MIN_HOURS = 1;
export const SUSPENSION_MAX_HOURS = 24 * 365;

// Durées proposées d'un clic dans le panneau. La saisie libre reste possible.
export const SUSPENSION_PRESETS = [
  { hours: 1,        label: "1 heure" },
  { hours: 24,       label: "24 heures" },
  { hours: 72,       label: "3 jours" },
  { hours: 24 * 7,   label: "7 jours" },
  { hours: 24 * 30,  label: "30 jours" },
  { hours: 24 * 90,  label: "90 jours" },
];

// Supabase attend une durée au format Go ("72h", "30m") ou "none". Un
// bannissement n'ayant pas d'échéance, on lui en donne une hors d'atteinte
// plutôt que d'inventer un format que l'API refuserait.
export const PERMANENT_BAN_DURATION = "876000h"; // ~100 ans
export const NO_BAN = "none";

const MS_PER_HOUR = 60 * 60 * 1000;

// Motif : espaces normalisés, longueur bornée. Aucune balise n'est retirée —
// le motif est rendu comme du TEXTE, jamais interprété comme du HTML, ce qui
// rend le nettoyage inutile et l'oubli sans conséquence.
export function sanitizeReason(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, REASON_MAX);
}

// Valide une demande de sanction et renvoie l'objet à écrire.
// `{ ok: false, error }` en cas de refus : la route se contente de relayer le
// message, il est déjà rédigé pour être lu par un humain.
export function validateSanction({ type, hours, reason, by } = {}, now = new Date()) {
  if (!SANCTION_TYPES.includes(type)) {
    return { ok: false, error: "Type de sanction inconnu." };
  }

  const motif = sanitizeReason(reason);
  if (motif.length < REASON_MIN) {
    return { ok: false, error: "Un motif est obligatoire : il est communiqué à l'utilisateur." };
  }

  let until = null;
  if (type === "suspension") {
    const h = Number(hours);
    if (!Number.isFinite(h) || h < SUSPENSION_MIN_HOURS || h > SUSPENSION_MAX_HOURS) {
      return {
        ok: false,
        error: `Durée invalide : entre ${SUSPENSION_MIN_HOURS} heure et ${SUSPENSION_MAX_HOURS} heures (1 an). Au-delà, prononcez un bannissement.`,
      };
    }
    until = new Date(now.getTime() + h * MS_PER_HOUR).toISOString();
  }

  return {
    ok: true,
    sanction: {
      type,
      reason: motif,
      until,
      at: new Date(now).toISOString(),
      by: by ?? null,
    },
  };
}

// Lecture d'une sanction depuis les droits du compte. Renvoie toujours un objet
// exploitable, y compris pour un compte sain — l'appelant teste `active`, pas
// l'existence du champ.
export function sanctionState(appMetadata, now = new Date()) {
  const s = appMetadata?.sanction;
  const vide = { present: false, active: false, expired: false, type: null, reason: "", until: null, at: null, by: null, remainingMs: 0 };
  if (!s || typeof s !== "object" || !SANCTION_TYPES.includes(s.type)) return vide;

  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const echeance = s.until ? new Date(s.until).getTime() : null;
  // Une échéance illisible ne doit pas rouvrir l'accès par accident : on la
  // traite comme une sanction encore en cours, quitte à ce qu'elle soit levée
  // à la main. Se tromper dans ce sens se corrige ; l'inverse ne se voit pas.
  const expiree = s.type === "suspension" && echeance !== null && Number.isFinite(echeance) && echeance <= t;

  return {
    present: true,
    active: !expiree,
    expired: expiree,
    type: s.type,
    reason: typeof s.reason === "string" ? s.reason : "",
    until: s.until ?? null,
    at: s.at ?? null,
    by: s.by ?? null,
    remainingMs: echeance !== null && Number.isFinite(echeance) ? Math.max(0, echeance - t) : 0,
  };
}

// Durée à transmettre à Supabase (`ban_duration`). Bannir côté Supabase, et pas
// seulement écrire un champ dans les droits, est ce qui invalide réellement les
// sessions ouvertes et empêche la reconnexion : sans cela, un onglet déjà
// connecté continuerait de fonctionner jusqu'à l'expiration de son jeton.
export function banDurationFor(sanction, now = new Date()) {
  if (!sanction || !SANCTION_TYPES.includes(sanction.type)) return NO_BAN;
  if (sanction.type === "ban") return PERMANENT_BAN_DURATION;

  const echeance = sanction.until ? new Date(sanction.until).getTime() : NaN;
  if (!Number.isFinite(echeance)) return NO_BAN;

  const restant = echeance - (now instanceof Date ? now.getTime() : new Date(now).getTime());
  if (restant <= 0) return NO_BAN;

  // Minutes plutôt qu'heures : arrondir une suspension d'une heure à l'heure
  // supérieure la doublerait presque.
  return `${Math.max(1, Math.ceil(restant / 60000))}m`;
}

// Journal des sanctions conservé dans les droits du compte. Il double le
// journal d'audit en base — lequel suppose la migration SQL appliquée — pour
// que l'historique d'un compte reste consultable en toutes circonstances.
//
// Bornes serrées, et pour une raison précise : `app_metadata` est recopié dans
// CHAQUE jeton de session. Un historique généreux alourdirait tous les appels
// du compte concerné, jusqu'à buter sur la taille maximale d'un en-tête. Dix
// entrées au motif abrégé suffisent à retracer un compte ; le motif intégral
// reste dans la sanction en cours et dans le journal d'audit.
export const SANCTION_HISTORY_MAX = 10;
export const HISTORY_REASON_MAX = 160;

export function appendHistory(history, entry) {
  const liste = Array.isArray(history) ? history : [];
  const abrege = { ...entry, reason: String(entry?.reason ?? "").slice(0, HISTORY_REASON_MAX) };
  return [abrege, ...liste].slice(0, SANCTION_HISTORY_MAX);
}

// Correctif de droits appliquant une sanction.
export function sanctionPatch(sanction, previousHistory) {
  return {
    sanction,
    sanction_history: appendHistory(previousHistory, {
      action: sanction.type,
      reason: sanction.reason,
      until: sanction.until,
      at: sanction.at,
      by: sanction.by ?? null,
    }),
  };
}

// Correctif levant la sanction. `null` plutôt qu'une suppression de clé :
// l'écriture des droits fusionne, elle ne sait pas retirer un champ.
export function liftPatch(previousHistory, { by = null, reason = "", at = new Date() } = {}) {
  return {
    sanction: null,
    sanction_history: appendHistory(previousHistory, {
      action: "lift",
      reason: sanitizeReason(reason),
      until: null,
      at: new Date(at).toISOString(),
      by,
    }),
  };
}

// Message adressé à la personne sanctionnée. Écrit une seule fois et partagé
// par le serveur (refus des routes) et l'interface (écran de blocage) : deux
// formulations divergentes sur le même fait donneraient l'impression d'un
// dysfonctionnement plutôt que d'une décision.
export function sanctionMessage(state) {
  if (!state?.active) return "";
  const motif = state.reason ? ` Motif : ${state.reason}` : "";
  if (state.type === "ban") {
    return `Votre compte a été fermé et l'accès au service est définitivement révoqué.${motif}`;
  }
  const echeance = state.until ? formatDateFr(state.until) : null;
  return echeance
    ? `Votre accès est suspendu jusqu'au ${echeance}.${motif}`
    : `Votre accès est temporairement suspendu.${motif}`;
}

export function formatDateFr(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Libellé de durée restante, pour l'écran affiché à la personne suspendue.
export function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "quelques instants";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} heure${heures > 1 ? "s" : ""}`;
  const jours = Math.floor(heures / 24);
  return `${jours} jour${jours > 1 ? "s" : ""}`;
}
