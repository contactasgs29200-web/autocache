// /api/plate-corners.js
// Détection des coins de la plaque via Claude Vision, en DEUX passes pilotées
// par le frontend :
//   mode "locate" : image entière → bbox approximative de la plaque.
//   mode "refine" : crop zoomé sur la plaque → les 4 coins exacts
//                   (quadrilatère en perspective, pas un rectangle).
//
// Stratégie de coût : le strict minimum d'appels, chacun sur le modèle le
// moins cher capable de la tâche (locate = trivial → Haiku 4.5 ;
// refine = précision → Sonnet 5 en effort réduit). Le tier "best" est
// l'UNIQUE escalade autorisée (même modèle, effort haut — pas de modèle
// premium) : le frontend ne la demande que quand le résultat économique
// échoue à ses contrôles de plausibilité locaux. Les vérifications
// LLM supplémentaires (mode verify, corrections dirigées) ont été
// remplacées par des contrôles géométriques gratuits côté client.

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const MODELS = {
  locate: { default: 'claude-haiku-4-5', best: 'claude-sonnet-5' },
  refine: { default: 'claude-sonnet-5', best: 'claude-sonnet-5' },
};
// Effort Sonnet 5 : "low" par défaut (latence ~2-4 s, précision suffisante sur
// un crop zoomé ×4), "high" uniquement en escalade sur les photos difficiles.
const EFFORT = {
  locate: { default: null, best: 'low' },   // null = Haiku (pas d'effort)
  refine: { default: 'low', best: 'high' },
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

═══ ÉTAPE 1 — LIRE LES CARACTÈRES (ton ANCRE) ═══
Lis le texte de la plaque (ex: "DB-127-DG") et donne la boîte englobante SERRÉE de la bande de caractères : "chars" = {x1,y1,x2,y2} où (x1,y1) = haut-gauche du PREMIER caractère et (x2,y2) = bas-droit du DERNIER caractère, en coordonnées normalisées de CE crop. Si les caractères sont trop petits/flous pour être lus mais que la bande de texte est visible, donne quand même sa boîte (text vide). Tout le reste de ta réponse doit être cohérent avec cette boîte.

═══ ÉTAPE 2 — ISOLER LA SURFACE DE LA PLAQUE ═══
La surface de la plaque est le rectangle MAT qui porte ces caractères. Le cadre/support en plastique ou chrome autour N'EST PAS la plaque — prends uniquement le rectangle bord à bord, pas le cadre ni le renfoncement du pare-choc.

═══ ÉTAPE 3 — RAISONNER SUR LA PERSPECTIVE ═══
La plaque est un vrai rectangle (~520×110mm) qui, en perspective, se projette en QUADRILATÈRE DÉFORMÉ (trapèze/parallélogramme) dès que le véhicule n'est pas vu strictement de face. Analyse :
- Caméra au-dessus / au niveau / en dessous de la plaque ?
- Véhicule tourné vers la gauche / la droite / de face ?
- Quel côté de la plaque est le plus proche de la caméra (donc visuellement le plus grand) ?
Les bords supérieur et inférieur ne sont PAS forcément horizontaux dans l'image. Ne "corrige" jamais les coins vers un rectangle aligné sur les axes : donne les positions RÉELLEMENT observées.

═══ ÉTAPE 4 — LES 4 COINS, AUTOUR DE L'ANCRE ═══
La surface de la plaque dépasse de la bande de caractères d'environ 10-15% en largeur (bandes bleues aux extrémités) et 20-40% en hauteur. Tes 4 coins doivent donc ENTOURER STRICTEMENT la boîte "chars" :
- tl : plus haut ET plus à gauche que le haut-gauche de "chars"
- tr : plus haut ET plus à droite que le haut-droit de "chars"
- br : plus bas ET plus à droite que le bas-droit de "chars"
- bl : plus bas ET plus à gauche que le bas-gauche de "chars"
Erreur classique à éviter ABSOLUMENT : un quadrilatère décalé d'une hauteur de plaque vers le bas, dont le bord HAUT longe le bord BAS réel de la plaque. Si ta boîte "chars" n'est pas à l'intérieur de ton quadrilatère, tes coins sont FAUX : recommence.

Coordonnées normalisées 0.0–1.0 relatives à CE crop : x=0.0 = bord gauche, x=1.0 = bord droit, y=0.0 = bord haut, y=1.0 = bord bas.

Si aucune plaque n'est identifiable dans ce crop, réponds {"found":false}.

Réponds UNIQUEMENT avec ce JSON (3 décimales, sans markdown) :
{"found":true,"analysis":"caméra au niveau, voiture tournée à droite, côté gauche plus proche; bord supérieur incliné vers le bas à droite","text":"AB-123-CD","chars":{"x1":0.281,"y1":0.410,"x2":0.663,"y2":0.518},"tl":{"x":0.212,"y":0.334},"tr":{"x":0.741,"y":0.398},"br":{"x":0.735,"y":0.612},"bl":{"x":0.208,"y":0.531}}`;

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

async function askClaude(apiKey, model, effort, b64, prompt) {
  const body = {
    model,
    // Sonnet 5 : le thinking adaptatif (actif par défaut) compte dans
    // max_tokens — un budget trop petit part entièrement en thinking et le
    // JSON final n'est jamais écrit. Haiku ne « pense » pas mais le budget
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
  if (effort) body.output_config = { effort };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error(`plate-corners [${model}] Anthropic error:`, JSON.stringify(data).slice(0, 500));
    return { error: { status: 500, body: { error: 'Anthropic error', details: data } } };
  }
  if (data.stop_reason === 'refusal') {
    console.warn(`plate-corners [${model}]: refusal`, JSON.stringify(data.stop_details || {}));
    return { refused: true };
  }
  // Les modèles avec thinking renvoient un bloc "thinking" avant le bloc
  // "text" : ne jamais lire content[0] directement, chercher le bloc texte.
  const text = data.content?.find(b => b.type === 'text')?.text ?? '';
  console.log(`plate-corners [${model}${effort ? ':' + effort : ''}] stop:`, data.stop_reason, 'raw:', text.slice(0, 300));
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

const okBox = b => b && [b.x1, b.y1, b.x2, b.y2].every(v => typeof v === 'number' && v >= -0.05 && v <= 1.05)
  && b.x2 > b.x1 && b.y2 > b.y1;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { b64, mode, tier } = req.body || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  const passe = mode === 'locate' ? 'locate' : 'refine';
  const t = tier === 'best' ? 'best' : 'default';
  const model = MODELS[passe][t];
  const effort = EFFORT[passe][t];

  try {
    if (passe === 'locate') {
      const r = await askClaude(apiKey, model, effort, b64, LOCATE_PROMPT);
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
    const r = await askClaude(apiKey, model, effort, b64, REFINE_PROMPT);
    if (r.error)   return res.status(r.error.status).json(r.error.body);
    if (r.refused || !r.json.found) return res.status(200).json({ found: false });

    const c = r.json;
    if (c.analysis) console.log('analysis:', c.analysis);
    if (!okPoint(c.tl) || !okPoint(c.tr) || !okPoint(c.br) || !okPoint(c.bl)) {
      return res.status(500).json({ error: 'Invalid corners', model, c });
    }

    // Boîte des caractères : l'ancre du contrôle de cohérence côté client
    // (le quad doit la contenir, sinon il est décalé et sera reconstruit à
    // partir d'elle). Optionnelle — si invalide on l'omet, les coins restent
    // exploitables seuls.
    const chars = okBox(c.chars) ? c.chars : null;
    const text = typeof c.text === 'string' ? c.text.slice(0, 16) : null;

    console.log(`plate-corners refine [${model}:${effort}] OK:`, JSON.stringify({ text, chars, tl: c.tl, tr: c.tr, br: c.br, bl: c.bl }));
    return res.status(200).json({
      found: true, tl: c.tl, tr: c.tr, br: c.br, bl: c.bl,
      ...(chars ? { chars } : {}), ...(text ? { text } : {}), model,
    });

  } catch (e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
