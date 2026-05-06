// OpenAI Image Edit provider (gpt-image-1 / gpt-image-1-mini).
// https://platform.openai.com/docs/api-reference/images/createEdit
//
// Mask convention: transparent pixels in the mask PNG are the region to edit,
// opaque pixels are preserved.
//
// IMPORTANT: this endpoint is documented as multipart/form-data, with `image`
// and `mask` as file uploads. Sending a JSON body with `image_url` was the
// previous (broken) implementation — the API silently fell back to behavior
// that produced no visible change. We now use multipart correctly.
//
// Supported `size` values for /v1/images/edits with gpt-image-1:
//   1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait), auto.
// Anything else is rejected by OpenAI with HTTP 400. We snap arbitrary
// requested sizes to the closest supported aspect ratio so callers don't
// have to know about this constraint.
import { HeadlightRestorationProvider, ProviderRequestError } from './base.js';

const ENDPOINT = 'https://api.openai.com/v1/images/edits';

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const OPENAI_SUPPORTED_SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto'];

/**
 * Snap an arbitrary "WxH" string to one of OpenAI's supported edit sizes.
 *   - "auto" or empty → "auto"
 *   - already supported → unchanged
 *   - unsupported "WxH" → closest aspect: landscape / portrait / square
 *   - unparseable → "auto"
 */
export function snapOpenAISize(requested) {
  if (!requested || requested === 'auto') return 'auto';
  if (OPENAI_SUPPORTED_SIZES.includes(requested)) return requested;
  const m = /^(\d+)x(\d+)$/.exec(String(requested));
  if (!m) return 'auto';
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return 'auto';
  const ratio = w / h;
  if (ratio > 1.2) return '1536x1024';
  if (ratio < 0.83) return '1024x1536';
  return '1024x1024';
}

export class OpenAIHeadlightProvider extends HeadlightRestorationProvider {
  get name() { return 'openai'; }
  get defaultModel() { return 'gpt-image-1'; }

  async restoreHeadlightsWithAI({ imageBase64, imageMime, maskBase64, prompt, strength, size }) {
    const candidates = uniqueModels(this.model);
    const attempts = [];
    const effectiveSize = snapOpenAISize(size);
    if (effectiveSize !== (size || 'auto')) {
      console.log('[openai-provider] snapping size', { requested: size, effective: effectiveSize });
    }

    for (const model of candidates) {
      try {
        const result = await this._callOnce({
          model,
          imageBase64,
          imageMime,
          maskBase64,
          prompt,
          quality: strength?.openaiQuality || 'medium',
          fidelity: strength?.openaiFidelity || 'low',
          size: effectiveSize,
        });
        return { imageBase64: result.b64, model, size: effectiveSize, raw: result.raw, attempts };
      } catch (e) {
        attempts.push({ model, status: e.status ?? 500, error: e.message });
        console.error('[openai-provider] attempt failed', { model, status: e.status, message: e.message, details: redactDetails(e.details) });
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 404) break;
      }
    }

    const last = attempts[attempts.length - 1];
    throw new ProviderRequestError(
      last?.error || 'OpenAI image edit failed',
      last?.status || 502,
      attempts,
    );
  }

  async _callOnce({ model, imageBase64, imageMime, maskBase64, prompt, quality, fidelity, size }) {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const maskBuffer = Buffer.from(maskBase64, 'base64');

    const imageExt = MIME_TO_EXT[imageMime] || 'png';
    const imageBlob = new Blob([imageBuffer], { type: imageMime });
    const maskBlob = new Blob([maskBuffer], { type: 'image/png' });

    // Defensive: a caller might pass a size string that bypasses snap.
    const effectiveSize = snapOpenAISize(size);

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('image', imageBlob, `image.${imageExt}`);
    form.append('mask', maskBlob, 'mask.png');
    form.append('n', '1');
    form.append('quality', quality);
    form.append('size', effectiveSize);
    form.append('input_fidelity', fidelity);
    if (model === 'gpt-image-1' || model === 'gpt-image-1-mini') {
      form.append('output_format', 'png');
    }

    console.log('[openai-provider] POST /v1/images/edits', {
      model, quality, input_fidelity: fidelity, size: effectiveSize,
      imageBytes: imageBuffer.length, maskBytes: maskBuffer.length,
      promptLength: prompt.length,
    });

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!response.ok) {
      const message = data?.error?.message || text || response.statusText;
      console.error('[openai-provider] error response', { status: response.status, message, body: text.slice(0, 500) });
      throw new ProviderRequestError(message, response.status, data);
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      console.error('[openai-provider] response missing b64_json', { keys: data ? Object.keys(data) : null });
      throw new ProviderRequestError('OpenAI response did not include an image', 502, data);
    }

    console.log('[openai-provider] success', {
      model,
      outBytes: Math.floor((b64.length * 3) / 4),
      usage: data?.usage ?? null,
    });

    return { b64, raw: data };
  }
}

function uniqueModels(primary) {
  return [primary, 'gpt-image-1', 'gpt-image-1-mini'].filter(
    (m, i, list) => m && list.indexOf(m) === i,
  );
}

function redactDetails(details) {
  if (!details) return null;
  const json = JSON.stringify(details);
  return json.length > 800 ? json.slice(0, 800) + '...' : json;
}
