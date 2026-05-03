// /api/headlights.js
// Détecte les optiques avant via GPT-4o-mini.
// Retourne des bounding boxes + polygones normalisés (0-1) pour construire un masque.

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

  const prompt = `Look at this car photo. Find only the visible FRONT headlight plastic lens covers — the transparent or yellowed polycarbonate housing over the headlight bulbs.

For each main front headlight visible, return:
- a bounding box in normalized coordinates (0.0 = left/top edge, 1.0 = right/bottom edge)
- a polygon with 4 to 8 normalized points following the visible lens outline as closely as possible

Rules:
- x, y = top-left corner of the bounding box
- w, h = width and height
- Cover the FULL headlight plastic housing including any yellowed/foggy area
- Add only a small 3-6% margin around each headlight
- Do not include rear lights, license plates, grilles, bumper trim, wheels, fog lights, chrome strips, or orange side markers unless they are physically inside the main headlight lens
- If no front headlights are visible, return {"lights": []}

Return ONLY valid JSON, no explanation:
{"lights": [{"x": 0.05, "y": 0.38, "w": 0.22, "h": 0.18, "points": [{"x": 0.06, "y": 0.40}, {"x": 0.25, "y": 0.38}, {"x": 0.27, "y": 0.50}, {"x": 0.07, "y": 0.55}], "confidence": 0.92}]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
        max_tokens: 700,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' },
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
    const lights = Array.isArray(gpt.lights) ? gpt.lights
      .filter(l =>
        typeof l.x === 'number' && typeof l.y === 'number' &&
        typeof l.w === 'number' && typeof l.h === 'number'
      )
      .map(l => ({
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        confidence: typeof l.confidence === 'number' ? l.confidence : null,
        points: Array.isArray(l.points)
          ? l.points.filter(p => typeof p?.x === 'number' && typeof p?.y === 'number')
          : [],
      }))
    : [];

    console.log(`headlights: detected ${lights.length} light(s)`, lights);
    return res.json({ lights });

  } catch (e) {
    console.error('headlights.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
