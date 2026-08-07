// api/_stripeShapes.js
// Lecture des champs Stripe qui ont CHANGÉ DE PLACE d'une version d'API à
// l'autre.
//
// Stripe ne casse pas les intégrations existantes : chaque compte reste figé sur
// la version d'API en vigueur lors de sa création, et les champs déplacés
// restent lisibles à l'ancien emplacement pour les anciens comptes. Un compte
// récent — celui-ci est en `2026-03-25.dahlia` — reçoit en revanche les objets
// dans leur forme nouvelle, où ces champs valent `undefined` là où le code les
// cherchait. L'erreur est silencieuse : pas d'exception, juste une condition qui
// ne se vérifie jamais et un traitement qui n'a pas lieu.
//
// Ces lecteurs interrogent les deux emplacements. Ils restent donc justes quelle
// que soit la version du compte, et le jour où la version est relevée il n'y a
// rien à changer.

// Bornes de la période facturée.
// Déplacées de l'abonnement vers ses lignes : lues au seul ancien emplacement,
// l'espace client affichait « Invalid Date » et « NaN jour ».
export function periodOf(sub) {
  const item = sub?.items?.data?.[0];
  return {
    start: sub?.current_period_start ?? item?.current_period_start ?? null,
    end:   sub?.current_period_end   ?? item?.current_period_end   ?? null,
  };
}

// Abonnement rattaché à une facture.
//
// `invoice.subscription` a disparu de l'objet Facture au profit de
// `invoice.parent.subscription_details.subscription`, la facture pouvant
// désormais avoir d'autres origines qu'un abonnement. Conséquence sur ce projet :
// `invoice.paid` et `invoice.payment_failed` ne trouvaient plus d'abonnement,
// donc l'encaissement d'un renouvellement ne remettait pas le quota à zéro et un
// impayé ne suspendait pas l'accès — le webhook répondant malgré tout 200, rien
// ne le signalait.
//
// Troisième emplacement, en dernier recours : les lignes de la facture, qui
// portent l'abonnement de leur côté. Une facture de renouvellement en a toujours
// au moins une.
export function subscriptionIdOfInvoice(invoice) {
  const candidats = [
    invoice?.subscription,
    invoice?.parent?.subscription_details?.subscription,
    ...(invoice?.lines?.data ?? []).flatMap(l => [
      l?.parent?.subscription_item_details?.subscription,
      l?.subscription,
    ]),
  ];
  for (const c of candidats) {
    if (typeof c === "string" && c) return c;
    if (c && typeof c === "object" && typeof c.id === "string") return c.id;
  }
  return null;
}
