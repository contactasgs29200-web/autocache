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
// Sortie  : { dataUrl: "data:image/png;base64,...", provider, shadow }
//           Le PNG contient le véhicule détouré, ombre incluse dans l'alpha.

import { requireUser } from './_auth.js';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } }, maxDuration: 60 };

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

  // Chaque appel consomme du crédit Photoroom / remove.bg.
  const user = await requireUser(req, res);
  if (!user) return;

  const provider = pickProvider(process.env);
  if (!provider) {
    // Pas de clé configurée : contrat explicite avec le frontend → repli local.
    return res.status(501).json({ error: 'Détourage Pro non configuré' });
  }

  const { b64 } = req.body || {};
  if (!b64 || typeof b64 !== 'string') return res.status(400).json({ error: 'Missing b64' });

  const shadow = (process.env.SHOWROOM_CUTOUT_SHADOW || '').toLowerCase() !== 'off';

  try {
    const t0 = Date.now();
    const pngB64 = provider === 'photoroom'
      ? await photoroomCutout(b64, process.env.PHOTOROOM_API_KEY, shadow)
      : await removebgCutout(b64, process.env.REMOVEBG_API_KEY, shadow);
    console.log(`showroom-cutout [${provider}] ok en ${Date.now() - t0} ms (${Math.round(pngB64.length * 0.75 / 1024)} Ko)`);
    return res.status(200).json({ dataUrl: `data:image/png;base64,${pngB64}`, provider, shadow });
  } catch (e) {
    // L'erreur fournisseur (clé invalide, crédits épuisés…) est loguée côté
    // Vercel et renvoyée en 502 : le frontend loguera puis repliera sur
    // @imgly — jamais de photo en échec à cause du détourage Pro.
    console.error(`showroom-cutout [${provider}] échec:`, e?.message);
    return res.status(502).json({ error: e?.message || 'Erreur fournisseur détourage' });
  }
}
