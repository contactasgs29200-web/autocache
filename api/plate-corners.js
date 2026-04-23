// /api/plate-corners.js
// Claude Haiku Vision sur l'image complète — détecte les 4 coins réels de la plaque
// Claude distingue la plaque d'immatriculation des stickers concessionnaire, protections, etc.

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
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  const prompt = `This image is a crop of a car photo containing a vehicle license plate. Find the license plate and return the precise coordinates of its 4 corners.

The license plate is the white/grey flat plate with alphanumeric registration characters (French format like "FJ-713-KZ", "GA-700-JL", etc.) and a blue EU strip on the left side with the letter F.

PRECISE MEASUREMENT RULES:
1. Measure to the OUTER EDGE of the white plate surface — where the plate material begins and ends.
2. Do NOT include the plastic mounting frame or border around the plate.
3. If the plate is viewed at an angle, the 4 corners will NOT form a rectangle — measure the actual visible quadrilateral.
4. x=0.0 is the LEFT edge of this image, x=1.0 is the RIGHT edge.
5. y=0.0 is the TOP edge of this image, y=1.0 is the BOTTOM edge.

Return ONLY this JSON (no markdown, no explanation):
{"tl":{"x":0.10,"y":0.30},"tr":{"x":0.90,"y":0.28},"br":{"x":0.91,"y":0.72},"bl":{"x":0.09,"y":0.74}}`;

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
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    console.log('plate-corners status:', response.status);
    if (!response.ok) return res.status(500).json({ error: 'Anthropic error', details: data });

    const text = data.content?.[0]?.text ?? '';
    console.log('plate-corners response:', text);

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON', text });

    const c = JSON.parse(raw);
    const ok = p => p && typeof p.x === 'number' && typeof p.y === 'number'
      && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;

    if (!ok(c.tl) || !ok(c.tr) || !ok(c.br) || !ok(c.bl)) {
      return res.status(500).json({ error: 'Invalid corners', c });
    }

    // Validation : la plaque doit avoir un ratio largeur/hauteur raisonnable (2:1 à 8:1)
    const w = Math.abs(c.tr.x - c.tl.x);
    const h = Math.abs(c.bl.y - c.tl.y);
    if (h > 0 && (w / h < 1.5 || w / h > 10)) {
      return res.status(500).json({ error: 'Aspect ratio invalid', w, h });
    }

    console.log('plate-corners OK:', JSON.stringify(c));
    return res.json({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl });

  } catch(e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
