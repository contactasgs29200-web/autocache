// api/_entitlements.js
// Lecture et écriture des DROITS d'un compte : plan, formule, quota consommé,
// identifiant client Stripe, déverrouillages de fonctionnalités.
//
// Pourquoi ces champs ne vivent plus dans `user_metadata` :
// `supabase.auth.updateUser({ data })` écrit dans `user_metadata`, et c'est une
// opération que l'utilisateur exécute lui-même depuis son navigateur. Tant que
// le plan y résidait, n'importe quel compte connecté pouvait s'attribuer
// l'abonnement en une ligne dans la console, et remettre son compteur de photos
// à zéro. Supabase documente d'ailleurs `user_metadata` comme non fiable pour
// l'autorisation.
//
// `app_metadata` répond exactement à ce besoin : il n'est modifiable qu'avec la
// clé de service — donc uniquement ici, côté serveur — tout en étant présent
// dans le jeton, ce qui permet à l'interface de le LIRE sans requête
// supplémentaire. Lecture libre, écriture réservée.
//
// Restent dans `user_metadata`, à juste titre : nom, téléphone, email d'export,
// didacticiel vu. Ce sont des préférences ; que leur propriétaire les modifie
// est sans conséquence.

import { createClient } from "@supabase/supabase-js";

let cached = null;

export function supabaseAdmin() {
  if (!cached) {
    cached = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return cached;
}

// Droits d'un compte, avec les valeurs par défaut d'un compte neuf.
export function entitlementsOf(user) {
  const a = user?.app_metadata ?? {};
  return {
    plan: a.plan ?? "trial",
    formule: a.formule ?? null,
    photosUsed: Number.isFinite(a.photos_used) ? a.photos_used : 0,
    periodStart: a.photos_period_start ?? null,
    stripeCustomerId: a.stripe_customer_id ?? null,
  };
}

// Relit un compte depuis la base — nécessaire avant tout calcul de quota, le
// jeton présenté par l'appelant pouvant porter des valeurs périmées.
export async function freshUser(userId) {
  const { data, error } = await supabaseAdmin().auth.admin.getUserById(userId);
  if (error) throw new Error(`Lecture du compte impossible : ${error.message}`);
  return data?.user ?? null;
}

// Écrit un correctif de droits, en préservant explicitement les champs absents
// du correctif.
//
// Supabase fusionne déjà les clés fournies, mais on ne s'en remet pas à ce
// comportement : si l'écriture remplaçait le bloc au lieu de le compléter, un
// simple décompte de photos — qui n'envoie que `photos_used` — effacerait le
// plan, la formule et le rattachement Stripe de l'abonné, le renvoyant en essai
// à chaque lot traité. La relecture préalable coûte un appel et supprime ce
// risque.
//
// `attributes` transmet des champs du compte lui-même — aujourd'hui
// `ban_duration`, seul moyen d'invalider réellement les sessions ouvertes d'un
// compte sanctionné. Les écrire dans le MÊME appel que les droits garantit qu'on
// ne se retrouve jamais avec la sanction inscrite mais non appliquée, ou
// l'inverse.
export async function writeEntitlements(userId, patch, attributes = {}) {
  const admin = supabaseAdmin();
  const current = await freshUser(userId);
  const fusion = { ...(current?.app_metadata ?? {}), ...patch };

  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: fusion,
    ...attributes,
  });
  if (error) throw new Error(`Écriture des droits impossible : ${error.message}`);
  return data?.user ?? null;
}

