export const NETWORK_SCHEMA: string;
export const RECORD_SCHEMA: string;
export const packageDir: string;
export const manifestFile: string;
export const committedManifestFile: string;
export const licensedInputFile: string;
export const approvalRecordFile: string;
export const committedApprovalFile: string;
export const osmManifestFile: string;
export const committedOsmManifestFile: string;
export const osmInputFile: string;
export const proposedManifestFile: string;
export const committedProposedManifestFile: string;
export const proposedInputFile: string;
export class AdmissionError extends Error {}
export function admittedFeatures(manifest: any): Map<string, any>;
export function excludedIds(manifest: any): Set<string>;
export const ATTRIBUTE_FIELDS: string[];
export function admit(
  inputText: string,
  manifest: any,
): { features: any[]; domainsText: string };
export function toNetworkText(
  features: any[],
  domainsText: string,
  supplementLayer?: any,
  proposedLayer?: any,
): string;
export function readApprovalRecord(file?: string): Promise<any>;
export function buildPackage(args: {
  inputText: string;
  manifest: any;
  manifestBytes: Uint8Array;
  approval: any;
  supplement?: {
    inputText: string;
    manifest: any;
    manifestBytes: Uint8Array;
  } | null;
  access?: {
    inputText: string;
    manifestBytes: Uint8Array;
  } | null;
  proposed?: {
    inputText: string;
    manifest: any;
    manifestBytes: Uint8Array;
  } | null;
}): Promise<{
  record: any;
  body: Buffer;
  file: string;
  accessFiles: { file: string; body: Buffer }[];
}>;
export function accessIdentity(
  networkSha256: string,
  indexSha256: string,
): string;
export function writePackage(
  built: {
    record: any;
    body: Buffer;
    file: string;
    accessFiles?: { file: string; body: Buffer }[];
  },
  outDir?: string,
): Promise<string>;
export function packageFromFiles(options?: {
  inputFile?: string;
  manifestPath?: string;
  approvalPath?: string;
  outDir?: string;
  osmInput?: string | null;
  osmManifestPath?: string;
  accessInput?: string | null;
  accessManifestPath?: string;
  proposedInput?: string | null;
  proposedManifestPath?: string;
}): Promise<{ record: any; body: Buffer; file: string }>;
export function verifyPackageDir(
  dir?: string,
  manifestPath?: string,
  accessManifestPath?: string,
): Promise<{
  record: any;
  body: Buffer;
  network: any;
  accessFiles: [string, Buffer][];
}>;
export function checkPackage(
  record: any,
  body: Uint8Array,
  manifestBytes: Uint8Array,
  osmManifestBytes?: Uint8Array | null,
  readPart?: (file: string) => Buffer | undefined,
  proposedManifestBytes?: Uint8Array | null,
  accessManifestBytes?: Uint8Array | null,
): any;
export const accessManifestFile: string;
export const committedAccessManifestFile: string;
