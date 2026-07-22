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

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function setUserPlan(userId, plan) {
  const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, {
    user_metadata: { plan },
  });
  if (error) throw new Error(`Supabase update failed: ${error.message}`);
}

async function activateSubscription(userId, plan, formule, stripeCustomerId) {
  // Active l'abonnement et démarre une fenêtre mensuelle de crédits.
  // Le quota (300 photos/mois) est remis à zéro chaque mois côté application,
  // indépendamment de la cadence de facturation (hebdo / mensuel / annuel).
  const meta = { plan, photos_used: 0, showroom_used: 0, photos_period_start: new Date().toISOString() };
  if (formule) meta.formule = formule;
  if (stripeCustomerId) meta.stripe_customer_id = stripeCustomerId;
  const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, {
    user_metadata: meta,
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
      const userId     = session.client_reference_id || session.metadata?.userId;
      const plan       = session.metadata?.plan || "premium";
      const formule    = session.metadata?.formule || null;
      const customerId = typeof session.customer === "string" ? session.customer : null;
      if (userId) {
        await activateSubscription(userId, plan, formule, customerId);
        console.log(`Abonnement "${plan}" (formule: ${formule}) activé pour user ${userId} (customer: ${customerId})`);
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

    if (event.type === "customer.subscription.updated") {
      // Si Stripe passe l'abonnement en unpaid/canceled (après échec des relances),
      // on coupe l'accès. Si le paiement est rattrapé et l'abo repasse en active, on restaure.
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      if (userId && (subscription.status === "unpaid" || subscription.status === "canceled")) {
        await setUserPlan(userId, "trial");
        console.log(`Abonnement ${subscription.status} — user ${userId} repassé en trial`);
      }
      if (userId && subscription.status === "active" && subscription.metadata?.plan) {
        await setUserPlan(userId, subscription.metadata.plan);
        console.log(`Abonnement réactivé — user ${userId} plan "${subscription.metadata.plan}"`);
      }
    }

    if (event.type === "invoice.payment_failed") {
      // Échec de paiement — on NE coupe PAS l'accès immédiatement.
      // L'utilisateur garde son accès jusqu'à la fin de la période déjà payée.
      // Stripe retente automatiquement. Si toutes les tentatives échouent,
      // l'abonnement passe en unpaid/canceled (géré par customer.subscription.updated).
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = subscription.metadata?.userId;
        console.warn(`Paiement échoué — user ${userId} (tentative ${invoice.attempt_count}). Accès maintenu jusqu'à fin de période.`);
      }
    }

    if (event.type === "invoice.paid") {
      // Paiement réussi (renouvellement) → réactive le plan + remet les crédits à zéro
      const invoice = event.data.object;
      if (invoice.subscription && invoice.billing_reason === "subscription_cycle") {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId  = subscription.metadata?.userId;
        const plan    = subscription.metadata?.plan || "premium";
        const formule = subscription.metadata?.formule || null;
        if (userId) {
          const meta = { plan, photos_used: 0, headlight_photos_used: 0, showroom_used: 0 };
          if (formule) meta.formule = formule;
          const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, {
            user_metadata: meta,
          });
          if (error) throw new Error(`Supabase update failed: ${error.message}`);
          console.log(`Renouvellement réussi — user ${userId} (formule: ${formule}) crédits remis à zéro`);
        }
      }
    }

  } catch (e) {
    console.error("Erreur traitement webhook:", e.message);
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ received: true });
}
