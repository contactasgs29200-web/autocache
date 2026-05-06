// End-to-end orchestrator behavior — uses an in-process mock provider
// (no network), verifies dimension validation and error propagation.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  restoreHeadlights,
  ProviderConfigError,
  ProviderRequestError,
} from '../api/_lib/headlight/index.js';
import { HeadlightRestorationProvider } from '../api/_lib/headlight/providers/base.js';
import { __registry } from '../api/_lib/headlight/providers/index.js';
import { readPngSize, dimensionsMatch } from '../api/_lib/headlight/composite.js';

// Tiny 4x4 transparent PNG built byte-by-byte. We only need a valid IHDR,
// so we generate one with the requested dimensions on demand.
function fakePngBase64(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;       // bit depth
  ihdrData[9] = 6;       // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(ihdrData.length, 0);
  const ihdrCrc = Buffer.alloc(4);  // placeholder — we don't verify CRC
  const buf = Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, ihdrCrc]);
  return buf.toString('base64');
}

class MockProvider extends HeadlightRestorationProvider {
  get name() { return 'mock'; }
  get defaultModel() { return 'mock-1'; }
  constructor(cfg) {
    super(cfg);
    this.calls = [];
    this.behavior = cfg.behavior || 'ok-1024';
  }
  async restoreHeadlightsWithAI(req) {
    this.calls.push(req);
    if (this.behavior === 'throw') {
      throw new ProviderRequestError('mock failure', 502);
    }
    if (this.behavior === 'wrong-size') {
      return { imageBase64: fakePngBase64(512, 512), model: this.model };
    }
    return { imageBase64: fakePngBase64(1024, 1024), model: this.model };
  }
}

function withMockProvider(behavior, run) {
  const original = __registry.openai;
  __registry.openai = class extends MockProvider {
    constructor(cfg) { super({ ...cfg, behavior }); }
  };
  try {
    return run();
  } finally {
    __registry.openai = original;
  }
}

test('restoreHeadlights: happy path returns image + provider metadata', async () => {
  await withMockProvider('ok-1024', async () => {
    const out = await restoreHeadlights({
      imageBase64: 'aGVsbG8=',
      maskBase64: 'bWFzaw==',
      size: '1024x1024',
      strength: 'high',
      env: { HEADLIGHT_AI_API_KEY: 'k' },
    });
    assert.equal(out.provider, 'mock');
    assert.equal(out.strength, 'high');
    assert.ok(out.imageBase64.length > 0);
    assert.equal(typeof out.blend.expandOuter, 'number');
  });
});

test('restoreHeadlights: rejects mismatched output dimensions', async () => {
  await withMockProvider('wrong-size', async () => {
    await assert.rejects(
      () => restoreHeadlights({
        imageBase64: 'a', maskBase64: 'b',
        size: '1024x1024',
        env: { HEADLIGHT_AI_API_KEY: 'k' },
      }),
      ProviderRequestError,
    );
  });
});

test('restoreHeadlights: when AI disabled, throws ProviderConfigError', async () => {
  await assert.rejects(
    () => restoreHeadlights({
      imageBase64: 'a', maskBase64: 'b',
      env: { HEADLIGHT_AI_ENABLED: 'false' },
    }),
    ProviderConfigError,
  );
});

test('restoreHeadlights: surfaces provider request errors', async () => {
  await withMockProvider('throw', async () => {
    await assert.rejects(
      () => restoreHeadlights({
        imageBase64: 'a', maskBase64: 'b',
        env: { HEADLIGHT_AI_API_KEY: 'k' },
      }),
      ProviderRequestError,
    );
  });
});

test('readPngSize parses width/height from a valid IHDR', () => {
  const size = readPngSize(fakePngBase64(800, 600));
  assert.deepEqual(size, { width: 800, height: 600 });
});

test('dimensionsMatch tolerates rounding to 16px', () => {
  assert.equal(dimensionsMatch({ width: 1024, height: 1024 }, '1024x1024'), true);
  assert.equal(dimensionsMatch({ width: 1024, height: 1024 }, '1040x1040'), true);
  assert.equal(dimensionsMatch({ width: 512, height: 512 }, '1024x1024'), false);
});
