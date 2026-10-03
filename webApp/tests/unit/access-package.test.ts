import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdmissionError,
  accessIdentity,
  checkPackage,
  packageFromFiles,
  verifyPackageDir,
} from "../../tools/lib/dataset-package.mjs";
import { makeCounty } from "../support/county-fixture.mjs";
import {
  makeAccessExtract,
  makeAccessManifest,
} from "../support/access-fixture.mjs";
import {
  DatasetError,
  identityOf,
  parseDatasetRecord,
} from "../../src/dataset";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function workspace(extract = makeAccessExtract()) {
  const dir = await mkdtemp(join(tmpdir(), "trail-access-package-"));
  const county = makeCounty();
  const files = {
    input: join(dir, "extract.json"),
    manifest: join(dir, "manifest.json"),
    approval: join(dir, "approval.json"),
    access: join(dir, "access.json"),
    accessManifest: join(dir, "access-manifest.json"),
  };
  await writeFile(files.input, JSON.stringify(county.input));
  await writeFile(files.manifest, JSON.stringify(county.manifest));
  await writeFile(files.approval, JSON.stringify(county.approval));
  const accessText = JSON.stringify(extract);
  await writeFile(files.access, accessText);
  await writeFile(
    files.accessManifest,
    JSON.stringify(makeAccessManifest(accessText)),
  );
  const make = (name: string, withAccess: boolean) =>
    packageFromFiles({
      inputFile: files.input,
      manifestPath: files.manifest,
      approvalPath: files.approval,
      outDir: join(dir, name),
      accessInput: withAccess ? files.access : null,
      accessManifestPath: files.accessManifest,
    }).then((built) => ({ built, out: join(dir, name) }));
  return { dir, files, make, county };
}

test("a package with access pins every part by hash, moves the identity, and verifies from disk", async () => {
  const { make, files } = await workspace();
  const withAccess = await make("with", true);
  const without = await make("without", false);
  const { record } = withAccess.built;
  assert.equal(record.access.base.featureCount, 1);
  assert.equal(record.access.index.localFeatureCount, 2);
  assert.ok(record.access.index.tileCount >= 2);
  const combined = accessIdentity(
    record.content.sha256,
    record.access.index.sha256,
  );
  assert.equal(record.access.combinedSha256, combined);
  assert.equal(record.version, `2026-01-01.${combined.slice(0, 12)}`);
  // The same trails with and without access are different datasets to anything that remembers one.
  assert.equal(record.content.sha256, without.built.record.content.sha256);
  assert.notEqual(record.version, without.built.record.version);
  assert.match(record.omitted.accessRoads, /^Included: ordinary-road access/);
  assert.match(record.omitted.accessRoads, /never an invented connection/);
  // Every file the record names is on disk, hash-named, and nothing else is.
  const names = (await readdir(withAccess.out)).sort();
  assert.ok(names.includes(record.access.base.file));
  assert.ok(names.includes(record.access.index.file));
  assert.equal(
    names.length,
    2 + 1 + 1 + record.access.index.tileCount,
    "dataset.json, the network, the base, the index and the tiles",
  );
  const verified = await verifyPackageDir(
    withAccess.out,
    files.manifest,
    files.accessManifest,
  );
  assert.equal(verified.accessFiles.length, 2 + record.access.index.tileCount);
  // The browser-side identity is the combined one.
  assert.equal(
    identityOf(parseDatasetRecord(record, "review")).contentSha256,
    combined,
  );
  assert.equal(
    identityOf(parseDatasetRecord(without.built.record, "review"))
      .contentSha256,
    without.built.record.content.sha256,
  );
  // A different set of service roads over the SAME trails is a different identity.
  const other = clone(makeAccessExtract());
  other.layers[1].features.pop();
  const second = await (await workspace(other)).make("other", true);
  assert.notEqual(
    second.built.record.access.combinedSha256,
    record.access.combinedSha256,
  );
});

test("the audit refuses a package whose access parts were altered, removed or added to", async () => {
  const { make, files } = await workspace();
  const { built, out } = await make("with", true);
  const refused = async (
    change: () => Promise<void>,
    undo: () => Promise<void>,
  ) => {
    await change();
    await assert.rejects(
      verifyPackageDir(out, files.manifest, files.accessManifest),
      AdmissionError,
    );
    await undo();
    await verifyPackageDir(out, files.manifest, files.accessManifest); // restored: verifies again
  };
  const tile = join(
    out,
    (await readdir(out)).find((n) => n.startsWith("access-tile."))!,
  );
  const original = await readFile(tile);
  await refused(
    async () => {
      const copy = Buffer.from(original);
      copy[copy.length - 3] ^= 1;
      await writeFile(tile, copy);
    },
    () => writeFile(tile, original),
  );
  const stray = join(out, "access-tile.9999_9999.000000000000.json");
  await refused(
    () => writeFile(stray, "{}"),
    async () => {
      const { rm } = await import("node:fs/promises");
      await rm(stray);
    },
  );
  const index = join(out, built.record.access.index.file);
  const indexBytes = await readFile(index);
  await refused(
    async () => {
      const { rm } = await import("node:fs/promises");
      await rm(index);
    },
    () => writeFile(index, indexBytes),
  );
});

test("a record with access parts cannot be checked without them, and its identity must match", async () => {
  const { make, files } = await workspace();
  const { built, out } = await make("with", true);
  const manifestBytes = await readFile(files.manifest);
  const accessManifestBytes = await readFile(files.accessManifest);
  const read = (name: string) =>
    readFile(join(out, name)).catch(() => undefined);
  const preloaded = new Map<string, Buffer>();
  for (const name of await readdir(out))
    preloaded.set(name, await readFile(join(out, name)));
  const fromMap = (name: string) => preloaded.get(name);
  void read;
  assert.throws(
    () => checkPackage(built.record, built.body, manifestBytes),
    AdmissionError,
  );
  checkPackage(
    built.record,
    built.body,
    manifestBytes,
    null,
    fromMap,
    null,
    accessManifestBytes,
  );
  const wrongIdentity = clone(built.record);
  wrongIdentity.access.combinedSha256 = "0".repeat(64);
  assert.throws(
    () =>
      checkPackage(
        wrongIdentity,
        built.body,
        manifestBytes,
        null,
        fromMap,
        null,
        accessManifestBytes,
      ),
    AdmissionError,
  );
  const wrongVersion = clone(built.record);
  wrongVersion.version = `2026-01-01.${built.record.content.sha256.slice(0, 12)}`;
  assert.throws(
    () =>
      checkPackage(
        wrongVersion,
        built.body,
        manifestBytes,
        null,
        fromMap,
        null,
        accessManifestBytes,
      ),
    AdmissionError,
  );
});

test("an extract with no base roads, a duplicated road or an unservable latitude is refused whole", async () => {
  for (const mutate of [
    (e: any) => (e.layers[0].features = []),
    (e: any) => e.layers[1].features.push(clone(e.layers[1].features[0])),
    (e: any) =>
      (e.layers[1].features[0].paths = [
        [
          [0, 80],
          [0.1, 80],
        ],
      ]),
  ]) {
    const extract = clone(makeAccessExtract());
    mutate(extract);
    const { make } = await workspace(extract);
    await assert.rejects(make("bad", true), AdmissionError);
  }
});

test("the runtime refuses a malformed access description before using any of it", async () => {
  const { make } = await workspace();
  const { built } = await make("with", true);
  const bad = (change: (r: any) => void) => {
    const record = clone(built.record);
    change(record);
    assert.throws(
      () => parseDatasetRecord(record, "review"),
      (error: any) =>
        error instanceof DatasetError && error.code === "data-corrupt",
    );
  };
  parseDatasetRecord(clone(built.record), "review");
  bad((r) => (r.access.base.file = "../escape.json"));
  bad((r) => (r.access.base.file = "a/b.json"));
  bad((r) => (r.access.index.sha256 = "short"));
  bad((r) => (r.access.index.file = "access-index.000000000000.json"));
  bad((r) => (r.access.radiusMeters = 5000));
  bad((r) => (r.access.windowCells = 0));
  bad((r) => delete r.access.combinedSha256);
});
