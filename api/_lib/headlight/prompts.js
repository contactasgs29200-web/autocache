// Shared prompts and parameter mapping for headlight restoration.
// Kept in a single file so every provider speaks the same product language.

export const DEFAULT_PROMPT = [
  'Restore the car headlights only.',
  'Make the headlight lenses crystal clear, transparent, glossy and realistic,',
  'with depth, internal reflectors, bulbs, natural highlights and reflections',
  'on the polycarbonate/glass surface.',
  'Preserve the exact shape, perspective, reflections, lighting and surrounding car body.',
  'Remove yellow oxidation and cloudy haze.',
  'Do not change the car body, license plate, background, wheels or paint.',
  'Photorealistic automotive photography.',
].join(' ');

export const DEFAULT_NEGATIVE_PROMPT = [
  'white opaque headlights',
  'flat white pixels',
  'cartoon',
  'unrealistic',
  'changed car body',
  'changed license plate',
  'distorted car shape',
  'overexposed',
  'blurry',
  'artifacts',
].join(', ');

// Strength controls how aggressive the model is allowed to redraw the masked area.
// Each provider maps this to its own knob (image_edit quality, denoising strength, etc.)
export const STRENGTH_PRESETS = {
  low:    { label: 'low',    denoise: 0.55, openaiQuality: 'low'    },
  medium: { label: 'medium', denoise: 0.75, openaiQuality: 'medium' },
  high:   { label: 'high',   denoise: 0.92, openaiQuality: 'high'   },
};

export function resolveStrength(strength) {
  if (typeof strength === 'string' && STRENGTH_PRESETS[strength]) {
    return STRENGTH_PRESETS[strength];
  }
  return STRENGTH_PRESETS.medium;
}
