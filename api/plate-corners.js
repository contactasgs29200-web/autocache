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

  const { b64, hint } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64' });

  const hintLine = hint
    ? `\nSEARCH HINT: An automated detector (may be wrong) estimated the plate center near x≈${hint.cx}, y≈${hint.cy}. Use this as a starting point but ALWAYS verify visually — it might point to a wheel, background, or wrong object.\n`
    : '';

  const prompt = `PRECISE LICENSE PLATE CORNER DETECTION
${hintLine}
You are looking at a FULL vehicle photo. Find the main vehicle's license plate.

═══ STEP 1 — IDENTIFY THE CORRECT PLATE ═══
If multiple plates are visible (other vehicles in background), pick the one belonging to the MAIN (foreground) vehicle — the largest and most prominent. Ignore background plates, wheels, hubcaps, stickers, and all non-plate objects.

A French license plate:
- Flat rectangular plaque on the front or rear bumper
- WHITE or YELLOW background with alphanumeric text (e.g. "FJ-713-KZ", "FG-976-DN")
- Blue EU strip on LEFT edge with letter "F"
- Small department code on RIGHT edge (e.g. "06", "75", "92")
- NOT a wheel, NOT a hubcap, NOT a sticker, NOT a grille

═══ STEP 2 — REASON ABOUT PERSPECTIVE ═══
The plate is 520×110mm physical rectangle. Due to camera angle:
- Camera above → top edge shorter than bottom
- Car turned → near side appears taller
The 4 corners form a QUADRILATERAL, not necessarily a rectangle.

═══ STEP 3 — PLACE THE 4 CORNERS PRECISELY ═══
Corners on the OUTER EDGE of the plate surface only:
- INCLUDE the blue EU strip and department code
- DO NOT include mounting frame, screws, bumper trim, chrome

Coordinate system (full image):
- x=0.0 = LEFT edge, x=1.0 = RIGHT edge
- y=0.0 = TOP edge, y=1.0 = BOTTOM edge

Return ONLY this JSON (3 decimal places, no markdown):
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

    // Validation : la plaque doit avoir un ratio largeur/hauteur raisonnable (1.2:1 à 12:1)
    // Plus permissif car la plaque occupe une petite portion de l'image complète
    const w = Math.abs(c.tr.x - c.tl.x);
    const h = Math.abs(c.bl.y - c.tl.y);
    if (h > 0 && (w / h < 1.2 || w / h > 12)) {
      return res.status(500).json({ error: 'Aspect ratio invalid', w, h });
    }

    console.log('plate-corners OK:', JSON.stringify(c));
    return res.json({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl });

  } catch(e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
