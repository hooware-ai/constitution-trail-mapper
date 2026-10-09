import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Real CLI refusals must precede any build or artifact mutation; public eligibility checks themselves are in release-guards.
for (const [label, override, message] of [
  [
    "private override",
    { TRAIL_ASSUME_ESTIMATED_CONNECTIONS: "1" },
    /refuses the private estimated-connection override/,
  ],
  ["fixture", { TRAIL_DATASET: "fixture" }, /requires the county dataset/],
  [
    "review channel",
    { TRAIL_CHANNEL: "review" },
    /requires the public channel/,
  ],
] as const) {
  test(`public build refuses ${label} before starting a build`, () => {
    const env = Object.assign(
      {},
      process.env,
      {
        TRAIL_ASSUME_ESTIMATED_CONNECTIONS: "0",
        TRAIL_DATASET: "county",
        TRAIL_CHANNEL: "public",
      },
      override,
    );
    const result = spawnSync(process.execPath, ["tools/build-public.mjs"], {
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, "");
  });
}
