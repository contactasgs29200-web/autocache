// Per-headlight crop geometry helpers — pure JS, no DOM required.
//
// Why per-headlight crops?
// Sending the whole car to the inpainting API gave the model too much
// freedom: it could (and did) redesign one headlight to a different model,
// or skip restoring one of the two. By cropping tightly around each
// headlight and asking the model to restore that ONE optic, the
// surrounding context is too constrained to "redesign" anything, and each
// optic is treated identically and independently.
//
// Geometry pipeline:
//   1. Take the headlight bbox (normalized 0..1) + source W×H pixels.
//   2. Add `margin` (default 60%) on each side for context.
//   3. Snap the resulting aspect to one of OpenAI's supported edit sizes
//      (1024x1024, 1024x1536, 1536x1024) by EXPANDING the smaller dimension.
//   4. Clamp the crop to the image bounds.
//   5. After clamping, re-pick the closest supported size (clamping may
//      have shifted the aspect).

import { snapOpenAISize, OPENAI_SUPPORTED_SIZES } from './providers/openai.js';

const TARGET_SIZES = {
  square:    { aspect: 1.0,  size: '1024x1024', workW: 1024, workH: 1024 },
  landscape: { aspect: 1.5,  size: '1536x1024', workW: 1536, workH: 1024 },
  portrait:  { aspect: 2 / 3, size: '1024x1536', workW: 1024, workH: 1536 },
};

function pickAspect(ratio) {
  if (ratio > 1.2)  return TARGET_SIZES.landscape;
  if (ratio < 0.83) return TARGET_SIZES.portrait;
  return TARGET_SIZES.square;
}

/**
 * Compute the source-pixel crop box for a single headlight.
 *
 * @param {{x:number,y:number,w:number,h:number}} light  normalized (0..1) in source W×H
 * @param {number} W source image width  (px)
 * @param {number} H source image height (px)
 * @param {number} [margin=0.6] extra context fraction added on each side
 * @returns {{
 *   sourceX:number, sourceY:number, sourceW:number, sourceH:number,
 *   workW:number, workH:number, size:string,
 * }}
 */
export function computeLightCrop(light, W, H, margin = 0.6) {
  const bx = light.x * W;
  const by = light.y * H;
  const bw = Math.max(1, light.w * W);
  const bh = Math.max(1, light.h * H);
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  // 1. expand bbox by margin on each side (margin = total extra fraction).
  let cropW = bw * (1 + margin);
  let cropH = bh * (1 + margin);

  // 2. snap to OpenAI aspect by EXPANDING (never shrink — would crop the optic).
  let pick = pickAspect(cropW / cropH);
  if (cropW / cropH > pick.aspect) {
    cropH = cropW / pick.aspect;
  } else {
    cropW = cropH * pick.aspect;
  }

  // 3. center on the headlight, clamp to image bounds (preserve as much
  //    context as possible by shifting before clamping).
  let sx = Math.round(cx - cropW / 2);
  let sy = Math.round(cy - cropH / 2);
  let sw = Math.round(cropW);
  let sh = Math.round(cropH);

  // Shift to keep crop inside image when one edge is off
  if (sx < 0) { sx = 0; }
  if (sy < 0) { sy = 0; }
  if (sx + sw > W) sx = Math.max(0, W - sw);
  if (sy + sh > H) sy = Math.max(0, H - sh);

  // If the crop is still larger than the image (very small source), clamp.
  if (sw > W) { sx = 0; sw = W; }
  if (sh > H) { sy = 0; sh = H; }

  // 4. re-pick supported size based on the (possibly clamped) aspect.
  pick = pickAspect(sw / sh);

  return {
    sourceX: sx,
    sourceY: sy,
    sourceW: sw,
    sourceH: sh,
    workW: pick.workW,
    workH: pick.workH,
    size: pick.size,
  };
}

/**
 * Transform a headlight (normalized in source W×H) into normalized
 * coordinates relative to a crop's source rectangle. Used so the mask
 * builder draws the polygon at the right spot inside the crop canvas.
 */
export function transformLightToCrop(light, crop, W, H) {
  const lx = (light.x * W - crop.sourceX) / crop.sourceW;
  const ly = (light.y * H - crop.sourceY) / crop.sourceH;
  const lw = (light.w * W) / crop.sourceW;
  const lh = (light.h * H) / crop.sourceH;
  const points = (light.points || []).map((p) => ({
    x: (p.x * W - crop.sourceX) / crop.sourceW,
    y: (p.y * H - crop.sourceY) / crop.sourceH,
  }));
  return { x: lx, y: ly, w: lw, h: lh, points };
}

// Re-export so callers can validate sizes without reaching into providers/.
export { snapOpenAISize, OPENAI_SUPPORTED_SIZES };
