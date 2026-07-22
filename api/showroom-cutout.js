// /api/showroom-cutout.js
// Détourage professionnel + ombre IA pour le mode showroom (plan SHOWROOM_V2,
// étage A). Deux fournisseurs interchangeables derrière le même contrat :
//
//   - Photoroom Image Editing API v2 (PHOTOROOM_API_KEY) — détourage +
//     « AI Shadows » (shadow.mode=ai.soft), plan Plus requis.
//   - remove.bg (REMOVEBG_API_KEY) — type=car (sujet automobile, vitres
//     semi-transparentes) + ombre voiture.
//
// SHOWROOM_CUTOUT_PROVIDER=photoroom|removebg force un fournisseur quand les
// deux clés sont présentes. SHOWROOM_CUTOUT_SHADOW=off désactive l'ombre IA.
// Sans aucune clé configurée → 501 : le frontend retombe silencieusement sur
// le pipeline local (@imgly + heuristiques), comme avant.
//
// Entrée  : POST { b64 }  (JPEG base64, sans préfixe data:)
//           + header Authorization: Bearer <access_token Supabase>
// Sortie  : { dataUrl: "data:image/png;base64,...", provider, shadow }
//           Le PNG contient le véhicule détouré, ombre incluse dans l'alpha.
//
// GATING : chaque appel coûte un crédit fournisseur → l'accès est contrôlé
// ICI, pas seulement dans l'UI. Autorisés :
//  - plan "premium_showroom" : SHOWROOM_MONTHLY_QUOTA photos/mois (compteur
//    showroom_used, remis à zéro avec le quota photos mensuel)
//  - plan "trial" : TRIAL_SHOWROOM_LIMIT photos offertes à vie (compteur
//    showroom_trial_used, jamais remis à zéro)
// Les autres plans (pro, anciens premium/essential) → 403 : leur pipeline
// showroom éventuel reste 100 % local (@imgly), sans coût.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: { sizeLimit: '12mb' } }, maxDuration: 60 };

export const SHOWROOM_MONTHLY_QUOTA = 150;
export const TRIAL_SHOWROOM_LIMIT   = 3;

// Décision d'accès d'après les métadonnées utilisateur. Pure — exportée pour
// les tests. Renvoie { allowed, counterKey, used } ou { allowed:false, status, error }.
export function authorizeShowroom(meta) {
  const plan = meta?.plan ?? "trial";
  if (plan === "premium_showroom") {
    const used = meta?.showroom_used ?? 0;
    if (used >= SHOWROOM_MONTHLY_QUOTA) {
      return { allowed: false, status: 402, error: `Quota showroom mensuel atteint (${SHOWROOM_MONTHLY_QUOTA} photos)` };
    }
    return { allowed: true, counterKey: "showroom_used", used };
  }
  if (plan === "trial") {
    const used = meta?.showroom_trial_used ?? 0;
    if (used >= TRIAL_SHOWROOM_LIMIT) {
      return { allowed: false, status: 402, error: `Photos showroom d'essai épuisées (${TRIAL_SHOWROOM_LIMIT} offertes)` };
    }
    return { allowed: true, counterKey: "showroom_trial_used", used };
  }
  return { allowed: false, status: 403, error: "Le détourage Showroom nécessite l'abonnement Premium" };
}

// Choix du fournisseur d'après l'environnement. Exporté pour les tests.
export function pickProvider(env) {
  const forced = (env.SHOWROOM_CUTOUT_PROVIDER || '').toLowerCase();
  if (forced === 'photoroom') return env.PHOTOROOM_API_KEY ? 'photoroom' : null;
  if (forced === 'removebg')  return env.REMOVEBG_API_KEY  ? 'removebg'  : null;
  if (env.PHOTOROOM_API_KEY) return 'photoroom';
  if (env.REMOVEBG_API_KEY)  return 'removebg';
  return null;
}

async function photoroomCutout(b64, apiKey, shadow) {
  const form = new FormData();
  form.append('imageFile', new Blob([Buffer.from(b64, 'base64')], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('background.color', 'transparent');
  form.append('export.format', 'png');
  form.append('outputSize', 'originalImage');
  if (shadow) form.append('shadow.mode', 'ai.soft');
  const r = await fetch('https://image-api.photoroom.com/v2/edit', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, Accept: 'image/png, application/json' },
    body: form,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Photoroom HTTP ${r.status} — ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString('base64');
}

async function removebgCutout(b64, apiKey, shadow) {
  const r = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      image_file_b64: b64,
      size: 'auto',
      type: 'car',
      format: 'png',
      semitransparency: true,     // vitres semi-transparentes
      add_shadow: !!shadow,       // ombre voiture (add-on remove.bg)
    }),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const detail = json?.errors?.[0]?.title || JSON.stringify(json)?.slice(0, 300) || '';
    throw new Error(`remove.bg HTTP ${r.status} — ${detail}`);
  }
  const out = json?.data?.result_b64;
  if (!out) throw new Error('remove.bg : réponse sans result_b64');
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const provider = pickProvider(process.env);
  if (!provider) {
    // Pas de clé configurée : contrat explicite avec le frontend → repli local.
    return res.status(501).json({ error: 'Détourage Pro non configuré' });
  }

  // ── Authentification + droit d'accès (l'appel coûte de l'argent) ──
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: authError } = await sb.auth.getUser(token);
  if (authError || !userData?.user) return res.status(401).json({ error: 'Session invalide' });
  const authz = authorizeShowroom(userData.user.user_metadata);
  if (!authz.allowed) return res.status(authz.status).json({ error: authz.error, code: 'showroom_gate' });

  const { b64 } = req.body || {};
  if (!b64 || typeof b64 !== 'string') return res.status(400).json({ error: 'Missing b64' });

  const shadow = (process.env.SHOWROOM_CUTOUT_SHADOW || '').toLowerCase() !== 'off';

  try {
    const t0 = Date.now();
    const pngB64 = provider === 'photoroom'
      ? await photoroomCutout(b64, process.env.PHOTOROOM_API_KEY, shadow)
      : await removebgCutout(b64, process.env.REMOVEBG_API_KEY, shadow);
    // Décompte APRÈS succès fournisseur : un échec (panne, crédits épuisés)
    // ne consomme pas le quota de l'utilisateur. Les appels d'un même lot
    // sont séquentiels côté client — pas de course sur le compteur.
    try {
      await sb.auth.admin.updateUserById(userData.user.id, {
        user_metadata: { [authz.counterKey]: authz.used + 1 },
      });
    } catch (e2) {
      console.error('showroom-cutout: incrément quota échoué:', e2?.message);
    }
    console.log(`showroom-cutout [${provider}] ok en ${Date.now() - t0} ms (${Math.round(pngB64.length * 0.75 / 1024)} Ko) — ${authz.counterKey}=${authz.used + 1}`);
    return res.status(200).json({ dataUrl: `data:image/png;base64,${pngB64}`, provider, shadow });
  } catch (e) {
    // L'erreur fournisseur (clé invalide, crédits épuisés…) est loguée côté
    // Vercel et renvoyée en 502 : le frontend loguera puis repliera sur
    // @imgly — jamais de photo en échec à cause du détourage Pro.
    console.error(`showroom-cutout [${provider}] échec:`, e?.message);
    return res.status(502).json({ error: e?.message || 'Erreur fournisseur détourage' });
  }
}
