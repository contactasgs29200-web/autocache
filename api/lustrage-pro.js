// /api/lustrage-pro.js
// Lustrage des optiques via OpenAI Image Edit.
// L'image est fournie par le front, le masque PNG indique les optiques a reinventer.

export const config = { api: { bodyParser: { sizeLimit: '30mb' } } };

const DEFAULT_PROMPT = [
  'Retouch only the masked front headlight lens covers.',
  'The result must be visibly different: remove every yellow, amber, brown, oxidized, foggy, or cloudy tint from the masked headlights.',
  'Recreate crystal clear transparent polycarbonate headlight lenses with realistic glass depth, crisp inner reflectors, bulbs, natural highlights, and reflections.',
  'Make the lens look cleaned and polished like a professional headlight restoration, not color-corrected pixels.',
  'Preserve the exact car model, paint, body panels, panel gaps, shadows, background, camera angle, and lighting.',
  'Do not make the headlights white, opaque, cloudy, painted, flat, milky, or overexposed.',
  'Do not alter the license plate area, logos, wheels, grille, bumper, or any unmasked area.',
].join(' ');

function normalizeMime(mime) {
  if (mime === 'image/png' || mime === 'image/webp' || mime === 'image/jpeg') return mime;
  return 'image/jpeg';
}

function uniqueModels(primary) {
  return [primary, 'gpt-image-1', 'gpt-image-1-mini'].filter((model, index, list) =>
    model && list.indexOf(model) === index
  );
}

async function callImageEdit({ apiKey, model, prompt, imageBase64, maskBase64, imageMime, quality }) {
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      images: [{ image_url: `data:${imageMime};base64,${imageBase64}` }],
      mask: { image_url: `data:image/png;base64,${maskBase64}` },
      input_fidelity: 'high',
      quality,
      output_format: 'png',
      size: 'auto',
      moderation: 'low',
      n: 1,
    }),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const details = data?.error?.message || text || response.statusText;
    const error = new Error(details);
    error.status = response.status;
    throw error;
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    const error = new Error('OpenAI response did not include an image');
    error.status = 502;
    throw error;
  }

  return { b64, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    imageBase64,
    maskBase64,
    imageMime = 'image/jpeg',
    quality = 'medium',
    prompt = DEFAULT_PROMPT,
  } = req.body ?? {};

  if (!imageBase64 || !maskBase64) {
    return res.status(400).json({ error: 'Missing imageBase64 or maskBase64' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  const preferredModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
  const mime = normalizeMime(imageMime);
  const attempts = [];

  for (const model of uniqueModels(preferredModel)) {
    try {
      const { b64, data } = await callImageEdit({
        apiKey,
        model,
        prompt,
        imageBase64,
        maskBase64,
        imageMime: mime,
        quality,
      });

      return res.json({
        imageBase64: b64,
        model,
        attempts,
        usage: data?.usage ?? null,
      });
    } catch (e) {
      attempts.push({ model, status: e.status ?? 500, error: e.message });
      console.error('OpenAI image edit error:', model, e.status ?? 500, e.message);
    }
  }

  const last = attempts[attempts.length - 1];
  return res.status(last?.status || 500).json({
    error: last?.error || 'OpenAI image edit failed',
    attempts,
  });
}
