// api/accept-terms.js
// Enregistrement de l'acceptation d'une version des conditions générales.
//
// L'acceptation est écrite à DEUX endroits, et ce n'est pas une redondance
// inutile :
//
//   - dans les droits du compte (`app_metadata.cgv_accepted`), parce que ces
//     droits voyagent dans le jeton de session : l'application sait donc, sans
//     aucune requête, si elle doit présenter la nouvelle version. C'est ce qui
//     évite un appel réseau à chaque ouverture ;
//   - dans la table `legal_acceptances`, parce que c'est là que se constitue la
//     PREUVE : une ligne horodatée, immuable, portant l'empreinte du texte
//     accepté. Les droits d'un compte, eux, sont réécrits en permanence.
//
// Si la table n'existe pas, l'acceptation reste enregistrée dans les droits :
// l'utilisateur n'est jamais bloqué par une migration manquante.

import { requireUser, corsHeaders } from "./_auth.js";
import { supabaseAdmin, writeEntitlements } from "./_entitlements.js";
import { isMissingTable } from "./_admin.js";
import { DOC_KEY } from "../src/legalTerms.js";

const TABLE = "legal_documents";
const ACCEPTANCES = "legal_acceptances";

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // `allowSuspended` : accepter les conditions n'est pas utiliser le service.
  // Un compte suspendu doit pouvoir régulariser ce point sans attendre la fin
  // de sa sanction.
  const user = await requireUser(req, res, { allowSuspended: true });
  if (!user) return;

  const version = Number(req.body?.version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: "Version invalide." });

  try {
    const db = supabaseAdmin();

    // L'empreinte vient de la BASE, jamais du corps de la requête : accepter
    // doit porter sur le texte réellement publié, pas sur celui que l'appelant
    // affirme avoir lu.
    const { data: doc, error } = await db.from(TABLE)
      .select("version, content_hash, effective_at")
      .eq("doc_key", DOC_KEY).eq("version", version).maybeSingle();
    if (error) throw error;
    if (!doc) return res.status(404).json({ error: "Version introuvable." });

    const acceptation = {
      version: doc.version,
      hash: doc.content_hash,
      at: new Date().toISOString(),
    };

    await writeEntitlements(user.id, { cgv_accepted: acceptation });

    // Trace probatoire. Best effort : une acceptation non journalisée vaut
    // mieux qu'une acceptation refusée.
    let logged = false;
    try {
      const { error: errTrace } = await db.from(ACCEPTANCES).insert({
        user_id: user.id,
        email: user.email ?? null,
        doc_key: DOC_KEY,
        version: doc.version,
        content_hash: doc.content_hash,
        accepted_at: acceptation.at,
        user_agent: String(req.headers["user-agent"] ?? "").slice(0, 400),
        ip: String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || null,
      });
      if (errTrace) throw errTrace;
      logged = true;
    } catch (e) {
      if (!isMissingTable(e)) console.warn("[accept-terms] trace non écrite :", e?.message ?? e);
    }

    return res.status(200).json({ ok: true, accepted: acceptation, logged });
  } catch (e) {
    if (isMissingTable(e)) {
      return res.status(200).json({ ok: false, setupRequired: true, error: "Aucune version publiée en base." });
    }
    console.error("accept-terms error:", e);
    return res.status(500).json({ error: e.message });
  }
}
