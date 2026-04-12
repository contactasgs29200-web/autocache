// /api/headlights.js
// Utilise GPT-4o Vision pour localiser tous les feux/optiques du véhicule.
// Retourne des boîtes englobantes normalisées (0-1) pour chaque optique détectée.

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

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

  const { b64 } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set in environment' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64 image' });

  const prompt = `Look at this car photo. Locate ONLY the two FRONT headlights (phares avant) — the light units at the front of the vehicle near the hood/bonnet.

For each front headlight, return a bounding box in normalized coordinates (0.0 = left/top edge, 1.0 = right/bottom edge of the image).

Rules:
- x, y = top-left corner of the bounding box
- w, h = width and height
- Include the FULL plastic lens housing in the box, with a little margin
- ONLY front headlights. Completely ignore rear taillights, brake lights, fog lights, turn signals.
- If no front headlights are visible (car seen from behind or side), return {"lights": []}

Return ONLY this JSON, no explanation, no markdown:
{"lights": [{"x": 0.12, "y": 0.40, "w": 0.14, "h": 0.09}]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${b64}`,
                detail: 'low',
              },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    console.log('Headlights GPT-4o status:', response.status);

    if (!response.ok) {
      return res.status(500).json({ error: 'OpenAI API error', details: data });
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    console.log('Headlights GPT-4o response:', text);

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in GPT-4o response', text });

    const gpt = JSON.parse(raw);
    const lights = Array.isArray(gpt.lights) ? gpt.lights.filter(l =>
      typeof l.x === 'number' && typeof l.y === 'number' &&
      typeof l.w === 'number' && typeof l.h === 'number'
    ) : [];

    console.log(`Lights detected: ${lights.length}`, JSON.stringify(lights));
    return res.json({ lights });

  } catch (e) {
    console.error('headlights.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
