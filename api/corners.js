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

  const prompt = `Look at this car photo. Answer 2 questions about the car's orientation:

QUESTION 1 — Which direction is the car's FRONT (hood/bonnet/headlights) pointing?
- "right" = the car's front/nose points toward the RIGHT side of the image
- "left"  = the car's front/nose points toward the LEFT side of the image
- "none"  = the car faces straight toward the camera (symmetric front view)

QUESTION 2 — How strongly is the car angled? Pick the best estimate:
- 0  = perfectly straight-on (we see a symmetric front face)
- 15 = slight 3/4 angle (one headlight slightly more visible)
- 25 = typical dealer 3/4 angle (both headlights visible but one side dominates)
- 35 = strong 3/4 angle (we see a lot of the side of the car)
- 45 = almost side-on

IMPORTANT RULE: Most dealer photos are taken at a 3/4 angle (20-35°). Only use 0 if the car is truly symmetric and perfectly straight-on.

Return ONLY this JSON (no explanation):
{"hood_points":"right|left|none","angle_deg":25}`;

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

    // Convert hood direction → near_side (which edge of the plate is closer to camera)
    // hood points RIGHT → left side of car is closer → left edge of plate is taller
    // hood points LEFT  → right side of car is closer → right edge of plate is taller
    const near_side = gpt.hood_points === 'right' ? 'left'
                    : gpt.hood_points === 'left'  ? 'right'
                    : 'none';
    const angle_deg = gpt.angle_deg;

    console.log('GPT-4o angle:', JSON.stringify({ hood_points: gpt.hood_points, near_side, angle_deg }));
    return res.json({ near_side, angle_deg });

  } catch (e) {
    console.error('corners.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
