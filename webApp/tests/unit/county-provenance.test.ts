import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageFromFiles } from "../../tools/lib/dataset-package.mjs";
import {
  loadDataset,
  publicReleaseBlockers,
} from "../../tools/lib/provenance.mjs";
import { makeCounty } from "../support/county-fixture.mjs";

const CLEAN = { commit: "a".repeat(40), dirty: false };

/** A synthetic package laid out the way a county build ships it: dist/data/dataset.json + dist/data/trails.<sha>.json. */
async function shipped(approval = makeCounty().approval) {
  const dir = await mkdtemp(join(tmpdir(), "trail-county-dist-"));
  const county = makeCounty();
  const files = {
    input: join(dir, "extract.json"),
    manifest: join(dir, "manifest.json"),
    approval: join(dir, "approval.json"),
    out: join(dir, "county"),
    dist: join(dir, "dist"),
  };
  await writeFile(files.input, JSON.stringify(county.input));
  await writeFile(files.manifest, JSON.stringify(county.manifest));
  await writeFile(files.approval, JSON.stringify(approval));
  const built = await packageFromFiles({
    inputFile: files.input,
    manifestPath: files.manifest,
    approvalPath: files.approval,
    outDir: files.out,
  });
  await mkdir(join(files.dist, "data"), { recursive: true });
  await mkdir(join(files.dist, "assets"), { recursive: true });
  await copyFile(
    join(files.out, "dataset.json"),
    join(files.dist, "data", "dataset.json"),
  );
  await copyFile(
    join(files.out, built.file),
    join(files.dist, "data", built.file),
  );
  await writeFile(join(files.dist, "index.html"), "<!doctype html>");
  await writeFile(join(files.dist, "assets", "app.js"), "export {};");
  const paths = {
    distDir: files.dist,
    approvalFile: files.approval,
    manifestFile: files.manifest,
  };
  return { dir, files, paths, built };
}
const problems = async (paths: Record<string, string>) =>
  publicReleaseBlockers(await loadDataset(paths), CLEAN);

test("a consistent county artifact is identified from its shipped files, never from claims", async () => {
  const { dir, paths, built } = await shipped();
  try {
    const dataset = await loadDataset(paths);
    assert.equal(dataset.kind, "county");
    assert.equal(dataset.content?.distPath, `data/${built.file}`);
    assert.equal(dataset.content?.sha256, built.record.content.sha256);
    assert.equal(
      dataset.sourceManifestSha256,
      built.record.source.manifestSha256,
    );
    assert.deepEqual(dataset.inconsistencies, [
      "dataset was packaged from a manifest or approval record other than the committed ones",
    ]);
    const blockers = await problems(paths);
    assert.ok(blockers.some((b) => /dataset is not marked approved/.test(b)));
    // The committed blockers travel with the artifact so an audit lists them.
    assert.ok(
      blockers.some((b) => b.includes("Synthetic data is never releasable.")),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an approval flag that the committed record does not carry is a blocker", async () => {
  const { dir, paths, files } = await shipped();
  try {
    const record = JSON.parse(
      await readFile(join(files.dist, "data", "dataset.json"), "utf8"),
    );
    record.approval = {
      approved: true,
      approvedBy: "someone",
      approvedOn: "2026-06-01",
      blockers: [],
    };
    await writeFile(
      join(files.dist, "data", "dataset.json"),
      JSON.stringify(record),
    );
    const blockers = await problems(paths);
    assert.ok(
      blockers.some((b) => /shipped dataset approved differs/.test(b)),
      blockers.join("; "),
    );
    assert.ok(blockers.some((b) => /approvedBy differs/.test(b)));
    assert.ok(blockers.some((b) => /dataset is not marked approved/.test(b)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("altered, missing and substituted network content is caught by the artifact audit", async () => {
  const { dir, paths, files, built } = await shipped();
  try {
    const network = join(files.dist, "data", built.file);
    const original = await readFile(network);
    await writeFile(
      network,
      Buffer.concat([original.subarray(0, -2), Buffer.from(" }")]),
    );
    assert.ok(
      (await problems(paths)).some((b) => /content check failed.*hash/.test(b)),
    );
    await rm(network);
    assert.ok(
      (await problems(paths)).some((b) => /content check failed/.test(b)),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixture network data inside a county artifact is a blocker", async () => {
  const { dir, paths, files } = await shipped();
  try {
    await writeFile(
      join(files.dist, "assets", "review-network.js"),
      'export default {id:"fixture-h-0-0"};',
    );
    assert.ok(
      (await problems(paths)).some((b) =>
        /fixture network data found in assets\/review-network\.js/.test(b),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a fully approved committed record still blocks a package made from other than the committed manifest", async () => {
  // A hypothetical approval must name the composition it covers; learn it from an unapproved build of the same data.
  const probe = await shipped();
  const composition = probe.built.record.composition;
  await rm(probe.dir, { recursive: true, force: true });
  const approved = {
    ...makeCounty().approval,
    approved: true,
    approvedBy: "Owner",
    approvedOn: "2026-06-01",
    approvedComposition: composition,
    blockers: [],
  };
  const { dir, paths } = await shipped(approved);
  try {
    const blockers = await problems(paths);
    // Everything else is satisfied, so the only remaining reason is that this was not the reviewed manifest.
    assert.deepEqual(blockers, [
      "dataset was packaged from a manifest or approval record other than the committed ones",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
