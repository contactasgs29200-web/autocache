// /api/lustrage-pro.js
// Lustrage Pro via Stability AI inpainting (stable-image/edit/inpaint).
// Contrairement à gpt-image-1, Stability AI préserve la voiture originale
// et n'inpaint QUE les zones blanches du masque.

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

  // Stability AI attend un multipart/form-data avec image + mask + prompt
  const formData = new FormData();
  formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), 'car.png');
  formData.append('mask',  new Blob([maskBuffer],  { type: 'image/png' }), 'mask.png');
  formData.append('prompt',
    'Brand new crystal clear transparent headlight plastic lens cover, ' +
    'no yellowing, no oxidation, no hazing, clean reflectors visible inside, ' +
    'professional headlight restoration, photorealistic'
  );
  formData.append('negative_prompt',
    'yellow, amber, foggy, hazy, oxidized, blurry, distorted, different car'
  );
  formData.append('output_format', 'png');
  formData.append('strength', '0.75');

  try {
    const response = await fetch(
      'https://api.stability.ai/v2beta/stable-image/edit/inpaint',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'image/*',
        },
        body: formData,
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
