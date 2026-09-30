export const distDir: string;
export const datasetFile: string;
export const APPROVED_DATASET_FIELDS: string[];
export interface SourceState {
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
}
export interface DatasetIdentity {
  kind: string;
  approved?: boolean;
  id?: string;
  version?: string;
  [extra: string]: unknown;
}
export function sourceState(): SourceState;
export function loadDataset(): Promise<DatasetIdentity>;
export function publicReleaseBlockers(
  dataset: DatasetIdentity,
  source?: { commit: string | null; dirty: boolean | null },
): string[];
export function artifactFiles(
  dir?: string,
): Promise<Array<{ path: string; sha256: string; bytes: number }>>;
export function writeProvenance(options?: {
  allowDirty?: boolean;
}): Promise<any>;
export function verifyProvenance(): Promise<any>;
export function isDirectory(path: string): Promise<boolean>;
