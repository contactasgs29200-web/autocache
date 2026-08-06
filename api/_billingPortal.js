// api/_billingPortal.js — servi par api/billing.js (op: "portal")
import Stripe from "stripe";
import { requireUser } from "./_auth.js";
import { formuleFromInterval } from "../src/subscriptionQuota.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // L'identité vient du jeton, plus du corps de la requête. Auparavant, poster
  // un `userId` quelconque suffisait à obtenir une session du portail de
  // facturation de ce client — factures, moyen de paiement, résiliation.
  //
  // `allowSuspended` : un compte suspendu ou banni continue d'être prélevé par
  // Stripe tant qu'il n'a pas résilié. Lui fermer cette porte reviendrait à
  // couper le service tout en encaissant, sans issue — c'est le seul accès que
  // la sanction ne retire pas, comme le prévoit l'article 8 des CGV.
  const user = await requireUser(req, res, { allowSuspended: true });
  if (!user) return;

  const { action } = req.body || {};
  const stripeCustomerId = user.app_metadata?.stripe_customer_id;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Abonnement « en cours » au sens large : on inclut les statuts en défaut de
  // paiement, sinon un abonnement past_due disparaît de l'interface et le Client
  // n'a plus aucun moyen de comprendre pourquoi son accès est coupé, ni de
  // mettre sa carte à jour.
  const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid"];

  // Bornes de la période en cours.
  // Les versions récentes de l'API Stripe ont déplacé `current_period_start` et
  // `current_period_end` de l'abonnement vers ses lignes : lus à l'ancien
  // emplacement ils valent `undefined`, et l'interface affichait « Invalid
  // Date » et « NaN jour ». On lit les deux emplacements pour rester juste
  // quelle que soit la version d'API du compte.
  function periodOf(sub) {
    const item = sub?.items?.data?.[0];
    return {
      start: sub?.current_period_start ?? item?.current_period_start ?? null,
      end:   sub?.current_period_end   ?? item?.current_period_end   ?? null,
    };
  }

  async function findSubscription() {
    const { data } = await stripe.subscriptions.list({
      customer: stripeCustomerId, status: "all", limit: 10,
    });
    return data.find(s => LIVE_STATUSES.includes(s.status)) || null;
  }

  /* ── action: "subscription-info" ── */
  if (action === "subscription-info") {
    if (!stripeCustomerId) return res.status(200).json({ hasSubscription: false });
    try {
      const sub = await findSubscription();
      if (!sub) return res.status(200).json({ hasSubscription: false });
      const { start, end } = periodOf(sub);
      return res.status(200).json({
        hasSubscription: true,
        periodStart: start,
        periodEnd: end,
        plan: sub.metadata?.plan || null,
        // Même règle qu'ailleurs : la cadence facturée prime sur l'étiquette
        // posée au paiement, pour que l'en-tête n'annonce pas « Mensuelle »
        // au-dessus d'un quota hebdomadaire.
        formule: formuleFromInterval(sub.items?.data?.[0]?.price?.recurring?.interval)
                 || sub.metadata?.formule || null,
        status: sub.status,
        // Résiliation demandée : plus aucun prélèvement, l'accès court jusqu'à
        // `periodEnd`. L'interface doit dire « fin d'accès » et non
        // « prochain paiement », sinon la résiliation paraît sans effet.
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      });
    } catch (e) {
      console.error("Subscription info error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── action: "cancel" ── */
  // Ouvre le portail Stripe directement sur le parcours de résiliation, plutôt
  // que sur l'accueil du portail : le Client ne dépend plus de la présence du
  // bouton « Annuler » dans la configuration du portail pour pouvoir résilier.
  // Stripe applique `cancel_at_period_end` : aucun nouveau prélèvement, accès
  // conservé jusqu'au terme de la période déjà réglée.
  if (action === "cancel") {
    if (!stripeCustomerId) return res.status(400).json({ error: "Aucun compte Stripe associé" });
    try {
      const sub = await findSubscription();
      if (!sub) return res.status(404).json({ error: "Aucun abonnement en cours" });
      if (sub.cancel_at_period_end) {
        return res.status(200).json({ alreadyCancelled: true, periodEnd: periodOf(sub).end });
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: req.headers.origin || "https://autocache.fr",
        flow_data: {
          type: "subscription_cancel",
          subscription_cancel: { subscription: sub.id },
        },
      });
      return res.status(200).json({ url: session.url });
    } catch (e) {
      console.error("Cancel flow error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── default: portal session ── */
  if (!stripeCustomerId) return res.status(400).json({ error: "Aucun compte Stripe associé" });
  const origin = req.headers.origin || "https://autocache.fr";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: origin,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Customer portal error:", e);
    return res.status(500).json({ error: e.message });
  }
}
