// /api/lustrage-pro.js
//
// Headlight restoration endpoint — AI inpainting / image-to-image only.
//
// The pipeline is:
//   1. The front-end detects the headlights (api/headlights.js → polygons)
//   2. The front-end builds a precise mask + the source image and POSTs them
//      to this endpoint together with `mode` and `strength`.
//   3. We delegate to a HeadlightRestorationProvider (OpenAI / Replicate /
//      Stability — selected via HEADLIGHT_AI_PROVIDER).
//   4. The front-end re-composites the AI output on top of the original
//      using the blending parameters returned in the response.
//
// We never replace yellow pixels with white pixels here: the AI does the
// work. If the AI call fails:
//   - by default we surface the error.
//   - if HEADLIGHT_AI_FALLBACK_LOCAL=true the response carries a
//     `fallback: "local"` flag so the front-end can run its legacy
//     canvas-only polish as a graceful degradation.
//
// Env vars (see docs/HEADLIGHT_RESTORATION.md):
//   HEADLIGHT_AI_ENABLED          true | false  (default: true)
//   HEADLIGHT_AI_PROVIDER         openai | replicate | stability
//   HEADLIGHT_AI_API_KEY          provider API key
//   HEADLIGHT_AI_MODEL            provider-specific model id
//   HEADLIGHT_AI_FALLBACK_LOCAL   true | false  (default: false)

import {
  restoreHeadlights,
  fallbackLocalEnabled,
  ProviderConfigError,
  ProviderRequestError,
  resolveStrength,
  blendParamsFor,
} from './_lib/headlight/index.js';

export const config = { api: { bodyParser: { sizeLimit: '30mb' } } };

const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

function normalizeMime(mime) {
  return SUPPORTED_MIME.has(mime) ? mime : 'image/jpeg';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    imageBase64,
    maskBase64,
    imageMime = 'image/jpeg',
    mode = 'ai',
    strength = 'medium',
    size = null,
    prompt,
    negativePrompt,
  } = req.body ?? {};

  if (!imageBase64 || !maskBase64) {
    return res.status(400).json({ error: 'Missing imageBase64 or maskBase64' });
  }

  if (mode !== 'ai') {
    return res.status(400).json({
      error: `Unsupported mode "${mode}". The only supported mode is "ai".`,
    });
  }

  try {
    const result = await restoreHeadlights({
      imageBase64,
      maskBase64,
      imageMime: normalizeMime(imageMime),
      size,
      prompt,
      negativePrompt,
      strength,
    });

    return res.json({
      imageBase64: result.imageBase64,
      provider: result.provider,
      model: result.model,
      strength: result.strength,
      blend: result.blend,
      attempts: result.attempts,
      mode: 'ai',
    });
  } catch (e) {
    const status = e instanceof ProviderConfigError ? 500
      : e instanceof ProviderRequestError ? (e.status || 502)
      : 500;
    const allowFallback = fallbackLocalEnabled();
    const payload = {
      error: e.message || 'Headlight restoration failed',
      provider: process.env.HEADLIGHT_AI_PROVIDER || 'openai',
      details: e.details ?? null,
      fallback: allowFallback ? 'local' : null,
      blend: allowFallback ? blendParamsFor(resolveStrength(strength)) : null,
    };

    console.error('lustrage-pro AI error:', status, payload);
    return res.status(status).json(payload);
  }
}
