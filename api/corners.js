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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { b64, prBox, plateText } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set in environment' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64 image' });

  const prompt = `Look at this car photo. Answer 3 questions:

QUESTION 1 — License plate center position (normalized 0.0–1.0):
Find the rectangular license plate (the plate with letters/numbers, NOT the plastic holder or bumper).
Return its CENTER coordinates and size:
- cx: horizontal center (0.0 = left edge of image, 1.0 = right edge)
- cy: vertical center (0.0 = top edge of image, 1.0 = bottom edge)
- w:  width of the plate only
- h:  height of the plate only
Be precise — measure the plate itself, not the surrounding plastic frame or bumper recess.

QUESTION 2 — Car orientation (hood/headlights direction):
- "right" = the car's front/nose points toward the RIGHT side of the image
- "left"  = the car's front/nose points toward the LEFT side of the image
- "none"  = the car faces straight toward the camera (symmetric front view)

QUESTION 3 — Angle estimate:
- 0  = perfectly straight-on (symmetric front face)
- 15 = slight 3/4 angle
- 25 = typical dealer 3/4 angle
- 35 = strong 3/4 angle
- 45 = almost side-on

Return ONLY this JSON (no explanation):
{"plate":{"cx":0.65,"cy":0.74,"w":0.18,"h":0.04},"hood_points":"left","angle_deg":25}`;

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
      return res.status(500).json({ error: 'Invalid angle response from GPT-4o', gpt });
    }

    const near_side = gpt.hood_points === 'right' ? 'left'
                    : gpt.hood_points === 'left'  ? 'right'
                    : 'none';
    const angle_deg = gpt.angle_deg;

    // Centre de la plaque détecté par GPT-4o (cx, cy, w, h normalisés)
    const p = gpt.plate;
    const plateCenter = (p && typeof p.cx === 'number' && typeof p.cy === 'number' &&
                         typeof p.w  === 'number' && typeof p.h  === 'number')
      ? { cx: p.cx, cy: p.cy, w: p.w, h: p.h }
      : null;

    console.log('GPT-4o result:', JSON.stringify({ hood_points: gpt.hood_points, near_side, angle_deg, plateCenter }));
    return res.json({ near_side, angle_deg, plateCenter });

  } catch (e) {
    console.error('corners.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
