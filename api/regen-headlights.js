// /api/regen-headlights.js
// Utilise le Responses API OpenAI avec gpt-4o + outil image_generation.
// C'est exactement ce que ChatGPT fait en interne quand on lui demande
// de modifier une photo — résultats bien supérieurs à images/edits.

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  const prompt =
    'Edit this car photo: the headlight plastic lens covers are yellowed and oxidized. ' +
    'Restore them to look brand new — perfectly clear and transparent, ' +
    'so you can see the reflectors and chrome inside. ' +
    'The headlights are OFF, no light or glow. ' +
    'Keep EVERYTHING else exactly the same: car body, color, background, wheels, windows, license plate. ' +
    'Only the headlight clarity changes. Photorealistic result.';

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${imageBase64}`,
            },
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        }],
        tools: [{ type: 'image_generation' }],
      }),
    });

    if (!response.ok) {
      const msg = await response.text().catch(() => response.statusText);
      console.error('OpenAI Responses API error:', msg);
      return res.status(response.status).json({ error: msg });
    }

    const data = await response.json();
    console.log('Responses API output types:', data.output?.map(o => o.type));

    // Le résultat image est dans un output de type "image_generation_call"
    const imgOutput = data.output?.find(o => o.type === 'image_generation_call');
    const b64 = imgOutput?.result;

    if (!b64) {
      console.error('No image_generation_call in response:', JSON.stringify(data.output));
      return res.status(500).json({ error: 'No image in response', output: data.output });
    }

    return res.json({ imageBase64: b64 });

  } catch (e) {
    console.error('regen-headlights error:', e);
    return res.status(500).json({ error: e.message });
  }
}
