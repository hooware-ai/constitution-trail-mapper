/** Spacing of direction chevrons along a line, in screen pixels (native stamps them about every 110 px). */
export const CHEVRON_SPACING_PX = 110;

export interface Chevron {
  x: number;
  y: number;
  /** Direction of travel in screen space, radians (0 = right, positive = clockwise because screen y grows downward). */
  angle: number;
}

/**
 * Chevrons every `spacing` pixels along a projected polyline, the first half a spacing in, each facing travel. The same
 * placement native uses for its share image (TrailRouteShareCueGeometry.chevronsAlong), on screen coordinates.
 */
export function chevronsAlong(
  points: { x: number; y: number }[],
  spacing = CHEVRON_SPACING_PX,
): Chevron[] {
  const found: Chevron[] = [];
  let next = spacing / 2;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const angle = Math.atan2(dy, dx);
    while (next <= travelled + length) {
      const ratio = (next - travelled) / length;
      found.push({
        x: points[i - 1].x + dx * ratio,
        y: points[i - 1].y + dy * ratio,
        angle,
      });
      next += spacing;
    }
    travelled += length;
  }
  return found;
}
