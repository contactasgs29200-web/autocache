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

  const prompt = `Look at this car photo. Find the vehicle LICENSE PLATE — the official registration plate with alphanumeric characters (format like "GA-700-JL", "FJ-713-KZ", "CT-348-MT" etc. in France).

IMPORTANT: Do NOT confuse the license plate with:
- Dealer stickers or dealer frames (e.g. "FOREST AUTOMOBILES", "amplitude-auto.com", etc.)
- Plastic bumper trim or skid plates
- Parking sensors or tow hooks
- Any text on walls or floors

The license plate has the country identifier (F for France) and registration numbers. It is attached to the car bumper.

Return the exact normalized coordinates (0.0 = left/top edge, 1.0 = right/bottom edge) of the 4 corners of the plate surface:
- tl: top-left
- tr: top-right
- br: bottom-right
- bl: bottom-left

If the plate is angled it will appear as a trapezoid — give actual corners, not a perfect rectangle.

Return ONLY this JSON (no explanation):
{"tl":{"x":0.30,"y":0.62},"tr":{"x":0.58,"y":0.61},"br":{"x":0.58,"y":0.68},"bl":{"x":0.30,"y":0.69}}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
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
