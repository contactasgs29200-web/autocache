// api/admin.js
// Point d'entrée unique du panneau d'administration.
//
// Trois surfaces derrière une seule fonction serverless — comptes, actions sur
// un compte, conditions générales — pour la même raison que `billing.js` : le
// plan Hobby de Vercel plafonne à douze fonctions par déploiement, et une
// fonction par route faisait déborder ce compte.
//
// Chaque traitement conserve son fichier et son contrôle d'accès : le garde
// `requireAdmin` est appliqué DANS chacun d'eux, pas ici. Un routeur qui
// autoriserait à la place des traitements créerait exactement le genre de
// dépendance qu'on regrette : le jour où un traitement est appelé autrement,
// il ne serait plus gardé du tout.
//
// `resource` désigne la surface ; `action` reste au traitement, qui l'employait
// déjà pour distinguer ses opérations.

import { corsHeaders } from "./_auth.js";
import users from "./_adminUsers.js";
import userAction from "./_adminUserAction.js";
import terms from "./_adminTerms.js";

const RESOURCES = {
  "users": users,             // liste, recherche, fiche d'un compte
  "user-action": userAction,  // plan, quota, crédits, suspension, bannissement
  "terms": terms,             // versions des conditions générales
};

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const traitement = RESOURCES[String(req.body?.resource ?? "")];
  // Réponse volontairement identique à celle d'un accès refusé : sans compte
  // administrateur, cette adresse ne doit rien apprendre de ce qu'elle expose.
  if (!traitement) return res.status(404).json({ error: "Ressource introuvable." });

  return traitement(req, res);
}
