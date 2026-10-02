import type { MapCuePiece, Point } from "./types";

/**
 * The drawn geometry already ridden at `progress` (navigation distance), one continuous polyline per piece, exactly as
 * native computes it (TrailRouteMapCues.riddenPolylines): a ridden second pass follows its own offset line, so the overlay
 * covers the line the rider sees.
 */
export function riddenPolylines(
  pieces: MapCuePiece[],
  progress: number,
): Point[][] {
  if (!(progress > 0)) return [];
  const lines: Point[][] = [];
  for (const piece of pieces) {
    const { points, distances } = piece;
    if (points.length < 2 || distances.length !== points.length) continue;
    if (distances[0] >= progress) continue;
    const ridden: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      if (distances[i] <= progress) {
        ridden.push(points[i]);
        continue;
      }
      const span = distances[i] - distances[i - 1];
      const ratio = span > 0 ? (progress - distances[i - 1]) / span : 0;
      ridden.push({
        latitude:
          points[i - 1].latitude +
          (points[i].latitude - points[i - 1].latitude) * ratio,
        longitude:
          points[i - 1].longitude +
          (points[i].longitude - points[i - 1].longitude) * ratio,
      });
      break;
    }
    if (ridden.length >= 2) lines.push(ridden);
  }
  return lines;
}

/** Length of a polyline in metres (equirectangular, ample at route scale). */
export function lengthMeters(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    total +=
      Math.hypot(
        (b.longitude - a.longitude) *
          Math.cos(((a.latitude + b.latitude) / 2) * (Math.PI / 180)),
        b.latitude - a.latitude,
      ) * 111_320;
  }
  return total;
}
