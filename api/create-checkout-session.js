import Stripe from "stripe";
import { requireUser, corsHeaders } from "./_auth.js";

// Abonnement unique AutoCache, décliné en 3 formules de facturation.
const PRICE_ENV = {
  weekly:  "STRIPE_WEEKLY_PRICE_ID",
  monthly: "STRIPE_MONTHLY_PRICE_ID",
  annual:  "STRIPE_ANNUAL_PRICE_ID",
};

// Le coupon "-5€ première échéance" s'applique uniquement aux formules
// mensuelle et annuelle (l'hebdo "découverte" à 4,90€ est déjà l'offre d'entrée).
const COUPON_FORMULES = ["monthly", "annual"];

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Le compte à créditer est celui du jeton, jamais celui annoncé dans le
  // corps : sans cela, on pouvait ouvrir un paiement rattaché au compte d'un
  // tiers, et l'abonnement se serait activé sur le mauvais compte.
  const user = await requireUser(req, res);
  if (!user) return;

  const userId = user.id;
  const userEmail = user.email;
  const { formule } = req.body || {};
  if (!formule || !userEmail) return res.status(400).json({ error: "Paramètres manquants." });

  const envName = PRICE_ENV[formule];
  if (!envName) return res.status(400).json({ error: "Formule inconnue." });
  const priceId = process.env[envName];
  if (!priceId) return res.status(500).json({ error: "Price ID non configuré." });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.origin || "https://autocache.fr";

  // Crée le coupon "première échéance -5€" s'il n'existe pas encore
  const COUPON_ID = "PREMIERE_ECHEANCE_5EUR";
  let discounts;
  if (COUPON_FORMULES.includes(formule)) {
    try {
      await stripe.coupons.retrieve(COUPON_ID);
    } catch {
      await stripe.coupons.create({
        id: COUPON_ID,
        amount_off: 500,
        currency: "eur",
        duration: "once",
        name: "Première échéance -5€",
      });
    }
    discounts = [{ coupon: COUPON_ID }];
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: userEmail,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      metadata: { userId, plan: "premium", formule },
      subscription_data: { metadata: { userId, plan: "premium", formule } },
      success_url: `${origin}?payment=success&formule=${formule}`,
      cancel_url: `${origin}?payment=cancelled`,
      locale: "fr",
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout error:", e);
    return res.status(500).json({ error: e.message });
  }
}
