// Shared prompts and parameter mapping for headlight restoration.
// Strong, directive prompt: the goal is a clearly visible restoration,
// not a subtle color correction.

export const DEFAULT_PROMPT = [
  'Reconstruct and restore only the car headlights.',
  'The current headlights are yellow, cloudy and oxidized.',
  'Make the lenses visibly crystal clear, transparent, glossy and renewed,',
  'like professionally restored headlights.',
  'Add realistic internal depth, lens reflections, clear plastic texture and sharp highlights.',
  'Remove yellow oxidation and foggy haze.',
  'Preserve the exact headlight shape, vehicle body, license plate, paint, wheels, background and perspective.',
  'The improvement must be clearly visible but photorealistic.',
].join(' ');

export const DEFAULT_NEGATIVE_PROMPT = [
  'unchanged headlights',
  'no visible difference',
  'yellow cloudy headlights',
  'white opaque headlights',
  'flat white pixels',
  'plastic blob',
  'changed license plate',
  'changed car paint',
  'distorted body',
  'artifacts',
  'cartoon',
  'overexposed',
].join(', ');

// Strength controls how aggressive the model is allowed to redraw the masked area.
// `openaiQuality` maps to /v1/images/edits `quality` (image detail).
// `openaiFidelity` maps to /v1/images/edits `input_fidelity`:
//    high → preserve the input look (subtle change)
//    low  → let the model diverge from the input (dramatic change)
// Default ("medium") leans toward visible change since the user asked for it.
export const STRENGTH_PRESETS = {
  low:    { label: 'low',    denoise: 0.55, openaiQuality: 'medium', openaiFidelity: 'high' },
  medium: { label: 'medium', denoise: 0.80, openaiQuality: 'high',   openaiFidelity: 'low'  },
  high:   { label: 'high',   denoise: 0.95, openaiQuality: 'high',   openaiFidelity: 'low'  },
};

export function resolveStrength(strength) {
  if (typeof strength === 'string' && STRENGTH_PRESETS[strength]) {
    return STRENGTH_PRESETS[strength];
  }
  return STRENGTH_PRESETS.medium;
}
