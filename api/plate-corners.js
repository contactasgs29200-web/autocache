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

  const prompt = `PRECISE LICENSE PLATE CORNER DETECTION

You are looking at a CROP of a vehicle photo. Find THE FOREGROUND vehicle's license plate.

═══ STEP 1 — IDENTIFY THE CORRECT PLATE ═══
If multiple plates are visible (other vehicles in background), pick the LARGEST and MOST CENTRAL one — the plate of the FOREGROUND vehicle. Ignore plates of background vehicles.

A French license plate is:
- A flat rectangular plaque mounted on the bumper
- WHITE OR YELLOW background with alphanumeric characters (e.g. "FJ-713-KZ", "DM-996-HX")
- Has a BLUE EU STRIP on the LEFT side with letter "F"
- Has a small DEPARTMENT CODE on the RIGHT side (e.g. "75", "77", "92")

═══ STEP 2 — REASON ABOUT PERSPECTIVE ═══
The plate is a physical rectangle (520×110mm). Due to perspective:
- Camera ABOVE the plate → top edge appears SHORTER than bottom edge
- Camera BELOW the plate → top edge appears LONGER than bottom edge
- Car turned LEFT (toward camera right) → RIGHT side of plate appears TALLER
- Car turned RIGHT (toward camera left) → LEFT side of plate appears TALLER
The 4 corners often form a NON-RECTANGULAR QUADRILATERAL — that's expected.

═══ STEP 3 — PLACE THE 4 CORNERS PRECISELY ═══
Each corner sits on the OUTER EDGE of the plate's flat surface:
- INCLUDE the blue EU strip (it's part of the plate surface)
- INCLUDE the department code on the right
- DO NOT include the plastic/metal mounting frame around the plate
- DO NOT include screws, dealer stickers, bumper trim, or chrome

Coordinate system (NORMALIZED to this cropped image):
- x = 0.0 → LEFT edge of THIS image
- x = 1.0 → RIGHT edge of THIS image
- y = 0.0 → TOP edge of THIS image
- y = 1.0 → BOTTOM edge of THIS image

Return ONLY this JSON (3 decimal places, no markdown, no explanation):
{"tl":{"x":0.123,"y":0.456},"tr":{"x":0.789,"y":0.450},"br":{"x":0.795,"y":0.567},"bl":{"x":0.118,"y":0.572}}`;

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
        max_tokens: 400,
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
