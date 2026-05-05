// OpenAI Image Edit provider (gpt-image-1 / gpt-image-1-mini).
// https://platform.openai.com/docs/api-reference/images/createEdit
//
// Mask convention: transparent pixels in the mask PNG are the region to edit,
// opaque pixels are preserved.
import { HeadlightRestorationProvider, ProviderRequestError } from './base.js';

const ENDPOINT = 'https://api.openai.com/v1/images/edits';

export class OpenAIHeadlightProvider extends HeadlightRestorationProvider {
  get name() { return 'openai'; }
  get defaultModel() { return 'gpt-image-1'; }

  async restoreHeadlightsWithAI({ imageBase64, imageMime, maskBase64, prompt, strength, size }) {
    const candidates = uniqueModels(this.model);
    const attempts = [];

    for (const model of candidates) {
      try {
        const result = await this._callOnce({
          model,
          imageBase64,
          imageMime,
          maskBase64,
          prompt,
          quality: strength?.openaiQuality || 'medium',
          size,
        });
        return { imageBase64: result.b64, model, raw: result.raw, attempts };
      } catch (e) {
        attempts.push({ model, status: e.status ?? 500, error: e.message });
        // 4xx that aren't model-specific won't be helped by retrying with another model.
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 404) {
          break;
        }
      }
    }

    const last = attempts[attempts.length - 1];
    throw new ProviderRequestError(
      last?.error || 'OpenAI image edit failed',
      last?.status || 502,
      attempts,
    );
  }

  async _callOnce({ model, imageBase64, imageMime, maskBase64, prompt, quality, size }) {
    const body = {
      model,
      prompt,
      images: [{ image_url: `data:${imageMime};base64,${imageBase64}` }],
      mask: { image_url: `data:image/png;base64,${maskBase64}` },
      input_fidelity: 'high',
      quality,
      output_format: 'png',
      size: size || 'auto',
      moderation: 'low',
      n: 1,
    };

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!response.ok) {
      const message = data?.error?.message || text || response.statusText;
      throw new ProviderRequestError(message, response.status, data);
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      throw new ProviderRequestError('OpenAI response did not include an image', 502, data);
    }

    return { b64, raw: data };
  }
}

function uniqueModels(primary) {
  return [primary, 'gpt-image-1', 'gpt-image-1-mini'].filter(
    (m, i, list) => m && list.indexOf(m) === i,
  );
}
