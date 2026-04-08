// Nettoyage IA — Clipdrop Cleanup API
// Reçoit l'image + un masque (zones à nettoyer en blanc) et retourne l'image nettoyée.
// Doc : https://clipdrop.co/apis/docs/cleanup

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { imageBase64, maskBase64 } = req.body;
  if (!imageBase64 || !maskBase64)
    return res.status(400).json({ error: "Missing imageBase64 or maskBase64" });

  const apiKey = process.env.CLIPDROP_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: "CLIPDROP_API_KEY not configured" });

  // Convertit les base64 en Buffers
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const maskBuffer  = Buffer.from(maskBase64,  "base64");

  // Construit le multipart/form-data manuellement (pas de node-canvas requis)
  const boundary = "----ClipDropBoundary" + Date.now();
  const CRLF = "\r\n";

  function part(name, filename, contentType, data) {
    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}` +
      `Content-Type: ${contentType}${CRLF}${CRLF}`;
    return Buffer.concat([Buffer.from(header), data, Buffer.from(CRLF)]);
  }

  const body = Buffer.concat([
    part("image_file", "image.jpg", "image/jpeg", imageBuffer),
    part("mask_file",  "mask.png",  "image/png",  maskBuffer),
    Buffer.from(`--${boundary}--${CRLF}`),
  ]);

  const response = await fetch("https://clipdrop-api.co/cleanup/v1", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    return res.status(response.status).json({ error: msg });
  }

  const resultBuffer = Buffer.from(await response.arrayBuffer());
  res.setHeader("Content-Type", "image/png");
  res.status(200).send(resultBuffer);
}
