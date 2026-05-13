// Black-box test of the api/lustrage-pro.js HTTP handler:
// - 405 on non-POST
// - 400 on missing payload
// - 400 on unsupported mode
// - 200 + provider metadata on success (mock provider)
// - 502 + fallback gating on provider failure
import test from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/lustrage-pro.js';
import { __registry } from '../api/_lib/headlight/providers/index.js';
import { HeadlightRestorationProvider, ProviderRequestError } from '../api/_lib/headlight/providers/base.js';

function fakePngBase64(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 6;
  const ihdrLen = Buffer.alloc(4); ihdrLen.writeUInt32BE(13, 0);
  const ihdrCrc = Buffer.alloc(4);
  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, ihdrCrc]).toString('base64');
}

class StubResponse {
  constructor() { this.statusCode = 200; this.body = null; }
  status(s) { this.statusCode = s; return this; }
  json(b)   { this.body = b; return this; }
}

function withMockProvider(behavior, run) {
  const original = __registry.openai;
  __registry.openai = class extends HeadlightRestorationProvider {
    get name() { return 'mock'; }
    get defaultModel() { return 'mock-1'; }
    async restoreHeadlightsWithAI() {
      if (behavior === 'throw') throw new ProviderRequestError('boom', 502);
      return { imageBase64: fakePngBase64(1024, 1024), model: 'mock-1' };
    }
  };
  // The handler reads env at call time — make sure tests don't leak.
  const prev = {
    enabled: process.env.HEADLIGHT_AI_ENABLED,
    key:     process.env.HEADLIGHT_AI_API_KEY,
    fb:      process.env.HEADLIGHT_AI_FALLBACK_LOCAL,
    prov:    process.env.HEADLIGHT_AI_PROVIDER,
  };
  process.env.HEADLIGHT_AI_API_KEY = 'k';
  process.env.HEADLIGHT_AI_ENABLED = 'true';
  delete process.env.HEADLIGHT_AI_PROVIDER;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      __registry.openai = original;
      restoreEnv(prev);
    });
}

function restoreEnv(prev) {
  if (prev.enabled === undefined) delete process.env.HEADLIGHT_AI_ENABLED; else process.env.HEADLIGHT_AI_ENABLED = prev.enabled;
  if (prev.key === undefined) delete process.env.HEADLIGHT_AI_API_KEY; else process.env.HEADLIGHT_AI_API_KEY = prev.key;
  if (prev.fb === undefined) delete process.env.HEADLIGHT_AI_FALLBACK_LOCAL; else process.env.HEADLIGHT_AI_FALLBACK_LOCAL = prev.fb;
  if (prev.prov === undefined) delete process.env.HEADLIGHT_AI_PROVIDER; else process.env.HEADLIGHT_AI_PROVIDER = prev.prov;
}

test('handler: rejects non-POST', async () => {
  const res = new StubResponse();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('handler: 400 when image or mask missing', async () => {
  const res = new StubResponse();
  await handler({ method: 'POST', body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('handler: 400 when mode is not "ai"', async () => {
  const res = new StubResponse();
  await handler({ method: 'POST', body: { imageBase64: 'a', maskBase64: 'b', mode: 'local' } }, res);
  assert.equal(res.statusCode, 400);
});

test('handler: 200 with provider metadata on success', async () => {
  await withMockProvider('ok', async () => {
    const res = new StubResponse();
    await handler({
      method: 'POST',
      body: {
        imageBase64: 'a', maskBase64: 'b',
        size: '1024x1024', strength: 'medium',
      },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.provider, 'mock');
    assert.equal(res.body.mode, 'ai');
    assert.equal(res.body.strength, 'medium');
    assert.ok(res.body.imageBase64.length > 0);
    assert.ok(res.body.blend);
  });
});

test('handler: error response carries fallback=null when feature flag is off', async () => {
  await withMockProvider('throw', async () => {
    const res = new StubResponse();
    delete process.env.HEADLIGHT_AI_FALLBACK_LOCAL;
    await handler({
      method: 'POST',
      body: { imageBase64: 'a', maskBase64: 'b', size: '1024x1024' },
    }, res);
    assert.ok(res.statusCode >= 500);
    assert.equal(res.body.fallback, null);
    assert.equal(res.body.blend, null);
  });
});

test('handler: error response carries fallback="local" when HEADLIGHT_AI_FALLBACK_LOCAL=true', async () => {
  await withMockProvider('throw', async () => {
    const res = new StubResponse();
    process.env.HEADLIGHT_AI_FALLBACK_LOCAL = 'true';
    await handler({
      method: 'POST',
      body: { imageBase64: 'a', maskBase64: 'b', size: '1024x1024' },
    }, res);
    assert.equal(res.body.fallback, 'local');
    assert.ok(res.body.blend, 'blend params returned for client compositing');
    delete process.env.HEADLIGHT_AI_FALLBACK_LOCAL;
  });
});
