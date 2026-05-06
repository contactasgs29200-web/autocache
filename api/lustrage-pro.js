// /api/lustrage-pro.js
//
// Headlight restoration endpoint — AI inpainting / image-to-image only.
//
// New diagnostic features (added during the no-op investigation):
//   - Verbose server logs for every request (env, mode, strength, mask
//     coverage, AI dimensions, success/failure).
//   - `?debug=1` query: response also returns the mask + raw AI image so
//     the client can render them for inspection.
//
// Env vars (see docs/HEADLIGHT_RESTORATION.md).

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

function isDebugRequest(req) {
  const url = req.url || '';
  if (url.includes('debug=1') || url.includes('debug=true')) return true;
  return req.body?.debug === true || req.body?.debug === 1 || req.body?.debug === '1';
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
    maskCoverage = null,
  } = req.body ?? {};

  const debug = isDebugRequest(req);

  console.log('[lustrage-pro] request', {
    mode,
    strength,
    size,
    imageMime,
    imageBytes: imageBase64 ? Math.floor((imageBase64.length * 3) / 4) : 0,
    maskBytes: maskBase64 ? Math.floor((maskBase64.length * 3) / 4) : 0,
    maskCoverage,
    debug,
    env: {
      HEADLIGHT_AI_ENABLED: process.env.HEADLIGHT_AI_ENABLED ?? '(unset, default true)',
      HEADLIGHT_AI_PROVIDER: process.env.HEADLIGHT_AI_PROVIDER ?? '(unset, default openai)',
      HEADLIGHT_AI_MODEL: process.env.HEADLIGHT_AI_MODEL ?? '(unset, default gpt-image-1)',
      HEADLIGHT_AI_API_KEY: process.env.HEADLIGHT_AI_API_KEY ? '(set)' : (process.env.OPENAI_API_KEY ? '(via OPENAI_API_KEY)' : '(MISSING)'),
      HEADLIGHT_AI_FALLBACK_LOCAL: process.env.HEADLIGHT_AI_FALLBACK_LOCAL ?? '(unset, default false)',
    },
  });

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
      maskCoverage,
    });

    const payload = {
      imageBase64: result.imageBase64,
      provider: result.provider,
      model: result.model,
      strength: result.strength,
      blend: result.blend,
      attempts: result.attempts,
      mode: 'ai',
      outDims: result.outDims,
      requestedSize: result.requestedSize,
      effectiveSize: result.effectiveSize,
    };

    if (debug) {
      payload.debug = {
        maskBase64,
        rawAiBase64: result.imageBase64,
        promptUsed: prompt ?? null,
        env: {
          provider: process.env.HEADLIGHT_AI_PROVIDER ?? 'openai',
          model: process.env.HEADLIGHT_AI_MODEL ?? 'gpt-image-1',
        },
      };
    }

    return res.json(payload);
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
    if (debug) {
      payload.debug = { maskBase64, env: process.env.HEADLIGHT_AI_PROVIDER || 'openai' };
    }

    console.error('[lustrage-pro] AI error', { status, error: e.message, details: e.details });
    return res.status(status).json(payload);
  }
}
