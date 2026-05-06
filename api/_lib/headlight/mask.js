// Headlight mask geometry helpers.
//
// The actual rasterization happens client-side in App.jsx (where a canvas
// already exists). The functions here are pure JS and used:
//   - to validate normalized headlight bounding boxes / polygons coming from
//     the detector,
//   - to compute the safe expanded mask region in normalized coords,
//   - by tests, without needing a DOM.
//
// We never let the mask touch:
//   - license plate area
//   - bumper / body / wheels / windshield
//   - background
// → The detector returns tight headlight polygons; we only feather a few
//   percent around them. We also clip to a safe band that excludes the bottom
//   of the image (where the plate usually sits).

const PLATE_GUARD_BOTTOM = 0.92;  // do not extend mask below this normalized Y
const ROOF_GUARD_TOP     = 0.05;  // do not extend mask above this normalized Y

export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function normalizeHeadlight(light) {
  const x1 = clamp01(light?.x);
  const y1 = clamp01(light?.y);
  const x2 = clamp01(Number(light?.x) + Number(light?.w));
  const y2 = clamp01(Number(light?.y) + Number(light?.h));
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(0, Math.abs(x2 - x1));
  const h = Math.max(0, Math.abs(y2 - y1));
  const points = Array.isArray(light?.points)
    ? light.points
        .map((p) => Array.isArray(p)
          ? { x: clamp01(p[0]), y: clamp01(p[1]) }
          : { x: clamp01(p?.x), y: clamp01(p?.y) })
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    : [];

  return { x, y, w, h, points };
}

export function isMeaningfulHeadlight(light) {
  const minSize = 0.015;
  return light && light.w >= minSize && light.h >= minSize;
}

/**
 * Expand each polygon point outward from the bbox center by `expand` (0..1).
 * Used to feather the mask without spilling onto the surrounding car body.
 */
export function expandLightPoints(light, expand = 0.04) {
  const cx = light.x + light.w / 2;
  const cy = light.y + light.h / 2;
  const expandPoint = (p) => ({
    x: clamp01(cx + (p.x - cx) * (1 + expand)),
    y: clamp01(cy + (p.y - cy) * (1 + expand)),
  });

  if (light.points.length >= 3) {
    return { ...light, points: light.points.map(expandPoint) };
  }
  // Fallback: synthesize an ellipse polygon so the mask has a curved edge.
  const rx = (light.w / 2) * (1 + expand);
  const ry = (light.h / 2) * (1 + expand);
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    pts.push({ x: clamp01(cx + Math.cos(t) * rx), y: clamp01(cy + Math.sin(t) * ry) });
  }
  return { ...light, points: pts };
}

/**
 * Drop any light whose mask would intrude on the plate guard band or the
 * top sky band. Lights are returned with all coordinates clamped.
 */
export function filterToSafeBand(lights) {
  return lights
    .map(normalizeHeadlight)
    .filter(isMeaningfulHeadlight)
    .filter((l) => l.y > ROOF_GUARD_TOP && (l.y + l.h) < PLATE_GUARD_BOTTOM);
}

/**
 * Pure helpers used by the front-end mask drawer to know the feather radii.
 */
export function maskFeatherRadii({ workW, workH }) {
  const min = Math.max(1, Math.min(workW, workH));
  return {
    soft: Math.max(2, Math.round(min * 0.003)),
    blendOuter: Math.max(3, Math.round(min * 0.0025)),
  };
}

export const MASK_GUARDS = { PLATE_GUARD_BOTTOM, ROOF_GUARD_TOP };
