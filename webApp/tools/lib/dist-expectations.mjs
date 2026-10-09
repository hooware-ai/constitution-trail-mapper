import { readFileSync } from "node:fs";
import { join } from "node:path";
import { distDir } from "./provenance.mjs";

/** Test selection must describe the artifact, not silently select a different acceptance lane.
 * This is a mode preflight only; audit-dist remains responsible for verifying hashes and approval.
 */
export function assertDistExpectations(provenance, env = process.env) {
  const kind = provenance?.dataset?.kind;
  const privateMode = provenance?.build?.assumeEstimatedConnections;
  if (
    provenance?.schema !== 1 ||
    !["fixture", "county"].includes(kind) ||
    typeof privateMode !== "boolean"
  )
    throw new Error(
      "Built-artifact test preflight: provenance must identify fixture/county and a boolean assumeEstimatedConnections flag. Rebuild dist/ with provenance before testing.",
    );
  const expectedKind = env.TRAIL_EXPECT_DATASET ?? "fixture";
  const flag = env.TRAIL_ASSUME_ESTIMATED_CONNECTIONS;
  if (!["fixture", "county"].includes(expectedKind))
    throw new Error(
      "TRAIL_EXPECT_DATASET must be fixture or county (default: fixture).",
    );
  if (flag !== undefined && !["0", "1"].includes(flag))
    throw new Error(
      "TRAIL_ASSUME_ESTIMATED_CONNECTIONS must be 0 or 1 (default: 0).",
    );
  const expectedPrivate = flag === "1";
  if (expectedKind !== kind || expectedPrivate !== privateMode)
    throw new Error(
      `Built-artifact test mode mismatch: dist/ is ${kind}, estimated connections ${privateMode ? "on" : "off"}; tests expect ${expectedKind}, estimated connections ${expectedPrivate ? "on" : "off"}. Use TRAIL_EXPECT_DATASET=${kind} TRAIL_ASSUME_ESTIMATED_CONNECTIONS=${privateMode ? "1" : "0"} for this artifact, or rebuild the intended mode.`,
    );
}

export function checkDistExpectations(
  path = join(distDir, "provenance.json"),
  env = process.env,
) {
  let provenance;
  try {
    provenance = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Built-artifact test preflight: cannot read dist/provenance.json. Build dist/ with provenance before testing.",
    );
  }
  assertDistExpectations(provenance, env);
}
