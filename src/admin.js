// src/admin.js
// Qui est administrateur, et rien d'autre.
//
// Ce module est volontairement minuscule et partagé entre le navigateur et les
// fonctions serveur, pour qu'il n'existe qu'UNE définition de l'administrateur.
// Une seconde liste, recopiée ailleurs, finirait tôt ou tard par diverger — et
// une divergence ici, c'est soit un panneau inaccessible à son propriétaire,
// soit un panneau ouvert à quelqu'un d'autre.
//
// Ce que ce module NE fait PAS : autoriser. Le navigateur s'en sert uniquement
// pour décider s'il affiche l'entrée de menu ; l'autorisation réelle est
// prononcée par `api/_admin.js`, à partir de l'email porté par le JETON de
// session signé par Supabase. Autrement dit : masquer le bouton est du confort,
// le refus vient du serveur.

// Adresse propriétaire du service. Sert de valeur par défaut des deux côtés ;
// le serveur peut l'étendre par la variable d'environnement ADMIN_EMAILS.
export const OWNER_EMAIL = "contact.asgs29200@gmail.com";

export const ADMIN_EMAILS = [OWNER_EMAIL];

// Les emails Supabase sont déjà normalisés en minuscules, mais la comparaison
// ne s'appuie pas là-dessus : une casse différente ne doit jamais valoir refus
// au propriétaire, ni acceptation à un homonyme.
export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isAdminEmail(email, allowlist = ADMIN_EMAILS) {
  const wanted = normalizeEmail(email);
  if (!wanted) return false;
  return allowlist.some(a => normalizeEmail(a) === wanted);
}

// Découpe une liste d'emails saisie en variable d'environnement
// ("a@x.fr, b@y.fr"). Les entrées vides sont ignorées plutôt que de produire
// une chaîne vide dans la liste — laquelle n'autoriserait personne, mais
// vaudrait comparaison inutile à chaque requête.
export function parseAdminEmails(raw, fallback = ADMIN_EMAILS) {
  const parsed = String(raw ?? "")
    .split(/[,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}
