import type { AccessGap } from "./types";

/**
 * The connections the rider is asked to check: those BETWEEN mapped parts of the route. The start and destination (or loop
 * return) connections are obvious and are not announced as notices, but they stay in the route data, count in warnings, and are
 * drawn dashed on the map.
 */
export function connectionsToCheck(gaps: AccessGap[]): AccessGap[] {
  return gaps.filter((gap) => gap.kind !== "endpoint");
}

export function gapDistance(meters: number): string {
  const feet = meters / 0.3048;
  if (feet < 1) return "<1 ft";
  if (meters >= 1609.344) return `${(meters / 1609.344).toFixed(1)} mi`;
  return `${Math.round(feet).toLocaleString("en-US")} ft`;
}
