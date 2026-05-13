// Stability AI provider — v2beta inpaint endpoint.
// https://platform.stability.ai/docs/api-reference#tag/Edit/operation/inpaint
//
// Stability mask convention: WHITE = region to redraw, BLACK = preserve.
// Adapter expects masks pre-built for that convention by the caller.
import { HeadlightRestorationProvider, ProviderRequestError } from './base.js';

const ENDPOINT = 'https://api.stability.ai/v2beta/stable-image/edit/inpaint';

export class StabilityHeadlightProvider extends HeadlightRestorationProvider {
  get name() { return 'stability'; }
  get defaultModel() { return 'sd3.5-large'; }

  async restoreHeadlightsWithAI({
    imageBase64, imageMime, maskBase64, prompt, negativePrompt, strength,
  }) {
    const form = new FormData();
    form.append('image', toBlob(imageBase64, imageMime), imageBlobName(imageMime));
    form.append('mask', toBlob(maskBase64, 'image/png'), 'mask.png');
    form.append('prompt', prompt);
    if (negativePrompt) form.append('negative_prompt', negativePrompt);
    form.append('output_format', 'png');
    form.append('mode', 'mask');
    form.append('grow_mask', '4');
    form.append('model', this.model);
    if (strength?.denoise) form.append('strength', String(strength.denoise));

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      body: form,
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const message = data?.errors?.join('; ') || data?.message || text || response.statusText;
      throw new ProviderRequestError(message, response.status, data);
    }

    const b64 = data?.image;
    if (!b64) throw new ProviderRequestError('Stability response missing `image`', 502, data);
    return { imageBase64: b64, model: this.model, raw: data };
  }
}

function toBlob(b64, mime) {
  const buf = Buffer.from(b64, 'base64');
  return new Blob([buf], { type: mime });
}

function imageBlobName(mime) {
  if (mime === 'image/png') return 'image.png';
  if (mime === 'image/webp') return 'image.webp';
  return 'image.jpg';
}
