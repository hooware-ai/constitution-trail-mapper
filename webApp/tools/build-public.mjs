// The publication entry point: county data, public channel, strict routing and exact clean-source eligibility.
// Review/test builds keep their existing entry points. This command never changes sharing or deploys anything.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { webRoot } from "./lib/core.mjs";
import { sourceState } from "./lib/provenance.mjs";

try {
  if (
    process.env.TRAIL_ASSUME_ESTIMATED_CONNECTIONS &&
    process.env.TRAIL_ASSUME_ESTIMATED_CONNECTIONS !== "0"
  )
    throw new Error(
      "Public build refuses the private estimated-connection override.",
    );
  if (process.env.TRAIL_DATASET && process.env.TRAIL_DATASET !== "county")
    throw new Error(
      "Public build requires the county dataset, never a fixture.",
    );
  if (process.env.TRAIL_CHANNEL && process.env.TRAIL_CHANNEL !== "public")
    throw new Error("Public build requires the public channel.");
  const source = sourceState();
  if (!source.commit || source.dirty !== false)
    throw new Error("Public build requires an exact clean source commit.");
  const env = {
    ...process.env,
    TRAIL_DATASET: "county",
    TRAIL_CHANNEL: "public",
    TRAIL_ASSUME_ESTIMATED_CONNECTIONS: "0",
  };
  for (const args of [
    ["tools/verify-core.mjs"],
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    ["node_modules/vite/bin/vite.js", "build"],
    ["tools/write-provenance.mjs", "--strict"],
    ["tools/audit-dist.mjs", "--public"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(webRoot, args[0]), ...args.slice(1)],
      { cwd: webRoot, env, stdio: "inherit" },
    );
    if (result.error) throw new Error(`Public build could not run ${args[0]}.`);
    if (result.status !== 0)
      throw new Error(
        `Public build stopped at ${args[0]} (exit ${result.status ?? "unknown"}).`,
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
