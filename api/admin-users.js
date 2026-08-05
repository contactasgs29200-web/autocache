// api/admin-users.js
// Lecture de la base clients : liste complète, recherche, fiche détaillée,
// chiffres d'ensemble.
//
// Aucune table n'est nécessaire ici. Tout provient de l'API d'administration
// Supabase (`auth.admin.listUsers`) et des droits stockés dans `app_metadata` —
// ce qui rend cette partie du panneau utilisable immédiatement, sans migration
// préalable.
//
// La recherche et le tri s'effectuent sur le serveur, sur l'ensemble des
// comptes, et non sur la page affichée : chercher un email dans un tableau
// paginé ne doit pas dépendre de la page où l'on se trouve.

import { requireAdmin, corsHeaders, projectUser } from "./_admin.js";
import { supabaseAdmin, freshUser } from "./_entitlements.js";
import { normalizeEmail } from "../src/admin.js";

// Supabase plafonne `perPage` à 1 000. On borne le nombre de pages parcourues :
// au-delà, la mémoire d'une fonction serverless devient le facteur limitant, et
// il faudra une vraie pagination côté base. La réponse le signale (`truncated`)
// plutôt que de laisser croire à une liste complète.
const PAGE_SIZE = 200;
const MAX_PAGES = 25; // 5 000 comptes

async function loadAllUsers() {
  const admin = supabaseAdmin();
  const tous = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Lecture des comptes impossible : ${error.message}`);
    const lot = data?.users ?? [];
    tous.push(...lot);
    // Une page incomplète signale la fin de la base : inutile d'en demander
    // une de plus pour se l'entendre confirmer.
    if (lot.length < PAGE_SIZE) return { users: tous, truncated: false };
  }
  return { users: tous, truncated: true };
}

const TRIS = {
  created:  (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0),
  lastSeen: (a, b) => new Date(b.lastSignInAt ?? 0) - new Date(a.lastSignInAt ?? 0),
  usage:    (a, b) => (b.quota?.used ?? 0) - (a.quota?.used ?? 0),
  total:    (a, b) => (b.photosTotal ?? 0) - (a.photosTotal ?? 0),
  email:    (a, b) => String(a.email ?? "").localeCompare(String(b.email ?? "")),
};

function matches(fiche, q) {
  if (!q) return true;
  const champs = [
    fiche.email, fiche.profile.fullName, fiche.profile.phone,
    fiche.profile.exportEmail, fiche.stripeCustomerId, fiche.id,
  ];
  return champs.some(v => String(v ?? "").toLowerCase().includes(q));
}

function passesFilter(fiche, filtre) {
  switch (filtre) {
    case "paid":      return fiche.plan !== "trial";
    case "trial":     return fiche.plan === "trial";
    case "sanctioned":return fiche.sanction.active;
    case "unconfirmed": return !fiche.emailConfirmed;
    default:          return true;
  }
}

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { action = "list" } = req.body || {};
  const now = new Date();

  try {
    // Fiche d'un compte, relue en base : c'est ce que renvoie une action pour
    // rafraîchir l'affichage sans recharger la liste entière.
    if (action === "get") {
      const id = String(req.body?.userId ?? "");
      if (!id) return res.status(400).json({ error: "Identifiant manquant." });
      const u = await freshUser(id);
      if (!u) return res.status(404).json({ error: "Compte introuvable." });
      return res.status(200).json({ user: projectUser(u, now) });
    }

    const { users, truncated } = await loadAllUsers();
    const fiches = users.map(u => projectUser(u, now));

    // Chiffres d'ensemble : calculés sur TOUS les comptes, avant filtrage, sinon
    // le total afficherait le résultat de la recherche en cours.
    const moisCourant = now.toISOString().slice(0, 7);
    const stats = {
      total: fiches.length,
      paid: fiches.filter(f => f.plan !== "trial").length,
      trial: fiches.filter(f => f.plan === "trial").length,
      sanctioned: fiches.filter(f => f.sanction.active).length,
      unconfirmed: fiches.filter(f => !f.emailConfirmed).length,
      photosThisMonth: fiches.reduce((s, f) => s + (f.monthly.find(m => m.month === moisCourant)?.photos ?? 0), 0),
      photosAllTime: fiches.reduce((s, f) => s + f.photosTotal, 0),
      newThisMonth: fiches.filter(f => String(f.createdAt ?? "").slice(0, 7) === moisCourant).length,
      truncated,
    };

    const q = normalizeEmail(req.body?.search ?? "");
    const filtre = String(req.body?.filter ?? "all");
    const tri = TRIS[req.body?.sort] ?? TRIS.created;

    const filtrees = fiches.filter(f => matches(f, q) && passesFilter(f, filtre)).sort(tri);

    const perPage = Math.min(200, Math.max(10, Number(req.body?.perPage) || 25));
    const page = Math.max(1, Number(req.body?.page) || 1);
    const debut = (page - 1) * perPage;

    return res.status(200).json({
      users: filtrees.slice(debut, debut + perPage),
      page,
      perPage,
      matching: filtrees.length,
      pages: Math.max(1, Math.ceil(filtrees.length / perPage)),
      stats,
    });
  } catch (e) {
    console.error("admin-users error:", e);
    return res.status(500).json({ error: e.message });
  }
}
