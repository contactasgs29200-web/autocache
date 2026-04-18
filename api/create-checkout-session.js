import Stripe from "stripe";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { plan, userId, userEmail } = req.body || {};
  if (!plan || !userId || !userEmail) return res.status(400).json({ error: "Paramètres manquants." });

  const priceId = plan === "pro"
    ? process.env.STRIPE_PRO_PRICE_ID
    : process.env.STRIPE_ESSENTIAL_PRICE_ID;

  if (!priceId) return res.status(500).json({ error: "Price ID non configuré." });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.origin || "https://autocache.fr";

  // Crée le coupon "premier mois -5€" s'il n'existe pas encore
  const COUPON_ID = "PREMIER_MOIS_5EUR";
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

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: userEmail,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      discounts: [{ coupon: COUPON_ID }],
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
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
