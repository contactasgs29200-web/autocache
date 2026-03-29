// /api/removebg.js
// Supprime l'arrière-plan d'une photo de voiture via remove.bg API.
// Retourne une image PNG avec transparence en base64.

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { b64 } = req.body;
  const apiKey = process.env.REMOVEBG_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'REMOVEBG_API_KEY not set in environment' });
  if (!b64)    return res.status(400).json({ error: 'Missing b64 image' });

  try {
    const formData = new FormData();
    formData.append('image_base64', b64);
    formData.append('size', 'auto');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: formData,
    });

    console.log('remove.bg HTTP status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('remove.bg error body:', errText);
      return res.status(200).json({ ok: false, error: `remove.bg ${response.status}`, detail: errText });
    }

    const arrayBuffer = await response.arrayBuffer();
    const b64png = Buffer.from(arrayBuffer).toString('base64');
    console.log('remove.bg success — PNG size:', arrayBuffer.byteLength, 'bytes');
    return res.status(200).json({ ok: true, b64png });

  } catch (e) {
    console.error('removebg.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
