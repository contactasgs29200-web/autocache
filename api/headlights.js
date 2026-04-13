// /api/headlights.js
// Détecte les phares via GPT-4o-mini avec detail:auto pour une meilleure précision.
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

  const prompt = `Look at this car photo. Find the headlight plastic lens covers — the transparent/yellowed plastic housing over the headlight bulbs.

For each headlight visible, return a bounding box in normalized coordinates (0.0 = left/top edge, 1.0 = right/bottom edge).

Rules:
- x, y = top-left corner of the bounding box
- w, h = width and height
- Cover the FULL headlight plastic housing including any yellowed/foggy area
- Include front headlights AND rear lights if visible and yellowed/oxidized
- Add ~10% margin around each headlight
- If no headlights visible, return {"lights": []}

Return ONLY valid JSON, no explanation:
{"lights": [{"x": 0.05, "y": 0.38, "w": 0.22, "h": 0.18}, {"x": 0.68, "y": 0.38, "w": 0.20, "h": 0.16}]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'auto' },
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
    console.log('headlights detection response:', text);
    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in response', text });

    const gpt = JSON.parse(raw);
    const lights = Array.isArray(gpt.lights) ? gpt.lights.filter(l =>
      typeof l.x === 'number' && typeof l.y === 'number' &&
      typeof l.w === 'number' && typeof l.h === 'number'
    ) : [];

    console.log(`headlights: detected ${lights.length} light(s)`, lights);
    return res.json({ lights });

  } catch (e) {
    console.error('headlights.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
