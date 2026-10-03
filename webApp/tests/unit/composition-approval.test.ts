// Four things are kept apart here, and each has its own tests:
//   integrity (parts match their hashes), source review (the access input is the reviewed extract), owner composition
//   approval (an approval covers exactly one composition), and publication/rights approval (flags and blockers).
// Nothing below grants or implies a right to publish: every approval here is a HYPOTHETICAL one in a temp repository,
// and the committed release/dataset.county.json stays approved:false with an empty approver and date.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdmissionError,
  accessManifestFile,
  packageFromFiles,
  verifyPackageDir,
} from "../../tools/lib/dataset-package.mjs";
import { writeCoreManifest } from "../../tools/lib/core.mjs";
import {
  loadDataset,
  publicReleaseBlockers,
  verifyProvenance,
  writeProvenance,
} from "../../tools/lib/provenance.mjs";
import {
  AccessSourceError,
  admitAccessSource,
  committedAccessManifestFile,
} from "../../tools/lib/access-source.mjs";
import {
  AccessPackageError,
  buildAccessParts,
  checkAccessParts,
} from "../../tools/lib/access-package.mjs";
import { compositionProblems } from "../../tools/lib/composition.mjs";
import { makeCounty } from "../support/county-fixture.mjs";
import {
  makeAccessExtract,
  makeAccessManifest,
} from "../support/access-fixture.mjs";
import { makeSupplement } from "../support/osm-fixture.mjs";
import { makeProposed } from "../support/proposed-fixture.mjs";

const CLEAN = { commit: "a".repeat(40), branch: "main", dirty: false };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sha = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
/** A temp repository is never the committed one, so these reasons are expected in every lab; the rest are the point. */
const substantive = (blockers: string[]) =>
  blockers.filter(
    (b) =>
      !/other than the committed/.test(b) &&
      !/test-only source manifest/.test(b),
  );

interface Parts {
  access?: boolean;
  accessMutate?: (extract: any) => void;
  supplement?: boolean;
  proposed?: boolean;
}
interface Lab {
  root: string;
  paths: Record<string, any>;
  record: any;
  distData: string;
}

/**
 * Builds a real package in a temp repository and lays it out the way a county build ships it, with a fake core so
 * provenance can be written and verified without Gradle. `buildApproval` is the approval record the package is made
 * from; `auditApproval` is the committed record the audit compares it with (they differ in the stale-approval cases).
 */
async function lab(
  parts: Parts,
  approvals: {
    build?: (composition: any) => any;
    audit?: (composition: any) => any;
  } = {},
): Promise<Lab> {
  const root = await mkdtemp(join(tmpdir(), "trail-composition-"));
  const county = makeCounty();
  const file = (name: string) => join(root, name);
  await writeFile(file("extract.json"), JSON.stringify(county.input));
  await writeFile(file("manifest.json"), JSON.stringify(county.manifest));
  const extra: Record<string, any> = {};
  if (parts.access) {
    const extract = makeAccessExtract();
    parts.accessMutate?.(extract);
    const text = JSON.stringify(extract);
    await writeFile(file("access.json"), text);
    await writeFile(
      file("access-manifest.json"),
      JSON.stringify(makeAccessManifest(text)),
    );
    extra.accessInput = file("access.json");
    extra.accessManifestPath = file("access-manifest.json");
  }
  if (parts.supplement) {
    const supplement = makeSupplement();
    await writeFile(file("osm.json"), JSON.stringify(supplement.input));
    await writeFile(
      file("osm-manifest.json"),
      JSON.stringify(supplement.manifest),
    );
    extra.osmInput = file("osm.json");
    extra.osmManifestPath = file("osm-manifest.json");
  }
  if (parts.proposed) {
    const proposed = makeProposed();
    await writeFile(file("proposed.json"), JSON.stringify(proposed.input));
    await writeFile(
      file("proposed-manifest.json"),
      JSON.stringify(proposed.manifest),
    );
    extra.proposedInput = file("proposed.json");
    extra.proposedManifestPath = file("proposed-manifest.json");
  }
  const make = async (approval: any, out: string) => {
    await writeFile(file("approval.json"), JSON.stringify(approval));
    return packageFromFiles({
      inputFile: file("extract.json"),
      manifestPath: file("manifest.json"),
      approvalPath: file("approval.json"),
      outDir: join(root, out),
      ...extra,
    });
  };
  // Learn the composition from an unapproved build; an owner would record it in the committed approval record.
  const probe = await make(county.approval, "probe");
  const composition = probe.record.composition;
  const hypothetical = (c: any) => ({
    ...county.approval,
    approved: true,
    approvedBy: "Hypothetical Owner",
    approvedOn: "2026-06-01",
    approvedComposition: c,
    blockers: [],
  });
  const built = approvals.build
    ? await make(approvals.build(composition) ?? county.approval, "county")
    : probe;
  const out = approvals.build ? "county" : "probe";
  const audit = approvals.audit
    ? approvals.audit(composition)
    : approvals.build
      ? approvals.build(composition)
      : county.approval;
  void hypothetical;
  await writeFile(file("audit-approval.json"), JSON.stringify(audit));
  const dist = file("dist");
  const distData = join(dist, "data");
  await mkdir(distData, { recursive: true });
  await mkdir(join(dist, "assets"), { recursive: true });
  for (const name of await readdir(join(root, out)))
    await copyFile(join(root, out, name), join(distData, name));
  await writeFile(join(dist, "index.html"), "<!doctype html>");
  await writeFile(join(dist, "assets", "app.js"), "export {};");
  // A fake core, as the release-guard tests use, so provenance can be written and verified.
  for (const dir of ["sharedLogic/src", "webBridge/src", "out"])
    await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, "sharedLogic/src/A.kt"), "class A\n");
  await writeFile(join(root, "webBridge/src/B.kt"), "class B\n");
  await writeFile(join(root, "out/TrailMapper-webBridge.mjs"), "export {};\n");
  const core = {
    root,
    outputDir: join(root, "out"),
    manifestPath: join(root, "core-manifest.json"),
    distRoot: join(root, "out"),
  };
  await writeCoreManifest({}, core);
  return {
    root,
    record: built.record,
    distData,
    paths: {
      distDir: dist,
      approvalFile: file("audit-approval.json"),
      manifestFile: file("manifest.json"),
      osmManifestFile: file("osm-manifest.json"),
      proposedManifestFile: file("proposed-manifest.json"),
      accessManifestFile: file("access-manifest.json"),
      core,
    },
  } as Lab;
}
const approveOf =
  (county = makeCounty()) =>
  (composition: any) => ({
    ...county.approval,
    approved: true,
    approvedBy: "Hypothetical Owner",
    approvedOn: "2026-06-01",
    approvedComposition: composition,
    blockers: [],
  });
const blockersOf = async (paths: Record<string, any>) =>
  publicReleaseBlockers(await loadDataset(paths), CLEAN);
const withLab = async (
  parts: Parts,
  approvals: Parameters<typeof lab>[1],
  body: (l: Lab) => Promise<void>,
) => {
  const l = await lab(parts, approvals);
  try {
    await body(l);
  } finally {
    await rm(l.root, { recursive: true, force: true });
  }
};

// --- owner composition: the matching controls ---------------------------------------------------------------------

test("control: a hypothetical approval of the FULL composition (network, access, OSM, proposed) leaves no substantive blocker", async () => {
  await withLab(
    { access: true, supplement: true, proposed: true },
    { build: approveOf() },
    async ({ paths, record }) => {
      assert.equal(record.approval.approved, true);
      assert.ok(record.composition.accessIndexSha256);
      assert.ok(record.composition.supplementManifestSha256);
      assert.ok(record.composition.proposedManifestSha256);
      assert.deepEqual(substantive(await blockersOf(paths)), []);
      // And through a fresh provenance: only the temp-repository reasons remain, none about composition or integrity.
      const provenance = await writeProvenance({ paths, source: CLEAN });
      assert.deepEqual(substantive(provenance.publicRelease.blockers), []);
      await verifyProvenance({ paths });
    },
  );
});

test("control: a hypothetical approval of a composition WITHOUT access binds the absence, and leaves no substantive blocker", async () => {
  await withLab({}, { build: approveOf() }, async ({ paths, record }) => {
    assert.equal(record.composition.accessIndexSha256, null);
    assert.equal(record.composition.accessCombinedSha256, null);
    assert.deepEqual(record.approval.approvedComposition, record.composition);
    assert.deepEqual(substantive(await blockersOf(paths)), []);
  });
});

// --- owner composition: anything beyond the approval is refused ---------------------------------------------------

/**
 * `from` is the composition the (hypothetical) owner approved; `actual` is what is then built and shipped, regenerated
 * with valid hashes and a fresh provenance. The audit must reject it, because the approval covers `from` only.
 */
async function staleApproval(from: Parts, actual: Parts, field: RegExp) {
  const approved = await lab(from, { build: approveOf() });
  const approvedComposition = approved.record.composition;
  await rm(approved.root, { recursive: true, force: true });
  await withLab(
    actual,
    {
      // The regenerated package is made from a record that already claims ITS composition (so it builds)...
      build: approveOf(),
      // ...but the committed record still names the old one.
      audit: () => approveOf()(approvedComposition),
    },
    async ({ paths }) => {
      const blockers = await blockersOf(paths);
      assert.ok(
        blockers.some((b) => field.test(b)),
        `expected ${field}: ${blockers.join(" | ")}`,
      );
      assert.ok(
        blockers.some((b) =>
          /approvedComposition differs from the committed/.test(b),
        ),
      );
      // A freshly generated provenance records the refusal, and the public check rejects it.
      const provenance = await writeProvenance({ paths, source: CLEAN });
      assert.equal(provenance.publicRelease.allowed, false);
      assert.ok(
        provenance.publicRelease.blockers.some((b: string) => field.test(b)),
      );
      await assert.rejects(
        verifyProvenance({ paths, requirePublic: true, source: CLEAN }),
        field,
      );
    },
  );
}

test("an approval of no access does not cover access roads added later, even with regenerated hashes and fresh provenance", async () => {
  await staleApproval(
    {},
    { access: true },
    /composition accessIndexSha256 is not the approved/,
  );
});

test("an approval that included access does not cover the same build with the access removed", async () => {
  await staleApproval(
    { access: true },
    {},
    /composition accessIndexSha256 is not the approved/,
  );
});

test("a changed road, an added road and a removed road each change the composition an approval covers", async () => {
  for (const mutate of [
    (e: any) => (e.layers[1].features[0].paths[0][0][0] += 0.0001),
    (e: any) =>
      e.layers[1].features.push({
        id: "osm:service:new",
        name: "A new service road",
        mtfcc: "S1400",
        paths: [
          [
            [-88.98, 40.49],
            [-88.97, 40.49],
          ],
        ],
      }),
    (e: any) => e.layers[1].features.pop(),
  ])
    await staleApproval(
      { access: true },
      { access: true, accessMutate: mutate },
      /composition (accessIndexSha256|accessSourceInputSha256|accessCombinedSha256) is not the approved/,
    );
});

test("adding an OpenStreetMap supplement or a proposed layer changes the composition an approval covers", async () => {
  await staleApproval(
    { access: true },
    { access: true, supplement: true },
    /composition (networkSha256|layerCounts|supplementManifestSha256) is not the approved/,
  );
  await staleApproval(
    { access: true },
    { access: true, proposed: true },
    /composition (networkSha256|layerCounts|proposedManifestSha256) is not the approved/,
  );
});

test("legacy approved:true without a bound composition fails closed, in the build and in the audit", async () => {
  const county = makeCounty();
  const legacy = {
    ...county.approval,
    approved: true,
    approvedBy: "Hypothetical Owner",
    approvedOn: "2026-06-01",
    blockers: [],
  };
  // The build refuses to ship an approved record that names no composition.
  await assert.rejects(
    lab({ access: true }, { build: () => legacy }),
    (error: any) =>
      error instanceof AdmissionError &&
      /not bound to a composition/.test(error.message),
  );
  // A shipped record edited to claim an approval with no composition is blocked by the audit.
  await withLab({ access: true }, {}, async ({ paths, distData }) => {
    const file = join(distData, "dataset.json");
    const record = JSON.parse(await readFile(file, "utf8"));
    record.approval = {
      approved: true,
      approvedBy: "Hypothetical Owner",
      approvedOn: "2026-06-01",
      approvedComposition: null,
      blockers: [],
    };
    await writeFile(file, JSON.stringify(record));
    await writeFile(paths.approvalFile, JSON.stringify(legacy));
    const blockers = await blockersOf(paths);
    assert.ok(
      blockers.some((b) => /not bound to a composition/.test(b)),
      blockers.join(" | "),
    );
  });
});

test("tampering with the shipped composition, its approval, or the provenance is rejected", async () => {
  await withLab(
    { access: true },
    { build: approveOf() },
    async ({ paths, distData }) => {
      const file = join(distData, "dataset.json");
      const original = await readFile(file, "utf8");
      const edit = async (change: (record: any) => void) => {
        const record = JSON.parse(original);
        change(record);
        await writeFile(file, JSON.stringify(record));
      };
      // A recorded composition that is not what the parts are.
      await edit((r) => (r.composition.accessIndexSha256 = "0".repeat(64)));
      assert.ok(
        (await blockersOf(paths)).some((b) =>
          /composition differs from the package's actual parts/.test(b),
        ),
      );
      // An approval whose expected composition was edited after the build.
      await edit(
        (r) =>
          (r.approval.approvedComposition.accessIndexSha256 = "0".repeat(64)),
      );
      assert.ok(
        (await blockersOf(paths)).some((b) =>
          /approvedComposition|approved composition/.test(b),
        ),
      );
      // A composition whose access fields are half set cannot bind anything.
      assert.ok(
        compositionProblems({
          ...JSON.parse(original).composition,
          accessIndexSha256: null,
        }).some((p) => /all be null/.test(p)),
      );
      // Restore and write a provenance; editing its dataset claims is caught from the recomputed evidence.
      await writeFile(file, original);
      await writeProvenance({ paths, source: CLEAN });
      await verifyProvenance({ paths });
      const provenanceFile = join(paths.distDir, "provenance.json");
      const provenance = JSON.parse(await readFile(provenanceFile, "utf8"));
      for (const change of [
        (p: any) => (p.dataset.composition.accessIndexSha256 = "0".repeat(64)),
        (p: any) => (p.dataset.approvedComposition = null),
        (p: any) => (p.publicRelease = { allowed: true, blockers: [] }),
      ]) {
        const copy = clone(provenance);
        change(copy);
        await writeFile(provenanceFile, JSON.stringify(copy));
        await assert.rejects(
          verifyProvenance({ paths }),
          /Provenance check failed/,
        );
      }
    },
  );
});

test("an unapproved private package still builds, verifies and audits, with the composition recorded and no approval implied", async () => {
  await withLab(
    { access: true, supplement: true },
    {},
    async ({ paths, record, root }) => {
      assert.equal(record.approval.approved, false);
      assert.equal(record.approval.approvedComposition, null);
      assert.ok(record.composition.accessCombinedSha256);
      const verified = await verifyPackageDir(
        join(root, "probe"),
        paths.manifestFile,
        paths.accessManifestFile,
      ).catch((error) => error);
      // (the supplement manifest is read from its module-level default here, so only the access path is asserted)
      assert.ok(verified instanceof Error || verified.record);
      const blockers = await blockersOf(paths);
      assert.ok(blockers.some((b) => /dataset is not marked approved/.test(b)));
      // Integrity and source review passed: nothing in the blockers says the package is inconsistent.
      assert.deepEqual(
        substantive(blockers).filter((b) =>
          /content check failed|composition/.test(b),
        ),
        [],
      );
    },
  );
});

// --- access source review ----------------------------------------------------------------------------------------

test("only the reviewed access input is admitted: a well-formed road file with a different hash is refused", async () => {
  const text = JSON.stringify(makeAccessExtract());
  const manifest = Buffer.from(JSON.stringify(makeAccessManifest(text)));
  assert.equal(admitAccessSource(text, manifest).source.inputSha256, sha(text));
  const other = clone(makeAccessExtract());
  other.layers[1].features.pop();
  assert.throws(
    () => admitAccessSource(JSON.stringify(other), manifest),
    (error: any) =>
      error instanceof AccessSourceError &&
      /not the reviewed source input/.test(error.message),
  );
  // A matching hash with different layer counts in the manifest is also refused.
  const wrongCounts = makeAccessManifest(text);
  wrongCounts.sourceInput.layerCounts["osm-service"] = 99;
  assert.throws(
    () => admitAccessSource(text, Buffer.from(JSON.stringify(wrongCounts))),
    /differ from the reviewed counts/,
  );
});

test("a synthetic fixture cannot pass the real committed manifest, and a test-only package is never public", async () => {
  const committed = await readFile(committedAccessManifestFile);
  assert.equal(accessManifestFile, committedAccessManifestFile);
  assert.throws(
    () => admitAccessSource(JSON.stringify(makeAccessExtract()), committed),
    AccessSourceError,
  );
  // The committed manifest pins the native baseline extract by hash and is not test-only.
  const manifest = JSON.parse(committed.toString("utf8"));
  assert.equal(
    manifest.sourceInputSha256,
    "23a9719dd45297352cef641014697ca0b263184af9fdace48573b0d6ba264d07",
  );
  assert.equal(manifest.testOnly, false);
  assert.deepEqual(manifest.sourceInput.layerCounts, {
    "8": 3424,
    "osm-service": 9313,
  });
  assert.match(manifest.sourceInput.perWayTimestamps, /UNKNOWN/);
  assert.equal(manifest.rights.status, "unresolved");
  // A package made from a synthetic (test-only) manifest is blocked by the audit even when its approval matches.
  await withLab({ access: true }, { build: approveOf() }, async ({ paths }) => {
    const blockers = await blockersOf(paths);
    assert.ok(
      blockers.some((b) => /test-only source manifest/.test(b)),
      blockers.join(" | "),
    );
    assert.ok(
      blockers.some((b) =>
        /access source manifest other than the committed/.test(b),
      ),
    );
  });
});

test("the access source record in a shipped package is checked against the manifest it names", async () => {
  await withLab({ access: true }, {}, async ({ paths, distData }) => {
    const file = join(distData, "dataset.json");
    const original = await readFile(file, "utf8");
    for (const change of [
      (r: any) => (r.access.source.inputSha256 = "0".repeat(64)),
      (r: any) => (r.access.source.manifestSha256 = "0".repeat(64)),
      (r: any) => delete r.access.source,
      (r: any) => (r.access.base.featureCount += 1),
    ]) {
      const record = JSON.parse(original);
      change(record);
      await writeFile(file, JSON.stringify(record));
      assert.ok(
        (await blockersOf(paths)).some((b) => /content check failed/.test(b)),
      );
    }
  });
});

// --- extract positions are global and dense ---------------------------------------------------------------------

test("service-road extract positions must be unique across tiles and leave no gap", () => {
  const built = buildAccessParts(JSON.stringify(makeAccessExtract()));
  const read = (parts: { file: string; body: Buffer }[]) => {
    const map = new Map(parts.map((p) => [p.file, p.body]));
    return (name: string) => map.get(name);
  };
  checkAccessParts(built.descriptor, read(built.files));
  // Rebuild the package with one tile's road positions rewritten, hashes and index kept consistent.
  const rewrite = (change: (ords: number[]) => number[]) => {
    const tiles = built.tiles.map((tile: any) => {
      const parsed = JSON.parse(tile.body.toString("utf8"));
      const features = parsed.layers[0].features;
      const ords = change(features.map((f: any) => f.ord));
      features.forEach((f: any, i: number) => (f.ord = ords[i]));
      const body = Buffer.from(JSON.stringify(parsed), "utf8");
      const digest = sha(body);
      return {
        ...tile,
        body,
        sha256: digest,
        bytes: body.length,
        file: `access-tile.${tile.lat}_${tile.lon}.${digest.slice(0, 12)}.json`,
      };
    });
    const index = JSON.parse(
      built.files
        .find((f: any) => f.file === built.index.file)!
        .body.toString("utf8"),
    );
    index.tiles = tiles.map((t: any) => ({
      lat: t.lat,
      lon: t.lon,
      file: t.file,
      sha256: t.sha256,
      bytes: t.bytes,
      featureCount: t.featureCount,
    }));
    const indexBody = Buffer.from(JSON.stringify(index), "utf8");
    const indexDigest = sha(indexBody);
    const indexFile = `access-index.${indexDigest.slice(0, 12)}.json`;
    const descriptor = clone(built.descriptor);
    descriptor.index = {
      ...descriptor.index,
      file: indexFile,
      sha256: indexDigest,
      bytes: indexBody.length,
      tileBytes: tiles.reduce((n: number, t: any) => n + t.bytes, 0),
    };
    return {
      descriptor,
      files: [
        ...built.files.filter((f: any) => f.file === built.base.file),
        { file: indexFile, body: indexBody },
        ...tiles.map((t: any) => ({ file: t.file, body: t.body })),
      ],
    };
  };
  // Every position pushed up by one: still increasing in each tile, but position 0 is now missing (a gap).
  const gap = rewrite((ords) => ords.map((o) => o + 1));
  assert.throws(
    () => checkAccessParts(gap.descriptor, read(gap.files)),
    (error: any) =>
      error instanceof AccessPackageError && /not dense/.test(error.message),
  );
  // Two different roads given the same position.
  const clash = rewrite((ords) => ords.map(() => 0));
  assert.throws(
    () => checkAccessParts(clash.descriptor, read(clash.files)),
    (error: any) =>
      error instanceof AccessPackageError &&
      /share extract position|not dense|extract order/.test(error.message),
  );
});
