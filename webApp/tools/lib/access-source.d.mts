export const ACCESS_MANIFEST_KIND: string;
export const committedAccessManifestFile: string;
export class AccessSourceError extends Error {}
export function parseAccessManifest(manifestBytes: Uint8Array): any;
export function admitAccessSource(
  inputText: string,
  manifestBytes: Uint8Array,
): {
  manifest: any;
  source: { inputSha256: string; manifestSha256: string; testOnly: boolean };
};
export function checkAccessSource(access: any, manifestBytes: Uint8Array): any;
