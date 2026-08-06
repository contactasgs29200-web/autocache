// api/_adminTerms.js — servi par api/admin.js (resource: "terms")
// Publication des conditions générales, côté administration.
//
// Une publication n'écrase jamais rien. Elle ajoute une VERSION : numérotée,
// horodatée, signée du compte qui l'a publiée, accompagnée d'un résumé des
// modifications et d'une date d'entrée en vigueur qui respecte le préavis dû.
// Les versions antérieures restent en base et restent lisibles publiquement.
//
// Cette immutabilité n'est pas de la prudence de développeur, c'est ce qui rend
// le document opposable : en cas de litige, ce qui compte est le texte
// applicable À LA DATE DES FAITS, et la preuve que le client en a été informé.
// Un document modifié en place ne prouve rien — il ne conserve pas ce qu'il
// disait hier.
//
// Aucune suppression n'est exposée, volontairement : revenir en arrière se fait
// en publiant une nouvelle version qui reprend l'ancien texte, ce qui laisse la
// trace du passage et de son retour.

import { requireAdmin, corsHeaders, audit, isMissingTable, setupRequiredPayload } from "./_admin.js";
import { supabaseAdmin } from "./_entitlements.js";
import { validatePublication, DOC_KEY, hashContent } from "../src/legalTerms.js";
import { BASELINE_MARKDOWN, BASELINE_TITLE, BASELINE_SUMMARY } from "../src/legalBaseline.js";

const TABLE = "legal_documents";
const ACCEPTANCES = "legal_acceptances";

// Colonnes servies dans les listes : tout sauf le corps du document, qui pèse
// plusieurs dizaines de milliers de caractères et n'a rien à faire dans une
// liste de versions.
const META = "id, doc_key, version, title, summary, kind, content_hash, notice_days, effective_at, published_at, published_by, created_at";

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const db = supabaseAdmin();
  const { action = "list" } = req.body || {};

  try {
    // ── Liste des versions ────────────────────────────────────────────────
    if (action === "list") {
      const { data, error } = await db.from(TABLE).select(META)
        .eq("doc_key", DOC_KEY).order("version", { ascending: false });
      if (error) throw error;

      const now = Date.now();
      const versions = data ?? [];
      return res.status(200).json({
        versions,
        // En vigueur : la dernière version dont la date d'effet est passée.
        // Ce n'est PAS forcément la dernière publiée — c'est tout l'objet du
        // préavis.
        inForce: versions.find(v => new Date(v.effective_at).getTime() <= now) ?? null,
        pending: versions.filter(v => new Date(v.effective_at).getTime() > now),
        baseline: versions.length === 0
          ? { title: BASELINE_TITLE, summary: BASELINE_SUMMARY, body: BASELINE_MARKDOWN, hash: hashContent(BASELINE_MARKDOWN) }
          : null,
      });
    }

    // ── Une version, texte compris ────────────────────────────────────────
    if (action === "get") {
      const version = Number(req.body?.version);
      if (!Number.isInteger(version)) return res.status(400).json({ error: "Numéro de version invalide." });

      const { data, error } = await db.from(TABLE).select("*")
        .eq("doc_key", DOC_KEY).eq("version", version).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Version introuvable." });
      return res.status(200).json({ document: data });
    }

    // ── Publication ───────────────────────────────────────────────────────
    if (action === "publish") {
      const now = new Date();
      const controle = validatePublication(req.body ?? {}, now);
      if (!controle.ok) return res.status(400).json({ error: controle.error });
      const v = controle.value;

      const { data: dernieres, error: errLecture } = await db.from(TABLE)
        .select("version, content_hash").eq("doc_key", DOC_KEY)
        .order("version", { ascending: false }).limit(1);
      if (errLecture) throw errLecture;

      const precedente = dernieres?.[0] ?? null;
      // Republier un texte identique créerait une version sans objet, qui
      // demanderait pourtant une nouvelle acceptation à tout le monde.
      if (precedente && precedente.content_hash === v.contentHash) {
        return res.status(400).json({ error: "Le texte est identique à la version en ligne : aucune publication nécessaire." });
      }

      const ligne = {
        doc_key: DOC_KEY,
        version: (precedente?.version ?? 0) + 1,
        title: v.title,
        summary: v.summary,
        kind: v.kind,
        body: v.body,
        content_hash: v.contentHash,
        notice_days: v.noticeDays,
        effective_at: v.effectiveAt,
        published_at: v.publishedAt,
        published_by: admin.email,
      };

      const { data, error } = await db.from(TABLE).insert(ligne).select(META).single();
      if (error) throw error;

      await audit(admin, "publish-terms", null, {
        version: ligne.version, kind: ligne.kind, effective_at: ligne.effective_at, hash: ligne.content_hash,
      });

      return res.status(200).json({
        ok: true,
        document: data,
        message: `Version ${ligne.version} publiée — entrée en vigueur le ${new Date(ligne.effective_at).toLocaleDateString("fr-FR")}.`,
      });
    }

    // ── Preuve d'acceptation ──────────────────────────────────────────────
    // Ce que l'on peut produire en cas de contestation : qui a accepté quelle
    // version, quand, et l'empreinte du texte accepté.
    if (action === "acceptances") {
      const version = Number(req.body?.version);
      const limite = Math.min(500, Math.max(1, Number(req.body?.limit) || 100));

      let requete = db.from(ACCEPTANCES).select("*", { count: "exact" })
        .eq("doc_key", DOC_KEY).order("accepted_at", { ascending: false }).limit(limite);
      if (Number.isInteger(version)) requete = requete.eq("version", version);

      const { data, error, count } = await requete;
      if (error) throw error;
      return res.status(200).json({ acceptances: data ?? [], count: count ?? (data?.length ?? 0) });
    }

    return res.status(400).json({ error: "Action inconnue." });
  } catch (e) {
    if (isMissingTable(e)) {
      // La gestion des CGV est la seule partie du panneau qui suppose la
      // migration : on le dit clairement plutôt que de renvoyer une erreur de
      // base de données que personne ne saurait interpréter.
      return res.status(200).json(setupRequiredPayload("cgv"));
    }
    console.error("admin-terms error:", e);
    return res.status(500).json({ error: e.message });
  }
}
