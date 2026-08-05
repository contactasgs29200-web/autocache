// api/_auth.js
// Contrôle d'identité commun à toutes les fonctions serveur.
//
// Le préfixe « _ » empêche Vercel d'exposer ce fichier comme une route : c'est
// un module partagé, pas une adresse appelable.
//
// Principe : l'identité de l'appelant vient du JETON de session, jamais du
// corps de la requête. Un `userId` transmis dans le corps n'est qu'une
// affirmation de l'appelant — n'importe qui peut écrire celui du voisin.
// Le jeton, lui, est signé par Supabase et ne peut pas être fabriqué.

import { createClient } from "@supabase/supabase-js";
import { sanctionState, sanctionMessage } from "../src/moderation.js";

let cached = null;

function supabaseAdmin() {
  if (!cached) {
    cached = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return cached;
}

// Renvoie l'utilisateur authentifié, ou `null` après avoir répondu 401.
// Usage dans un handler :
//     const user = await requireUser(req, res);
//     if (!user) return;            // la réponse est déjà partie
//     // ... n'utiliser que user.id / user.email à partir d'ici
//
// Les comptes sous sanction sont écartés ici, une fois pour toutes. Le
// bannissement prononcé côté Supabase invalide déjà les sessions, mais un jeton
// déjà émis reste valable jusqu'à son expiration : sans ce contrôle, un onglet
// resté ouvert continuerait de consommer le service pendant une heure après la
// suspension.
//
// `allowSuspended: true` est réservé aux routes qu'un compte suspendu doit
// conserver — au premier rang desquelles la résiliation de son abonnement.
// Couper l'accès à quelqu'un tout en continuant de le prélever, sans lui
// laisser le moyen d'arrêter, ne se défend pas.
export async function requireUser(req, res, { allowSuspended = false } = {}) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ error: "Authentification requise." });
    return null;
  }

  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: "Session invalide ou expirée. Reconnectez-vous." });
    return null;
  }

  const user = data.user;

  if (!allowSuspended) {
    const etat = sanctionState(user.app_metadata);
    if (etat.active) {
      res.status(403).json({
        error: sanctionMessage(etat),
        suspended: true,
        sanction: { type: etat.type, reason: etat.reason, until: etat.until },
      });
      return null;
    }
  }

  return user;
}

// En-têtes CORS incluant Authorization : sans cette mention, le navigateur
// refuse d'envoyer le jeton sur les requêtes inter-origines.
export function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
