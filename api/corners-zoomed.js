// /api/corners-zoomed.js
// GPT-4o Vision sur une image CROPPÉE centrée sur la plaque.
// La plaque remplit la majorité de l'image → détection des 4 coins très précise.

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

function isValidCorner(c) {
  return c && typeof c.x === 'number' && typeof c.y === 'number'
    && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { b64 } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  const prompt = `This image is a zoomed crop centered on a vehicle license plate.

Find the license plate surface (the rectangular plate with letters/numbers, NOT the plastic holder or mounting screws).

Return the exact normalized coordinates (0.0 = left/top edge, 1.0 = right/bottom edge) of its 4 corners:
- tl: top-left corner of the plate surface
- tr: top-right corner of the plate surface
- br: bottom-right corner of the plate surface
- bl: bottom-left corner of the plate surface

The plate may appear as a trapezoid if seen from an angle — give the actual visible corners, not a perfect rectangle.

Return ONLY this JSON (no explanation):
{"tl":{"x":0.05,"y":0.28},"tr":{"x":0.93,"y":0.24},"br":{"x":0.94,"y":0.76},"bl":{"x":0.04,"y":0.80}}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 200,
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
    console.log('GPT-4o zoomed status:', response.status);
    if (!response.ok) return res.status(500).json({ error: 'OpenAI error', details: data });

    const text = data.choices?.[0]?.message?.content ?? '';
    console.log('GPT-4o zoomed response:', text);

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON', text });

    const gpt = JSON.parse(raw);
    if (!isValidCorner(gpt.tl) || !isValidCorner(gpt.tr) ||
        !isValidCorner(gpt.br) || !isValidCorner(gpt.bl)) {
      return res.status(500).json({ error: 'Invalid corners', gpt });
    }

    console.log('GPT-4o zoomed corners OK:', JSON.stringify(gpt));
    return res.json({ tl: gpt.tl, tr: gpt.tr, br: gpt.br, bl: gpt.bl });

  } catch (e) {
    console.error('corners-zoomed error:', e);
    return res.status(500).json({ error: e.message });
  }
}
