export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { b64, imgW, imgH } = req.body;

    const buffer = Buffer.from(b64, 'base64');
    const formData = new FormData();
    formData.append('upload', new Blob([buffer], { type: 'image/jpeg' }), 'plate.jpg');

    const response = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.PLATERECOGNIZER_API_KEY}`,
      },
      body: formData,
    });

    const data = await response.json();
    console.log("Plate Recognizer response:", JSON.stringify(data));

    if (!data.results || data.results.length === 0) {
      return res.status(200).json({ found: false });
    }

    const box = data.results[0].box;
    // Normalize pixel coords to 0-1 using the uploaded image dimensions
    const tl = { x: box.xmin / imgW, y: box.ymin / imgH };
    const tr = { x: box.xmax / imgW, y: box.ymin / imgH };
    const br = { x: box.xmax / imgW, y: box.ymax / imgH };
    const bl = { x: box.xmin / imgW, y: box.ymax / imgH };

    res.status(200).json({ found: true, tl, tr, br, bl });
  } catch (error) {
    console.error("Plate Recognizer error:", error);
    res.status(500).json({ error: error.message });
  }
}
