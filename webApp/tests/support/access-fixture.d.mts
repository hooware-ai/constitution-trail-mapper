export const accessPlaces: Record<
  "start" | "end",
  { label: string; latitude: number; longitude: number }
>;
export function makeAccessExtract(): {
  job: string;
  layers: { id: string; name: string; features: any[] }[];
};
export const closureTrailEntry: [string, string, string[], number[][][]];
