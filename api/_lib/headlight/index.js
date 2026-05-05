// Public entry point for the headlight restoration pipeline.
//
// The flow:
//   1. resolveProviderConfig() reads HEADLIGHT_AI_* env vars.
//   2. getProvider() instantiates the right adapter.
//   3. restoreHeadlights() calls provider.restoreHeadlightsWithAI() and
//      validates the output before handing it back.
//
// The caller (api/lustrage-pro.js) handles the HTTP request/response shape,
// the front-end (App.jsx) builds the mask and re-composites the result.

import {
  getProvider,
  resolveProviderConfig,
  fallbackLocalEnabled,
  listProviders,
} from './providers/index.js';
import { ProviderRequestError, ProviderConfigError } from './providers/base.js';
import { DEFAULT_PROMPT, DEFAULT_NEGATIVE_PROMPT, resolveStrength } from './prompts.js';
import { readPngSize, dimensionsMatch, blendParamsFor } from './composite.js';

/**
 * @param {object} args
 * @param {string} args.imageBase64
 * @param {string} args.maskBase64
 * @param {string} [args.imageMime]
 * @param {string} [args.size]               "WxH" we asked for. Used to
 *                                            validate the model didn't
 *                                            silently shrink the image.
 * @param {string} [args.prompt]
 * @param {string} [args.negativePrompt]
 * @param {string} [args.strength]           low | medium | high
 * @param {object} [args.env]                env override (tests).
 * @param {object} [args.providerOverrides]  test hook for getProvider().
 */
export async function restoreHeadlights(args) {
  const env = args.env || process.env;
  const provider = getProvider(env, args.providerOverrides);
  if (!provider) {
    throw new ProviderConfigError('Headlight AI is disabled (HEADLIGHT_AI_ENABLED=false)');
  }

  const strength = resolveStrength(args.strength);
  const prompt = args.prompt || DEFAULT_PROMPT;
  const negativePrompt = args.negativePrompt || DEFAULT_NEGATIVE_PROMPT;

  const result = await provider.restoreHeadlightsWithAI({
    imageBase64: args.imageBase64,
    imageMime: args.imageMime || 'image/jpeg',
    maskBase64: args.maskBase64,
    prompt,
    negativePrompt,
    strength,
    size: args.size,
  });

  // Dimension guard: a model that shrinks/upsizes the image would make the
  // composite step misalign — reject it loudly so the caller can fall back
  // (only if HEADLIGHT_AI_FALLBACK_LOCAL=true) instead of pretending it worked.
  if (args.size) {
    const out = readPngSize(result.imageBase64);
    if (out && !dimensionsMatch(out, args.size)) {
      throw new ProviderRequestError(
        `AI output dimensions ${out.width}x${out.height} do not match requested ${args.size}`,
        502,
        { requested: args.size, received: out },
      );
    }
  }

  return {
    imageBase64: result.imageBase64,
    provider: provider.name,
    model: result.model,
    strength: strength.label,
    blend: blendParamsFor(strength),
    raw: result.raw ?? null,
    attempts: result.attempts || [],
  };
}

export {
  getProvider,
  resolveProviderConfig,
  fallbackLocalEnabled,
  listProviders,
  ProviderRequestError,
  ProviderConfigError,
  DEFAULT_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  resolveStrength,
  blendParamsFor,
};
