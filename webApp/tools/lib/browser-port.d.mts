export const COUNTY_BROWSER_PORT_COUNT: 6;
export function browserPort(value: unknown, label?: string): number;
export function browserPortRange(
  value: unknown,
  count: number,
  label?: string,
): number;
export function freeBrowserPortRange(
  count?: number,
  nextCandidate?: () => Promise<number>,
): Promise<number>;
