// api/_legalRead.js — servi par api/legal.js (GET)
// Lecture PUBLIQUE des conditions générales publiées.
//
// Publique et sans authentification, délibérément : des conditions générales
// qu'il faudrait un compte pour lire ne seraient pas opposables à qui n'en a
// pas encore. La page /cgv.html s'en sert, et n'importe qui peut demander une
// version archivée par son numéro — c'est précisément ce qui permet à un client
// de vérifier ce qu'il a accepté.
//
// Tant qu'aucune version n'a été publiée, la réponse est vide et la page
// statique continue de faire foi. Le service ne se retrouve donc jamais sans
// conditions affichées, y compris si la migration n'a pas été appliquée.

import { supabaseAdmin } from "./_entitlements.js";
import { isMissingTable } from "./_admin.js";
import { DOC_KEY } from "../src/legalTerms.js";
import { renderMarkdown } from "../src/markdownLite.js";

const TABLE = "legal_documents";
const META = "version, title, summary, kind, content_hash, notice_days, effective_at, published_at";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Cache court : le document change quelques fois par an, mais une version
  // fraîchement publiée doit apparaître en quelques minutes, pas le lendemain.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");

  try {
    const db = supabaseAdmin();
    const demandee = Number(req.query?.version);

    // Le HTML est rendu ICI, par le même module que l'aperçu du panneau
    // d'administration. La page /cgv.html n'a donc pas sa propre copie du
    // convertisseur — deux copies finiraient par afficher deux mises en page
    // pour un même texte. Le rendu échappe tout : rien de ce qui est saisi ne
    // devient du balisage.
    const avecHtml = (doc) => (doc ? { ...doc, html: renderMarkdown(doc.body ?? "") } : null);

    if (Number.isInteger(demandee)) {
      const { data, error } = await db.from(TABLE)
        .select(`${META}, body`).eq("doc_key", DOC_KEY).eq("version", demandee).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Version introuvable." });
      return res.status(200).json({ document: avecHtml(data), archived: true });
    }

    const { data, error } = await db.from(TABLE)
      .select(`${META}, body`).eq("doc_key", DOC_KEY).order("version", { ascending: false });
    if (error) throw error;

    const versions = data ?? [];
    if (versions.length === 0) return res.status(200).json({ document: null, versions: [] });

    const now = Date.now();
    // Le document AFFICHÉ est celui en vigueur, pas le dernier publié : pendant
    // le préavis, ce sont encore les conditions précédentes qui régissent le
    // contrat. La version à venir est annoncée à côté, avec sa date d'effet.
    const enVigueur = versions.find(v => new Date(v.effective_at).getTime() <= now) ?? null;
    const aVenir = versions.filter(v => new Date(v.effective_at).getTime() > now)
      .sort((a, b) => a.version - b.version)[0] ?? null;

    return res.status(200).json({
      document: avecHtml(enVigueur),
      upcoming: aVenir ? { ...aVenir, body: undefined, html: renderMarkdown(aVenir.body ?? "") } : null,
      versions: versions.map(({ body, ...meta }) => meta),
    });
  } catch (e) {
    if (isMissingTable(e)) return res.status(200).json({ document: null, versions: [], setupRequired: true });
    console.error("legal-terms error:", e);
    return res.status(500).json({ error: e.message });
  }
}
