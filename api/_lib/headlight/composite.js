// Server-side validation that the AI returned an image we can safely composite.
//
// The actual blending happens client-side (canvas) because the source image
// is already on the client. This file is the "guard rail" that:
//   - decodes the PNG dimensions returned by the AI
//   - rejects responses whose size differs from the input we sent
//   - exposes a pure helper that selects what fraction of the output we
//     should keep — used for the final blend.

import { resolveStrength } from './prompts.js';

/**
 * Inspect a PNG signature/IHDR and return its dimensions.
 * Returns null if the buffer isn't a PNG we can parse.
 */
export function readPngSize(base64) {
  try {
    const buf = Buffer.from(base64, 'base64');
    // PNG: 8-byte signature + IHDR chunk starting at offset 8.
    // IHDR layout: length(4) | "IHDR"(4) | width(4) | height(4) | ...
    if (buf.length < 24) return null;
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * Compare the AI output dimensions against the request's expected size string
 * ("WxH"). Tolerance accounts for providers that round to multiples of 8/16.
 */
export function dimensionsMatch(out, expected, tolerance = 16) {
  if (!out || !expected) return false;
  const m = /^(\d+)x(\d+)$/.exec(expected);
  if (!m) return false;
  const expW = Number(m[1]);
  const expH = Number(m[2]);
  return Math.abs(out.width - expW) <= tolerance
      && Math.abs(out.height - expH) <= tolerance;
}

/**
 * Build the blend descriptor that the front-end uses when re-compositing
 * the AI result on top of the original. Centralized here so any provider
 * keeps the same look & feel.
 */
export function blendParamsFor(strength) {
  const preset = resolveStrength(strength);
  return {
    expandOuter: 0.065,    // outer alpha mask (feathered)
    expandInner: 0.035,    // inner alpha mask (full opacity)
    edgeBlur: 0.0025,      // relative blur on the alpha edges
    aiOpacity: preset.label === 'low' ? 0.85 : 1.0,
  };
}
