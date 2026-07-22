import Stripe from "stripe";

// Deux abonnements AutoCache, chacun décliné en 3 formules de facturation :
//  - pro     : l'abonnement classique (cache plaque, logo, ajustements…)
//  - premium : pro + mode Showroom (détourage Photoroom + ombre IA, 150/mois)
// Valeur du plan écrite dans les métadonnées Stripe/Supabase :
//  pro → "pro", premium → "premium_showroom".
// ("premium" tout court = anciens abonnés du plan unique, conservé tel quel.)
const PRICE_ENV = {
  pro: {
    weekly:  "STRIPE_WEEKLY_PRICE_ID",
    monthly: "STRIPE_MONTHLY_PRICE_ID",
    annual:  "STRIPE_ANNUAL_PRICE_ID",
  },
  premium: {
    weekly:  "STRIPE_PREMIUM_WEEKLY_PRICE_ID",
    monthly: "STRIPE_PREMIUM_MONTHLY_PRICE_ID",
    annual:  "STRIPE_PREMIUM_ANNUAL_PRICE_ID",
  },
};

const PLAN_METADATA = { pro: "pro", premium: "premium_showroom" };

// Le coupon "-5€ première échéance" s'applique uniquement aux formules
// mensuelle et annuelle (l'hebdo "découverte" est déjà l'offre d'entrée).
const COUPON_FORMULES = ["monthly", "annual"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { formule, userId, userEmail, plan = "pro" } = req.body || {};
  if (!formule || !userId || !userEmail) return res.status(400).json({ error: "Paramètres manquants." });

  const planPrices = PRICE_ENV[plan];
  if (!planPrices) return res.status(400).json({ error: "Plan inconnu." });
  const envName = planPrices[formule];
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

  const planMeta = PLAN_METADATA[plan];
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: userEmail,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      metadata: { userId, plan: planMeta, formule },
      subscription_data: { metadata: { userId, plan: planMeta, formule } },
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
