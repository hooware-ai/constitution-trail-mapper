export function addressIndexBuildFile(
  repoRoot: string,
  dataset: "fixture" | "county",
  channel: "review" | "public",
  override: string | undefined,
  syntheticEvidence?: {
    manifest: Record<string, unknown>;
    approval: Record<string, unknown>;
  },
): string | undefined;
export function verifyAddressPackage(
  repoRoot: string,
  file?: string,
): { file: string; sha256: string; bytes: number; rows: number };
