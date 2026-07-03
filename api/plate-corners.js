// /api/plate-corners.js
// Détection interne des 4 coins de la plaque via Claude (Fable 5) Vision.
// Contrairement à un simple bbox, le prompt force le modèle à raisonner sur
// la perspective (angle caméra / voiture) pour renvoyer un vrai quadrilatère
// (trapèze/parallélogramme) qui épouse la plaque même quand la voiture a de
// l'angle, au lieu d'un rectangle strict.

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const PLATE_CORNERS_PROMPT = `Regarde cette photo de véhicule. Trouve la PLAQUE D'IMMATRICULATION : la plaque plate portant des caractères alphanumériques (ex: "AB-123-CD" en France), sur fond blanc ou jaune, fixée à la carrosserie (pare-choc avant ou arrière).

Ne confonds PAS la plaque avec : autocollants concessionnaire, moulures/chrome de pare-choc, plaques de protection sous le châssis, caches de crochet de remorquage, ou tout panneau posé au sol/mur.

═══ ÉTAPE 1 — ISOLER LA SURFACE DE LA PLAQUE ═══
La surface de la plaque est MATE (non réfléchissante) et porte le texte. Le cadre/support en plastique ou chrome autour N'EST PAS la plaque — ne prends que le rectangle qui contient exactement les caractères, pas le cadre.

═══ ÉTAPE 2 — RAISONNER SUR LA PERSPECTIVE ═══
La plaque est un vrai rectangle (~520×110mm) qui, en perspective, se projette en un QUADRILATÈRE DÉFORMÉ (trapèze/parallélogramme) dès que la voiture n'est pas prise strictement de face. Raisonne :
- Hauteur caméra par rapport à la plaque : au-dessus / au niveau / en dessous ?
- Angle horizontal : voiture tournée vers la gauche / la droite / de face ?
- Quel côté du quadrilatère est le plus proche de la caméra (donc visuellement le plus grand) ?

IMPORTANT : les 4 coins NE FORMENT PAS un rectangle aligné sur les axes dès que la voiture a de l'angle. Ne "corrige" jamais les coins vers un rectangle parfait — donne les coordonnées RÉELLEMENT observées, y compris si les côtés opposés ou les angles ne sont pas égaux.

═══ ÉTAPE 3 — COORDONNÉES ═══
Donne les coordonnées normalisées (0.0 à 1.0) des 4 coins de la SURFACE de la plaque, dans l'ordre :
- tl : coin haut-gauche
- tr : coin haut-droit
- br : coin bas-droit
- bl : coin bas-gauche

x=0.0 = bord gauche de l'image, x=1.0 = bord droit.
y=0.0 = bord haut de l'image, y=1.0 = bord bas.

Si aucune plaque n'est visible ou identifiable avec certitude, réponds avec "found": false (et laisse tl/tr/br/bl absents).

Réponds UNIQUEMENT avec ce JSON (3 décimales, sans markdown, sans texte hors JSON) :
{"found":true,"analysis":"plaque isolée du cadre; caméra au niveau, voiture tournée à droite; côté gauche plus proche","tl":{"x":0.301,"y":0.712},"tr":{"x":0.551,"y":0.703},"br":{"x":0.553,"y":0.761},"bl":{"x":0.302,"y":0.771}}`;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { b64 } = req.body || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-fable-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: PLATE_CORNERS_PROMPT },
          ],
        }],
      }),
    });

    const data = await response.json();
    console.log('plate-corners status:', response.status);
    if (!response.ok) return res.status(500).json({ error: 'Anthropic error', details: data });

    const text = data.content?.[0]?.text ?? '';
    console.log('plate-corners raw:', text.slice(0, 300));

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in response', text });

    const c = JSON.parse(raw);
    if (c.analysis) console.log('analysis:', c.analysis);

    if (!c.found) return res.status(200).json({ found: false });

    const ok = p => p && typeof p.x === 'number' && typeof p.y === 'number'
      && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;

    if (!ok(c.tl) || !ok(c.tr) || !ok(c.br) || !ok(c.bl)) {
      return res.status(500).json({ error: 'Invalid corners', c });
    }

    const w = Math.abs(c.tr.x - c.tl.x);
    const h = Math.abs(c.bl.y - c.tl.y);
    if (h > 0 && (w / h < 0.8 || w / h > 20)) {
      return res.status(500).json({ error: 'Aspect ratio invalid', w, h, ratio: (w / h).toFixed(2) });
    }

    console.log('plate-corners OK:', JSON.stringify({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl }));
    return res.status(200).json({ found: true, tl: c.tl, tr: c.tr, br: c.br, bl: c.bl });

  } catch (e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
