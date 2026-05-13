// Verify the OpenAI provider sends multipart/form-data (NOT JSON) with the
// `image` and `mask` as file fields — this is the OpenAI Image Edit contract.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OpenAIHeadlightProvider } from '../api/_lib/headlight/providers/openai.js';
import { resolveStrength } from '../api/_lib/headlight/prompts.js';

test('OpenAI provider posts multipart/form-data with image+mask file fields', async () => {
  const captured = {};
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    captured.url = url;
    captured.method = init.method;
    captured.headers = init.headers;
    captured.body = init.body;
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from('fake').toString('base64') }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const provider = new OpenAIHeadlightProvider({ apiKey: 'sk-test', model: 'gpt-image-1' });
    await provider.restoreHeadlightsWithAI({
      imageBase64: Buffer.from('fakeimg').toString('base64'),
      imageMime: 'image/jpeg',
      maskBase64: Buffer.from('fakemask').toString('base64'),
      prompt: 'restore headlights',
      strength: resolveStrength('medium'),
      size: '1024x1024',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Endpoint
  assert.equal(captured.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(captured.method, 'POST');
  // Authorization header should be a bearer token, NOT contain the literal "Bearer sk-..." in the body
  assert.match(captured.headers.Authorization, /^Bearer sk-test$/);

  // Body must be a FormData / multipart payload — not a JSON string with image_url
  const body = captured.body;
  assert.ok(typeof body !== 'string', 'body must not be a JSON string (the old broken path)');
  assert.ok(body instanceof FormData, 'body must be FormData (multipart/form-data)');

  // Required fields
  assert.equal(body.get('model'), 'gpt-image-1');
  assert.equal(body.get('prompt'), 'restore headlights');
  // medium strength preset (post-restore introduction): high quality, high fidelity.
  // The "restore" preset is the new default; "high" is the only one that lowers fidelity.
  assert.equal(body.get('quality'), 'high');
  assert.equal(body.get('input_fidelity'), 'high');
  assert.equal(body.get('size'), '1024x1024');
  assert.equal(body.get('n'), '1');
  assert.equal(body.get('output_format'), 'png');
  assert.ok(body.get('image') instanceof Blob, 'image must be a Blob (file upload)');
  assert.ok(body.get('mask') instanceof Blob, 'mask must be a Blob (file upload)');
  assert.equal(body.get('mask').type, 'image/png');
});

test('OpenAI provider strength=low maps to high fidelity (subtle change)', async () => {
  const captured = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.body = init.body;
    return new Response(JSON.stringify({ data: [{ b64_json: 'aGk=' }] }), { status: 200 });
  };
  try {
    const provider = new OpenAIHeadlightProvider({ apiKey: 'k', model: 'gpt-image-1' });
    await provider.restoreHeadlightsWithAI({
      imageBase64: 'aGk=', imageMime: 'image/png', maskBase64: 'aGk=',
      prompt: 'p', strength: resolveStrength('low'), size: '1024x1024',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.body.get('input_fidelity'), 'high');
  assert.equal(captured.body.get('quality'), 'medium');
});

test('OpenAI provider strength=high maps to high quality + low fidelity (strong change)', async () => {
  const captured = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.body = init.body;
    return new Response(JSON.stringify({ data: [{ b64_json: 'aGk=' }] }), { status: 200 });
  };
  try {
    const provider = new OpenAIHeadlightProvider({ apiKey: 'k', model: 'gpt-image-1' });
    await provider.restoreHeadlightsWithAI({
      imageBase64: 'aGk=', imageMime: 'image/png', maskBase64: 'aGk=',
      prompt: 'p', strength: resolveStrength('high'), size: '1024x1024',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.body.get('quality'), 'high');
  assert.equal(captured.body.get('input_fidelity'), 'low');
});
