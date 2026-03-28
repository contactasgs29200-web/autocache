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

  const { b64, prBox } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set in environment' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64 image' });

  const tl = prBox?.tl ?? {};
  const tr = prBox?.tr ?? {};

  const prompt = `This is a car photo. A license plate detector found the plate approximately here:
- Left edge x ≈ ${(tl.x ?? 0.5).toFixed(3)}
- Right edge x ≈ ${(tr.x ?? 0.6).toFixed(3)}
- Top edge y ≈ ${(tl.y ?? 0.5).toFixed(3)}
(coordinates: 0 = left/top of image, 1 = right/bottom)

Your task: locate the license plate and return the precise coordinates of its 4 PHYSICAL corners as they appear in this photo.

Rules:
- If the car is at an angle, the plate appears as a TRAPEZOID — return the actual angled corners, NOT a bounding box rectangle
- Include the blue EU identification strip on the left edge of the plate
- Be as precise as possible — this will be used to overlay a logo exactly on the plate

Return ONLY this JSON, nothing else:
{"tl":{"x":0.0,"y":0.0},"tr":{"x":0.0,"y":0.0},"br":{"x":0.0,"y":0.0},"bl":{"x":0.0,"y":0.0}}

tl=top-left, tr=top-right, br=bottom-right, bl=bottom-left. Values are 0.0–1.0 fractions of image size.`;

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

    const corners = JSON.parse(raw);
    const pts = ['tl','tr','br','bl'];
    for (const k of pts) {
      if (!corners[k] || typeof corners[k].x !== 'number' || typeof corners[k].y !== 'number') {
        return res.status(500).json({ error: `Invalid corner: ${k}`, corners });
      }
    }

    console.log('GPT-4o corners:', JSON.stringify(corners));
    return res.json({ found: true, corners });

  } catch (e) {
    console.error('corners.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
