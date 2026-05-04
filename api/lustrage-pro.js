// /api/lustrage-pro.js
// Lustrage des optiques via OpenAI Image Edit.
// L'image est fournie par le front, le masque PNG indique les optiques a reinventer.

export const config = { api: { bodyParser: { sizeLimit: '30mb' } } };

const DEFAULT_PROMPT = [
  'Retouch only the masked headlight lens covers.',
  'Restore yellowed, oxidized, foggy plastic into crystal clear transparent polycarbonate headlight lenses.',
  'Keep realistic glass depth, sharp inner reflectors, bulbs, natural highlights, and reflections.',
  'Preserve the exact car model, paint, body panels, panel gaps, shadows, background, camera angle, and lighting.',
  'Do not make the headlights white, opaque, cloudy, painted, or flat.',
  'Do not alter the license plate area, logos, wheels, grille, bumper, or any unmasked area.',
].join(' ');

function normalizeMime(mime) {
  if (mime === 'image/png' || mime === 'image/webp' || mime === 'image/jpeg') return mime;
  return 'image/jpeg';
}

function filenameForMime(mime) {
  if (mime === 'image/png') return 'car.png';
  if (mime === 'image/webp') return 'car.webp';
  return 'car.jpg';
}

function part(boundary, name, filename, contentType, data) {
  const CRLF = '\r\n';
  const header =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}` +
    `Content-Type: ${contentType}${CRLF}${CRLF}`;
  return Buffer.concat([Buffer.from(header), data, Buffer.from(CRLF)]);
}

function field(boundary, name, value) {
  const CRLF = '\r\n';
  return Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
    `${value}${CRLF}`
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    imageBase64,
    maskBase64,
    imageMime = 'image/jpeg',
    quality = 'medium',
    prompt = DEFAULT_PROMPT,
  } = req.body ?? {};

  if (!imageBase64 || !maskBase64) {
    return res.status(400).json({ error: 'Missing imageBase64 or maskBase64' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
  const mime = normalizeMime(imageMime);
  const imageBuffer = Buffer.from(imageBase64, 'base64');
  const maskBuffer = Buffer.from(maskBase64, 'base64');
  const boundary = '----AutoCacheOpenAI' + Date.now();

  const fields = [
    part(boundary, 'image', filenameForMime(mime), mime, imageBuffer),
    part(boundary, 'mask', 'headlight-mask.png', 'image/png', maskBuffer),
    field(boundary, 'model', model),
    field(boundary, 'prompt', prompt),
    field(boundary, 'quality', quality),
    field(boundary, 'output_format', 'png'),
    field(boundary, 'size', 'auto'),
    field(boundary, 'n', '1'),
  ];
  fields.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(fields);

  try {
    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const details = data?.error?.message || text || response.statusText;
      console.error('OpenAI image edit error:', response.status, details);
      return res.status(response.status).json({ error: details });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      console.error('OpenAI image edit: missing b64_json', data);
      return res.status(502).json({ error: 'OpenAI response did not include an image' });
    }

    return res.json({
      imageBase64: b64,
      model,
      usage: data?.usage ?? null,
    });
  } catch (e) {
    console.error('lustrage-pro error:', e);
    return res.status(500).json({ error: e.message });
  }
}
