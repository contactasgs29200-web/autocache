// =============================================================================
//  /api/detect-plates.js   — Fonction Vercel (Node 18+)
//  Appelle Plate Recognizer Blur API et renvoie UNIQUEMENT les polygones
//  (4 coins) des plaques, SANS flouter (on pose notre propre cache côté client).
//
//  PRÉREQUIS :
//   - Variable d'environnement Vercel : PLATE_RECOGNIZER_TOKEN = ton token PR
//   - "Blur" activé sur ton compte Plate Recognizer.
// =============================================================================

// On reçoit l'image en base64 dans le corps JSON : relève la limite du body
// parser (défaut Vercel = 1 Mo) pour accepter une photo réduite ≤1600px.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST seulement' });

  try {
    const { imageBase64, regions } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 manquant' });

    // data URL ("data:image/jpeg;base64,XXXX") ou base64 brut
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const buf = Buffer.from(b64, 'base64');

    const form = new FormData();
    form.append('upload', new Blob([buf], { type: 'image/jpeg' }), 'image.jpg');
    if (regions) form.append('regions', regions); // ex: 'fr' pour plaques françaises
    // NB: on n'envoie PAS 'faces'/'plates' -> l'API renvoie le polygone sans flouter.

    const r = await fetch('https://blur.platerecognizer.com/v1/blur', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + process.env.PLATE_RECOGNIZER_TOKEN },
      body: form
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error || 'Erreur API Plate Recognizer' });

    // data.plates = [ { polygon: [[x,y],[x,y],[x,y],[x,y]], result: {...} }, ... ]
    const polygons = (data.plates || []).map(p => p.polygon).filter(Boolean);
    return res.status(200).json({ polygons });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
