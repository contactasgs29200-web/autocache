// Server-side guards that prevent silent no-op restorations:
//   - empty / >50% mask coverage is refused before calling the AI
//   - if the AI returns a byte-identical image, we throw instead of pretending success
import test from 'node:test';
import assert from 'node:assert/strict';

import { restoreHeadlights, ProviderRequestError } from '../api/_lib/headlight/index.js';
import { __registry } from '../api/_lib/headlight/providers/index.js';
import { HeadlightRestorationProvider } from '../api/_lib/headlight/providers/base.js';
import { isLikelySameAsInput } from '../api/_lib/headlight/composite.js';

class EchoProvider extends HeadlightRestorationProvider {
  get name() { return 'echo'; }
  get defaultModel() { return 'echo-1'; }
  async restoreHeadlightsWithAI(req) {
    return { imageBase64: req.imageBase64, model: this.model };
  }
}

function withProvider(Provider, run) {
  const original = __registry.openai;
  __registry.openai = Provider;
  return Promise.resolve()
    .then(run)
    .finally(() => { __registry.openai = original; });
}

test('empty mask coverage is refused before any AI call', async () => {
  await assert.rejects(
    () => restoreHeadlights({
      imageBase64: 'aaaa', maskBase64: 'bbbb',
      maskCoverage: 0,
      env: { HEADLIGHT_AI_API_KEY: 'k' },
    }),
    (err) => err instanceof ProviderRequestError && /empty mask/i.test(err.message),
  );
});

test('absurdly large mask coverage is refused', async () => {
  await assert.rejects(
    () => restoreHeadlights({
      imageBase64: 'aaaa', maskBase64: 'bbbb',
      maskCoverage: 0.85,
      env: { HEADLIGHT_AI_API_KEY: 'k' },
    }),
    /headlights/i,
  );
});

test('AI echoing the input image is detected and rejected as a no-op', async () => {
  await withProvider(EchoProvider, async () => {
    await assert.rejects(
      () => restoreHeadlights({
        imageBase64: 'identicalbytes',
        maskBase64: 'somemask',
        maskCoverage: 0.04,
        env: { HEADLIGHT_AI_API_KEY: 'k' },
      }),
      (err) => err instanceof ProviderRequestError && /no-op/i.test(err.message),
    );
  });
});

test('isLikelySameAsInput basic behavior', () => {
  assert.equal(isLikelySameAsInput('abc', 'abc'), true);
  assert.equal(isLikelySameAsInput('abc', 'xyz'), false);
  assert.equal(isLikelySameAsInput('', 'abc'), false);
  assert.equal(isLikelySameAsInput(null, 'abc'), false);
});
