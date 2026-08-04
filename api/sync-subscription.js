// /api/sync-subscription.js
// Réconciliation de l'abonnement : demande directement à Stripe si le compte
// connecté a un abonnement en cours, et aligne le compte en conséquence.
//
// Pourquoi cette route existe :
// L'activation reposait uniquement sur le webhook `checkout.session.completed`.
// Un webhook est une notification « au mieux » — il peut ne pas être configuré,
// viser une mauvaise URL, échouer sur un démarrage à froid, ou arriver après
// que l'utilisateur a fermé l'onglet. Dans tous ces cas l'abonné payait sans
// rien obtenir, et aucun rechargement ne le débloquait puisque rien n'allait
// jamais redemander à Stripe.
//
// Ici on inverse la charge : c'est l'application qui interroge Stripe, source
// de vérité du paiement. Le webhook reste utile — il réagit sans délai et gère
// les impayés et résiliations — mais il n'est plus le seul chemin d'activation.

import Stripe from "stripe";
import { requireUser } from "./_auth.js";
import { formuleFromInterval } from "../src/subscriptionQuota.js";
import { writeEntitlements, entitlementsOf } from "./_entitlements.js";

const ACTIVE_STATUSES = ["active", "trialing"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireUser(req, res);
  if (!user) return;

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // 1. Retrouver le client Stripe. L'identifiant mémorisé est le chemin
    //    normal ; la recherche par email couvre le cas où le webhook n'a
    //    jamais tourné et ne l'a donc jamais enregistré — précisément la
    //    situation que cette route doit rattraper.
    const customerIds = [];
    const known = entitlementsOf(user).stripeCustomerId;
    if (known) customerIds.push(known);

    if (user.email) {
      const { data: found } = await stripe.customers.list({ email: user.email, limit: 10 });
      for (const c of found) if (!customerIds.includes(c.id)) customerIds.push(c.id);
    }

    if (customerIds.length === 0) {
      return res.status(200).json({ active: false, reason: "no_customer" });
    }

    // 2. Chercher un abonnement en cours parmi ces clients. Stripe Checkout
    //    crée un client par session lorsqu'aucun n'est transmis : un même
    //    email peut donc en avoir plusieurs, et seul l'un d'eux porte
    //    l'abonnement payé.
    let sub = null;
    for (const id of customerIds) {
      const { data } = await stripe.subscriptions.list({ customer: id, status: "all", limit: 10 });
      sub = data.find(s => ACTIVE_STATUSES.includes(s.status));
      if (sub) break;
    }

    if (!sub) {
      return res.status(200).json({ active: false, reason: "no_active_subscription" });
    }

    // 3. Aligner le compte. On n'écrase le quota que si l'abonnement n'était
    //    pas déjà actif côté compte : une réconciliation répétée ne doit pas
    //    rouvrir un quota déjà consommé.
    const plan = sub.metadata?.plan || "premium";
    // La cadence facturée fait foi : la métadonnée `formule` reflète le bouton
    // cliqué, et diverge dès qu'un identifiant de tarif est mal renseigné.
    const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
    const formule = formuleFromInterval(interval) || sub.metadata?.formule || null;
    if (sub.metadata?.formule && formule !== sub.metadata.formule) {
      console.warn(`[sync] formule annoncée "${sub.metadata.formule}" ≠ cadence facturée "${interval}" — la cadence l'emporte`);
    }
    const wasActive = entitlementsOf(user).plan !== "trial";

    const meta = { plan, stripe_customer_id: sub.customer };
    if (formule) meta.formule = formule;
    if (!wasActive) {
      meta.photos_used = 0;
      meta.headlight_photos_used = 0;
      meta.photos_period_start = new Date().toISOString();
    }

    await writeEntitlements(user.id, meta);

    console.log(`[sync] user ${user.id} : abonnement ${sub.status} (${formule}) — compte aligné`);
    return res.status(200).json({
      active: true,
      plan,
      formule,
      status: sub.status,
      activated: !wasActive,
    });
  } catch (e) {
    console.error("sync-subscription error:", e);
    return res.status(500).json({ error: e.message });
  }
}
