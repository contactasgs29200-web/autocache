// src/legalTerms.js
// Règles de publication des conditions générales.
//
// Modifier des CGV n'est pas un simple enregistrement de texte : c'est modifier
// un contrat déjà conclu avec des clients qui paient. Les CGV en vigueur au
// moment de la souscription restent la loi des parties tant que le client n'a
// pas accepté les nouvelles. Publier une version qui s'appliquerait
// rétroactivement, sans préavis ni information, expose à voir la clause modifiée
// déclarée inopposable — voire abusive.
//
// Ce module encode donc ce qu'une publication doit respecter :
//
//   1. VERSIONNAGE      chaque publication crée une version numérotée, jamais
//                       une modification en place. Les versions précédentes
//                       restent consultables et opposables pour la période où
//                       elles étaient en vigueur.
//   2. EMPREINTE        chaque version porte l'empreinte de son texte : ce qui
//                       a été accepté est prouvable, mot pour mot.
//   3. RÉSUMÉ           toute publication exige un résumé des modifications.
//                       C'est l'obligation d'information : le client doit savoir
//                       CE QUI change, pas seulement que quelque chose a changé.
//   4. PRÉAVIS          une modification substantielle n'entre en vigueur qu'au
//                       terme d'un préavis (30 jours par défaut), pendant lequel
//                       le client peut résilier sans frais s'il la refuse.
//   5. NON-RÉTROACTIVITÉ chaque client reste lié à la version qu'il a acceptée
//                       jusqu'à l'entrée en vigueur de la suivante.
//   6. TRAÇABILITÉ      acceptations horodatées, journal des publications.
//
// Les trois natures de modification ne se valent pas, et c'est volontaire :
// corriger une faute de frappe n'appelle pas trente jours de préavis, augmenter
// un tarif si.

export const DOC_KEY = "cgv";

export const DEFAULT_NOTICE_DAYS = 30;

// `notice`     : préavis minimal en jours avant entrée en vigueur.
// `acceptance` : la nouvelle version doit-elle être acceptée explicitement ?
// `blocking`   : à défaut d'acceptation passé l'entrée en vigueur, l'accès au
//                service est-il conditionné à une réponse du client ?
export const CHANGE_KINDS = {
  substantive: {
    key: "substantive",
    label: "Modification substantielle",
    hint: "Tarifs, quotas, durée, résiliation, responsabilité, droits et obligations.",
    notice: DEFAULT_NOTICE_DAYS,
    acceptance: true,
    blocking: true,
    consequence:
      "Préavis de 30 jours minimum. Les clients sont informés, restent régis par la version précédente jusqu'à l'entrée en vigueur, et peuvent résilier sans frais d'ici là.",
  },
  legal: {
    key: "legal",
    label: "Mise en conformité légale",
    hint: "Transposition d'une obligation légale ou réglementaire nouvelle, sans marge de choix.",
    notice: 0,
    acceptance: true,
    blocking: false,
    consequence:
      "Entrée en vigueur immédiate possible, la modification étant imposée par la loi. Les clients en sont informés et l'acceptation est enregistrée, sans blocage de l'accès.",
  },
  minor: {
    key: "minor",
    label: "Correction de forme",
    hint: "Faute, reformulation, coordonnées. Aucune obligation des parties n'est modifiée.",
    notice: 0,
    acceptance: false,
    blocking: false,
    consequence:
      "Entrée en vigueur immédiate, sans notification bloquante. La version reste archivée et horodatée.",
  },
};

export const CHANGE_KIND_LIST = [CHANGE_KINDS.substantive, CHANGE_KINDS.legal, CHANGE_KINDS.minor];

export const SUMMARY_MIN = 20;
export const SUMMARY_MAX = 1000;
export const BODY_MIN = 200;
export const TITLE_MAX = 160;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function kindOf(key) {
  return CHANGE_KINDS[key] ?? null;
}

// Empreinte du texte — FNV-1a sur 64 bits, écrite en deux moitiés de 32.
// Le choix d'une implémentation locale plutôt que d'un SHA-256 est assumé : il
// ne s'agit pas de résister à une collision fabriquée par un adversaire, mais de
// constater qu'un texte accepté est bien celui qui est affiché. La même
// fonction tourne dans le navigateur et sur le serveur, sans dépendance ni
// asynchronisme.
export function hashContent(text) {
  const s = String(text ?? "");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x85ebca6b) >>> 0;
  }
  const hex = n => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}-${s.length}`;
}

export function minimumNoticeDays(kindKey) {
  return kindOf(kindKey)?.notice ?? DEFAULT_NOTICE_DAYS;
}

// Première date d'entrée en vigueur admissible pour une nature de modification.
export function earliestEffectiveDate(kindKey, publishedAt = new Date(), noticeDays) {
  const base = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  const jours = Number.isFinite(Number(noticeDays))
    ? Math.max(Number(noticeDays), minimumNoticeDays(kindKey))
    : minimumNoticeDays(kindKey);
  return new Date(base.getTime() + jours * MS_PER_DAY);
}

// Date proposée par défaut dans le formulaire : l'échéance minimale, à minuit,
// arrondie au jour suivant. Un préavis « à la minute près » n'a pas de sens et
// se calcule mal — les préavis se comptent en jours.
//
// Exception pour les natures sans préavis : la date proposée est le JOUR MÊME.
// Proposer demain à une correction de faute de frappe contredirait ce que le
// panneau annonce (« entrée en vigueur immédiate »).
export function suggestedEffectiveDate(kindKey, now = new Date()) {
  const base = now instanceof Date ? now : new Date(now);
  if (minimumNoticeDays(kindKey) === 0) return startOfUTCDay(base);

  const min = earliestEffectiveDate(kindKey, base);
  const d = startOfUTCDay(min);
  if (d.getTime() < min.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

// Contrôle d'une demande de publication. Renvoie le document prêt à écrire.
export function validatePublication(input = {}, now = new Date()) {
  const kind = kindOf(input.kind);
  if (!kind) return { ok: false, error: "Nature de la modification non précisée." };

  const title = String(input.title ?? "").trim().slice(0, TITLE_MAX);
  if (!title) return { ok: false, error: "Le titre du document est obligatoire." };

  const summary = String(input.summary ?? "").trim().slice(0, SUMMARY_MAX);
  if (summary.length < SUMMARY_MIN) {
    return {
      ok: false,
      error: `Le résumé des modifications est obligatoire (${SUMMARY_MIN} caractères minimum). Il est communiqué aux clients : c'est lui qui les informe de ce qui change.`,
    };
  }

  const body = String(input.body ?? "").trim();
  if (body.length < BODY_MIN) {
    return { ok: false, error: "Le texte du document est vide ou tronqué — publication refusée." };
  }

  const noticeDays = Number.isFinite(Number(input.noticeDays))
    ? Math.max(0, Math.floor(Number(input.noticeDays)))
    : kind.notice;
  if (noticeDays < kind.notice) {
    return {
      ok: false,
      error: `Une ${kind.label.toLowerCase()} suppose un préavis d'au moins ${kind.notice} jours.`,
    };
  }

  let effective = input.effectiveAt ? new Date(input.effectiveAt) : suggestedEffectiveDate(input.kind, now);
  if (Number.isNaN(effective.getTime())) {
    return { ok: false, error: "Date d'entrée en vigueur illisible." };
  }

  // Le formulaire ne saisit qu'une DATE, sans heure : « aujourd'hui » y vaut
  // minuit, donc quelques heures dans le passé. Pour une nature sans préavis,
  // cela signifie « tout de suite » et non « ce matin » — la date est ramenée à
  // l'instant de publication. La tolérance s'arrête au jour courant : une date
  // d'hier reste refusée, y compris sans préavis.
  const nowDate = now instanceof Date ? now : new Date(now);
  if (noticeDays === 0 && effective.getTime() < nowDate.getTime()
      && effective.getTime() >= startOfUTCDay(nowDate).getTime()) {
    effective = new Date(nowDate);
  }

  // Tolérance d'une minute : le formulaire propose une date calculée à
  // l'ouverture, et le temps passé à rédiger ne doit pas la rendre invalide au
  // moment d'envoyer.
  const minimum = earliestEffectiveDate(input.kind, now, noticeDays);
  if (effective.getTime() < minimum.getTime() - 60_000) {
    const jours = Math.max(kind.notice, noticeDays);
    return {
      ok: false,
      error: jours > 0
        ? `Entrée en vigueur trop proche : ${jours} jours de préavis sont requis, soit le ${minimum.toLocaleDateString("fr-FR")} au plus tôt.`
        : "L'entrée en vigueur ne peut pas être antérieure à la publication : une modification rétroactive est inopposable.",
    };
  }

  return {
    ok: true,
    value: {
      docKey: DOC_KEY,
      title,
      summary,
      kind: kind.key,
      body,
      contentHash: hashContent(body),
      noticeDays,
      effectiveAt: effective.toISOString(),
      publishedAt: new Date(now).toISOString(),
    },
  };
}

// ── Côté client : que doit-on demander à cet utilisateur ? ────────────────
//
// `accepted` provient des droits du compte : { version, hash, at }.
// Renvoie :
//   mode "none"     rien à demander
//        "info"     information non bloquante (préavis en cours, ou conformité)
//        "blocking" la version est entrée en vigueur et n'a pas été acceptée
export function acceptanceState({ doc, accepted, now = new Date() } = {}) {
  const vide = { mode: "none", required: false, blocking: false, version: null, effectiveAt: null, inForce: false };
  if (!doc || !doc.version) return vide;

  const kind = kindOf(doc.kind) ?? CHANGE_KINDS.substantive;
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const effective = doc.effectiveAt ? new Date(doc.effectiveAt).getTime() : t;
  const inForce = Number.isFinite(effective) ? effective <= t : true;

  const dejaAccepte = !!accepted
    && Number(accepted.version) === Number(doc.version)
    && (!accepted.hash || !doc.contentHash || accepted.hash === doc.contentHash);

  if (dejaAccepte || !kind.acceptance) {
    return { ...vide, version: doc.version, effectiveAt: doc.effectiveAt ?? null, inForce };
  }

  const bloquant = kind.blocking && inForce;
  return {
    mode: bloquant ? "blocking" : "info",
    required: true,
    blocking: bloquant,
    version: doc.version,
    effectiveAt: doc.effectiveAt ?? null,
    inForce,
    kind: kind.key,
    // Un client qui refuse la nouvelle version doit pouvoir partir sans frais :
    // c'est la contrepartie du droit de modifier unilatéralement le contrat.
    mayTerminate: kind.blocking,
  };
}

// Version qui LIE un client donné à un instant donné : la dernière version
// entrée en vigueur, à défaut celle qu'il a acceptée. C'est cette version-là qui
// s'applique en cas de litige, pas nécessairement la dernière publiée.
export function bindingVersion(docs, accepted, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const enVigueur = (Array.isArray(docs) ? docs : [])
    .filter(d => d?.effectiveAt && new Date(d.effectiveAt).getTime() <= t)
    .sort((a, b) => Number(b.version) - Number(a.version))[0];

  if (enVigueur) return Number(enVigueur.version);
  return accepted?.version ? Number(accepted.version) : null;
}

// Garanties appliquées à chaque publication, affichées dans le panneau avant
// de publier. Les énoncer sur place évite de publier une hausse tarifaire en
// croyant corriger une virgule.
export const LEGAL_GUARANTEES = [
  "La version précédente est archivée, horodatée et reste consultable publiquement.",
  "Le texte publié porte une empreinte : ce qui a été accepté est prouvable.",
  "Le résumé des modifications est obligatoire et communiqué aux clients.",
  "Une modification substantielle n'entre en vigueur qu'après 30 jours de préavis.",
  "Chaque client reste régi par la version acceptée jusqu'à cette entrée en vigueur.",
  "Le refus de la nouvelle version ouvre la résiliation sans frais ni pénalité.",
  "Acceptations et publications sont journalisées, avec date et auteur.",
];
