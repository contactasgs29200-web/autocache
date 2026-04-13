// /api/lustrage-pro.js
// Lustrage Pro via Stability AI inpainting (stable-image/edit/inpaint).
// Préserve la voiture originale, inpaint uniquement les zones blanches du masque.
// Utilise un builder multipart manuel (compatible toutes versions Node.js).

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64, maskBase64 } = req.body;
  if (!imageBase64 || !maskBase64)
    return res.status(400).json({ error: 'Missing imageBase64 or maskBase64' });

  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'STABILITY_API_KEY not set' });

  const imageBuffer = Buffer.from(imageBase64, 'base64');
  const maskBuffer  = Buffer.from(maskBase64,  'base64');

  const boundary = '----StabilityBoundary' + Date.now();
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

  const body = Buffer.concat([
    part('image', 'car.png',  'image/png', imageBuffer),
    part('mask',  'mask.png', 'image/png', maskBuffer),
    field('prompt',
      'Brand new crystal clear transparent headlight plastic lens cover, ' +
      'no yellowing, no oxidation, no hazing, clean reflectors visible inside, ' +
      'professional headlight restoration, photorealistic'
    ),
    field('negative_prompt',
      'yellow, amber, foggy, hazy, oxidized, blurry, distorted, different car'
    ),
    field('output_format', 'png'),
    field('strength', '0.75'),
    Buffer.from(`--${boundary}--${CRLF}`),
  ]);

  try {
    const response = await fetch(
      'https://api.stability.ai/v2beta/stable-image/edit/inpaint',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'image/*',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      console.error('Stability AI inpaint error:', response.status, errText);
      return res.status(response.status).json({ error: errText });
    }

    const arrayBuffer = await response.arrayBuffer();
    const b64 = Buffer.from(arrayBuffer).toString('base64');
    return res.json({ imageBase64: b64 });

  } catch (e) {
    console.error('lustrage-pro error:', e);
    return res.status(500).json({ error: e.message });
  }
}
