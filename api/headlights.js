// /api/headlights.js
// Détecte les phares avant via GPT-4o-mini Vision (rapide, ~$0.002/image).
// Retourne des bounding boxes normalisées (0-1).

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

  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64 image' });

  const prompt = `Look at this car photo. Locate ONLY the two FRONT headlights (phares avant) — the main light units at the front of the vehicle.

For each front headlight, return a bounding box in normalized coordinates (0.0 = left/top, 1.0 = right/bottom of image).

Rules:
- x, y = top-left corner of the bounding box
- w, h = width and height
- Include the FULL headlight housing with a small margin around it
- ONLY front headlights. Ignore rear taillights, fog lights, turn signals
- If no front headlights visible, return {"lights": []}

Return ONLY JSON, no explanation:
{"lights": [{"x": 0.12, "y": 0.40, "w": 0.14, "h": 0.09}]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'low' },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: 'OpenAI API error', details: data });
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in response', text });

    const gpt = JSON.parse(raw);
    const lights = Array.isArray(gpt.lights) ? gpt.lights.filter(l =>
      typeof l.x === 'number' && typeof l.y === 'number' &&
      typeof l.w === 'number' && typeof l.h === 'number'
    ) : [];

    return res.json({ lights });

  } catch (e) {
    console.error('headlights.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
