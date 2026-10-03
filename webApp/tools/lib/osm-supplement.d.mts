export const SUPPLEMENT_LAYER_ID: string;
export const SUPPLEMENT_KIND: string;
export const committedOsmManifestFile: string;
export const osmInputFile: string;
export class SupplementError extends Error {}
export function reviewedWays(manifest: any): Map<string, any>;
export function exclusions(manifest: any): string[];
export function geometryHash(points: number[][]): string;
export function admitSupplement(
  inputText: string,
  manifest: any,
): { layer: any; facts: any };
export function checkSupplementLayer(
  layer: any,
  record: any,
  manifest: any,
  manifestBytes: Uint8Array,
): any;
