// Public entry point for the headlight restoration pipeline.

import {
  getProvider,
  resolveProviderConfig,
  fallbackLocalEnabled,
  listProviders,
} from './providers/index.js';
import { ProviderRequestError, ProviderConfigError } from './providers/base.js';
import { DEFAULT_PROMPT, DEFAULT_NEGATIVE_PROMPT, resolveStrength } from './prompts.js';
import {
  readPngSize,
  dimensionsMatch,
  blendParamsFor,
  isLikelySameAsInput,
} from './composite.js';

export async function restoreHeadlights(args) {
  const env = args.env || process.env;
  const provider = getProvider(env, args.providerOverrides);
  if (!provider) {
    throw new ProviderConfigError('Headlight AI is disabled (HEADLIGHT_AI_ENABLED=false)');
  }

  const strength = resolveStrength(args.strength);
  const prompt = args.prompt || DEFAULT_PROMPT;
  const negativePrompt = args.negativePrompt || DEFAULT_NEGATIVE_PROMPT;

  console.log('[headlight] restoreHeadlights', {
    provider: provider.name,
    model: provider.model,
    strength: strength.label,
    size: args.size || null,
    imageBytes: args.imageBase64 ? Math.floor((args.imageBase64.length * 3) / 4) : 0,
    maskBytes: args.maskBase64 ? Math.floor((args.maskBase64.length * 3) / 4) : 0,
    maskCoverage: typeof args.maskCoverage === 'number' ? args.maskCoverage : null,
    promptHead: prompt.slice(0, 80) + '...',
  });

  // Refuse empty / suspicious masks server-side so we never burn an API call
  // for a no-op edit.
  if (typeof args.maskCoverage === 'number') {
    if (args.maskCoverage <= 0.0005) {
      throw new ProviderRequestError(
        `Mask covers ${Math.round(args.maskCoverage * 10000) / 100}% of the image — refusing to call the AI for an empty mask.`,
        422,
        { maskCoverage: args.maskCoverage },
      );
    }
    if (args.maskCoverage > 0.5) {
      throw new ProviderRequestError(
        `Mask covers ${Math.round(args.maskCoverage * 100)}% of the image — that's far more than headlights, refusing to call the AI.`,
        422,
        { maskCoverage: args.maskCoverage },
      );
    }
  }

  const result = await provider.restoreHeadlightsWithAI({
    imageBase64: args.imageBase64,
    imageMime: args.imageMime || 'image/jpeg',
    maskBase64: args.maskBase64,
    prompt,
    negativePrompt,
    strength,
    size: args.size,
  });

  // Dimension guard: compare the AI output to the size the PROVIDER actually
  // used (which may differ from `args.size` after snapping to provider-supported
  // values). For "auto" we just record the dimensions without enforcing match.
  let outDims = null;
  const effectiveSize = result.size || args.size;
  if (effectiveSize) {
    outDims = readPngSize(result.imageBase64);
    if (outDims && effectiveSize !== 'auto' && !dimensionsMatch(outDims, effectiveSize)) {
      throw new ProviderRequestError(
        `AI output dimensions ${outDims.width}x${outDims.height} do not match expected ${effectiveSize}`,
        502,
        { expected: effectiveSize, requested: args.size, received: outDims },
      );
    }
  }

  // Cheap server-side signature check: if the AI returned literally the same
  // bytes we sent, fail loudly instead of pretending the AI did its job.
  // (Real pixel-level diff is done client-side on the masked region.)
  if (isLikelySameAsInput(args.imageBase64, result.imageBase64)) {
    throw new ProviderRequestError(
      'AI returned an output that looks identical to the input — likely a no-op edit',
      502,
      { provider: provider.name, model: result.model },
    );
  }

  console.log('[headlight] restoreHeadlights ok', {
    provider: provider.name,
    model: result.model,
    outDims,
  });

  return {
    imageBase64: result.imageBase64,
    provider: provider.name,
    model: result.model,
    strength: strength.label,
    blend: blendParamsFor(strength),
    raw: result.raw ?? null,
    attempts: result.attempts || [],
    outDims,
    requestedSize: args.size || null,
    effectiveSize: effectiveSize || null,
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
