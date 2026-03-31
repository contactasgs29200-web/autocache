// /api/headlights.js
// Utilise GPT-4o Vision pour localiser les optiques (phares / feux) dans la photo.
// Retourne des boîtes englobantes normalisées (0-1) pour chaque optique détectée.
// Appel uniquement si l'option "Lustrage des optiques" est activée.

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

  const prompt = `Look at this car photo. Locate ONLY the FRONT headlights (phares avant) visible on the car. Do NOT include rear taillights, brake lights, or turn signals.

For each front headlight, return a bounding box in normalized coordinates (0.0 = left/top edge, 1.0 = right/bottom edge of the image).

Rules:
- x, y = top-left corner of the bounding box
- w, h = width and height
- Be generous with the box: include the full plastic lens housing, not just the bulb
- ONLY front headlights (the ones near the hood/bonnet). Exclude ALL rear lights.
- If no front headlights are visible (e.g. car seen from behind), return {"lights": []}

Return ONLY this JSON (no explanation):
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
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${b64}`,
                detail: 'low', // suffisant pour localiser — 4× moins cher que 'high'
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

    console.log(`Headlights detected: ${lights.length}`, JSON.stringify(lights));
    return res.json({ lights });

  } catch (e) {
    console.error('headlights.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
