// src/subscriptionQuota.js
// Règles de quota de l'abonnement AutoCache — source de vérité unique,
// partagée par l'application (affichage + décompte) et par le webhook Stripe
// (réinitialisation à l'encaissement). Toute divergence entre ces deux chemins
// se traduirait par un quota accordé deux fois, ou jamais.
//
// Le volume est adossé à la CADENCE DE FACTURATION :
//   - hebdomadaire : 250 photos par tranche de 7 jours
//   - mensuel      : 1 000 photos par mois calendaire
//   - annuel       : 1 000 photos par mois calendaire
//
// Les trois formules représentent donc le même volume mensuel (~1 000 photos).
// Servir l'hebdomadaire par tranches de 250 plutôt qu'en un bloc de 1 000 évite
// qu'une seule semaine payée — la formule la moins chère à l'unité — ne donne
// accès à un mois entier de traitement.

export const DEFAULT_FORMULE = "monthly";

// Volume de l'essai gratuit, offert une seule fois et jamais renouvelé.
export const TRIAL_PHOTOS = 30;

// Quota applicable à un compte, essai compris. Sert de référence commune au
// serveur — qui décompte et refuse — et à l'interface, qui affiche le solde.
export function limitFor(plan, formule) {
  return (plan ?? "trial") === "trial" ? TRIAL_PHOTOS : photosForFormule(formule);
}

export const FORMULE_QUOTA = {
  weekly:  { photos: 250,  period: { unit: "week",  count: 1 } },
  monthly: { photos: 1000, period: { unit: "month", count: 1 } },
  annual:  { photos: 1000, period: { unit: "month", count: 1 } },
};

// Les comptes sans formule connue — crédités par code administrateur, ou
// souscrits avant que la formule ne soit enregistrée — retombent sur la règle
// mensuelle, la plus courante.
export function quotaForFormule(formule) {
  return FORMULE_QUOTA[formule] ?? FORMULE_QUOTA[DEFAULT_FORMULE];
}

// Déduit la formule de la CADENCE RÉELLEMENT FACTURÉE par Stripe.
//
// La formule est aussi enregistrée en métadonnée au moment du paiement, mais
// cette métadonnée reflète le bouton cliqué, pas le tarif appliqué : si un
// identifiant de tarif est mal renseigné, elle annonce « mensuel » sur un
// abonnement prélevé chaque semaine, et le quota accordé ne correspond plus à
// ce que paie l'abonné. L'intervalle du prix, lui, ne peut pas mentir — c'est
// littéralement ce qui est débité.
export function formuleFromInterval(interval) {
  switch (interval) {
    case "week":  return "weekly";
    case "month": return "monthly";
    case "year":  return "annual";
    default:      return null;
  }
}

export function photosForFormule(formule) {
  return quotaForFormule(formule).photos;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Nombre de fenêtres de quota entièrement écoulées depuis `anchorIso`.
// 0 signifie « toujours dans la fenêtre en cours » : ne rien réinitialiser.
export function periodsElapsed(formule, anchorIso, now = new Date()) {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return 0;

  const { period } = quotaForFormule(formule);

  if (period.unit === "week") {
    // Fenêtre glissante de 7 jours : on compte les journées pleines, ce qui
    // reste juste au passage d'un mois comme d'un changement d'heure.
    const days = Math.floor((now.getTime() - anchor.getTime()) / MS_PER_DAY);
    return Math.max(0, Math.floor(days / (7 * period.count)));
  }

  // Mois calendaires révolus : le quota se renouvelle à la date anniversaire.
  let months = (now.getFullYear() - anchor.getFullYear()) * 12
             + (now.getMonth() - anchor.getMonth());
  if (now.getDate() < anchor.getDate()) months -= 1; // jour du mois pas encore atteint
  return Math.max(0, Math.floor(months / period.count));
}

// Avance l'ancre de `periods` fenêtres, sans la caler sur « maintenant » :
// la date anniversaire de souscription est ainsi préservée, même si
// l'utilisateur ne revient qu'après plusieurs fenêtres d'absence.
export function advanceAnchor(formule, anchorIso, periods) {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime()) || periods < 1) return anchorIso;

  const { period } = quotaForFormule(formule);
  const next = new Date(anchor);
  if (period.unit === "week") {
    next.setDate(next.getDate() + periods * 7 * period.count);
  } else {
    next.setMonth(next.getMonth() + periods * period.count);
  }
  return next.toISOString();
}

// ── Crédits accordés à la main par l'administrateur ────────────────────────
//
// Le panneau d'administration peut augmenter le quota d'un compte. Ces photos
// supplémentaires ne remplacent pas le quota de la formule : elles s'y ajoutent,
// et ne sont entamées qu'une fois le quota de base épuisé.
//
// Pourquoi un compteur séparé plutôt que de retrancher au compteur d'usage,
// comme le font les codes promotionnels : un compteur d'usage ne peut pas
// descendre sous zéro, donc cette méthode ne sait pas accorder plus que la
// formule, et surtout le cadeau disparaît au renouvellement de la fenêtre. Un
// solde de crédits, lui, survit au renouvellement — diminué de ce qui a été
// réellement consommé sur la période écoulée, jamais davantage.
export function limitWithBonus(plan, formule, bonus) {
  return limitFor(plan, formule) + normalizeBonus(bonus);
}

export function normalizeBonus(bonus) {
  const n = Number(bonus);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Solde de crédits restant au passage d'une fenêtre à la suivante.
// `used` étant remis à zéro, il faut d'abord retirer du solde la part de crédits
// consommée pendant la fenêtre qui s'achève : tout ce qui dépassait le quota de
// base a forcément été pris sur les crédits.
export function carryBonus(bonus, used, base) {
  const solde = normalizeBonus(bonus);
  const consomme = Math.max(0, Number(used ?? 0) - Number(base ?? 0));
  return Math.max(0, solde - consomme);
}

// État complet du quota d'un compte à un instant donné, renouvellement de
// fenêtre compris.
//
// Le renouvellement était calculé à deux endroits : au décompte, qui l'écrit, et
// à l'affichage, qui l'ignorait. Un compte revenu après un mois d'absence
// voyait donc son ancien compteur jusqu'à la première photo traitée. Cette
// fonction est désormais la seule à savoir ce que vaut un quota : le décompte
// s'en sert pour écrire, le panneau d'administration pour montrer, et les deux
// disent la même chose.
export function quotaSnapshot({ plan, formule, photosUsed, periodStart, bonus } = {}, now = new Date()) {
  const base = limitFor(plan, formule);
  const stored = Number.isFinite(Number(photosUsed)) ? Math.max(0, Math.floor(Number(photosUsed))) : 0;
  let solde = normalizeBonus(bonus);
  let used = stored;
  let debut = periodStart ?? null;
  let renouvelee = false;

  // L'essai gratuit est hors fenêtre : ses photos sont offertes une fois et ne
  // se rechargent jamais.
  if ((plan ?? "trial") !== "trial") {
    if (!debut) {
      debut = new Date(now).toISOString();
    } else {
      const periodes = periodsElapsed(formule, debut, now instanceof Date ? now : new Date(now));
      if (periodes >= 1) {
        solde = carryBonus(solde, stored, base);
        used = 0;
        debut = advanceAnchor(formule, debut, periodes);
        renouvelee = true;
      }
    }
  }

  const limit = base + solde;
  return {
    base,
    bonus: solde,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    periodStart: debut,
    periodEnd: (plan ?? "trial") === "trial" || !debut ? null : advanceAnchor(formule, debut, 1),
    renewed: renouvelee,
  };
}

// ── Historique de consommation, mois par mois ──────────────────────────────
//
// Le compteur d'usage est remis à zéro à chaque fenêtre : il dit ce qui reste,
// jamais ce qui a été consommé le mois dernier. L'historique répond à cette
// seconde question — c'est ce que le panneau d'administration affiche sous
// « consommation mensuelle ».
//
// Clés en temps universel (`2026-08`) et non en heure locale : le décompte est
// écrit par le serveur et relu par des navigateurs de fuseaux quelconques ; sans
// référence commune, une photo traitée le 1er du mois à 00h30 changerait de mois
// selon qui regarde.
export const HISTORY_MONTHS_MAX = 24;

export function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return monthKey(new Date());
  return d.toISOString().slice(0, 7);
}

export function recordMonthly(history, count, date = new Date(), keep = HISTORY_MONTHS_MAX) {
  const n = Number(count);
  const ajout = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const source = history && typeof history === "object" && !Array.isArray(history) ? history : {};
  const cle = monthKey(date);

  const fusion = { ...source };
  const precedent = Number(fusion[cle]);
  fusion[cle] = (Number.isFinite(precedent) && precedent > 0 ? precedent : 0) + ajout;

  // Bornage : les droits d'un compte voyagent dans chaque jeton de session, et
  // un historique sans limite finirait par les alourdir sans rien apporter.
  const cles = Object.keys(fusion).sort().slice(-Math.max(1, keep));
  const borne = {};
  for (const k of cles) borne[k] = fusion[k];
  return borne;
}

// Historique en liste décroissante, prêt à afficher : les mois sans usage
// apparaissent à zéro plutôt que d'être absents, sans quoi un graphique
// donnerait à voir une continuité qui n'existe pas.
export function monthlySeries(history, months = 12, now = new Date()) {
  const source = history && typeof history === "object" && !Array.isArray(history) ? history : {};
  const fin = now instanceof Date ? now : new Date(now);
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - i, 1));
    const k = monthKey(d);
    const v = Number(source[k]);
    out.push({ month: k, photos: Number.isFinite(v) && v > 0 ? v : 0 });
  }
  return out;
}

// "1 000" plutôt que "1000" — séparateur de milliers français.
export function formatPhotos(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Libellé commercial, affiché sur les cartes de formule et dans l'espace client.
export function quotaLabel(formule) {
  const { photos, period } = quotaForFormule(formule);
  const unite = period.unit === "week" ? "semaine" : "mois";
  return `${formatPhotos(photos)} photos / ${unite}`;
}
