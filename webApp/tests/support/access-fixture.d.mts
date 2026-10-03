export const accessPlaces: Record<
  "start" | "end",
  { label: string; latitude: number; longitude: number }
>;
export function makeAccessExtract(): {
  job: string;
  layers: { id: string; name: string; features: any[] }[];
};
export const closureTrailEntry: [string, string, string[], number[][][]];
export function makeAccessManifest(text: string): {
  schemaVersion: number;
  kind: string;
  testOnly: boolean;
  sourceInputSha256: string;
  sourceInput: { layerCounts: Record<string, number> };
  [key: string]: unknown;
};
