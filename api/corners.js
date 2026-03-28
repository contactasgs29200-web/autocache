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

  const plateHint = plateText
    ? `The registration number on this plate is "${plateText.toUpperCase()}".`
    : `There is a license plate on the front bumper.`;

  const prompt = `Car photo. ${plateHint}

Looking at this license plate, answer these 2 questions:
1. Which EDGE of the plate appears TALLER in the photo because it is physically closer to the camera?
   - "left"  = left edge is taller (car faces right in image)
   - "right" = right edge is taller (car faces left in image)
   - "none"  = plate looks flat / car is straight-on
2. How many degrees is the car rotated from straight-on? (0=straight, 20=slight angle, 40=strong angle)

Return ONLY this JSON, no other text:
{"near_side":"left|right|none","angle_deg":0}`;

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

    const angle = JSON.parse(raw);
    if (typeof angle.near_side !== 'string' || typeof angle.angle_deg !== 'number') {
      return res.status(500).json({ error: 'Invalid angle response from GPT-4o', angle });
    }

    console.log('GPT-4o angle:', JSON.stringify(angle));
    return res.json({ near_side: angle.near_side, angle_deg: angle.angle_deg });

  } catch (e) {
    console.error('corners.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
