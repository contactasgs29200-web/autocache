import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { periodsElapsed, advanceAnchor, formuleFromInterval } from "../src/subscriptionQuota.js";
import { writeEntitlements, entitlementsOf, freshUser } from "./_entitlements.js";

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
  await writeEntitlements(userId, { plan });
}

// ── Statuts Stripe et accès ────────────────────────────────────────────────
// Seuls "active" et "trialing" donnent droit à l'accès payant. Tous les autres
// signifient que la période en cours n'est pas (ou plus) payée :
//   past_due          → l'échéance de renouvellement a échoué, Stripe relance
//   unpaid            → toutes les relances ont échoué
//   canceled          → résilié (fin de période atteinte, ou résiliation immédiate)
//   incomplete_*      → le tout premier paiement n'a jamais abouti
// `past_due` est le cas critique : Stripe a DÉJÀ fait basculer la période
// suivante, donc sans coupure l'utilisateur consommerait un nouveau quota sans
// avoir payé, et ce pendant toute la fenêtre de relance (plusieurs semaines).
const ACTIVE_STATUSES = ["active", "trialing"];

// Retrouve l'utilisateur Supabase associé à un abonnement Stripe.
// Chemin normal : les métadonnées posées à la création du Checkout.
// Repli : balayage des comptes par `stripe_customer_id`, pour qu'un abonnement
// dépourvu de métadonnées (créé à la main dans Stripe, migré, ou modifié via
// le portail) ne reste pas actif indéfiniment faute d'avoir pu être rattaché.
async function resolveUserId(subscription) {
  if (subscription.metadata?.userId) return subscription.metadata.userId;

  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id;
  if (!customerId) return null;

  const admin = supabaseAdmin();
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Supabase listUsers failed: ${error.message}`);
    const match = data.users.find(u => u.app_metadata?.stripe_customer_id === customerId);
    if (match) {
      console.warn(`[webhook] userId absent des métadonnées — retrouvé via customer ${customerId}`);
      return match.id;
    }
    if (data.users.length < 1000) break;
  }
  console.error(`[webhook] aucun utilisateur pour le customer ${customerId} — accès non modifié`);
  return null;
}

// Applique le statut d'un abonnement sur le compte : accès maintenu ou coupé.
async function syncAccessFromSubscription(subscription, reason) {
  const userId = await resolveUserId(subscription);
  if (!userId) return;

  if (ACTIVE_STATUSES.includes(subscription.status)) {
    const plan = subscription.metadata?.plan || "premium";
    await setUserPlan(userId, plan);
    console.log(`[webhook] ${reason} — user ${userId} : accès maintenu (statut ${subscription.status}, plan "${plan}")`);
    return;
  }

  await setUserPlan(userId, "trial");
  console.log(`[webhook] ${reason} — user ${userId} : accès coupé (statut ${subscription.status})`);
}

async function activateSubscription(userId, plan, formule, stripeCustomerId) {
  // Active l'abonnement et démarre une fenêtre mensuelle de crédits.
  // Le quota (1 000 photos/mois) est remis à zéro chaque mois côté application,
  // indépendamment de la cadence de facturation (hebdo / mensuel / annuel).
  const meta = { plan, photos_used: 0, photos_period_start: new Date().toISOString(), plan_source: "stripe" };
  if (formule) meta.formule = formule;
  if (stripeCustomerId) meta.stripe_customer_id = stripeCustomerId;
  await writeEntitlements(userId, meta);
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
      const customerId = typeof session.customer === "string" ? session.customer : null;
      // La cadence réellement facturée prime sur la formule annoncée : cette
      // dernière reflète le bouton cliqué et ment dès qu'un identifiant de
      // tarif est mal renseigné, accordant alors un quota sans rapport avec
      // ce qui est prélevé.
      let formule = session.metadata?.formule || null;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(
          typeof session.subscription === "string" ? session.subscription : session.subscription.id
        );
        const reel = formuleFromInterval(sub.items?.data?.[0]?.price?.recurring?.interval);
        if (reel && reel !== formule) {
          console.warn(`[webhook] formule annoncée "${formule}" ≠ cadence facturée "${reel}" — la cadence l'emporte`);
          formule = reel;
        }
      }
      if (userId) {
        await activateSubscription(userId, plan, formule, customerId);
        console.log(`Abonnement "${plan}" (formule: ${formule}) activé pour user ${userId} (customer: ${customerId})`);
      }
    }

    if (event.type === "customer.subscription.deleted") {
      // Fin effective de l'abonnement : soit l'échéance d'une résiliation
      // programmée est atteinte, soit Stripe a résilié après échec des relances.
      // Dans les deux cas la période payée est consommée → accès coupé.
      await syncAccessFromSubscription(event.data.object, "abonnement terminé");
    }

    if (event.type === "customer.subscription.updated") {
      // Couvre trois transitions :
      //  - résiliation programmée (cancel_at_period_end) : le statut reste
      //    "active", l'accès est donc MAINTENU jusqu'au bout de la période
      //    déjà réglée, comme le prévoient les CGV ;
      //  - passage en past_due / unpaid / canceled : accès coupé ;
      //  - retour en active après régularisation : accès restauré.
      const subscription = event.data.object;
      const suffix = subscription.cancel_at_period_end ? " (résiliation programmée)" : "";
      await syncAccessFromSubscription(subscription, `abonnement mis à jour${suffix}`);
    }

    if (event.type === "invoice.payment_failed") {
      // Échec du prélèvement. On coupe l'accès sans attendre la fin des
      // relances Stripe : à ce stade la période en cours n'est pas payée
      // (Stripe a déjà fait basculer le cycle), donc laisser l'accès ouvert
      // reviendrait à offrir un nouveau quota complet à chaque échec.
      // Conforme à l'article 5 des CGV. L'accès est restauré automatiquement
      // par `invoice.paid` dès qu'une relance aboutit.
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = await resolveUserId(subscription);
        if (userId) {
          await setUserPlan(userId, "trial");
          console.warn(`[webhook] paiement échoué (tentative ${invoice.attempt_count}) — user ${userId} : accès suspendu jusqu'à régularisation`);
        }
      }
    }

    if (event.type === "invoice.paid") {
      // Paiement encaissé. Deux cas :
      //  - renouvellement de cycle → on restaure l'accès ET on remet le quota à zéro ;
      //  - relance aboutie après un échec → on restaure l'accès, mais SANS
      //    reremettre le quota à zéro si le cycle n'a pas changé, pour ne pas
      //    offrir un second quota sur une même période facturée.
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId  = await resolveUserId(subscription);
        const plan    = subscription.metadata?.plan || "premium";
        const formule = formuleFromInterval(
          subscription.items?.data?.[0]?.price?.recurring?.interval
        ) || subscription.metadata?.formule || null;

        if (userId && ACTIVE_STATUSES.includes(subscription.status)) {
          const meta = { plan };
          if (formule) meta.formule = formule;
          // La fenêtre de quota suit la cadence de facturation (7 jours en
          // hebdomadaire, un mois sinon). On ne réinitialise que si une fenêtre
          // entière s'est écoulée : un encaissement seul ne suffit pas, sans
          // quoi une relance aboutie rouvrirait un quota déjà consommé.
          const current = await freshUser(userId);
          const anchor = entitlementsOf(current).periodStart;
          const periods = anchor ? periodsElapsed(formule, anchor) : 0;
          if (!anchor) {
            meta.photos_used = 0;
            meta.headlight_photos_used = 0;
            meta.photos_period_start = new Date().toISOString();
          } else if (periods >= 1) {
            meta.photos_used = 0;
            meta.headlight_photos_used = 0;
            meta.photos_period_start = advanceAnchor(formule, anchor, periods);
          }
          await writeEntitlements(userId, meta);
          console.log(`[webhook] paiement encaissé (${invoice.billing_reason}) — user ${userId} : accès actif${isNewCycle ? ", quota remis à zéro" : ""}`);
        }
      }
    }

  } catch (e) {
    console.error("Erreur traitement webhook:", e.message);
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ received: true });
}
