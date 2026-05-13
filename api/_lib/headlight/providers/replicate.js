// Replicate provider — generic inpainting endpoint.
// https://replicate.com/docs/reference/http
//
// Default model: stability-ai/stable-diffusion-inpainting (or any inpainting
// model whose input schema accepts `image`, `mask`, `prompt`, `negative_prompt`).
// Override with HEADLIGHT_AI_MODEL=owner/name:version.
//
// Replicate mask convention: WHITE pixels = region to redraw, BLACK = preserve.
// Our internal masks are produced with the OpenAI convention (transparent = edit),
// so we hand the mask through and let `mask.js#exportMaskFor('replicate')` build
// the correct one. This provider does not invert anything itself.
import { HeadlightRestorationProvider, ProviderRequestError } from './base.js';

const BASE = 'https://api.replicate.com/v1';

export class ReplicateHeadlightProvider extends HeadlightRestorationProvider {
  get name() { return 'replicate'; }
  get defaultModel() {
    // A generic, well-known SD inpainting model. Override in env for production.
    return 'stability-ai/stable-diffusion-inpainting';
  }

  async restoreHeadlightsWithAI({
    imageBase64, imageMime, maskBase64, prompt, negativePrompt, strength,
  }) {
    const version = await this._resolveVersion(this.model);
    const input = {
      image: `data:${imageMime};base64,${imageBase64}`,
      mask: `data:image/png;base64,${maskBase64}`,
      prompt,
      negative_prompt: negativePrompt,
      num_inference_steps: 30,
      guidance_scale: 7.5,
      // Most SD inpainting endpoints expose either `strength` or `prompt_strength`.
      // Replicate ignores unknown fields, so we send both.
      strength: strength?.denoise ?? 0.75,
      prompt_strength: strength?.denoise ?? 0.75,
    };

    const created = await this._fetchJSON(`${BASE}/predictions`, {
      method: 'POST',
      body: JSON.stringify({ version, input }),
    });

    const finalPrediction = await this._waitFor(created.id);
    if (finalPrediction.status !== 'succeeded') {
      throw new ProviderRequestError(
        finalPrediction.error || `Replicate prediction ${finalPrediction.status}`,
        502,
        finalPrediction,
      );
    }

    const output = Array.isArray(finalPrediction.output)
      ? finalPrediction.output[0]
      : finalPrediction.output;
    if (!output) {
      throw new ProviderRequestError('Replicate returned no output', 502, finalPrediction);
    }

    const imageBase64Out = await this._downloadAsBase64(output);
    return { imageBase64: imageBase64Out, model: this.model, raw: finalPrediction };
  }

  async _resolveVersion(model) {
    // model is either "owner/name" or "owner/name:version".
    if (model.includes(':')) return model.split(':')[1];
    const data = await this._fetchJSON(`${BASE}/models/${model}`);
    const version = data?.latest_version?.id;
    if (!version) throw new ProviderRequestError(`No latest_version for ${model}`, 502, data);
    return version;
  }

  async _waitFor(id, { timeoutMs = 90_000, pollMs = 1_500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let prediction;
    while (Date.now() < deadline) {
      prediction = await this._fetchJSON(`${BASE}/predictions/${id}`);
      if (prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled') {
        return prediction;
      }
      await sleep(pollMs);
    }
    throw new ProviderRequestError('Replicate prediction timed out', 504, prediction);
  }

  async _downloadAsBase64(url) {
    const r = await fetch(url);
    if (!r.ok) throw new ProviderRequestError(`Replicate output download failed: ${r.status}`, 502);
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.toString('base64');
  }

  async _fetchJSON(url, init = {}) {
    const r = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) {
      const message = data?.detail || data?.error || text || r.statusText;
      throw new ProviderRequestError(message, r.status, data);
    }
    return data;
  }
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
