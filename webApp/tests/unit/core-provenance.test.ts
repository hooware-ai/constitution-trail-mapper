import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  coreInputs,
  coreOutputs,
  verifyCoreManifest,
  writeCoreManifest,
} from "../../tools/lib/core.mjs";
import {
  APPROVED_DATASET_FIELDS,
  publicReleaseBlockers,
} from "../../tools/lib/provenance.mjs";

async function fakeRepo() {
  const root = await mkdtemp(join(tmpdir(), "trail-core-"));
  await mkdir(join(root, "sharedLogic", "src"), { recursive: true });
  await mkdir(join(root, "webBridge", "src"), { recursive: true });
  await mkdir(join(root, "out"), { recursive: true });
  await writeFile(join(root, "sharedLogic", "src", "A.kt"), "class A\n");
  await writeFile(join(root, "webBridge", "src", "B.kt"), "class B\n");
  await writeFile(join(root, "settings.gradle.kts"), "include(':x')\n");
  await writeFile(
    join(root, "out", "TrailMapper-webBridge.mjs"),
    "export const core = 1;\n",
  );
  const paths = {
    root,
    outputDir: join(root, "out"),
    manifestPath: join(root, "manifest.json"),
  };
  return { root, paths };
}

test("a core manifest verifies until a Kotlin source changes, then the core is stale", async () => {
  const { root, paths } = await fakeRepo();
  try {
    await writeCoreManifest({}, paths);
    await verifyCoreManifest(paths);
    await writeFile(
      join(root, "webBridge", "src", "B.kt"),
      "class B { val changed = true }\n",
    );
    await assert.rejects(verifyCoreManifest(paths), /Stale Kotlin core/);
    // Rebuilding (rewriting the manifest from the new sources) makes it current again.
    await writeCoreManifest({}, paths);
    await verifyCoreManifest(paths);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("build configuration changes and new Kotlin files also make the core stale", async () => {
  const { root, paths } = await fakeRepo();
  try {
    await writeCoreManifest({}, paths);
    await writeFile(join(root, "settings.gradle.kts"), "include(':x', ':y')\n");
    await assert.rejects(verifyCoreManifest(paths), /Stale Kotlin core/);
    await writeCoreManifest({}, paths);
    await writeFile(join(root, "sharedLogic", "src", "New.kt"), "class New\n");
    await assert.rejects(verifyCoreManifest(paths), /Stale Kotlin core/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a copied or edited core output is rejected even when the sources match", async () => {
  const { root, paths } = await fakeRepo();
  try {
    await writeCoreManifest({}, paths);
    await writeFile(
      join(paths.outputDir, "TrailMapper-webBridge.mjs"),
      "export const core = 2;\n",
    );
    await assert.rejects(
      verifyCoreManifest(paths),
      /do not match their build manifest/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a missing manifest is refused with instructions", async () => {
  const { root, paths } = await fakeRepo();
  try {
    await assert.rejects(verifyCoreManifest(paths), /npm run build:core/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("hashes ignore line endings so Windows and Linux checkouts agree", async () => {
  const one = await fakeRepo(),
    two = await fakeRepo();
  try {
    await writeFile(join(two.root, "webBridge", "src", "B.kt"), "class B\r\n");
    assert.equal(
      (await coreInputs(one.root)).hash,
      (await coreInputs(two.root)).hash,
    );
    assert.equal(
      (await coreOutputs(one.paths.outputDir)).hash,
      (await coreOutputs(two.paths.outputDir)).hash,
    );
  } finally {
    await rm(one.root, { recursive: true, force: true });
    await rm(two.root, { recursive: true, force: true });
  }
});
test("the fixture dataset is never publishable and a file scan does not approve any dataset", () => {
  const clean = { commit: "a".repeat(40), dirty: false };
  const fixture = { kind: "fixture", approved: false };
  assert.match(
    publicReleaseBlockers(fixture, clean).join(" "),
    /synthetic fixture/,
  );
  // Marking a fixture approved is not enough.
  assert.ok(
    publicReleaseBlockers({ kind: "fixture", approved: true }, clean).length >
      0,
  );
  // An "approved" real dataset must carry every identity/rights field.
  const partial = {
    kind: "county",
    approved: true,
    id: "county",
    version: "1",
  };
  const blockers = publicReleaseBlockers(partial, clean);
  for (const field of APPROVED_DATASET_FIELDS.filter(
    (f) => f !== "id" && f !== "version",
  ))
    assert.ok(
      blockers.some((b) => b.includes(field)),
      field,
    );
  const complete = {
    kind: "county",
    approved: true,
    id: "county",
    version: "2026-10",
    content: { sha256: "b".repeat(64), distPath: "assets/data.json" },
    sourceManifestSha256: "c".repeat(64),
    licenseEvidence: ["https://example.test/license"],
    attribution: "Trail data: example",
    approvedBy: "owner",
    approvedOn: "2026-10-01",
    // An approval covers one composition: the actual parts must equal the expected ones the record carries.
    composition: {
      networkSha256: "b".repeat(64),
      layerCounts: { "8": 3 },
      accessBaseSha256: null,
      accessIndexSha256: null,
      accessCombinedSha256: null,
      accessSourceInputSha256: null,
      accessSourceManifestSha256: null,
      supplementManifestSha256: null,
      proposedManifestSha256: null,
    },
    approvedComposition: {
      networkSha256: "b".repeat(64),
      layerCounts: { "8": 3 },
      accessBaseSha256: null,
      accessIndexSha256: null,
      accessCombinedSha256: null,
      accessSourceInputSha256: null,
      accessSourceManifestSha256: null,
      supplementManifestSha256: null,
      proposedManifestSha256: null,
    },
  };
  assert.deepEqual(publicReleaseBlockers(complete, clean), []);
  // The same approval flags WITHOUT a bound composition fail closed: a legacy approval covers nothing.
  assert.ok(
    publicReleaseBlockers({ ...complete, approvedComposition: null }, clean)
      .length > 0,
  );
  // A dirty tree or unknown commit also blocks publication.
  assert.ok(
    publicReleaseBlockers(complete, { commit: "a".repeat(40), dirty: true })
      .length > 0,
  );
  assert.ok(
    publicReleaseBlockers(complete, { commit: null, dirty: null }).length > 0,
  );
});
