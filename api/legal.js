// api/legal.js
// Conditions générales, côté public : lecture et acceptation.
//
// La distinction se fait ici sur la MÉTHODE, et non sur un champ du corps,
// parce qu'elle recouvre exactement la différence entre les deux usages :
//
//   GET   lecture de la version en vigueur ou d'une version archivée.
//         Aucune authentification : des conditions générales qu'il faudrait un
//         compte pour lire ne seraient pas opposables à qui n'en a pas.
//   POST  enregistrement de l'acceptation par un client connecté.
//
// Le regroupement en une seule fonction serverless répond à la limite de douze
// du plan Hobby de Vercel ; les deux traitements restent dans leurs fichiers.

import { corsHeaders } from "./_auth.js";
import lire from "./_legalRead.js";
import accepter from "./_legalAccept.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    corsHeaders(res);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    return res.status(200).end();
  }

  if (req.method === "GET") return lire(req, res);
  if (req.method === "POST") return accepter(req, res);

  return res.status(405).json({ error: "Method not allowed" });
}
