// Server-side validation of the AI return + diff helpers used to detect
// "no visible change" failures.

import { resolveStrength } from './prompts.js';

/**
 * Inspect a PNG signature/IHDR and return its dimensions.
 */
export function readPngSize(base64) {
  try {
    const buf = Buffer.from(base64, 'base64');
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

export function dimensionsMatch(out, expected, tolerance = 16) {
  if (!out || !expected) return false;
  const m = /^(\d+)x(\d+)$/.exec(expected);
  if (!m) return false;
  const expW = Number(m[1]);
  const expH = Number(m[2]);
  return Math.abs(out.width - expW) <= tolerance
      && Math.abs(out.height - expH) <= tolerance;
}

export function blendParamsFor(strength) {
  const preset = resolveStrength(strength);
  return {
    expandOuter: 0.065,
    expandInner: 0.035,
    edgeBlur: 0.0025,
    aiOpacity: preset.label === 'low' ? 0.85 : 1.0,
  };
}

/**
 * "No visible change" detector. The full pixel diff is computed CLIENT-SIDE
 * (where the original canvas already lives), but the server still does a
 * cheap byte-level signature comparison so it can refuse a response that's
 * literally identical to the input we sent.
 */
export function isLikelySameAsInput(inputBase64, outputBase64) {
  if (!inputBase64 || !outputBase64) return false;
  if (inputBase64 === outputBase64) return true;
  // Very cheap heuristic: same length & same first/last 64 bytes.
  if (Math.abs(inputBase64.length - outputBase64.length) > 4) return false;
  const head = inputBase64.slice(0, 64) === outputBase64.slice(0, 64);
  const tail = inputBase64.slice(-64) === outputBase64.slice(-64);
  return head && tail;
}
