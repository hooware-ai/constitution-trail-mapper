export const NETWORK_SCHEMA: string;
export const RECORD_SCHEMA: string;
export const packageDir: string;
export const manifestFile: string;
export const licensedInputFile: string;
export const approvalRecordFile: string;
export class AdmissionError extends Error {}
export function admittedFeatures(manifest: any): Map<string, any>;
export function excludedIds(manifest: any): Set<string>;
export function admit(input: any, manifest: any): any[];
export function toNetwork(features: any[]): any;
export function readApprovalRecord(file?: string): Promise<any>;
export function buildPackage(args: {
  input: any;
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
