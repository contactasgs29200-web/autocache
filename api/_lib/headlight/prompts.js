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

// Used by the second-pass per-optic REFINE step that runs AFTER the
// full-image edit. The prompt is scoped to a tight crop containing one
// headlight and is meant to add sharpness / transparency without any
// redesign. Combined with a shrunk mask and the anti-artifact validator,
// this is the "polish" pass that gives the premium feel.
export const REFINE_PROMPT = [
  'Refine only this car headlight lens.',
  'Make it clearer, sharper, more transparent and professionally polished',
  'while preserving the exact original headlight shape, internal reflector details,',
  'lens geometry, perspective, highlights and surrounding bodywork.',
  'Remove yellow oxidation, haze and cloudiness.',
  'Do not redesign the headlight, do not change its shape, do not add black lines,',
  'seams, borders, scratches, shadows, stickers, fake reflections, blur or artifacts.',
  'The result must remain photorealistic and match the original car.',
].join(' ');

export const REFINE_NEGATIVE_PROMPT = [
  'blurred headlight',
  'soft details',
  'redesigned headlight',
  'different headlight model',
  'black line',
  'black seam',
  'dark border',
  'artificial outline',
  'gray patch',
  'visible cutout',
  'halo',
  'sticker',
  'distorted geometry',
  'changed bodywork',
  'changed paint',
  'changed bumper',
  'artifacts',
].join(', ');

export const LENS_PROMPT_SUFFIX = [
  'Modify only the transparent headlight lens interior.',
  'Do not repaint any circular area around the headlight.',
  'Do not alter hood, fender, bumper, paint, panel gaps or reflections.',
  'No halo, no circular patch, no oval repaint, no seam, no dark border.',
].join(' ');

export const LENS_NEGATIVE_PROMPT_ADDITIONS = [
  'halo around headlight',
  'circular repaint',
  'oval patch',
  'repainted rim',
  'dark border around lens',
  'visible mask boundary',
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
