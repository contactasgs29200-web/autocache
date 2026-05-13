// The orchestrator must forward a caller-provided prompt verbatim. This is
// what the front-end relies on to send STRICT_RETRY_PROMPT on the second
// full-image attempt.
import test from 'node:test';
import assert from 'node:assert/strict';

import { restoreHeadlights } from '../api/_lib/headlight/index.js';
import { __registry } from '../api/_lib/headlight/providers/index.js';
import { HeadlightRestorationProvider } from '../api/_lib/headlight/providers/base.js';

class CapturingProvider extends HeadlightRestorationProvider {
  get name() { return 'capture'; }
  get defaultModel() { return 'cap-1'; }
  constructor(cfg) {
    super(cfg);
    CapturingProvider.lastCall = null;
  }
  async restoreHeadlightsWithAI(req) {
    CapturingProvider.lastCall = { ...req };
    // Return a different image so the no-op echo guard doesn't kick in.
    return { imageBase64: 'b3RoZXJpbWFnZQ==', model: this.model, size: 'auto' };
  }
}

function withProvider(Provider, run) {
  const original = __registry.openai;
  __registry.openai = Provider;
  return Promise.resolve()
    .then(run)
    .finally(() => { __registry.openai = original; });
}

test('restoreHeadlights forwards a caller-provided prompt to the provider', async () => {
  await withProvider(CapturingProvider, async () => {
    const customPrompt = 'super strict retry prompt: pixel identical outside lenses';
    await restoreHeadlights({
      imageBase64: 'aW1hZ2U=',
      maskBase64: 'bWFzaw==',
      prompt: customPrompt,
      maskCoverage: 0.05,
      env: { HEADLIGHT_AI_API_KEY: 'k' },
    });
    assert.equal(CapturingProvider.lastCall.prompt, customPrompt);
  });
});

test('restoreHeadlights uses DEFAULT_PROMPT when no prompt is provided', async () => {
  await withProvider(CapturingProvider, async () => {
    await restoreHeadlights({
      imageBase64: 'aW1hZ2U=',
      maskBase64: 'bWFzaw==',
      maskCoverage: 0.05,
      env: { HEADLIGHT_AI_API_KEY: 'k' },
    });
    const sent = CapturingProvider.lastCall.prompt;
    assert.match(sent, /less yellow/i);
    assert.match(sent, /not modify/i);
  });
});
