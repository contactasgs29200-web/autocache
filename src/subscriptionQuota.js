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
