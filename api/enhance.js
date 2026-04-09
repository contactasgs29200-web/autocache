// Amélioration IA — OpenAI gpt-image-1 image edit
// Envoie la photo + un masque transparent (tout est éditable) avec un prompt pro.
// Résultat : carrosserie nettoyée, sol propre, couleurs neutres et professionnelles.

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { imageBase64, maskBase64 } = req.body;
  if (!imageBase64 || !maskBase64)
    return res.status(400).json({ error: "Missing imageBase64 or maskBase64" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const maskBuffer  = Buffer.from(maskBase64,  "base64");

  const boundary = "----EnhanceBoundary" + Date.now();
  const CRLF = "\r\n";

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
    "Car dealership showroom floor. " +
    "Clean, spotless floor with no tire marks, no dirt, no stains, no scuff marks. " +
    "Same floor material and color as the original. Seamless, professional result.";

  const body = Buffer.concat([
    part("image", "image.jpg", "image/jpeg", imageBuffer),
    part("mask",  "mask.png",  "image/png", maskBuffer),
    field("model",  "gpt-image-1"),
    field("prompt", prompt),
    field("n",      "1"),
    field("size",   "1536x1024"),
    Buffer.from(`--${boundary}--${CRLF}`),
  ]);

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    return res.status(response.status).json({ error: msg });
  }

  const json = await response.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) return res.status(500).json({ error: "No image in OpenAI response" });

  return res.json({ imageBase64: b64 });
}
