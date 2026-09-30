import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdmissionError,
  buildPackage,
  packageFromFiles,
  verifyPackageDir,
} from "../../tools/lib/dataset-package.mjs";
import { makeCounty } from "../support/county-fixture.mjs";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "trail-package-"));
  const county = makeCounty();
  const files = {
    input: join(dir, "extract.json"),
    manifest: join(dir, "manifest.json"),
    approval: join(dir, "approval.json"),
    out: join(dir, "out", "county"),
  };
  await writeFile(files.input, JSON.stringify(county.input));
  await writeFile(files.manifest, JSON.stringify(county.manifest));
  await writeFile(files.approval, JSON.stringify(county.approval));
  return { dir, county, files };
}
const build = (county: ReturnType<typeof makeCounty>) =>
  buildPackage({
    input: county.input,
    manifest: county.manifest,
    manifestBytes: Buffer.from(JSON.stringify(county.manifest)),
    approval: county.approval,
  });

test("the reviewed subset packages deterministically, hash-named, with truthful identity and no approval", async () => {
  const county = makeCounty();
  const first = await build(county);
  const second = await build(clone(county));
  assert.equal(first.record.content.sha256, second.record.content.sha256);
  assert.deepEqual(first.body, second.body);
  const { record } = first;
  assert.equal(record.schema, "trail-mapper.dataset/1");
  assert.match(record.content.file, /^trails\.[0-9a-f]{12}\.json$/);
  assert.ok(record.content.file.includes(record.content.sha256.slice(0, 12)));
  assert.equal(
    record.version,
    `2026-01-01.${record.content.sha256.slice(0, 12)}`,
  );
  assert.equal(record.content.featureCount, 5);
  assert.deepEqual(record.content.layerCounts, { "16": 3, "54": 2 });
  // Review date and extraction time are separate facts; neither is presented as upstream freshness.
  assert.equal(record.source.reviewedOn, "2026-01-01");
  assert.equal(record.source.extractedAtUtc, "2026-01-02T03:04:05+00:00");
  assert.equal(record.source.license, "CC BY 4.0");
  assert.match(record.source.changes, /Reviewed subset/);
  assert.deepEqual(record.omitted.proposedFeatureIds, [9999]);
  // Approval comes only from the committed record: nothing here approves a dataset.
  assert.deepEqual(record.approval, {
    approved: false,
    approvedBy: null,
    approvedOn: null,
    blockers: ["Synthetic data is never releasable."],
  });
  const network = JSON.parse(first.body.toString("utf8"));
  assert.equal(network.schema, "trail-mapper.network/1");
  assert.deepEqual(
    network.layers[0].features.map((f: { id: string }) => f.id),
    ["16:9003", "16:9004", "16:9005", "54:9001", "54:9002"],
  );
  assert.ok(
    network.layers[0].features.every(
      (f: { status: string }) => f.status === "Existing",
    ),
  );
  assert.doesNotMatch(first.body.toString("utf8"), /9999/);
});

const drift: Array<
  [string, (c: ReturnType<typeof makeCounty>) => void, RegExp]
> = [
  [
    "an extra feature the manifest never admitted",
    (c) => {
      const extra = clone(c.input.layers[0].features[0]);
      extra.id = "54:5000";
      c.input.layers[0].features.push(extra);
    },
    /not in the reviewed manifest/,
  ],
  [
    "a reviewed feature missing from the extract",
    (c) => {
      c.input.layers[0].features.pop();
    },
    /missing from the extract/,
  ],
  [
    "a duplicated feature",
    (c) => {
      c.input.layers[0].features.push(clone(c.input.layers[0].features[0]));
    },
    /appears twice/,
  ],
  [
    "a feature that is now proposed",
    (c) => {
      c.input.layers[0].features[1].status = "Proposed";
    },
    /not an existing trail/,
  ],
  [
    "changed geometry evidence",
    (c) => {
      c.input.layers[0].features[2].provenance.geometrySha256 = "0".repeat(64);
    },
    /reviewed evidence hashes/,
  ],
  [
    "changed attribute evidence",
    (c) => {
      c.input.layers[0].features[2].provenance.attributesSha256 = "1".repeat(
        64,
      );
    },
    /reviewed evidence hashes/,
  ],
  [
    "different routing roles",
    (c) => {
      c.input.layers[0].features[0].routeRoles = ["SharedRoadways"];
    },
    /different routing roles/,
  ],
  [
    "license drift in the extract",
    (c) => {
      c.input.sources.license = "CC BY-NC 4.0";
    },
    /license does not match/,
  ],
  [
    "license drift on a feature",
    (c) => {
      c.input.layers[0].features[0].provenance.license = "All rights reserved";
    },
    /reviewed license and source/,
  ],
  [
    "a different licensed source",
    (c) => {
      c.input.sources.licensedSourceUrl = "https://example.test/other";
    },
    /reviewed licensed source/,
  ],
  [
    "a different review date",
    (c) => {
      c.input.reviewedOn = "2026-02-02";
    },
    /different review date/,
  ],
  [
    "missing attribution",
    (c) => {
      delete c.input.sources.attribution;
    },
    /attribution, license evidence/,
  ],
  [
    "an unresolved supplement layer",
    (c) => {
      c.input.layers.push({ id: 9, name: "OSM supplement", features: [] });
    },
    /exactly the one reviewed licensed layer/,
  ],
  [
    "a feature from another layer",
    (c) => {
      c.input.layers[0].features[0].sourceLayerId = 9;
    },
    /does not come from the licensed layer/,
  ],
  [
    "invalid geometry",
    (c) => {
      c.input.layers[0].features[0].paths = [[[-88.9, 40.5]]];
    },
    /invalid geometry/,
  ],
  [
    "non-finite coordinates",
    (c) => {
      c.input.layers[0].features[0].paths = [
        [
          [-88.9, 40.5],
          [-88.8, 95],
        ],
      ];
    },
    /invalid geometry/,
  ],
  [
    "an excluded proposed geometry that has slipped in",
    (c) => {
      const proposed = clone(c.input.layers[0].features[0]);
      proposed.id = "54:9999";
      c.input.layers[0].features.push(proposed);
    },
    /excluded list/,
  ],
  [
    "a manifest whose count no longer matches",
    (c) => {
      c.manifest.reviewedFeatureCount = 6;
    },
    /count does not match/,
  ],
];
for (const [name, mutate, expected] of drift)
  test(`admission refuses ${name}`, async () => {
    const county = makeCounty();
    mutate(county);
    await assert.rejects(build(county), (error: unknown) => {
      assert.ok(error instanceof AdmissionError, String(error));
      assert.match((error as Error).message, expected);
      return true;
    });
  });

test("a refused package leaves an existing package untouched and no staging directory behind", async () => {
  const { dir, county, files } = await workspace();
  try {
    await packageFromFiles({
      inputFile: files.input,
      manifestPath: files.manifest,
      approvalPath: files.approval,
      outDir: files.out,
    });
    const before = await readdir(files.out);
    const record = await readFile(join(files.out, "dataset.json"), "utf8");
    const bad = clone(county.input);
    bad.layers[0].features[0].provenance.geometrySha256 = "f".repeat(64);
    await writeFile(files.input, JSON.stringify(bad));
    await assert.rejects(
      packageFromFiles({
        inputFile: files.input,
        manifestPath: files.manifest,
        approvalPath: files.approval,
        outDir: files.out,
      }),
      AdmissionError,
    );
    assert.deepEqual(await readdir(files.out), before);
    assert.equal(
      await readFile(join(files.out, "dataset.json"), "utf8"),
      record,
    );
    assert.deepEqual(
      (await readdir(join(dir, "out"))).filter((name) =>
        name.includes("staging"),
      ),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a missing extract explains how to make it and does not contact anything", async () => {
  const { dir, files } = await workspace();
  try {
    await assert.rejects(
      packageFromFiles({
        inputFile: join(dir, "absent.json"),
        manifestPath: files.manifest,
        approvalPath: files.approval,
        outDir: files.out,
      }),
      /fetch-web-review-data\.py/,
    );
    await assert.rejects(stat(files.out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a written package re-verifies, and tampering, strays and a changed manifest are caught", async () => {
  const { dir, files } = await workspace();
  try {
    const built = await packageFromFiles({
      inputFile: files.input,
      manifestPath: files.manifest,
      approvalPath: files.approval,
      outDir: files.out,
    });
    await verifyPackageDir(files.out, files.manifest);
    // A different reviewed manifest than the one used to package.
    const changed = JSON.parse(await readFile(files.manifest, "utf8"));
    changed.reviewedOn = "2026-03-03";
    const other = join(dir, "other-manifest.json");
    await writeFile(other, JSON.stringify(changed));
    await assert.rejects(
      verifyPackageDir(files.out, other),
      /different reviewed manifest/,
    );
    // A stray file next to the package.
    await writeFile(join(files.out, "extra.json"), "{}");
    await assert.rejects(
      verifyPackageDir(files.out, files.manifest),
      /Unexpected files/,
    );
    await rm(join(files.out, "extra.json"));
    // A modified network file.
    const network = join(files.out, built.file);
    const original = await readFile(network);
    await writeFile(
      network,
      Buffer.concat([original.subarray(0, -2), Buffer.from(" }")]),
    );
    await assert.rejects(
      verifyPackageDir(files.out, files.manifest),
      /recorded hash/,
    );
    await writeFile(network, original);
    // A package that names a feature the manifest excludes, with a consistent hash, is still refused.
    const parsed = JSON.parse(original.toString("utf8"));
    parsed.layers[0].features.push({
      ...parsed.layers[0].features[0],
      id: "54:9999",
    });
    const forged = Buffer.from(JSON.stringify(parsed));
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(forged).digest("hex");
    const record = JSON.parse(
      await readFile(join(files.out, "dataset.json"), "utf8"),
    );
    const forgedFile = `trails.${sha.slice(0, 12)}.json`;
    await rm(network);
    await writeFile(join(files.out, forgedFile), forged);
    record.content = {
      ...record.content,
      file: forgedFile,
      sha256: sha,
      bytes: forged.length,
    };
    await writeFile(join(files.out, "dataset.json"), JSON.stringify(record));
    await assert.rejects(
      verifyPackageDir(files.out, files.manifest),
      /exactly the reviewed set/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the committed reviewed manifest admits exactly 254 features and excludes the six proposed IDs", async () => {
  const { admittedFeatures, excludedIds } = await import(
    "../../tools/lib/dataset-package.mjs"
  );
  const manifest = JSON.parse(
    await readFile(
      join(process.cwd(), "..", "data", "web-reviewed-trails.manifest.json"),
      "utf8",
    ),
  );
  const entries = admittedFeatures(manifest);
  assert.equal(entries.size, 254);
  assert.deepEqual([...excludedIds(manifest)].sort(), [
    "54:1929",
    "54:1952",
    "54:2349",
    "54:3824",
    "54:4275",
    "54:4772",
  ]);
  for (const id of excludedIds(manifest)) assert.equal(entries.has(id), false);
  assert.equal(manifest.license, "CC BY 4.0");
});
