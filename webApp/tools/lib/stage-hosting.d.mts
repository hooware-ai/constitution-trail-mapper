export const STAGE_SCHEMA: string;
export const ORIGINAL_AUDIT_SCHEMA: string;
export const HOSTING_SCHEMA: string;
export interface StagedFile {
  path: string;
  bytes: number;
  sha256: string | null;
  contentType: string | null;
  cacheControl: string;
}
export interface StagePlan {
  schema: string;
  inert: true;
  note: string;
  https: boolean;
  publicRelease: { allowed: boolean; blockers: string[] };
  headersForEveryResponse: Record<string, string>;
  files: StagedFile[];
  problems: string[];
  manifests?: Record<string, { sha256: string }>;
}
export interface PartAudit {
  ok: boolean;
  problems: string[];
}
export interface StageAudits {
  original: PartAudit;
  wrapper: PartAudit;
  manifests: PartAudit;
}
export function responseFor(
  path: string,
  options?: { https?: boolean },
): {
  contentType: string | null;
  cacheControl: string;
  headers: Record<string, string>;
};
export function planStaging(input: {
  files: { path: string; bytes: number; sha256: string }[];
  publicRelease?: { allowed: boolean; blockers: string[] };
  https?: boolean;
}): StagePlan;
export function buildWorkerSource(input: {
  headersSource: string;
  adapterSource: string;
  inventory: Iterable<string>;
}): string;
export function stageSite(options: {
  distDir: string;
  outDir: string;
  https?: boolean;
  requirePublic?: boolean;
  paths?: Record<string, unknown>;
  source?: unknown;
  hooks?: {
    afterCopy?: (paths: { dist: string; site: string }) => void | Promise<void>;
  };
}): Promise<{ plan: StagePlan; outDir: string; audits: StageAudits }>;
export function auditStage(outDir: string): Promise<StageAudits>;
