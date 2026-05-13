// Abstract HeadlightRestorationProvider.
// Every provider implementation MUST extend this class and implement
// `restoreHeadlightsWithAI`.
//
// The contract is intentionally narrow: the provider receives a base image
// + a binary mask describing the headlight optics, and returns a restored
// PNG image with the SAME dimensions as the input.
//
// The provider must NOT touch any pixel outside the mask. Re-blending is
// done by the caller via `compositeRestoredRegion` so even if a model
// drifts on the rest of the image we only keep the masked region.

export class HeadlightRestorationProvider {
  /**
   * @param {object} cfg
   * @param {string} cfg.apiKey  Provider API key (loaded from env, never hardcoded).
   * @param {string} [cfg.model] Provider-specific model identifier.
   */
  constructor({ apiKey, model } = {}) {
    if (new.target === HeadlightRestorationProvider) {
      throw new Error('HeadlightRestorationProvider is abstract');
    }
    if (!apiKey) {
      throw new ProviderConfigError(`${this.name} requires an API key`);
    }
    this.apiKey = apiKey;
    this.model = model || this.defaultModel;
  }

  /** Provider-friendly name, surfaced in API responses. */
  get name() { return 'unknown'; }

  /** Default model identifier when HEADLIGHT_AI_MODEL is not set. */
  get defaultModel() { return null; }

  /**
   * Restore the masked region of `imageBase64` using the AI model.
   *
   * @param {object} req
   * @param {string} req.imageBase64  Base64 (no data: prefix) of the source image.
   * @param {string} req.imageMime    'image/jpeg' | 'image/png' | 'image/webp'.
   * @param {string} req.maskBase64   Base64 PNG of the mask. Convention:
   *                                  the area to redraw is the alpha-transparent
   *                                  / non-zero region (provider-specific
   *                                  adapters convert as needed).
   * @param {string} req.prompt
   * @param {string} req.negativePrompt
   * @param {object} req.strength     One of STRENGTH_PRESETS values.
   * @param {string} [req.size]       e.g. "1024x1024".
   * @returns {Promise<{ imageBase64: string, model: string, raw?: any }>}
   */
  // eslint-disable-next-line no-unused-vars
  async restoreHeadlightsWithAI(req) {
    throw new Error(`${this.constructor.name}.restoreHeadlightsWithAI not implemented`);
  }
}

export class ProviderConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderConfigError';
    this.status = 500;
  }
}

export class ProviderRequestError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
    this.details = details;
  }
}
