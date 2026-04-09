import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !user) return res.status(404).json({ error: "Utilisateur introuvable" });

  const stripeCustomerId = user.user_metadata?.stripe_customer_id;
  if (!stripeCustomerId) return res.status(400).json({ error: "Aucun compte Stripe associé" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
