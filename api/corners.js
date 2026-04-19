// /api/corners.js
// Uses GPT-4o Vision to detect the exact 4 perspective corners of a license plate.
// Requires OPENAI_API_KEY in Vercel environment variables.

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

  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set in environment' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64 image' });

  const prompt = `Look at this car photo. Find the license plate — the rectangular metal or plastic panel with letters and numbers (ignore any plastic holder or bumper frame around it).

Return the EXACT position of its 4 corners in normalized image coordinates (x: 0.0 = left edge, 1.0 = right edge; y: 0.0 = top edge, 1.0 = bottom edge):
- tl: top-left corner of the plate
- tr: top-right corner
- br: bottom-right corner
- bl: bottom-left corner

If the car is at an angle, the plate will appear as a trapezoid or parallelogram — return the ACTUAL visible corners, not an axis-aligned rectangle.

Return ONLY this JSON (no explanation, no markdown):
{"tl":{"x":0.20,"y":0.72},"tr":{"x":0.58,"y":0.71},"br":{"x":0.58,"y":0.76},"bl":{"x":0.20,"y":0.77}}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${b64}`,
                detail: 'high',
              },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    console.log('GPT-4o status:', response.status);

    if (!response.ok) {
      return res.status(500).json({ error: 'OpenAI API error', details: data });
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    console.log('GPT-4o response:', text);

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in GPT-4o response', text });

    const gpt = JSON.parse(raw);
    if (!isValidCorner(gpt.tl) || !isValidCorner(gpt.tr) ||
        !isValidCorner(gpt.br) || !isValidCorner(gpt.bl)) {
      return res.status(500).json({ error: 'Invalid corners from GPT-4o', gpt });
    }

    console.log('GPT-4o corners:', JSON.stringify(gpt));
    return res.json({ tl: gpt.tl, tr: gpt.tr, br: gpt.br, bl: gpt.bl });

  } catch (e) {
    console.error('corners.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
