import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Désactiver le body parser pour lire le raw body (requis pour la vérification Stripe)
export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function setUserPlan(userId, plan) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { plan },
  });
  if (error) throw new Error(`Supabase update failed: ${error.message}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Webhook signature invalide:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.userId;
      const plan   = session.metadata?.plan;
      if (userId && plan) {
        await setUserPlan(userId, plan);
        console.log(`Plan "${plan}" activé pour user ${userId}`);
      }
    }

    if (event.type === "customer.subscription.deleted") {
      // Abonnement résilié → retour en essai
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      if (userId) {
        await setUserPlan(userId, "trial");
        console.log(`Abonnement résilié — user ${userId} repassé en trial`);
      }
    }

    if (event.type === "invoice.payment_failed") {
      // Échec de paiement → accès coupé immédiatement (retour en trial)
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = subscription.metadata?.userId;
        if (userId) {
          await setUserPlan(userId, "trial");
          console.warn(`Paiement échoué — user ${userId} repassé en trial (tentative ${invoice.attempt_count})`);
        }
      }
    }

    if (event.type === "invoice.paid") {
      // Paiement réussi (renouvellement ou rattrapage d'impayé) → réactive le plan
      const invoice = event.data.object;
      if (invoice.subscription && invoice.billing_reason === "subscription_cycle") {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = subscription.metadata?.userId;
        const plan   = subscription.metadata?.plan;
        if (userId && plan) {
          await setUserPlan(userId, plan);
          console.log(`Renouvellement réussi — user ${userId} plan "${plan}" réactivé`);
        }
      }
    }

  } catch (e) {
    console.error("Erreur traitement webhook:", e.message);
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ received: true });
}
