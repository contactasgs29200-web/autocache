// /api/polish-headlights-ai.js
// Reçoit l'image COMPLÈTE du véhicule + un masque PNG (transparent sur les phares).
// Envoie à gpt-image-1 (images/edits) pour restaurer uniquement les zones masquées.
// L'IA voit toute la voiture → résultat naturel et cohérent.

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64, maskBase64 } = req.body;
  if (!imageBase64 || !maskBase64)
    return res.status(400).json({ error: 'Missing imageBase64 or maskBase64' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  const imageBuffer = Buffer.from(imageBase64, 'base64');
  const maskBuffer  = Buffer.from(maskBase64,  'base64');

  const boundary = '----HeadlightBoundary' + Date.now();
  const CRLF = '\r\n';

  function part(name, filename, contentType, data) {
    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}` +
      `Content-Type: ${contentType}${CRLF}${CRLF}`;
    return Buffer.concat([Buffer.from(header), data, Buffer.from(CRLF)]);
  }
  function field(name, value) {
    return Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
      `${value}${CRLF}`
    );
  }

  const prompt =
    'Restore the car headlight plastic lens covers in the transparent/marked areas. ' +
    'The headlight plastic is yellowed and oxidized from UV exposure. ' +
    'Make the plastic look brand new: perfectly clear, transparent, and clean. ' +
    'You should be able to clearly see the reflectors, bulbs and chrome inside. ' +
    'The headlights are OFF — do NOT add any light, glow, beam or illumination. ' +
    'Keep the exact same headlight shape, size, position and surrounding bodywork. ' +
    'The result must look like a real photograph, not artificial.';

  const body = Buffer.concat([
    part('image', 'car.png', 'image/png', imageBuffer),
    part('mask',  'mask.png', 'image/png', maskBuffer),
    field('model',  'gpt-image-1'),
    field('prompt', prompt),
    field('n',      '1'),
    field('size',   '1536x1024'),
    field('quality', 'high'),
    Buffer.from(`--${boundary}--${CRLF}`),
  ]);

  try {
    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const msg = await response.text().catch(() => response.statusText);
      console.error('OpenAI headlight edit error:', msg);
      return res.status(response.status).json({ error: msg });
    }

    const json = await response.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: 'No image in OpenAI response' });

    return res.json({ imageBase64: b64 });

  } catch (e) {
    console.error('polish-headlights-ai error:', e);
    return res.status(500).json({ error: e.message });
  }
}
