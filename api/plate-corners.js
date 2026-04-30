// /api/plate-corners.js
// Claude Sonnet Vision — accepte un prompt custom (crop ou full image)

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

  const { b64, prompt } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    console.log('plate-corners status:', response.status);
    if (!response.ok) return res.status(500).json({ error: 'Anthropic error', details: data });

    const text = data.content?.[0]?.text ?? '';
    console.log('plate-corners raw:', text.slice(0, 300));

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in response', text });

    const c = JSON.parse(raw);
    if (c.analysis) console.log('analysis:', c.analysis);

    const ok = p => p && typeof p.x === 'number' && typeof p.y === 'number'
      && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;

    if (!ok(c.tl) || !ok(c.tr) || !ok(c.br) || !ok(c.bl)) {
      return res.status(500).json({ error: 'Invalid corners', c });
    }

    const w = Math.abs(c.tr.x - c.tl.x);
    const h = Math.abs(c.bl.y - c.tl.y);
    if (h > 0 && (w / h < 0.8 || w / h > 20)) {
      return res.status(500).json({ error: 'Aspect ratio invalid', w, h, ratio: (w/h).toFixed(2) });
    }

    console.log('plate-corners OK:', JSON.stringify({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl }));
    return res.json({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl });

  } catch(e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
