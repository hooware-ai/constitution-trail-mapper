// Secret-free fixture controls against an explicitly selected clean commit and its verified core.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webRoot, verifyCoreManifest, sha256 } from "./lib/core.mjs";
import { sourceState } from "./lib/provenance.mjs";

const project = process.argv[2];
assert.equal(
  process.argv.length,
  3,
  "Specify exactly one runtime project; no test filtering is supported",
);
assert.ok(
  ["runtime-chromium", "runtime-webkit"].includes(project),
  "Unknown runtime project",
);
const expectedCommit = process.env.TRAIL_RUNTIME_EXPECT_COMMIT;
assert.match(
  expectedCommit ?? "",
  /^[a-f0-9]{40}$/,
  "Explicit expected source commit is required",
);
async function identity() {
  const source = sourceState();
  assert.equal(
    source.commit,
    expectedCommit,
    "Runtime control checkout differs from selected commit",
  );
  assert.equal(
    source.dirty,
    false,
    "Runtime controls require clean selected source",
  );
  const core = await verifyCoreManifest();
  return {
    source,
    core: {
      inputsSha256: core.inputs.sha256,
      outputsSha256: core.outputs.sha256,
    },
  };
}
const before = await identity();
const directory = join(webRoot, "dist-report", "runtime-controls");
await mkdir(directory, { recursive: true });
const reportPath = join(directory, project + ".json");
const evidencePath = join(directory, project + "-identity.json");
await rm(reportPath, { force: true }); // A prior successful report cannot satisfy this invocation.
await writeFile(
  evidencePath,
  JSON.stringify(
    {
      schema: "trail-mapper.runtime-controls/1",
      project,
      ...before,
      status: "running",
    },
    null,
    2,
  ),
);
const cli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    cli,
    "test",
    "-c",
    "playwright.runtime.config.ts",
    "--project=" + project,
    "--retries=0",
    "--reporter=list,json",
  ],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      TRAIL_TEST_PORT: process.env.TRAIL_TEST_PORT ?? "4185",
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
    },
    stdio: "inherit",
  },
);
const after = await identity();
assert.deepEqual(
  after,
  before,
  "Source/core identity changed during browser controls",
);
const bytes = await readFile(reportPath);
const report = JSON.parse(bytes);
const passed =
  result.status === 0 &&
  !result.signal &&
  !result.error &&
  report.stats.expected === 16 &&
  report.stats.unexpected === 0 &&
  report.stats.skipped === 0 &&
  report.stats.flaky === 0 &&
  (report.errors?.length ?? 0) === 0;
await writeFile(
  evidencePath,
  JSON.stringify(
    {
      schema: "trail-mapper.runtime-controls/1",
      project,
      ...after,
      status: passed ? "passed" : "failed",
      browserReportSha256: sha256(bytes),
      stats: report.stats,
      limits:
        "Self-authored fixtures, actual App/controller/module workers and browser engine; no physical GPS or production activation",
    },
    null,
    2,
  ),
);
assert.ok(
  passed,
  "Require all sixteen runtime controls without failures, skips, retries, flaky passes or global errors",
);
console.log(
  JSON.stringify({
    project,
    selectedCommit: expectedCommit,
    controlsPassed: 16,
    ...after.core,
  }),
);
