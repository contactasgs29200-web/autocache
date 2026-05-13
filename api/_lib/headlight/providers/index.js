// Provider factory. Reads config from env (or an explicit overrides object
// for tests) and returns a ready-to-use HeadlightRestorationProvider.
import { ProviderConfigError } from './base.js';
import { OpenAIHeadlightProvider } from './openai.js';
import { ReplicateHeadlightProvider } from './replicate.js';
import { StabilityHeadlightProvider } from './stability.js';

const REGISTRY = {
  openai: OpenAIHeadlightProvider,
  replicate: ReplicateHeadlightProvider,
  stability: StabilityHeadlightProvider,
};

export function listProviders() {
  return Object.keys(REGISTRY);
}

/**
 * Resolve provider config from env (or `overrides` for tests).
 *
 *   HEADLIGHT_AI_PROVIDER  openai | replicate | stability
 *   HEADLIGHT_AI_API_KEY   per-provider API key (preferred). Falls back to
 *                          provider-specific defaults if not set:
 *                            - openai     → OPENAI_API_KEY
 *                            - replicate  → REPLICATE_API_TOKEN
 *                            - stability  → STABILITY_API_KEY
 *   HEADLIGHT_AI_MODEL     model id (provider-specific)
 *   HEADLIGHT_AI_ENABLED   "false" disables the AI pipeline
 *
 * Returns `null` when AI is explicitly disabled.
 */
export function resolveProviderConfig(env = process.env, overrides = {}) {
  const enabled = (env.HEADLIGHT_AI_ENABLED ?? 'true').toString().toLowerCase() !== 'false';
  if (!enabled && !overrides.force) return null;

  const name = (overrides.provider || env.HEADLIGHT_AI_PROVIDER || 'openai').toLowerCase();
  if (!REGISTRY[name]) {
    throw new ProviderConfigError(
      `Unknown HEADLIGHT_AI_PROVIDER "${name}". Supported: ${listProviders().join(', ')}`,
    );
  }

  const apiKey = overrides.apiKey
    || env.HEADLIGHT_AI_API_KEY
    || providerSpecificKey(name, env);
  if (!apiKey) {
    throw new ProviderConfigError(
      `Missing API key for provider "${name}". Set HEADLIGHT_AI_API_KEY.`,
    );
  }

  const model = overrides.model || env.HEADLIGHT_AI_MODEL || null;
  return { name, apiKey, model };
}

export function getProvider(env = process.env, overrides = {}) {
  const cfg = resolveProviderConfig(env, overrides);
  if (!cfg) return null;
  const Cls = REGISTRY[cfg.name];
  return new Cls({ apiKey: cfg.apiKey, model: cfg.model });
}

export function fallbackLocalEnabled(env = process.env) {
  return (env.HEADLIGHT_AI_FALLBACK_LOCAL ?? 'false').toString().toLowerCase() === 'true';
}

function providerSpecificKey(name, env) {
  if (name === 'openai') return env.OPENAI_API_KEY;
  if (name === 'replicate') return env.REPLICATE_API_TOKEN || env.REPLICATE_API_KEY;
  if (name === 'stability') return env.STABILITY_API_KEY;
  return null;
}

// Exposed for tests so the registry can be patched without import gymnastics.
export const __registry = REGISTRY;
