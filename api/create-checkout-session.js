import Stripe from "stripe";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { plan, period, userId, userEmail } = req.body || {};
  if (!plan || !userId || !userEmail) return res.status(400).json({ error: "Paramètres manquants." });

  // Plan unique "pro" facturé selon 3 cadences : hebdomadaire / mensuel / annuel.
  // Chaque cadence pointe vers un Price ID Stripe distinct (variables d'env à créer).
  const PERIOD_PRICES = {
    weekly:  process.env.STRIPE_PRO_WEEKLY_PRICE_ID,
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID,
    annual:  process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  };

  let priceId;
  if (period && period in PERIOD_PRICES) {
    priceId = PERIOD_PRICES[period];
  } else {
    // Rétro-compatibilité : ancien appel basé uniquement sur le plan.
    priceId = plan === "pro"
      ? process.env.STRIPE_PRO_PRICE_ID
      : process.env.STRIPE_ESSENTIAL_PRICE_ID;
  }

  if (!priceId) return res.status(500).json({ error: "Price ID non configuré pour cette cadence." });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.origin || "https://autocache.fr";

  // La remise « premier mois -5€ » ne concerne que la cadence mensuelle.
  const applyDiscount = !period || period === "monthly";

  // Crée le coupon "premier mois -5€" s'il n'existe pas encore
  const COUPON_ID = "PREMIER_MOIS_5EUR";
  if (applyDiscount) {
    try {
      await stripe.coupons.retrieve(COUPON_ID);
    } catch {
      await stripe.coupons.create({
        id: COUPON_ID,
        amount_off: 500,
        currency: "eur",
        duration: "once",
        name: "Premier mois -5€",
      });
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: userEmail,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      ...(applyDiscount ? { discounts: [{ coupon: COUPON_ID }] } : {}),
      metadata: { userId, plan, period: period || "monthly" },
      subscription_data: { metadata: { userId, plan, period: period || "monthly" } },
      success_url: `${origin}?payment=success&plan=${plan}`,
      cancel_url: `${origin}?payment=cancelled`,
      locale: "fr",
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout error:", e);
    return res.status(500).json({ error: e.message });
  }
}
