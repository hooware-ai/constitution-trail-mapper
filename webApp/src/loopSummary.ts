const METERS_PER_MILE = 1609.344;

/** Miles as native words them: whole numbers bare, one decimal when that is exact, otherwise two decimals. */
export function milesLabel(miles: number): string {
  const oneDecimal = Math.round(miles * 10) / 10;
  if (Math.abs(oneDecimal - miles) < 0.005) return String(oneDecimal);
  return String(Math.round(miles * 100) / 100);
}

/** For example "Requested 5 mi · Found 5.01 mi", so a near miss is plain rather than hidden (native's wording). */
export function loopComparison(
  requestedMeters: number,
  foundMeters: number,
): string {
  return `Requested ${milesLabel(requestedMeters / METERS_PER_MILE)} mi · Found ${milesLabel(foundMeters / METERS_PER_MILE)} mi`;
}

/** The loop result's heading: exact when the target was met, otherwise the closest loop that could be made. */
export const loopHeading = (targetMatched: boolean | undefined): string =>
  targetMatched === false ? "Closest available loop" : "Exercise loop ready";
