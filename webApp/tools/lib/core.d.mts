export const webRoot: string;
export const repoRoot: string;
export const coreOutputDir: string;
export const coreEntry: string;
export const coreManifestPath: string;
export interface CorePaths {
  root?: string;
  outputDir?: string;
  manifestPath?: string;
}
export interface CoreManifest {
  schema: number;
  builtAt: string;
  inputs: { count: number; sha256: string };
  outputs: {
    sha256: string;
    files: Array<{ path: string; sha256: string; bytes: number }>;
  };
  [extra: string]: unknown;
}
export function sha256(buffer: Uint8Array): string;
export function coreInputs(
  root?: string,
): Promise<{ count: number; hash: string }>;
export function coreOutputs(dir?: string): Promise<{
  files: Array<{ path: string; sha256: string; bytes: number }>;
  hash: string;
}>;
export function removeCoreOutputs(): Promise<void>;
export function writeCoreManifest(
  extra?: Record<string, unknown>,
  paths?: CorePaths,
): Promise<CoreManifest>;
export function verifyCoreManifest(paths?: CorePaths): Promise<CoreManifest>;
