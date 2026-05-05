// Provider factory + env wiring.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveProviderConfig,
  getProvider,
  fallbackLocalEnabled,
  listProviders,
} from '../api/_lib/headlight/providers/index.js';
import { OpenAIHeadlightProvider } from '../api/_lib/headlight/providers/openai.js';
import { ReplicateHeadlightProvider } from '../api/_lib/headlight/providers/replicate.js';
import { StabilityHeadlightProvider } from '../api/_lib/headlight/providers/stability.js';
import { ProviderConfigError } from '../api/_lib/headlight/providers/base.js';

test('listProviders exposes openai/replicate/stability', () => {
  const list = listProviders().sort();
  assert.deepEqual(list, ['openai', 'replicate', 'stability']);
});

test('resolveProviderConfig defaults to openai when env is empty', () => {
  const cfg = resolveProviderConfig({ HEADLIGHT_AI_API_KEY: 'sk-test' });
  assert.equal(cfg.name, 'openai');
  assert.equal(cfg.apiKey, 'sk-test');
  assert.equal(cfg.model, null);
});

test('resolveProviderConfig returns null when AI is disabled', () => {
  const cfg = resolveProviderConfig({
    HEADLIGHT_AI_ENABLED: 'false',
    HEADLIGHT_AI_API_KEY: 'sk-test',
  });
  assert.equal(cfg, null);
});

test('resolveProviderConfig throws on unknown provider', () => {
  assert.throws(
    () => resolveProviderConfig({ HEADLIGHT_AI_PROVIDER: 'midjourney', HEADLIGHT_AI_API_KEY: 'k' }),
    ProviderConfigError,
  );
});

test('resolveProviderConfig throws when api key is missing', () => {
  assert.throws(
    () => resolveProviderConfig({ HEADLIGHT_AI_PROVIDER: 'replicate' }),
    ProviderConfigError,
  );
});

test('resolveProviderConfig falls back to provider-specific keys', () => {
  // No HEADLIGHT_AI_API_KEY but OPENAI_API_KEY present
  const openai = resolveProviderConfig({ OPENAI_API_KEY: 'sk-openai' });
  assert.equal(openai.apiKey, 'sk-openai');

  // Replicate uses REPLICATE_API_TOKEN
  const replicate = resolveProviderConfig({
    HEADLIGHT_AI_PROVIDER: 'replicate',
    REPLICATE_API_TOKEN: 'r8_xxx',
  });
  assert.equal(replicate.apiKey, 'r8_xxx');

  // Stability uses STABILITY_API_KEY
  const stability = resolveProviderConfig({
    HEADLIGHT_AI_PROVIDER: 'stability',
    STABILITY_API_KEY: 'st-xxx',
  });
  assert.equal(stability.apiKey, 'st-xxx');
});

test('getProvider instantiates the correct class for each provider', () => {
  assert.ok(getProvider({ HEADLIGHT_AI_API_KEY: 'k' }) instanceof OpenAIHeadlightProvider);
  assert.ok(getProvider({ HEADLIGHT_AI_PROVIDER: 'replicate', HEADLIGHT_AI_API_KEY: 'k' })
    instanceof ReplicateHeadlightProvider);
  assert.ok(getProvider({ HEADLIGHT_AI_PROVIDER: 'stability', HEADLIGHT_AI_API_KEY: 'k' })
    instanceof StabilityHeadlightProvider);
});

test('fallbackLocalEnabled defaults to false', () => {
  assert.equal(fallbackLocalEnabled({}), false);
  assert.equal(fallbackLocalEnabled({ HEADLIGHT_AI_FALLBACK_LOCAL: 'true' }), true);
  assert.equal(fallbackLocalEnabled({ HEADLIGHT_AI_FALLBACK_LOCAL: 'TRUE' }), true);
  assert.equal(fallbackLocalEnabled({ HEADLIGHT_AI_FALLBACK_LOCAL: 'no' }), false);
});

test('provider model defaults can be overridden via env', () => {
  const a = getProvider({ HEADLIGHT_AI_API_KEY: 'k' });
  assert.equal(a.model, 'gpt-image-1');
  const b = getProvider({ HEADLIGHT_AI_API_KEY: 'k', HEADLIGHT_AI_MODEL: 'gpt-image-1-mini' });
  assert.equal(b.model, 'gpt-image-1-mini');
});

test('provider constructor refuses missing api key', () => {
  assert.throws(() => new OpenAIHeadlightProvider({}), /API key/);
});
