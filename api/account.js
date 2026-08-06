// api/account.js
// Opérations sur son propre compte : code administrateur, numéro de téléphone.
//
// Deux traitements courts réunis derrière une seule fonction serverless, pour
// tenir dans la limite de douze du plan Hobby de Vercel et garder une place
// libre pour la suite. Ils conservent leur fichier et leur contrôle d'accès —
// chacun exige déjà un compte connecté et n'agit que sur le compte du jeton.

import { corsHeaders } from "./_auth.js";
import promo from "./_accountPromo.js";
import phone from "./_accountPhone.js";

const OPERATIONS = { promo, phone };

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const traitement = OPERATIONS[String(req.body?.op ?? "")];
  if (!traitement) return res.status(400).json({ error: "Opération inconnue." });

  return traitement(req, res);
}
