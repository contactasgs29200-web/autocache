// Lock the OpenAI provider's size handling: it must NEVER send a size value
// outside the API's documented allow-list (1024x1024, 1536x1024, 1024x1536,
// auto). Anything else triggers HTTP 400 "Invalid size 'WxH'".
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OpenAIHeadlightProvider,
  OPENAI_SUPPORTED_SIZES,
  snapOpenAISize,
} from '../api/_lib/headlight/providers/openai.js';
import { resolveStrength } from '../api/_lib/headlight/prompts.js';

test('snapOpenAISize keeps already-supported sizes', () => {
  for (const size of ['1024x1024', '1536x1024', '1024x1536', 'auto']) {
    assert.equal(snapOpenAISize(size), size);
  }
});

test('snapOpenAISize maps landscape sizes to 1536x1024', () => {
  assert.equal(snapOpenAISize('1792x1344'), '1536x1024');
  assert.equal(snapOpenAISize('4032x3024'), '1536x1024');
  assert.equal(snapOpenAISize('1920x1080'), '1536x1024');
});

test('snapOpenAISize maps portrait sizes to 1024x1536', () => {
  assert.equal(snapOpenAISize('800x1200'),  '1024x1536');
  assert.equal(snapOpenAISize('1080x1920'), '1024x1536');
  assert.equal(snapOpenAISize('600x1000'),  '1024x1536');
});

test('snapOpenAISize maps near-square sizes to 1024x1024', () => {
  assert.equal(snapOpenAISize('900x900'),   '1024x1024');
  assert.equal(snapOpenAISize('1100x1000'), '1024x1024'); // ratio 1.1 < 1.2
  assert.equal(snapOpenAISize('900x1000'),  '1024x1024'); // ratio 0.9 > 0.83
});

test('snapOpenAISize falls back to "auto" for empty / garbage input', () => {
  assert.equal(snapOpenAISize(undefined), 'auto');
  assert.equal(snapOpenAISize(null), 'auto');
  assert.equal(snapOpenAISize(''), 'auto');
  assert.equal(snapOpenAISize('garbage'), 'auto');
  assert.equal(snapOpenAISize('1024'), 'auto');
  assert.equal(snapOpenAISize('0x0'), 'auto');
});

test('OpenAI provider NEVER sends an unsupported size to the API', async () => {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url, body: init.body });
    return new Response(JSON.stringify({ data: [{ b64_json: 'aGk=' }] }), { status: 200 });
  };

  const inputs = [
    '1792x1344',     // the size Vercel reported broke the API
    '4032x3024',     // mobile landscape original
    '1080x1920',     // mobile portrait
    '500x500',       // small square
    'totally garbage',
    undefined,
    'auto',
    '1024x1024',
  ];

  try {
    const provider = new OpenAIHeadlightProvider({ apiKey: 'k', model: 'gpt-image-1' });
    for (const size of inputs) {
      await provider.restoreHeadlightsWithAI({
        imageBase64: 'aGk=',
        imageMime: 'image/png',
        maskBase64: 'aGk=',
        prompt: 'p',
        strength: resolveStrength('medium'),
        size,
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(captured.length, inputs.length);
  for (const { body } of captured) {
    const sentSize = body.get('size');
    assert.ok(
      OPENAI_SUPPORTED_SIZES.includes(sentSize),
      `size "${sentSize}" must be in OPENAI_SUPPORTED_SIZES`,
    );
  }
});

test('OpenAI provider returns the snapped size in its result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ data: [{ b64_json: 'aGk=' }] }),
    { status: 200 },
  );
  try {
    const provider = new OpenAIHeadlightProvider({ apiKey: 'k', model: 'gpt-image-1' });
    const out = await provider.restoreHeadlightsWithAI({
      imageBase64: 'aGk=',
      imageMime: 'image/png',
      maskBase64: 'aGk=',
      prompt: 'p',
      strength: resolveStrength('medium'),
      size: '1792x1344',
    });
    assert.equal(out.size, '1536x1024', 'result.size must reflect the snapped value');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
