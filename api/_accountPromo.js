// api/_accountPromo.js — servi par api/account.js (op: "promo")
import { requireUser, corsHeaders } from "./_auth.js";
import { entitlementsOf, writeEntitlements, freshUser } from "./_entitlements.js";
import { limitFor } from "../src/subscriptionQuota.js";

// Trois familles de codes :
//   photos  → crédite le compteur de photos
//   plan    → force un plan d'abonnement
//   feature → déverrouille une fonctionnalité en accès restreint
const PROMO_CODES = {
  "AURELE30":  { photos: 30, reset: true },
  "AURELE5":   { photos: 5,  reset: false },
  "AURELEPREMIUM":   { plan: "premium" },
  "AURELEPRO":       { plan: "premium" }, // ancien code → abonnement unique
  "AURELEESSENTIEL": { plan: "premium" }, // ancien code → abonnement unique
  "AURELEABONNEMENT": { plan: "premium" },
  "AURELEESSAI":     { plan: "trial" },
};

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Un code administrateur ouvre un plan ou une fonctionnalité : sans compte
  // connecté, la liste était devinable par essais successifs, anonymement.
  const user = await requireUser(req, res);
  if (!user) return;

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, message: "Code manquant." });

  const promo = PROMO_CODES[code.trim().toUpperCase()];
  if (!promo) return res.status(200).json({ valid: false, message: "Code administrateur invalide." });

  try {
    // L'effet du code est APPLIQUÉ ICI. Auparavant cette route se contentait de
    // répondre « ce code donne le plan premium » et le navigateur se
    // l'attribuait lui-même — un appel direct à Supabase suffisait donc à
    // s'ouvrir un abonnement, code ou pas.
    const fresh = await freshUser(user.id);
    const ent = entitlementsOf(fresh);

    if (promo.plan) {
      const patch = { plan: promo.plan, plan_source: "promo" };
      // Un plan ouvert par code n'a pas de facturation derrière : on repart
      // d'un quota neuf et d'une fenêtre qui démarre maintenant.
      if (promo.plan !== "trial") {
        patch.photos_used = 0;
        patch.photos_period_start = new Date().toISOString();
      }
      await writeEntitlements(user.id, patch);
      const planLabel = promo.plan === "trial" ? "Essai gratuit" : "Abonnement";
      return res.status(200).json({ valid: true, message: `${planLabel} activé.` });
    }

    if (promo.feature) {
      await writeEntitlements(user.id, { [promo.feature]: true });
      return res.status(200).json({
        valid: true,
        message: `${promo.label || "Fonctionnalité"} déverrouillé.`,
      });
    }

    const limit = limitFor(ent.plan, ent.formule);
    const used = promo.reset ? 0 : Math.max(0, ent.photosUsed - promo.photos);
    await writeEntitlements(user.id, { photos_used: used });
    const available = Math.max(0, limit - used);
    const s = available > 1 ? "s" : "";
    return res.status(200).json({
      valid: true,
      message: promo.reset
        ? `Compteur réinitialisé — ${available} photo${s} disponible${s}.`
        : `+${promo.photos} crédits ajoutés — ${available} photo${s} disponible${s}.`,
    });
  } catch (e) {
    console.error("promo error:", e);
    return res.status(500).json({ valid: false, message: "Erreur serveur, réessayez." });
  }
}
