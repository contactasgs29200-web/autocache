// /api/consume-photos.js
// Décompte des photos traitées. Seule autorité sur le quota.
//
// Le compteur était auparavant tenu par le navigateur, qui écrivait lui-même
// `photos_used`. Un utilisateur pouvait donc le remettre à zéro à volonté. Il
// est désormais écrit ici, dans `app_metadata`, hors de sa portée.
//
// Limite assumée : le traitement des photos s'exécute dans le navigateur, sans
// rien coûter au serveur. Personne ne peut donc être empêché de traiter des
// images en n'appelant jamais cette route. Ce que ce décompte garantit, c'est
// que le quota affiché est honnête et qu'il ne peut pas être remis à zéro — et
// surtout, couplé au plan désormais inscriptible seulement côté serveur, que
// l'abonnement lui-même ne s'obtient plus sans payer.

import { requireUser } from "./_auth.js";
import { entitlementsOf, writeEntitlements, freshUser } from "./_entitlements.js";
import { quotaSnapshot, normalizeBonus, recordMonthly } from "../src/subscriptionQuota.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const caller = await requireUser(req, res);
  if (!caller) return;

  const count = Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    return res.status(400).json({ error: "Nombre de photos invalide." });
  }

  try {
    // On repart de l'état en base : le jeton de l'appelant peut être périmé,
    // et c'est précisément sur cet écart qu'un décompte se fausse.
    const user = await freshUser(caller.id);
    if (!user) return res.status(404).json({ error: "Compte introuvable." });

    const droits = user.app_metadata ?? {};
    const ent = entitlementsOf(user);
    const now = new Date();

    // Renouvellement de la fenêtre, crédits accordés à la main, quota
    // applicable : tout est calculé par `quotaSnapshot`, la même fonction que
    // celle dont se sert le panneau d'administration pour afficher ce compte.
    // Ce qui est décompté ici est donc exactement ce qui y est montré.
    const q = quotaSnapshot(
      { plan: ent.plan, formule: ent.formule, photosUsed: ent.photosUsed, periodStart: ent.periodStart, bonus: droits.bonus_photos },
      now,
    );

    if (count > q.remaining) {
      return res.status(402).json({
        error: "Quota dépassé.",
        used: q.used, limit: q.limit, remaining: q.remaining,
      });
    }

    const patch = { photos_used: q.used + count };
    if (q.periodStart !== ent.periodStart) patch.photos_period_start = q.periodStart;
    // Le solde de crédits n'est réécrit qu'au passage d'une fenêtre à la
    // suivante, où il perd la part consommée. En cours de période, il ne bouge
    // pas : c'est `photos_used` qui monte, et l'écrire pour rien ferait courir
    // le risque de l'écraser à partir d'une lecture périmée.
    if (q.bonus !== normalizeBonus(droits.bonus_photos)) patch.bonus_photos = q.bonus;

    // Historique mois par mois : le compteur d'usage repart de zéro à chaque
    // fenêtre et ne peut donc rien dire du mois dernier. C'est cette ligne qui
    // alimente la consommation mensuelle affichée dans le panneau.
    patch.photos_monthly = recordMonthly(droits.photos_monthly, count, now);

    await writeEntitlements(user.id, patch);

    return res.status(200).json({
      used: patch.photos_used,
      limit: q.limit,
      remaining: q.limit - patch.photos_used,
      bonus: q.bonus,
      periodStart: q.periodStart,
    });
  } catch (e) {
    console.error("consume-photos error:", e);
    return res.status(500).json({ error: e.message });
  }
}
