export const PROPOSED_LAYER_ID: string;
export const PROPOSED_KIND: string;
export const committedProposedManifestFile: string;
export const proposedInputFile: string;
export class ProposedError extends Error {
  blocked: boolean;
}
export const geometryHash: (paths: number[][][]) => string;
export function requireRights(manifest: any): Record<string, string>;
export function admitProposed(
  inputText: string,
  manifest: any,
): { layer: any; facts: any };
export function checkProposedLayer(
  layer: any,
  record: any,
  manifest: any,
  manifestBytes: Buffer | Uint8Array,
): number;
