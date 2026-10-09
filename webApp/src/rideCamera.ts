import type { LocationFix } from "./platform/navigation";

export type RideHeading = { bearing: number | null; anchor: LocationFix };

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (radians: number) => (radians * 180) / Math.PI;
const normalize = (bearing: number) => ((bearing % 360) + 360) % 360;

export function distanceBetween(a: LocationFix, b: LocationFix): number {
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const x =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Browser heading is only useful while moving; a noisy stationary GPS fix must not spin the map. */
export function nextRideHeading(
  previous: RideHeading | null,
  fix: LocationFix,
): RideHeading {
  const reported = fix.heading;
  if (
    typeof reported === "number" &&
    Number.isFinite(reported) &&
    typeof fix.speed === "number" &&
    fix.speed >= 1.5 &&
    fix.accuracy <= 35
  )
    return { bearing: normalize(reported), anchor: fix };

  if (!previous) return { bearing: null, anchor: fix };
  const elapsed = fix.timestamp - previous.anchor.timestamp;
  const moved = distanceBetween(previous.anchor, fix);
  const threshold = Math.max(12, previous.anchor.accuracy + fix.accuracy);
  const impliedSpeed = elapsed > 0 ? moved / (elapsed / 1000) : 0;
  if (
    elapsed >= 1000 &&
    elapsed <= 20000 &&
    moved >= threshold &&
    impliedSpeed >= 1.5 &&
    impliedSpeed <= 15 &&
    (typeof fix.speed !== "number" || fix.speed >= 1.5) &&
    fix.accuracy <= 35
  ) {
    const y =
      Math.sin(radians(fix.longitude - previous.anchor.longitude)) *
      Math.cos(radians(fix.latitude));
    const x =
      Math.cos(radians(previous.anchor.latitude)) *
        Math.sin(radians(fix.latitude)) -
      Math.sin(radians(previous.anchor.latitude)) *
        Math.cos(radians(fix.latitude)) *
        Math.cos(radians(fix.longitude - previous.anchor.longitude));
    return { bearing: normalize(degrees(Math.atan2(y, x))), anchor: fix };
  }
  // Keep a trusted heading while stationary. Refresh an old anchor so an eventual GPS jump cannot claim a direction.
  return {
    bearing: previous.bearing,
    anchor: elapsed > 20000 ? fix : previous.anchor,
  };
}

/** Pick the shortest rotation across north (359° to 1° is two degrees). */
export function nearestBearing(current: number, target: number): number {
  const delta = ((target - current + 540) % 360) - 180;
  return current + delta;
}
