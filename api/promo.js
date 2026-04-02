// Codes promo valides — à renseigner par l'administrateur
// Format : "CODE": { photos: <nombre de photos accordées> }
const PROMO_CODES = {
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
  if (!promo) return res.status(200).json({ valid: false, message: "Code promo invalide." });

  return res.status(200).json({ valid: true, photos: promo.photos, label: promo.label });
}
