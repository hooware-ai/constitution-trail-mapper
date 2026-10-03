export interface Composition {
  networkSha256: string;
  countyManifestSha256: string;
  layerCounts: Record<string, number>;
  accessBaseSha256: string | null;
  accessIndexSha256: string | null;
  accessCombinedSha256: string | null;
  accessSourceInputSha256: string | null;
  accessSourceManifestSha256: string | null;
  supplementManifestSha256: string | null;
  proposedManifestSha256: string | null;
}
export const COMPOSITION_FIELDS: string[];
export function manifestDigest(bytes: Uint8Array): string;
export function reconstructComposition(args: {
  record: any;
  body: Uint8Array;
  network: any;
  readPart?: (file: string) => Uint8Array | undefined;
  manifestBytes: Uint8Array;
  osmManifestBytes?: Uint8Array | null;
  proposedManifestBytes?: Uint8Array | null;
  accessManifestBytes?: Uint8Array | null;
}): Composition;
export function compositionProblems(composition: unknown): string[];
export function compositionDifferences(actual: any, expected: any): string[];
export function approvedCompositionProblems(
  actual: Composition | null | undefined,
  expected: unknown,
): string[];
