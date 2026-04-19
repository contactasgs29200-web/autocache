// /api/windshield.js
// Détecte les vitres (pare-brise) sur une photo intérieure de voiture via GPT-4o-mini.
// Retourne les 4 coins de chaque vitre en coordonnées normalisées (0-1).

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64 image' });

  const prompt = `This is an interior car photo taken from inside the vehicle.
Find all visible windows (windshield, side windows) where the outside is visible through the glass.

For each window, return the 4 corners of the visible glass area in normalized coordinates
(0.0 = left/top edge of image, 1.0 = right/bottom edge).
Trace the INNER edge of the glass (exclude door frames, pillars, dashboard, headliner).
Prioritize the windshield (largest window). Include side windows if clearly visible.

Return ONLY this JSON (no explanation):
{"windows":[{"type":"windshield","tl":{"x":0.15,"y":0.08},"tr":{"x":0.85,"y":0.08},"br":{"x":0.92,"y":0.52},"bl":{"x":0.08,"y":0.52}}]}

If no window with outside view is visible, return {"windows":[]}.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'auto' } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'OpenAI API error', details: data });

    const text = data.choices?.[0]?.message?.content ?? '';
    console.log('[windshield] GPT response:', text);

    const raw = extractJSON(text);
    if (!raw) return res.status(500).json({ error: 'No JSON in response', text });

    const gpt = JSON.parse(raw);
    const windows = Array.isArray(gpt.windows) ? gpt.windows.filter(w =>
      w.tl && w.tr && w.br && w.bl &&
      [w.tl, w.tr, w.br, w.bl].every(p => typeof p.x === 'number' && typeof p.y === 'number')
    ) : [];

    console.log(`[windshield] ${windows.length} window(s) detected`);
    return res.json({ windows });

  } catch (e) {
    console.error('[windshield] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
