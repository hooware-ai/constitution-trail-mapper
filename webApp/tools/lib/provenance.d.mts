export const distDir: string;
export const datasetFile: string;
export const APPROVED_DATASET_FIELDS: string[];
export interface SourceState {
  commit: string | null;
  branch?: string | null;
  dirty: boolean | null;
}
export interface DatasetIdentity {
  kind: string;
  approved?: boolean;
  id?: string;
  version?: string;
  content?: {
    sha256?: string | null;
    distPath?: string;
    bytes?: number | null;
  };
  sourceManifestSha256?: string | null;
  inconsistencies?: string[];
  blockers?: string[];
  [extra: string]: unknown;
}
export interface ProvenancePaths {
  distDir?: string;
  datasetFile?: string;
  approvalFile?: string;
  manifestFile?: string;
  webRoot?: string;
  core?: import("./core.mjs").CorePaths;
}
export function sourceState(root?: string): SourceState;
export function loadDataset(paths?: ProvenancePaths): Promise<DatasetIdentity>;
export function publicReleaseBlockers(
  dataset: DatasetIdentity,
  source?: SourceState,
  distFiles?: Array<{ path: string; sha256: string }>,
  build?: { assumeEstimatedConnections?: boolean },
): string[];
export function artifactFiles(
  dir?: string,
): Promise<Array<{ path: string; sha256: string; bytes: number }>>;
export function writeProvenance(options?: {
  allowDirty?: boolean;
  paths?: ProvenancePaths;
  source?: SourceState;
  build?: { assumeEstimatedConnections?: boolean };
}): Promise<any>;
export function verifyProvenance(options?: {
  requirePublic?: boolean;
  paths?: ProvenancePaths;
  source?: SourceState;
}): Promise<any>;
export function isDirectory(path: string): Promise<boolean>;
