// /api/corners.js
// Uses GPT-4o Vision to detect the exact 4 corners of the license plate + car angle.
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

  const prompt = `Look at this car photo and find the license plate (the rectangular plate with letters/numbers).

Return the EXACT normalized coordinates (0.0 to 1.0) of the 4 corners of the license plate surface:
- tl: top-left corner
- tr: top-right corner
- br: bottom-right corner
- bl: bottom-left corner

CRITICAL RULES:
1. Measure the PLATE SURFACE ONLY — not the plastic holder, not the bumper recess, not the mounting screws.
2. The plate seen from an angle will appear as a trapezoid/parallelogram — give the actual visible corners.
3. x=0.0 is the LEFT edge of the image, x=1.0 is the RIGHT edge.
4. y=0.0 is the TOP edge of the image, y=1.0 is the BOTTOM edge.

Also return:
- hood_points: direction the car's nose/hood faces ("left", "right", or "none" for straight-on)
- angle_deg: viewing angle (0=straight-on, 15=slight 3/4, 25=typical dealer angle, 35=strong 3/4, 45=side view)

Return ONLY this JSON (no explanation, no markdown):
{"tl":{"x":0.30,"y":0.71},"tr":{"x":0.55,"y":0.70},"br":{"x":0.55,"y":0.76},"bl":{"x":0.30,"y":0.77},"hood_points":"left","angle_deg":25}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 300,
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
    console.log('GPT-4o status:', response.status);

    if (!response.ok) {
      return res.status(500).json({ error: 'OpenAI API error', details: data });
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    console.log('GPT-4o response:', text);

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in GPT-4o response', text });

    const gpt = JSON.parse(raw);

    if (typeof gpt.hood_points !== 'string' || typeof gpt.angle_deg !== 'number') {
      return res.status(500).json({ error: 'Invalid GPT-4o response', gpt });
    }

    const near_side = gpt.hood_points === 'right' ? 'left'
                    : gpt.hood_points === 'left'  ? 'right'
                    : 'none';
    const angle_deg = gpt.angle_deg;

    // Exact plate corners from GPT-4o
    const corners = (isValidCorner(gpt.tl) && isValidCorner(gpt.tr) &&
                     isValidCorner(gpt.br) && isValidCorner(gpt.bl))
      ? { tl: gpt.tl, tr: gpt.tr, br: gpt.br, bl: gpt.bl }
      : null;

    console.log('GPT-4o result:', JSON.stringify({ near_side, angle_deg, corners }));
    return res.json({ near_side, angle_deg, corners });

  } catch (e) {
    console.error('corners.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
