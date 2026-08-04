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
import { limitFor, periodsElapsed, advanceAnchor } from "../src/subscriptionQuota.js";

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

    const ent = entitlementsOf(user);
    const limit = limitFor(ent.plan, ent.formule);

    // Renouvellement de la fenêtre, s'il y a lieu. L'essai gratuit en est
    // exclu : ses 30 photos sont offertes une fois et ne se rechargent jamais.
    let used = ent.photosUsed;
    let periodStart = ent.periodStart;
    const patch = {};

    if (ent.plan !== "trial") {
      if (!periodStart) {
        periodStart = new Date().toISOString();
        patch.photos_period_start = periodStart;
      } else {
        const periods = periodsElapsed(ent.formule, periodStart);
        if (periods >= 1) {
          used = 0;
          periodStart = advanceAnchor(ent.formule, periodStart, periods);
          patch.photos_period_start = periodStart;
        }
      }
    }

    const remaining = Math.max(0, limit - used);
    if (count > remaining) {
      return res.status(402).json({
        error: "Quota dépassé.",
        used, limit, remaining,
      });
    }

    patch.photos_used = used + count;
    await writeEntitlements(user.id, patch);

    return res.status(200).json({
      used: patch.photos_used,
      limit,
      remaining: limit - patch.photos_used,
      periodStart,
    });
  } catch (e) {
    console.error("consume-photos error:", e);
    return res.status(500).json({ error: e.message });
  }
}
