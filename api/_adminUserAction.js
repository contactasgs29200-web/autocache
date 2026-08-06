// api/_adminUserAction.js — servi par api/admin.js (resource: "user-action")
// Actions du panneau sur un compte : plan, quota, crédits, suspension,
// bannissement, levée de sanction.
//
// Une seule route pour toutes les actions, avec un `action` explicite. Le
// contrôle d'accès, la relecture du compte, le journal d'audit et la réponse
// (la fiche à jour) sont ainsi écrits une fois, et aucune action ne peut être
// ajoutée en oubliant l'un des quatre.
//
// Garde-fous, dans l'ordre où ils comptent :
//   - seul un administrateur passe (`requireAdmin`) ;
//   - un administrateur ne peut pas se sanctionner lui-même — le panneau se
//     verrouillerait, sans personne pour le rouvrir ;
//   - un administrateur ne peut pas en sanctionner un autre.

import { requireAdmin, corsHeaders, projectUser, audit, adminAllowlist } from "./_admin.js";
import { freshUser, writeEntitlements, entitlementsOf } from "./_entitlements.js";
import { validateSanction, sanctionPatch, liftPatch, banDurationFor, sanctionState, NO_BAN, sanitizeReason } from "../src/moderation.js";
import { normalizeBonus, FORMULE_QUOTA } from "../src/subscriptionQuota.js";
import { isAdminEmail } from "../src/admin.js";

const PLANS = ["trial", "premium"];
const FORMULES = Object.keys(FORMULE_QUOTA);

// Plafond d'un octroi manuel. Pas une méfiance envers l'administrateur : une
// protection contre le zéro de trop, qui offrirait un million de photos sans
// que rien ne le signale.
const GRANT_MAX = 100000;

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { action, userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "Identifiant du compte manquant." });

  try {
    const cible = await freshUser(userId);
    if (!cible) return res.status(404).json({ error: "Compte introuvable." });

    const droits = cible.app_metadata ?? {};
    const ent = entitlementsOf(cible);
    const now = new Date();
    const sanctions = ["suspend", "ban", "lift"];

    if (sanctions.includes(action)) {
      if (cible.id === admin.id) {
        return res.status(400).json({ error: "Vous ne pouvez pas vous sanctionner vous-même." });
      }
      if (isAdminEmail(cible.email, adminAllowlist())) {
        return res.status(403).json({ error: "Ce compte est administrateur : il ne peut pas être sanctionné depuis le panneau." });
      }
    }

    let patch = null;
    let attributes = {};
    let message = "";
    let details = {};

    switch (action) {
      // ── Plan et formule ──────────────────────────────────────────────────
      case "set-plan": {
        const plan = String(req.body?.plan ?? "");
        if (!PLANS.includes(plan)) return res.status(400).json({ error: "Plan inconnu." });

        const formule = req.body?.formule ? String(req.body.formule) : null;
        if (formule && !FORMULES.includes(formule)) return res.status(400).json({ error: "Formule inconnue." });

        // `plan_source: "admin"` n'est pas décoratif : la réconciliation Stripe
        // révoque tout accès payant qu'elle ne retrouve pas chez Stripe. Sans
        // cette marque, un abonnement ouvert à la main serait coupé à la
        // première synchronisation.
        patch = { plan, plan_source: plan === "trial" ? null : "admin" };
        if (formule) patch.formule = formule;

        // Ouvrir un accès repart d'une fenêtre neuve ; le refermer ne touche pas
        // au compteur, qui reste la trace de ce qui a été consommé.
        if (plan !== "trial" && ent.plan === "trial") {
          patch.photos_used = 0;
          patch.photos_period_start = now.toISOString();
        }
        message = plan === "trial" ? "Compte ramené à l'essai gratuit." : "Abonnement ouvert manuellement.";
        details = { plan, formule };
        break;
      }

      // ── Crédits accordés à la main ───────────────────────────────────────
      case "grant-photos": {
        const n = Math.trunc(Number(req.body?.photos));
        if (!Number.isFinite(n) || n === 0 || Math.abs(n) > GRANT_MAX) {
          return res.status(400).json({ error: `Nombre de photos invalide (1 à ${GRANT_MAX}, négatif pour retirer).` });
        }
        const solde = normalizeBonus(droits.bonus_photos);
        const nouveau = Math.max(0, solde + n);
        patch = { bonus_photos: nouveau };
        message = n > 0
          ? `+${n} photos accordées (solde de crédits : ${nouveau}).`
          : `${n} photos retirées (solde de crédits : ${nouveau}).`;
        details = { delta: n, bonus: nouveau };
        break;
      }

      // ── Compteur d'usage ────────────────────────────────────────────────
      case "set-used": {
        const used = Math.trunc(Number(req.body?.used));
        if (!Number.isFinite(used) || used < 0 || used > GRANT_MAX) {
          return res.status(400).json({ error: "Compteur invalide." });
        }
        patch = { photos_used: used };
        message = `Compteur fixé à ${used} photos utilisées.`;
        details = { used };
        break;
      }

      case "reset-quota": {
        // La fenêtre repart de maintenant : sans cela, le compteur remis à zéro
        // serait de nouveau balayé à la prochaine échéance calculée sur
        // l'ancienne ancre, et l'octroi ne durerait que quelques heures.
        patch = { photos_used: 0, photos_period_start: now.toISOString() };
        message = "Quota réinitialisé, nouvelle période démarrée.";
        break;
      }

      // ── Sanctions ────────────────────────────────────────────────────────
      case "suspend":
      case "ban": {
        const demande = validateSanction(
          {
            type: action === "ban" ? "ban" : "suspension",
            hours: req.body?.hours,
            reason: req.body?.reason,
            by: admin.email,
          },
          now,
        );
        if (!demande.ok) return res.status(400).json({ error: demande.error });

        patch = sanctionPatch(demande.sanction, droits.sanction_history);
        attributes = { ban_duration: banDurationFor(demande.sanction, now) };
        message = action === "ban"
          ? "Compte banni. Ses sessions sont révoquées."
          : `Compte suspendu jusqu'au ${new Date(demande.sanction.until).toLocaleString("fr-FR")}.`;
        details = { type: demande.sanction.type, reason: demande.sanction.reason, until: demande.sanction.until };
        break;
      }

      case "lift": {
        const etat = sanctionState(droits, now);
        if (!etat.present) return res.status(400).json({ error: "Ce compte n'est sous aucune sanction." });
        patch = liftPatch(droits.sanction_history, { by: admin.email, reason: req.body?.reason, at: now });
        attributes = { ban_duration: NO_BAN };
        message = "Sanction levée, accès rétabli.";
        details = { previous: etat.type, reason: sanitizeReason(req.body?.reason) };
        break;
      }

      default:
        return res.status(400).json({ error: "Action inconnue." });
    }

    const misAJour = await writeEntitlements(cible.id, patch, attributes);
    await audit(admin, action, cible, details);

    const fiche = projectUser(misAJour ?? (await freshUser(cible.id)), now);
    return res.status(200).json({ ok: true, message, user: fiche });
  } catch (e) {
    console.error("admin-user-action error:", e);
    return res.status(500).json({ error: e.message });
  }
}
