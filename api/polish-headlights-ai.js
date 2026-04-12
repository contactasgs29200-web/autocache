// /api/polish-headlights-ai.js
// Reçoit l'image du véhicule + un masque PNG (transparent sur les optiques détectées).
// Envoie à gpt-image-1 pour régénérer uniquement les zones masquées.
// Retourne l'image complète ; le client ne recolle que les zones des optiques.

export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { imageBase64, maskBase64 } = req.body;
  if (!imageBase64 || !maskBase64)
    return res.status(400).json({ error: "Missing imageBase64 or maskBase64" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const maskBuffer  = Buffer.from(maskBase64,  "base64");

  const boundary = "----HeadlightBoundary" + Date.now();
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
    "Polish the car front headlight lenses in the marked areas to make them look brand new. " +
    "Remove all yellowing, oxidation and cloudiness from the plastic lens covers. " +
    "Make them perfectly clear, bright and transparent like on a new car. " +
    "Do not modify anything else in the photo.";

  const body = Buffer.concat([
    part("image", "image.png", "image/png", imageBuffer),
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
    console.error("OpenAI headlight edit error:", msg);
    return res.status(response.status).json({ error: msg });
  }

  const json = await response.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) return res.status(500).json({ error: "No image in OpenAI response" });

  return res.json({ imageBase64: b64 });
}
