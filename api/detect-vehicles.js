// /api/detect-vehicles.js
// Détection des véhicules via Claude Vision (Haiku) — remplace l'ancien
// backend YOLO hébergé sur Railway. Utilisé par le pipeline showroom pour
// choisir le véhicule principal et écarter les véhicules voisins du
// détourage. En cas d'échec, le frontend retombe sur ses heuristiques
// locales (plaque + composantes connexes), comme avant.

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const MODELS = { default: 'claude-haiku-4-5', best: 'claude-sonnet-5' };

// Tarifs USD par MTok (input/output) — uniquement pour le log de coût.
// NB : Sonnet 5 passe du tarif intro 2/10 au tarif standard 3/15 le 2026-09-01.
const PRICING = {
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5': [2, 10],
};

const PROMPT = `Détecte TOUS les véhicules visibles sur cette photo (voiture, van, camion, moto, bus), même partiellement visibles ou coupés par le bord.

Pour chaque véhicule, donne son rectangle englobant SERRÉ en coordonnées normalisées :
- x=0.0 = bord gauche de l'image, x=1.0 = bord droit
- y=0.0 = bord haut, y=1.0 = bord bas

N'inclus PAS : reflets de véhicules dans des vitrines/carrosseries, véhicules sur affiches ou écrans, jouets.

Réponds UNIQUEMENT avec ce JSON (3 décimales, sans markdown) :
{"vehicles":[{"class":"car","conf":0.95,"bbox":{"x1":0.120,"y1":0.300,"x2":0.780,"y2":0.850}}]}
Si aucun véhicule : {"vehicles":[]}`;

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

  const { b64, tier } = req.body || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  const model = tier === 'best' ? MODELS.best : MODELS.default;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`detect-vehicles [${model}] Anthropic error:`, JSON.stringify(data).slice(0, 500));
      return res.status(500).json({ error: 'Anthropic error' });
    }
    // Suivi du coût réel par appel.
    const u = data.usage || {};
    const [pIn, pOut] = PRICING[model] || [0, 0];
    const cost = ((u.input_tokens || 0) * pIn + (u.output_tokens || 0) * pOut) / 1e6;
    console.log(`detect-vehicles [${model}] usage: in=${u.input_tokens} out=${u.output_tokens} cost=$${cost.toFixed(5)}`);
    const text = data.content?.find(b => b.type === 'text')?.text ?? '';
    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in response' });

    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(500).json({ error: 'Bad JSON' }); }

    // Validation stricte : bbox normalisées plausibles uniquement.
    const okNum = (v) => typeof v === 'number' && v >= -0.05 && v <= 1.05;
    const vehicles = (Array.isArray(parsed.vehicles) ? parsed.vehicles : [])
      .filter(v => v && v.bbox && okNum(v.bbox.x1) && okNum(v.bbox.y1) && okNum(v.bbox.x2) && okNum(v.bbox.y2)
        && v.bbox.x2 > v.bbox.x1 && v.bbox.y2 > v.bbox.y1)
      .map(v => {
        const bbox = {
          x1: Math.max(0, Math.min(1, v.bbox.x1)), y1: Math.max(0, Math.min(1, v.bbox.y1)),
          x2: Math.max(0, Math.min(1, v.bbox.x2)), y2: Math.max(0, Math.min(1, v.bbox.y2)),
        };
        return {
          class: typeof v.class === 'string' ? v.class : 'car',
          conf: typeof v.conf === 'number' ? Math.max(0, Math.min(1, v.conf)) : 0.8,
          bbox,
          area: (bbox.x2 - bbox.x1) * (bbox.y2 - bbox.y1),
        };
      })
      .sort((a, b) => b.area - a.area);

    console.log(`detect-vehicles [${model}]: ${vehicles.length} véhicule(s)`);
    return res.status(200).json({ vehicles, count: vehicles.length });
  } catch (e) {
    console.error('detect-vehicles error:', e);
    return res.status(500).json({ error: e.message });
  }
}
