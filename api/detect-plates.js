// =============================================================================
//  /api/detect-plates.js   — Fonction Vercel (Node 18+)
//  Détection de plaque via Plate Recognizer, avec DEUX niveaux :
//   1. Blur API (blur.platerecognizer.com) : renvoie le POLYGONE exact
//      (4 coins en perspective) de chaque plaque — le meilleur résultat.
//      Nécessite le produit Blur activé sur le compte.
//   2. Snapshot API (api.platerecognizer.com) : repli automatique si Blur
//      est indisponible (403/404 = non souscrit). Renvoie une BOÎTE serrée
//      (xmin/ymin/xmax/ymax) — le frontend fera affiner les 4 coins par
//      Claude sur un crop ciblé. Inclus dans le plan gratuit (2500/mois).
//
//  PRÉREQUIS : variable d'environnement Vercel PLATE_RECOGNIZER_TOKEN.
// =============================================================================

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

function buildForm(buf, regions) {
  const form = new FormData();
  form.append('upload', new Blob([buf], { type: 'image/jpeg' }), 'image.jpg');
  if (regions) form.append('regions', regions); // ex: 'fr' pour plaques françaises
  return form;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST seulement' });

  const token = process.env.PLATE_RECOGNIZER_TOKEN;
  if (!token) return res.status(500).json({ error: 'PLATE_RECOGNIZER_TOKEN non configuré' });

  try {
    const { imageBase64, regions } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 manquant' });

    // data URL ("data:image/jpeg;base64,XXXX") ou base64 brut
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const buf = Buffer.from(b64, 'base64');
    const auth = { 'Authorization': 'Token ' + token };

    // ── 1. Blur API : polygones exacts ──
    // NB: on n'envoie PAS 'faces'/'plates' -> l'API renvoie le polygone sans flouter.
    const rBlur = await fetch('https://blur.platerecognizer.com/v1/blur', {
      method: 'POST',
      headers: auth,
      body: buildForm(buf, regions),
    });
    if (rBlur.ok) {
      const data = await rBlur.json();
      // data.plates = [ { polygon: [[x,y]×4], result: {...} }, ... ]
      const polygons = (data.plates || []).map(p => p.polygon).filter(Boolean);
      return res.status(200).json({ polygons, source: 'blur' });
    }
    const blurErr = await rBlur.text().catch(() => '');
    console.warn(`detect-plates: Blur HTTP ${rBlur.status} (${blurErr.slice(0, 200)}) — repli Snapshot`);

    // ── 2. Snapshot API : boîtes serrées (plan gratuit) ──
    const rSnap = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
      method: 'POST',
      headers: auth,
      body: buildForm(buf, regions),
    });
    const data = await rSnap.json().catch(() => ({}));
    if (!rSnap.ok) {
      console.error(`detect-plates: Snapshot HTTP ${rSnap.status}`, JSON.stringify(data).slice(0, 300));
      return res.status(rSnap.status).json({ error: data.detail || data.error || 'Erreur API Plate Recognizer' });
    }
    // data.results = [ { box: {xmin,ymin,xmax,ymax}, plate, score, ... }, ... ]
    const boxes = (data.results || []).map(p => p.box)
      .filter(b => b && [b.xmin, b.ymin, b.xmax, b.ymax].every(v => typeof v === 'number'));
    return res.status(200).json({ boxes, source: 'snapshot' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
