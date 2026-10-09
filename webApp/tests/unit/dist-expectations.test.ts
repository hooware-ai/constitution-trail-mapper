import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertDistExpectations,
  checkDistExpectations,
} from "../../tools/lib/dist-expectations.mjs";

const artifact = (kind: string, privateMode: boolean) => ({
  schema: 1,
  dataset: { kind },
  build: { assumeEstimatedConnections: privateMode },
});

test("default preflight follows the same TRAIL_DIST_DIR override as the artifact server", () => {
  const directory = mkdtempSync(join(tmpdir(), "trail-dist-override-"));
  try {
    writeFileSync(
      join(directory, "provenance.json"),
      JSON.stringify(artifact("county", true)),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import('./tools/lib/dist-expectations.mjs').then(({checkDistExpectations})=>checkDistExpectations())",
      ],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: {
          ...process.env,
          TRAIL_DIST_DIR: directory,
          TRAIL_EXPECT_DATASET: "county",
          TRAIL_ASSUME_ESTIMATED_CONNECTIONS: "1",
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("fixture, strict county and owner-private county select only their matching acceptance lane", () => {
  assert.doesNotThrow(() =>
    assertDistExpectations(artifact("fixture", false), {}),
  );
  assert.doesNotThrow(() =>
    assertDistExpectations(artifact("county", false), {
      TRAIL_EXPECT_DATASET: "county",
    }),
  );
  assert.doesNotThrow(() =>
    assertDistExpectations(artifact("county", true), {
      TRAIL_EXPECT_DATASET: "county",
      TRAIL_ASSUME_ESTIMATED_CONNECTIONS: "1",
    }),
  );
  assert.doesNotThrow(() =>
    assertDistExpectations(artifact("fixture", false), {
      TRAIL_EXPECT_DATASET: "fixture",
      TRAIL_ASSUME_ESTIMATED_CONNECTIONS: "0",
    }),
  );
});

test("omitting or reversing private mode fails with the artifact's required flags", () => {
  assert.throws(
    () =>
      assertDistExpectations(artifact("county", true), {
        TRAIL_EXPECT_DATASET: "county",
      }),
    /Use TRAIL_EXPECT_DATASET=county TRAIL_ASSUME_ESTIMATED_CONNECTIONS=1/,
  );
  assert.throws(
    () =>
      assertDistExpectations(artifact("county", false), {
        TRAIL_EXPECT_DATASET: "county",
        TRAIL_ASSUME_ESTIMATED_CONNECTIONS: "1",
      }),
    /Use TRAIL_EXPECT_DATASET=county TRAIL_ASSUME_ESTIMATED_CONNECTIONS=0/,
  );
});

test("wrong dataset lane cannot silently skip the artifact's checks", () => {
  assert.throws(
    () => assertDistExpectations(artifact("county", false), {}),
    /Use TRAIL_EXPECT_DATASET=county/,
  );
  assert.throws(
    () =>
      assertDistExpectations(artifact("fixture", false), {
        TRAIL_EXPECT_DATASET: "county",
      }),
    /Use TRAIL_EXPECT_DATASET=fixture/,
  );
});

test("unknown expected flags and missing artifact mode evidence fail closed", () => {
  for (const value of ["", "public", "County"])
    assert.throws(
      () =>
        assertDistExpectations(artifact("fixture", false), {
          TRAIL_EXPECT_DATASET: value,
        }),
      /TRAIL_EXPECT_DATASET must/,
    );
  for (const value of ["", "true", "false", "2"])
    assert.throws(
      () =>
        assertDistExpectations(artifact("fixture", false), {
          TRAIL_ASSUME_ESTIMATED_CONNECTIONS: value,
        }),
      /must be 0 or 1/,
    );
  for (const value of [
    null,
    {},
    { schema: 1, dataset: { kind: "county" }, build: {} },
    artifact("unknown", false),
    { ...artifact("fixture", false), schema: 2 },
  ])
    assert.throws(
      () => assertDistExpectations(value, {}),
      /provenance must identify/,
    );
});

test("unreadable/malformed provenance refuses rather than defaulting to fixture tests", () => {
  const directory = mkdtempSync(join(tmpdir(), "trail-dist-mode-"));
  try {
    const path = join(directory, "provenance.json");
    assert.throws(() => checkDistExpectations(path, {}), /cannot read/);
    writeFileSync(path, "{");
    assert.throws(() => checkDistExpectations(path, {}), /cannot read/);
    writeFileSync(path, JSON.stringify(artifact("fixture", false)));
    assert.doesNotThrow(() => checkDistExpectations(path, {}));
  } finally {
    rmSync(directory, { recursive: true });
  }
});
