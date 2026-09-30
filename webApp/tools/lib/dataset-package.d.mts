export const NETWORK_SCHEMA: string;
export const RECORD_SCHEMA: string;
export const packageDir: string;
export const manifestFile: string;
export const committedManifestFile: string;
export const licensedInputFile: string;
export const approvalRecordFile: string;
export const committedApprovalFile: string;
export class AdmissionError extends Error {}
export function admittedFeatures(manifest: any): Map<string, any>;
export function excludedIds(manifest: any): Set<string>;
export const ATTRIBUTE_FIELDS: string[];
export function admit(
  inputText: string,
  manifest: any,
): { features: any[]; domainsText: string };
export function toNetworkText(features: any[], domainsText: string): string;
export function readApprovalRecord(file?: string): Promise<any>;
export function buildPackage(args: {
  inputText: string;
  manifest: any;
  manifestBytes: Uint8Array;
  approval: any;
}): Promise<{ record: any; body: Buffer; file: string }>;
export function writePackage(
  built: { record: any; body: Buffer; file: string },
  outDir?: string,
): Promise<string>;
export function packageFromFiles(options?: {
  inputFile?: string;
  manifestPath?: string;
  approvalPath?: string;
  outDir?: string;
}): Promise<{ record: any; body: Buffer; file: string }>;
export function verifyPackageDir(
  dir?: string,
  manifestPath?: string,
): Promise<{ record: any; body: Buffer; network: any }>;
export function checkPackage(
  record: any,
  body: Uint8Array,
  manifestBytes: Uint8Array,
): any;
