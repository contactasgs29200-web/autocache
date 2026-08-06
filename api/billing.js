// api/billing.js
// Point d'entrée unique de la facturation : souscription, portail client,
// réconciliation avec Stripe.
//
// Pourquoi un routeur plutôt que trois adresses distinctes :
// Vercel compte UNE fonction serverless par fichier exposé dans `api/`, et le
// plan Hobby en autorise douze. Le projet y était déjà, et l'ajout du panneau
// d'administration a fait échouer le déploiement — le build passait, c'est la
// mise en ligne qui était refusée. Regrouper ce qui relève d'un même domaine
// rend une place sans rien retirer au service.
//
// Les trois traitements n'ont PAS été fusionnés : ils vivent tels quels dans
// `_billingCheckout.js`, `_billingPortal.js` et `_billingSync.js`, au caractère
// près. Réécrire du code de paiement pour une contrainte d'hébergement aurait
// été le meilleur moyen d'y introduire une erreur ; ce fichier ne fait
// qu'aiguiller.
//
// L'opération est portée par `op` dans le corps de la requête. `action`, déjà
// utilisé par le portail pour distinguer résiliation et consultation, reste
// libre — les deux champs ne se marchent pas dessus.

import { corsHeaders } from "./_auth.js";
import checkout from "./_billingCheckout.js";
import portal from "./_billingPortal.js";
import sync from "./_billingSync.js";

const OPERATIONS = {
  checkout, // ouverture d'une session de paiement Stripe
  portal,   // portail client : factures, moyen de paiement, résiliation
  sync,     // réconciliation de l'abonnement avec Stripe
};

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const op = String(req.body?.op ?? "portal");
  const traitement = OPERATIONS[op];
  if (!traitement) return res.status(400).json({ error: "Opération de facturation inconnue." });

  return traitement(req, res);
}
