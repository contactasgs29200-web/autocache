// Shared prompts and parameter mapping for headlight restoration.
// The pipeline now sends ONE crop per headlight (not the whole car) so the
// prompt is phrased in the singular: the model sees one optic and is told to
// restore it without redesigning anything around it.

export const DEFAULT_PROMPT = [
  'On this car, make the headlight in this image less yellow and more transparent,',
  'without changing the rest of the photo.',
  'Preserve the exact original headlight model, shape, internal design,',
  'perspective, reflections, and surrounding bodywork.',
  'Only restore the lens so it looks clearer, cleaner, and less oxidized.',
  'Do not redesign the headlight.',
].join(' ');

export const DEFAULT_NEGATIVE_PROMPT = [
  'different headlight design',
  'altered headlight shape',
  'changed car body',
  'changed bumper',
  'changed grille',
  'changed license plate',
  'fake headlight',
  'distorted geometry',
  'unrealistic lighting',
  'artifacts',
  'blurry result',
].join(', ');

// Strength controls how aggressive the model is allowed to redraw the masked area.
// `openaiQuality`  → /v1/images/edits `quality`        (image detail)
// `openaiFidelity` → /v1/images/edits `input_fidelity` (preserve input look)
//
// "restore" is the new default for the per-headlight pipeline:
//   - high fidelity to keep the existing optic geometry
//   - medium quality to avoid the model re-imagining details
// "low/medium/high" are kept for callers who want more aggressive changes
// (full-frame use cases, future providers, etc.).
export const STRENGTH_PRESETS = {
  restore: { label: 'restore', denoise: 0.40, openaiQuality: 'medium', openaiFidelity: 'high' },
  low:     { label: 'low',     denoise: 0.55, openaiQuality: 'medium', openaiFidelity: 'high' },
  medium:  { label: 'medium',  denoise: 0.75, openaiQuality: 'high',   openaiFidelity: 'high' },
  high:    { label: 'high',    denoise: 0.90, openaiQuality: 'high',   openaiFidelity: 'low'  },
};

export const DEFAULT_STRENGTH = 'restore';

export function resolveStrength(strength) {
  if (typeof strength === 'string' && STRENGTH_PRESETS[strength]) {
    return STRENGTH_PRESETS[strength];
  }
  return STRENGTH_PRESETS[DEFAULT_STRENGTH];
}
