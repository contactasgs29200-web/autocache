// Shared prompts and parameter mapping for headlight restoration.
//
// Primary mode is FULL-IMAGE edit: we send the whole car photo with a mask
// covering only the front headlights and ask the model to restore them
// without touching anything else. The prompt below is intentionally very
// strict and reads like the user's reference ChatGPT prompt:
//   "sur cette voiture, rends ces optiques moins jaunis et plus
//    transparents, sans modifier le reste de la photo".

export const DEFAULT_PROMPT = [
  'Edit this car photo.',
  'Make the front headlights less yellow, clearer, cleaner, and more transparent,',
  'as if professionally restored, while preserving the exact headlight model,',
  'shape, internal design, reflections, perspective, and alignment.',
  'Do not redesign, replace, or reinterpret the headlights.',
  'Do not modify the car body, bumper, grille, hood, paint color, wheels,',
  'windows, background, floor, wall, shadows, lighting, framing, camera angle,',
  'or any other part of the image.',
  'The result must look like the same original photo, with only the',
  'oxidation/yellowing of the front headlights reduced and the lenses appearing',
  'cleaner and more transparent.',
].join(' ');

// Used on the second attempt when the first full-image edit failed validation
// (typically because the model touched something outside the headlights).
// Doubles down on the "do not change anything else" instruction.
export const STRICT_RETRY_PROMPT = [
  'Restore ONLY the polycarbonate lens covers of the front headlights:',
  'remove the yellow oxidation, make them clearer, cleaner and more transparent.',
  'Do NOT change anything else: the car body, paint color, bumper, grille, hood,',
  'wheels, license plate, windows, mirrors, background, ground, walls, shadows,',
  'lighting, framing and camera angle MUST remain pixel-identical to the input.',
  'Do NOT redesign or reinterpret the headlight shape or internal layout.',
  'Preserve the exact original headlight model, reflectors, bulbs and lens curvature.',
  'The output must be visually indistinguishable from the input outside the headlight lenses.',
].join(' ');

export const DEFAULT_NEGATIVE_PROMPT = [
  'different headlight design',
  'altered headlight shape',
  'changed car body',
  'changed bumper',
  'changed grille',
  'changed paint color',
  'changed background',
  'changed framing',
  'changed license plate',
  'fake headlight',
  'distorted geometry',
  'unrealistic lighting',
  'artifacts',
  'blurry result',
  'painted-over panel',
  'grey blob',
].join(', ');

// Strength controls how aggressive the model is allowed to redraw the masked area.
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
