// api/_admin.js
// Porte d'entrée de l'administration : qui a le droit, et trace de ce qui est fait.
//
// L'autorisation ne se déduit JAMAIS de ce que l'appelant affirme. Elle est
// prononcée à partir de l'email porté par le jeton de session, que Supabase
// signe et qu'un navigateur ne peut pas fabriquer. Masquer le bouton dans
// l'interface n'est qu'un confort d'affichage : quiconque appellerait ces
// routes à la main, avec un compte ordinaire, reçoit 403 ici.
//
// Deux exigences supplémentaires, et elles ne sont pas cosmétiques :
//   - l'email doit être VÉRIFIÉ. Sans cette condition, il suffirait de créer un
//     compte portant l'adresse de l'administrateur pour hériter du panneau ;
//     seul le lien de confirmation prouve qu'on relève cette boîte.
//   - le compte ne doit pas être lui-même sous sanction.

import { requireUser, corsHeaders } from "./_auth.js";
import { supabaseAdmin, entitlementsOf } from "./_entitlements.js";
import { isAdminEmail, parseAdminEmails, normalizeEmail } from "../src/admin.js";
import { sanctionState } from "../src/moderation.js";
import { quotaSnapshot, monthlySeries } from "../src/subscriptionQuota.js";

export { corsHeaders };

// Liste effective des administrateurs. La variable d'environnement permet
// d'ajouter une adresse sans redéployer le code ; à défaut, seul le
// propriétaire déclaré dans `src/admin.js` est reconnu.
export function adminAllowlist() {
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}

export function callerIsAdmin(user) {
  return !!user?.email
    && !!user?.email_confirmed_at
    && isAdminEmail(user.email, adminAllowlist());
}

// Renvoie l'administrateur authentifié, ou `null` après avoir répondu.
// Le refus est volontairement muet sur l'existence du panneau : « Ressource
// introuvable » plutôt que « vous n'êtes pas administrateur ».
export async function requireAdmin(req, res) {
  const user = await requireUser(req, res, { allowSuspended: false });
  if (!user) return null;

  if (!callerIsAdmin(user)) {
    console.warn(`[admin] accès refusé pour ${normalizeEmail(user.email) || user.id}`);
    res.status(404).json({ error: "Ressource introuvable." });
    return null;
  }
  return user;
}

// ── Fiche d'un compte ──────────────────────────────────────────────────────
//
// Projection unique, servie aussi bien à la liste qu'au détail et au retour
// d'une action. Deux projections différentes finiraient par afficher deux
// vérités : la ligne du tableau annonçant un quota, la fiche ouverte juste à
// côté en annonçant un autre.
//
// Ne sort d'ici que ce que le panneau affiche réellement. Le mot de passe n'est
// de toute façon jamais lisible — Supabase n'en conserve qu'une empreinte — et
// aucun jeton de session n'est exposé.
export function projectUser(u, now = new Date()) {
  const droits = u?.app_metadata ?? {};
  const profil = u?.user_metadata ?? {};
  const ent = entitlementsOf(u);
  const quota = quotaSnapshot(
    { plan: ent.plan, formule: ent.formule, photosUsed: ent.photosUsed, periodStart: ent.periodStart, bonus: droits.bonus_photos },
    now,
  );
  const historique = droits.photos_monthly ?? {};
  const total = Object.values(historique).reduce((s, v) => s + (Number(v) || 0), 0);

  return {
    id: u?.id ?? null,
    email: u?.email ?? null,
    emailConfirmed: !!u?.email_confirmed_at,
    createdAt: u?.created_at ?? null,
    lastSignInAt: u?.last_sign_in_at ?? null,
    provider: droits.provider ?? (Array.isArray(droits.providers) ? droits.providers[0] : null) ?? "email",
    profile: {
      fullName: profil.full_name ?? null,
      phone: profil.phone ?? u?.phone ?? null,
      exportEmail: profil.export_email ?? null,
      tutorialSeen: !!profil.tutorial_seen,
    },
    plan: ent.plan,
    formule: ent.formule,
    planSource: droits.plan_source ?? null,
    stripeCustomerId: ent.stripeCustomerId,
    quota,
    monthly: monthlySeries(historique, 12, now),
    photosTotal: total,
    sanction: sanctionState(droits, now),
    sanctionHistory: Array.isArray(droits.sanction_history) ? droits.sanction_history : [],
    cgv: droits.cgv_accepted ?? null,
    isAdmin: isAdminEmail(u?.email, adminAllowlist()),
  };
}

// ── Journal d'audit ────────────────────────────────────────────────────────
//
// Écrit dans la table `admin_audit_log` si la migration a été appliquée, sinon
// dans les journaux du serveur. Le choix est délibéré : une action
// d'administration ne doit jamais ÉCHOUER faute de journal. Suspendre un compte
// abusif à trois heures du matin ne peut pas dépendre d'une table absente — la
// trace, elle, existe de toute façon dans l'historique du compte concerné
// (`sanction_history`), qui ne suppose aucune migration.
export async function audit(actor, action, target, details = {}) {
  const ligne = {
    actor_email: normalizeEmail(actor?.email) || "inconnu",
    action,
    target_user_id: target?.id ?? null,
    target_email: normalizeEmail(target?.email) || null,
    details,
  };

  try {
    const { error } = await supabaseAdmin().from("admin_audit_log").insert(ligne);
    if (error) throw error;
    return { logged: true };
  } catch (e) {
    console.log(`[audit] ${ligne.actor_email} → ${action} → ${ligne.target_email ?? "-"} ${JSON.stringify(details)}`);
    if (isMissingTable(e)) return { logged: false, setupRequired: true };
    console.warn("[audit] écriture impossible :", e?.message ?? e);
    return { logged: false, error: e?.message ?? String(e) };
  }
}

// PostgREST signale une table absente par le code 42P01 (undefined_table) ou
// PGRST205 (introuvable dans le cache de schéma). On reconnaît les deux, plus
// le message en clair : selon la version, ce n'est pas toujours le même qui
// remonte.
export function isMissingTable(error) {
  const code = error?.code ?? "";
  const msg = String(error?.message ?? "");
  return code === "42P01"
    || code === "PGRST205"
    || /does not exist|schema cache/i.test(msg);
}

export const MIGRATION_FILE = "supabase/migrations/20260805000000_admin_panel.sql";

// Réponse commune lorsqu'une fonctionnalité adossée à une table n'est pas
// installée : l'interface sait alors afficher la marche à suivre au lieu d'une
// erreur opaque.
export function setupRequiredPayload(feature) {
  return {
    setupRequired: true,
    feature,
    error: `Cette fonctionnalité nécessite les tables du panneau d'administration. Exécutez ${MIGRATION_FILE} dans l'éditeur SQL Supabase.`,
    migration: MIGRATION_FILE,
  };
}
