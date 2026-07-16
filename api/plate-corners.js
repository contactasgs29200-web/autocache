// /api/plate-corners.js
// Détection interne des coins de la plaque via Claude Vision.
// Fonctionne en PASSES pilotées par le frontend :
//   mode "locate" : image entière → bbox approximative de la plaque.
//   mode "refine" : crop zoomé sur la plaque → les 4 coins exacts (quadrilatère
//                   en perspective, pas un rectangle).
//   mode "verify" : crop recadré sur le quad DÉTECTÉ → contrôle indépendant
//                   que la plaque est bien entière et centrée dedans (attrape
//                   les quads posés à côté de la plaque avant la pose du cache).
//
// Stratégie de coût : chaque passe utilise par défaut le modèle le moins cher
// capable de la tâche (locate/verify = trivial → Haiku ; refine = précision →
// Sonnet 5). Le frontend peut demander tier "best" (Opus 4.8) en escalade
// quand le résultat économique échoue au contrôle de plausibilité — la
// qualité max n'est donc payée que sur les photos difficiles.

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const MODELS = {
  locate: { default: 'claude-haiku-4-5', best: 'claude-opus-4-8' },
  refine: { default: 'claude-sonnet-5', best: 'claude-opus-4-8' },
  verify: { default: 'claude-haiku-4-5', best: 'claude-sonnet-5' },
};

// Tarifs USD par MTok (input/output) — uniquement pour le log de coût.
// NB : Sonnet 5 passe du tarif intro 2/10 au tarif standard 3/15 le 2026-09-01.
const PRICING = {
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5': [2, 10],
  'claude-opus-4-8': [5, 25],
};

const LOCATE_PROMPT = `Regarde cette photo de véhicule. Trouve la PLAQUE D'IMMATRICULATION : la plaque portant des caractères alphanumériques (ex: "AB-123-CD"), sur fond blanc ou jaune, fixée au pare-choc avant ou arrière du véhicule.

Ne confonds PAS la plaque avec : autocollants concessionnaire, moulures de pare-choc, calandre, entrées d'air, caches de crochet de remorquage, ou tout panneau au sol/mur.

Donne un rectangle englobant GÉNÉREUX autour de la plaque (un peu plus grand que la plaque elle-même, pour être sûr qu'elle soit entièrement dedans), en coordonnées normalisées :
- x=0.0 = bord gauche de l'image, x=1.0 = bord droit
- y=0.0 = bord haut, y=1.0 = bord bas

Si aucune plaque n'est visible, réponds {"found":false}.

Réponds UNIQUEMENT avec ce JSON (3 décimales, sans markdown) :
{"found":true,"box":{"x1":0.310,"y1":0.640,"x2":0.480,"y2":0.720}}`;

const REFINE_PROMPT = `Cette image est un CROP zoomé sur la plaque d'immatriculation d'un véhicule (la plaque avec les caractères alphanumériques, entourée de carrosserie/pare-choc).

═══ ÉTAPE 1 — ISOLER LA SURFACE DE LA PLAQUE ═══
La surface de la plaque est MATE et porte le texte. Le cadre/support en plastique ou chrome autour N'EST PAS la plaque — prends uniquement le rectangle qui contient les caractères, bord à bord, pas le cadre ni le renfoncement du pare-choc.

═══ ÉTAPE 2 — RAISONNER SUR LA PERSPECTIVE ═══
La plaque est un vrai rectangle (~520×110mm) qui, en perspective, se projette en QUADRILATÈRE DÉFORMÉ (trapèze/parallélogramme) dès que le véhicule n'est pas vu strictement de face. Analyse :
- Caméra au-dessus / au niveau / en dessous de la plaque ?
- Véhicule tourné vers la gauche / la droite / de face ?
- Quel côté de la plaque est le plus proche de la caméra (donc visuellement le plus grand) ?
Vérifie visuellement où se trouve CHAQUE coin : suis le bord supérieur de la plaque de gauche à droite, puis le bord inférieur. Les bords supérieur et inférieur ne sont PAS forcément horizontaux dans l'image.

IMPORTANT : ne "corrige" jamais les coins vers un rectangle aligné sur les axes. Donne les positions RÉELLEMENT observées de chaque coin, même si le quadrilatère est incliné ou déformé.

═══ ÉTAPE 3 — ANCRAGE SUR LE TEXTE ═══
Lis les caractères de la plaque (ex: "DB-127-DG"). Tes 4 coins délimitent le rectangle qui CONTIENT ces caractères. VÉRIFICATION OBLIGATOIRE avant de répondre : le centre de ton quadrilatère doit tomber SUR le texte lu — pas au-dessus (capot/calandre), pas en dessous (bouclier/entrée d'air). Erreur classique à éviter : donner un quadrilatère décalé d'une hauteur de plaque vers le bas, dont le bord HAUT longe le bord BAS réel de la plaque.

═══ ÉTAPE 4 — COORDONNÉES ═══
Donne les coordonnées normalisées (0.0–1.0, relatives à CE crop) des 4 coins de la SURFACE de la plaque :
- tl : coin haut-gauche
- tr : coin haut-droit
- br : coin bas-droit
- bl : coin bas-gauche

x=0.0 = bord gauche de cette image, x=1.0 = bord droit.
y=0.0 = bord haut, y=1.0 = bord bas.

Si aucune plaque n'est identifiable dans ce crop, réponds {"found":false}.

Réponds UNIQUEMENT avec ce JSON (3 décimales, sans markdown) :
{"found":true,"analysis":"caméra au niveau, voiture tournée à droite, côté gauche plus proche; bord supérieur incliné vers le bas à droite","text":"AB-123-CD","tl":{"x":0.212,"y":0.334},"tr":{"x":0.741,"y":0.398},"br":{"x":0.735,"y":0.612},"bl":{"x":0.208,"y":0.531}}`;

const VERIFY_PROMPT = `Cette image est un petit crop qui devrait contenir une plaque d'immatriculation ENTIÈRE (rectangle blanc ou jaune portant des caractères alphanumériques), à peu près centrée et occupant la majeure partie du cadre.

Réponds UNIQUEMENT avec ce JSON (sans markdown) :
- Plaque entière visible (ses 4 bords dans le cadre), à peu près centrée : {"ok":true}
- Plaque coupée par un bord, ou entière mais nettement décentrée : {"ok":false,"where":"..."} où "where" indique OÙ se trouve le centre de la plaque par rapport au centre du cadre : "above", "below", "left" ou "right"
- Aucune plaque visible (carrosserie, calandre, entrée d'air, sol…) : {"ok":false,"where":"absent"}`;

function extractJSON(txt) {
  let depth = 0, start = -1;
  for (let i = 0; i < txt.length; i++) {
    if (txt[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (txt[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) return txt.slice(start, i + 1);
    }
  }
  return null;
}

async function askClaude(apiKey, model, b64, prompt) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  const body = {
    model,
    // Sonnet 5 / Opus 4.8 : le thinking (adaptatif) compte
    // dans max_tokens — un budget trop petit part entièrement en thinking et
    // le JSON final n'est jamais écrit. Haiku ne « pense » pas mais le budget
    // large ne coûte rien (on ne paie que les tokens réellement générés).
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: prompt },
      ],
    }],
  };
  if (model !== 'claude-haiku-4-5') {
    // Coût + latence : le thinking adaptatif (sortie facturée) est le premier
    // poste de coût du pipeline. Sur le chemin nominal (Sonnet 5), "low"
    // suffit pour une tâche ciblée comme celle-ci — le contrôle de
    // plausibilité + verify + escalade côté client protège la qualité. Sur
    // l'escalade (Opus 4.8, photos difficiles), on garde "medium". Haiku ne
    // supporte pas ce paramètre.
    body.output_config = { effort: model === 'claude-opus-4-8' ? 'medium' : 'low' };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers, body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error(`plate-corners [${model}] Anthropic error:`, JSON.stringify(data).slice(0, 500));
    return { error: { status: 500, body: { error: 'Anthropic error', details: data } } };
  }
  // Suivi du coût réel par appel (les tokens de sortie incluent le thinking).
  const u = data.usage || {};
  const [pIn, pOut] = PRICING[model] || [0, 0];
  const cost = ((u.input_tokens || 0) * pIn + (u.output_tokens || 0) * pOut) / 1e6;
  console.log(`plate-corners [${model}] usage: in=${u.input_tokens} out=${u.output_tokens} cost=$${cost.toFixed(5)}`);
  if (data.stop_reason === 'refusal') {
    console.warn(`plate-corners [${model}]: refusal`, JSON.stringify(data.stop_details || {}));
    return { refused: true };
  }
  // Les modèles avec thinking renvoient un bloc "thinking" avant le bloc
  // "text" : ne jamais lire content[0] directement, chercher le bloc texte.
  const text = data.content?.find(b => b.type === 'text')?.text ?? '';
  console.log(`plate-corners [${model}] stop:`, data.stop_reason, 'raw:', text.slice(0, 300));
  const raw = extractJSON(text);
  if (!raw) return { error: { status: 500, body: { error: 'No JSON in response', model, stop_reason: data.stop_reason, text } } };
  try {
    return { json: JSON.parse(raw) };
  } catch (e) {
    return { error: { status: 500, body: { error: 'Bad JSON in response', model, text } } };
  }
}

const okPoint = p => p && typeof p.x === 'number' && typeof p.y === 'number'
  && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { b64, mode, tier } = req.body || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  const passe = mode === 'locate' ? 'locate' : mode === 'verify' ? 'verify' : 'refine';
  const model = MODELS[passe][tier === 'best' ? 'best' : 'default'];

  try {
    if (passe === 'verify') {
      const r = await askClaude(apiKey, model, b64, VERIFY_PROMPT);
      // Contrôle best-effort : en cas d'erreur/refus, on répond "indéterminé"
      // (ok:null) — le client conserve alors le quad plutôt que de le jeter.
      if (r.error || r.refused || typeof r.json?.ok !== 'boolean') {
        console.warn(`plate-corners verify [${model}] indéterminé`);
        return res.status(200).json({ ok: null });
      }
      const where = ['above', 'below', 'left', 'right', 'absent'].includes(r.json.where) ? r.json.where : null;
      console.log(`plate-corners verify [${model}]:`, JSON.stringify({ ok: r.json.ok, where }));
      return res.status(200).json({ ok: r.json.ok, where });
    }

    if (passe === 'locate') {
      const r = await askClaude(apiKey, model, b64, LOCATE_PROMPT);
      if (r.error)   return res.status(r.error.status).json(r.error.body);
      if (r.refused || !r.json.found) return res.status(200).json({ found: false });
      const box = r.json.box;
      // Coordonnées normalisées attendues : rejette aussi les valeurs en
      // pixels (ex: 310 au lieu de 0.31) pour déclencher l'escalade.
      if (!box || ![box.x1, box.y1, box.x2, box.y2].every(v => typeof v === 'number' && v >= -0.1 && v <= 1.1)
          || box.x2 <= box.x1 || box.y2 <= box.y1) {
        console.warn(`plate-corners locate [${model}] box invalide:`, JSON.stringify(box));
        return res.status(200).json({ found: false, invalid_box: true });
      }
      console.log(`plate-corners locate [${model}] OK:`, JSON.stringify(box));
      return res.status(200).json({ found: true, box, model });
    }

    // mode "refine" : 4 coins précis sur le crop
    const r = await askClaude(apiKey, model, b64, REFINE_PROMPT);
    if (r.error)   return res.status(r.error.status).json(r.error.body);
    if (r.refused || !r.json.found) return res.status(200).json({ found: false });

    const c = r.json;
    if (c.analysis) console.log('analysis:', c.analysis);
    if (!okPoint(c.tl) || !okPoint(c.tr) || !okPoint(c.br) || !okPoint(c.bl)) {
      return res.status(500).json({ error: 'Invalid corners', model, c });
    }

    console.log(`plate-corners refine [${model}] OK:`, JSON.stringify({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl }));
    return res.status(200).json({ found: true, tl: c.tl, tr: c.tr, br: c.br, bl: c.bl, model });

  } catch (e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
