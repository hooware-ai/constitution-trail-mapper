import type { MapCues, Point, RouteResult } from "./types";

/** Keep the route under the ridden overlay, including offset return passes. */
export function rideRoutePaths(
  route: RouteResult | null,
  cues: MapCues | null,
): {
  mapped: Point[][];
  access: Point[][];
} {
  const drawn = cues
    ? cues.pieces.filter((piece) => piece.isRouted)
    : (route?.segments ?? []);
  return {
    mapped: drawn
      .filter((piece) => piece.type !== "Access")
      .map((piece) => piece.points),
    access: drawn
      .filter((piece) => piece.type === "Access")
      .map((piece) => piece.points),
  };
}
