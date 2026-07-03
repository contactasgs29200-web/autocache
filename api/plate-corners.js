// /api/plate-corners.js
// Détection interne des coins de la plaque via Claude (Fable 5) Vision.
// Fonctionne en DEUX PASSES pilotées par le frontend :
//   mode "locate" : image entière → bbox approximative de la plaque.
//   mode "refine" : crop zoomé sur la plaque → les 4 coins exacts (quadrilatère
//                   en perspective, pas un rectangle).
// La précision au pixel n'est possible que sur le crop — sur l'image entière la
// plaque est trop petite pour viser les coins exactement.

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

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

═══ ÉTAPE 3 — COORDONNÉES ═══
Donne les coordonnées normalisées (0.0–1.0, relatives à CE crop) des 4 coins de la SURFACE de la plaque :
- tl : coin haut-gauche
- tr : coin haut-droit
- br : coin bas-droit
- bl : coin bas-gauche

x=0.0 = bord gauche de cette image, x=1.0 = bord droit.
y=0.0 = bord haut, y=1.0 = bord bas.

Si aucune plaque n'est identifiable dans ce crop, réponds {"found":false}.

Réponds UNIQUEMENT avec ce JSON (3 décimales, sans markdown) :
{"found":true,"analysis":"caméra au niveau, voiture tournée à droite, côté gauche plus proche; bord supérieur incliné vers le bas à droite","tl":{"x":0.212,"y":0.334},"tr":{"x":0.741,"y":0.398},"br":{"x":0.735,"y":0.612},"bl":{"x":0.208,"y":0.531}}`;

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

async function askFable(apiKey, b64, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Repli serveur : si les classifieurs Fable 5 refusent la requête,
      // l'API relance automatiquement sur Opus 4.8 dans le même appel.
      'anthropic-beta': 'server-side-fallback-2026-06-01',
    },
    body: JSON.stringify({
      model: 'claude-fable-5',
      // Fable 5 : le thinking (toujours actif) compte dans max_tokens. Le
      // prompt refine déclenche un long raisonnement perspective — avec un
      // budget trop petit, tout part en thinking et le JSON final n'est
      // jamais écrit (réponse sans bloc text).
      max_tokens: 8000,
      fallbacks: [{ model: 'claude-opus-4-8' }],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('plate-corners Anthropic error:', JSON.stringify(data).slice(0, 500));
    return { error: { status: 500, body: { error: 'Anthropic error', details: data } } };
  }
  if (data.stop_reason === 'refusal') {
    console.warn('plate-corners: refusal', JSON.stringify(data.stop_details || {}));
    return { refused: true };
  }
  // Fable 5 renvoie un bloc "thinking" avant le bloc "text" : ne jamais
  // lire content[0] directement, chercher le premier bloc texte.
  const text = data.content?.find(b => b.type === 'text')?.text ?? '';
  console.log('plate-corners stop:', data.stop_reason, 'raw:', text.slice(0, 300));
  const raw = extractJSON(text);
  if (!raw) return { error: { status: 500, body: { error: 'No JSON in response', stop_reason: data.stop_reason, text } } };
  try {
    return { json: JSON.parse(raw) };
  } catch (e) {
    return { error: { status: 500, body: { error: 'Bad JSON in response', text } } };
  }
}

const okPoint = p => p && typeof p.x === 'number' && typeof p.y === 'number'
  && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { b64, mode } = req.body || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  try {
    if (mode === 'locate') {
      const r = await askFable(apiKey, b64, LOCATE_PROMPT);
      if (r.error)   return res.status(r.error.status).json(r.error.body);
      if (r.refused || !r.json.found) return res.status(200).json({ found: false });
      const box = r.json.box;
      if (!box || ![box.x1, box.y1, box.x2, box.y2].every(v => typeof v === 'number')
          || box.x2 <= box.x1 || box.y2 <= box.y1) {
        return res.status(500).json({ error: 'Invalid box', box });
      }
      console.log('plate-corners locate OK:', JSON.stringify(box));
      return res.status(200).json({ found: true, box });
    }

    // mode "refine" (défaut) : 4 coins précis sur le crop
    const r = await askFable(apiKey, b64, REFINE_PROMPT);
    if (r.error)   return res.status(r.error.status).json(r.error.body);
    if (r.refused || !r.json.found) return res.status(200).json({ found: false });

    const c = r.json;
    if (c.analysis) console.log('analysis:', c.analysis);
    if (!okPoint(c.tl) || !okPoint(c.tr) || !okPoint(c.br) || !okPoint(c.bl)) {
      return res.status(500).json({ error: 'Invalid corners', c });
    }

    console.log('plate-corners refine OK:', JSON.stringify({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl }));
    return res.status(200).json({ found: true, tl: c.tl, tr: c.tr, br: c.br, bl: c.bl });

  } catch (e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
