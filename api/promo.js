// Trois familles de codes :
//   photos  → crédite le compteur de photos
//   plan    → force un plan d'abonnement
//   feature → déverrouille une fonctionnalité en accès restreint
const PROMO_CODES = {
  "AURELE30":  { photos: 30, reset: true },
  "AURELE5":   { photos: 5,  reset: false },
  // Showroom interactif (capture guidée + tour 360°) — accès sur invitation
  // le temps de la phase de test terrain.
  "AURELE3D":  { feature: "showroom_interactif", label: "Showroom interactif" },
  "AURELEPREMIUM":   { plan: "premium" },
  "AURELEPRO":       { plan: "premium" }, // ancien code → abonnement unique
  "AURELEESSENTIEL": { plan: "premium" }, // ancien code → abonnement unique
  "AURELEABONNEMENT": { plan: "premium" },
  "AURELEESSAI":     { plan: "trial" },
};

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, message: "Code manquant." });

  const promo = PROMO_CODES[code.trim().toUpperCase()];
  if (!promo) return res.status(200).json({ valid: false, message: "Code administrateur invalide." });

  if (promo.plan) return res.status(200).json({ valid: true, plan: promo.plan });
  if (promo.feature) return res.status(200).json({ valid: true, feature: promo.feature, label: promo.label || promo.feature });
  return res.status(200).json({ valid: true, photos: promo.photos, reset: promo.reset });
}
