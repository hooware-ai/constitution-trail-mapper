import { buildPackage } from "../../tools/lib/dataset-package.mjs";
import { makeCounty } from "./county-fixture.mjs";
import type { RefreshManifest } from "../../src/runtime/manifest";
export const REFRESH_NOW = Date.parse("2026-10-09T12:00:00Z");
export async function refreshFixture(
  sequence = 1,
): Promise<{ manifest: RefreshManifest; body: string }> {
  const c = makeCounty();
  const built = await buildPackage({
    inputText: JSON.stringify(c.input),
    manifest: c.manifest,
    manifestBytes: Buffer.from(JSON.stringify(c.manifest)),
    approval: c.approval,
  });
  return {
    body: built.body.toString("utf8"),
    manifest: {
      schema: "trail-mapper.refresh/1",
      sequence,
      releasedAtUtc: "2026-10-09T11:00:00Z",
      dataset: {
        ...built.record,
        version: `runtime-${sequence}`,
        approval: {
          approved: true,
          approvedBy: "Synthetic fixture reviewer",
          approvedOn: "2026-10-09",
          blockers: [],
        },
      },
      sources: [
        {
          id: "synthetic-source",
          publishedAtUtc: null,
          checkedAtUtc: "2026-10-09T11:00:00Z",
          reviewedAtUtc: "2026-10-09T11:00:00Z",
          staleAfterMs: 86400000,
        },
      ],
      closures: [
        { id: "synthetic-known-closure", contentSha256: "a".repeat(64) },
      ],
      reopenings: [],
    },
  };
}
