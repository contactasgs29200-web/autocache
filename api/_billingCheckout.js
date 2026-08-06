// api/_billingCheckout.js — servi par api/billing.js (op: "checkout")
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

  // Garde-fou : une remise ne doit jamais atteindre le prix de la formule.
  // Une remise fixe de 5 € appliquée à une échéance de 4,90 € ramène le dû à
  // 0 € — l'abonnement est alors ouvert sans le moindre encaissement. La liste
  // des formules éligibles ne suffit pas : elle ne protège de rien si la remise
  // vient d'ailleurs (coupon rattaché au client, code promotionnel automatique
  // configuré dans le tableau de bord Stripe). On vérifie donc le montant réel
  // du prix avant de joindre quoi que ce soit.
  const COUPON_ID = "PREMIERE_ECHEANCE_5EUR";
  const COUPON_AMOUNT = 500; // centimes

  let priceAmount = null;
  try {
    const price = await stripe.prices.retrieve(priceId);
    priceAmount = price.unit_amount;
  } catch (e) {
    console.error("Lecture du prix impossible:", e.message);
    return res.status(500).json({ error: "Tarif indisponible, réessayez." });
  }

  const remiseAdmissible = priceAmount != null && priceAmount > COUPON_AMOUNT;
  if (COUPON_FORMULES.includes(formule) && !remiseAdmissible) {
    console.warn(`[checkout] remise écartée : ${formule} à ${priceAmount} c. ne peut absorber ${COUPON_AMOUNT} c.`);
  }

  let discounts;
  if (COUPON_FORMULES.includes(formule) && remiseAdmissible) {
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
      // Stripe refuse `discounts` et `allow_promotion_codes` ensemble : quand
      // la remise de lancement s'applique d'office, le champ de code est donc
      // absent. Sinon on l'ouvre — il sert aux campagnes promotionnelles, et
      // permet de souscrire à 0 € avec un code dédié pour éprouver le parcours
      // complet sans mouvement d'argent réel.
      ...(discounts ? { discounts } : { allow_promotion_codes: true }),
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
