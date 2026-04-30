// /api/plate-corners.js
// Claude Sonnet Vision sur l'image complète — chain-of-thought pour ancrer sur le texte de plaque

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
    ? `\nHINT: An automated detector estimated the plate center near x=${hint.cx}, y=${hint.cy} (may be wrong — verify visually).\n`
    : '';

  const prompt = `LICENSE PLATE CORNER DETECTION — THINK STEP BY STEP
${hintLine}
This is a FULL vehicle photo. Follow ALL 4 steps.

STEP 1 — READ THE PLATE TEXT
Look carefully at the bumper area. Find the flat rectangular white/yellow surface with alphanumeric registration text.
State the exact characters you read (e.g. "DF-788-KV" or "AB-123-CD").
This text is your anchor — do not proceed until you have found it.

STEP 2 — ESTIMATE POSITION AS PERCENTAGES
Based on where the plate TEXT is located in the full image:
- Plate left edge is at x ≈ __% from left
- Plate right edge is at x ≈ __% from left
- Plate top edge is at y ≈ __% from top
- Plate bottom edge is at y ≈ __% from top

STEP 3 — ACCOUNT FOR PERSPECTIVE
Physical plate size: 520mm × 110mm (ratio ~4.7:1).
Is the car straight-on (rectangle shape), slightly angled, or strongly angled (trapezoid shape)?

STEP 4 — FINAL CORNER COORDINATES
Convert your Step 2 percentages to 0-1 decimal values (divide by 100).
Corners must be on the OUTER EDGE of the plate surface:
- Include the blue EU strip on the left
- Include the department code on the right
- Exclude any mounting frame, screws, chrome, or bumper trim

Coordinate axes: x=0.0 is LEFT edge, x=1.0 is RIGHT edge, y=0.0 is TOP, y=1.0 is BOTTOM.

Return JSON with analysis field showing your reasoning:
{"analysis":"I read DF-788-KV; plate left=35% right=67% top=40% bottom=55%; car straight-on","tl":{"x":0.350,"y":0.400},"tr":{"x":0.670,"y":0.400},"br":{"x":0.670,"y":0.550},"bl":{"x":0.350,"y":0.550}}`;

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
    if (c.analysis) console.log('Claude analysis:', c.analysis);

    const ok = p => p && typeof p.x === 'number' && typeof p.y === 'number'
      && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;

    if (!ok(c.tl) || !ok(c.tr) || !ok(c.br) || !ok(c.bl)) {
      return res.status(500).json({ error: 'Invalid corners', c });
    }

    const w = Math.abs(c.tr.x - c.tl.x);
    const h = Math.abs(c.bl.y - c.tl.y);
    if (h > 0 && (w / h < 1.0 || w / h > 15)) {
      return res.status(500).json({ error: 'Aspect ratio invalid', w, h, ratio: w/h });
    }

    console.log('plate-corners OK:', JSON.stringify({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl }));
    return res.json({ tl: c.tl, tr: c.tr, br: c.br, bl: c.bl });

  } catch(e) {
    console.error('plate-corners error:', e);
    return res.status(500).json({ error: e.message });
  }
}
