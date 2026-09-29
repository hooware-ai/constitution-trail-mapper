export function gapDistance(meters: number): string {
  const feet = meters / 0.3048;
  if (feet < 1) return "<1 ft";
  if (meters >= 1609.344) return `${(meters / 1609.344).toFixed(1)} mi`;
  return `${Math.round(feet).toLocaleString("en-US")} ft`;
}
