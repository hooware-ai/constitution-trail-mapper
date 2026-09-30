export function scaledList(
  count?: number,
  vertices?: number,
  columns?: number,
): Array<[string, string, string[], number[][][]]>;
export function makeCounty(options?: {
  reviewedOn?: string;
  excluded?: number[];
  list?: Array<[string, string, string[], number[][][]]>;
}): {
  manifest: any;
  input: any;
  approval: any;
};
