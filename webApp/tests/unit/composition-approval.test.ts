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
  buildPackage,
  checkPackage,
  packageFromFiles,
  sourceContractOf,
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
import {
  compositionProblems,
  manifestDigest,
  reconstructComposition,
} from "../../tools/lib/composition.mjs";
import { checkSupplementLayer } from "../../tools/lib/osm-supplement.mjs";
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
  /** Changes the county manifest and the extract it was made from together (source evidence), geometry untouched. */
  countyMutate?: (county: any) => void;
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
  parts.countyMutate?.(county);
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

test("an unapproved private package still builds, round-trips through verifyPackageDir and audits, and tampered or mis-pinned copies are refused", async () => {
  await withLab({ access: true }, {}, async ({ paths, record, root }) => {
    assert.equal(record.approval.approved, false);
    assert.equal(record.approval.approvedComposition, null);
    assert.ok(record.composition.accessCombinedSha256);
    // A real successful round trip: the very record that was built comes back, with every access part used.
    const out = join(root, "probe");
    const verified = await verifyPackageDir(
      out,
      paths.manifestFile,
      paths.accessManifestFile,
    );
    assert.deepEqual(verified.record, record);
    assert.equal(
      verified.accessFiles.length,
      2 + record.access.index.tileCount,
    );
    assert.equal(verified.network.schema, "trail-mapper.network/1");
    const blockers = await blockersOf(paths);
    assert.ok(blockers.some((b) => /dataset is not marked approved/.test(b)));
    assert.deepEqual(
      substantive(blockers).filter((b) =>
        /content check failed|composition/.test(b),
      ),
      [],
    );
    // Rejected controls, each for its own reason (a refusal here must not be an accident of the setup).
    const tile = (await readdir(out)).find((n) =>
      n.startsWith("access-tile."),
    )!;
    const original = await readFile(join(out, tile));
    const copy = Buffer.from(original);
    copy[copy.length - 3] ^= 1;
    await writeFile(join(out, tile), copy);
    await assert.rejects(
      verifyPackageDir(out, paths.manifestFile, paths.accessManifestFile),
      (error: any) =>
        error instanceof AdmissionError && /recorded hash/.test(error.message),
    );
    await writeFile(join(out, tile), original);
    // The same package checked against the committed (real) access manifest is not that package's source review.
    await assert.rejects(
      verifyPackageDir(out, paths.manifestFile, committedAccessManifestFile),
      (error: any) =>
        error instanceof AdmissionError &&
        /different source manifest/.test(error.message),
    );
    await verifyPackageDir(out, paths.manifestFile, paths.accessManifestFile);
  });
  // With an OpenStreetMap supplement too, the audit still judges the shipped files cleanly.
  await withLab({ access: true, supplement: true }, {}, async ({ paths }) => {
    assert.deepEqual(
      substantive(await blockersOf(paths)).filter((b) =>
        /content check failed|composition/.test(b),
      ),
      [],
    );
  });
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

// --- the county source manifest is part of the composition ----------------------------------------------------

test("changed county source evidence with identical network geometry is a different composition", async () => {
  const county = makeCounty();
  const make = (c: any, approval: any = c.approval) =>
    buildPackage({
      inputText: JSON.stringify(c.input),
      manifest: c.manifest,
      manifestBytes: Buffer.from(JSON.stringify(c.manifest)),
      approval,
    });
  const original = await make(county);
  const revised = clone(county);
  revised.manifest.licensedItemId =
    "different-hypothetical-rightsholder-source";
  revised.input.sources.licensedItemId = revised.manifest.licensedItemId;
  const rebuilt = await make(revised);
  // The network the router reads is byte-for-byte the same, yet the reviewed source evidence differs...
  assert.ok(rebuilt.body.equals(original.body));
  assert.notEqual(
    rebuilt.record.composition.countyManifestSha256,
    original.record.composition.countyManifestSha256,
  );
  // ...so an approval of the old composition does not carry over: building from it is refused.
  await assert.rejects(
    make(revised, {
      ...revised.approval,
      approved: true,
      approvedBy: "Synthetic test only",
      approvedOn: "2026-01-01",
      approvedComposition: original.record.composition,
      blockers: [],
    }),
    (error: any) =>
      error instanceof AdmissionError &&
      /countyManifestSha256 is not the approved composition/.test(
        error.message,
      ),
  );
  // And through the audit, with a regenerated package and a fresh provenance.
  await staleApproval(
    {},
    {
      countyMutate: (c: any) => {
        c.manifest.licensedItemId =
          "different-hypothetical-rightsholder-source";
        c.input.sources.licensedItemId = c.manifest.licensedItemId;
      },
    },
    /composition countyManifestSha256 is not the approved/,
  );
});

test("a manifest digest ignores line endings (Windows checkout vs GitHub LF) and nothing else", () => {
  const lf = Buffer.from('{"a":1,\n"b":2}\n');
  assert.equal(
    manifestDigest(lf),
    manifestDigest(Buffer.from(lf.toString().replace(/\n/g, "\r\n"))),
  );
  assert.notEqual(
    manifestDigest(lf),
    manifestDigest(Buffer.from('{"a":1,\n"b":3}\n')),
  );
  assert.notEqual(
    manifestDigest(lf),
    manifestDigest(Buffer.from('{"a":1, \n"b":2}\n')),
  );
});

// --- the access source audit judges the TRANSFORM, not the labels ---------------------------------------------

/**
 * A package as an attacker (or a bug) could forge it: content replaced, then every hash rehashed to be consistent (tile,
 * index, base, combined identity, version, composition) while the genuine source labels are kept. Nothing about it is
 * inconsistent except that it is not the reviewed content.
 */
async function forged(change: {
  base?: (base: any) => void;
  tile?: (features: any[]) => void;
}) {
  const county = makeCounty();
  const extract: any = makeAccessExtract();
  // A second base road, so base order and identity can be replaced without changing any count.
  extract.layers[0].features.push({
    id: "tiger:second",
    name: "Second synthetic base road",
    mtfcc: "S1400",
    paths: [
      [
        [-88.9, 40.55],
        [-88.89, 40.55],
      ],
    ],
  });
  const inputText = JSON.stringify(extract);
  const accessManifestBytes = Buffer.from(
    JSON.stringify(makeAccessManifest(inputText)),
  );
  const manifestBytes = Buffer.from(JSON.stringify(county.manifest));
  const built = await buildPackage({
    inputText: JSON.stringify(county.input),
    manifest: county.manifest,
    manifestBytes,
    approval: county.approval,
    access: { inputText, manifestBytes: accessManifestBytes },
  });
  const map = new Map<string, Buffer>(
    built.accessFiles.map((p: any) => [p.file, Buffer.from(p.body)]),
  );
  const record = clone(built.record);
  const named = (prefix: string, body: Buffer) =>
    `${prefix}.${sha(body).slice(0, 12)}.json`;
  if (change.base) {
    const base = JSON.parse(map.get(record.access.base.file)!.toString());
    change.base(base);
    const body = Buffer.from(JSON.stringify(base));
    record.access.base = {
      ...record.access.base,
      file: named("access-base", body),
      sha256: sha(body),
      bytes: body.length,
    };
    map.set(record.access.base.file, body);
  }
  const index = JSON.parse(map.get(record.access.index.file)!.toString());
  index.base = { ...record.access.base };
  let tileBytes = 0;
  // A change to a tile applies to every cell the road is in, so the tiles stay consistent with one another.
  const edits = new Map<string, any>();
  for (const entry of index.tiles) {
    const parsed = JSON.parse(map.get(entry.file)!.toString());
    const features = parsed.layers[0].features;
    if (change.tile) change.tile(features);
    const body = Buffer.from(JSON.stringify(parsed));
    entry.file = `access-tile.${entry.lat}_${entry.lon}.${sha(body).slice(0, 12)}.json`;
    entry.sha256 = sha(body);
    entry.bytes = body.length;
    tileBytes += body.length;
    map.set(entry.file, body);
    edits.set(entry.file, true);
  }
  const indexBody = Buffer.from(JSON.stringify(index));
  record.access.index = {
    ...record.access.index,
    file: named("access-index", indexBody),
    sha256: sha(indexBody),
    bytes: indexBody.length,
    tileBytes,
  };
  map.set(record.access.index.file, indexBody);
  record.access.combinedSha256 = sha(
    Buffer.from(`${record.content.sha256}:${record.access.index.sha256}`),
  );
  record.version = `${record.version.slice(0, record.version.lastIndexOf(".") + 1)}${record.access.combinedSha256.slice(0, 12)}`;
  record.composition = reconstructComposition({
    record,
    body: built.body,
    network: JSON.parse(built.body.toString()),
    readPart: (name: string) => map.get(name),
    manifestBytes,
    accessManifestBytes,
  });
  const check = () =>
    checkPackage(
      record,
      built.body,
      manifestBytes,
      null,
      (name: string) => map.get(name),
      null,
      accessManifestBytes,
    );
  return { record, check };
}
const notTheTransform = (error: any) =>
  error instanceof AdmissionError &&
  /reviewed transform of the reviewed source input/.test(error.message);

test("control: the forging helper itself, with no change, produces a package that checks", async () => {
  const { check } = await forged({});
  check();
});

test("consistent same-count replacements of the base roads, with genuine source labels, are refused", async () => {
  for (const change of [
    // a moved vertex
    (base: any) => (base.layers[0].features[0].paths[0][0][0] += 0.0001),
    // a replaced identity
    (base: any) => (base.layers[0].features[0].id = "tiger:other"),
    // a replaced order
    (base: any) => base.layers[0].features.reverse(),
  ]) {
    const { record, check } = await forged({ base: change });
    assert.equal(record.access.source.inputSha256.length, 64); // the genuine label is still there
    assert.throws(check, notTheTransform);
  }
});

test("consistent same-count replacements of the service roads (geometry, identity, order), with genuine source labels, are refused", async () => {
  const everywhere =
    (apply: (feature: any) => void, only?: string) => (features: any[]) =>
      features.forEach((f) => (!only || f.id === only) && apply(f));
  for (const change of [
    // a moved vertex (the middle one: it stays in its cells)
    everywhere((f) => (f.paths[0][1][1] += 0.0001), "osm:service:1"),
    // a replaced identity
    everywhere((f) => (f.id = "osm:service:renamed"), "osm:service:far"),
    // a swapped extract order between the two roads
    everywhere((f) => (f.ord = 1 - f.ord)),
  ]) {
    const { check } = await forged({ tile: change });
    assert.throws(check, notTheTransform);
  }
});

// --- ONE source contract: no copied descriptor is trusted -----------------------------------------------------

const buildWith = (c: any, extra: any = {}, approval: any = c.approval) =>
  buildPackage({
    inputText: JSON.stringify(c.input),
    manifest: c.manifest,
    manifestBytes: Buffer.from(JSON.stringify(c.manifest)),
    approval,
    ...extra,
  });
const countyManifestBytes = (c: any) => Buffer.from(JSON.stringify(c.manifest));
const refusedWith = (pattern: RegExp) => (error: any) =>
  error instanceof AdmissionError && pattern.test(error.message);

test("admission: the extract's own source descriptors must be the reviewed ones (each field, with a valid control)", async () => {
  const county = makeCounty();
  await buildWith(county); // control: the genuine extract is admitted
  const cases: [string, (sources: any) => void, RegExp][] = [
    [
      "licence evidence URL",
      (s) =>
        (s.licenseEvidenceUrl = "https://example.test/unreviewed-evidence"),
      /licence-evidence URL/,
    ],
    [
      "licence evidence hash",
      (s) => (s.licenseEvidenceSha256 = "f".repeat(64)),
      /licence-evidence hash/,
    ],
    [
      "missing licence evidence hash",
      (s) => delete s.licenseEvidenceSha256,
      /licence-evidence hash/,
    ],
    [
      "change disclosure",
      (s) => (s.changes = "Nothing was changed."),
      /change disclosure or disclaimer/,
    ],
    [
      "disclaimer",
      (s) => (s.disclaimer = "Guaranteed accurate."),
      /change disclosure or disclaimer/,
    ],
    ["licence", (s) => (s.license = "CC0"), /license does not match/],
    [
      "licence URL",
      (s) => (s.licenseUrl = "https://example.test/license"),
      /license does not match/,
    ],
    [
      "licensed source URL",
      (s) => (s.licensedSourceUrl = "https://example.test/source"),
      /reviewed licensed source/,
    ],
    [
      "licensed item",
      (s) => (s.licensedItemId = "other-item"),
      /reviewed licensed source/,
    ],
  ];
  for (const [name, mutate, pattern] of cases) {
    const changed = clone(county);
    mutate(changed.input.sources);
    await assert.rejects(buildWith(changed), refusedWith(pattern), name);
  }
  // The review date is its own fact, distinct from the extraction-run time.
  const reviewed = clone(county);
  reviewed.input.reviewedOn = "2030-01-01";
  await assert.rejects(
    buildWith(reviewed),
    refusedWith(/different review date/),
  );
  // Extraction-run time is an observation: a new run of the same reviewed data is admitted, and it is not review time.
  const rerun = clone(county);
  rerun.input.generatedAtUtc = "2031-02-03T04:05:06+00:00";
  const built = await buildWith(rerun);
  assert.equal(built.record.source.extractedAtUtc, "2031-02-03T04:05:06+00:00");
  assert.equal(built.record.source.reviewedOn, county.manifest.reviewedOn);
  // A manifest with no source contract cannot admit anything.
  const bare = clone(county);
  delete bare.manifest.sourceContract;
  await assert.rejects(buildWith(bare), refusedWith(/no source contract/));
  // Changed extract evidence under an old (hypothetical) approval cannot slip through either.
  const baseline = await buildWith(county);
  const changed = clone(county);
  changed.input.sources.licenseEvidenceUrl =
    "https://example.test/unreviewed-evidence";
  changed.input.sources.licenseEvidenceSha256 = "f".repeat(64);
  await assert.rejects(
    buildWith(
      changed,
      {},
      {
        ...county.approval,
        approved: true,
        approvedBy: "Synthetic test only",
        approvedOn: "2026-01-01",
        approvedComposition: baseline.record.composition,
        blockers: [],
      },
    ),
    AdmissionError,
  );
});

test("audit: every copied source descriptor in a shipped record must be the reviewed one (each field, with a valid control)", async () => {
  const county = makeCounty();
  const built = await buildWith(county);
  const check = (record: any) =>
    checkPackage(record, built.body, countyManifestBytes(county));
  check(built.record); // valid control
  const fields: [string, string][] = [
    ["license", "Synthetic unsupported license"],
    ["licenseUrl", "https://example.test/unreviewed-license"],
    ["licensedSourceUrl", "https://example.test/unreviewed-source"],
    ["licensedItemId", "other-item"],
    ["licenseEvidenceUrl", "https://example.test/unreviewed-evidence"],
    ["licenseEvidenceSha256", "f".repeat(64)],
    ["reviewedOn", "2030-01-01"],
    ["evidenceVerifiedAtUtc", "2030-01-01T00:00:00+00:00"],
    ["changes", "Nothing changed."],
    ["disclaimer", "Guaranteed accurate."],
  ];
  const forgeries: [string, (record: any) => void, RegExp][] = [
    ...fields.map(
      ([field, value]) =>
        [
          `source.${field}`,
          (r: any) => (r.source[field] = value),
          new RegExp(`source ${field} is not the reviewed value`),
        ] as [string, (r: any) => void, RegExp],
    ),
    [
      "an extra source field",
      (r) => (r.source.grantedBy = "someone"),
      /unexpected or missing fields/,
    ],
    [
      "a removed source field",
      (r) => delete r.source.disclaimer,
      /unexpected or missing fields/,
    ],
    [
      "a non-text extraction time",
      (r) => (r.source.extractedAtUtc = 5),
      /no extraction time/,
    ],
    [
      "per-layer counts",
      (r) => (r.content.layerCounts = { "16": 99 }),
      /per-layer counts/,
    ],
    [
      "omitted proposed segments",
      (r) => (r.omitted.proposedFeatureIds = []),
      /omitted proposed segments/,
    ],
  ];
  for (const [name, forge, pattern] of forgeries) {
    const record = clone(built.record);
    forge(record);
    assert.throws(() => check(record), refusedWith(pattern), name);
  }
});

test("fresh provenance: a forged source descriptor in the shipped package is a blocker, even under a matching hypothetical approval", async () => {
  await withLab({}, { build: approveOf() }, async ({ paths, distData }) => {
    const file = join(distData, "dataset.json");
    const original = await readFile(file, "utf8");
    // control: the genuine package under its approved composition has no substantive blocker
    assert.deepEqual(substantive(await blockersOf(paths)), []);
    for (const [field, value] of [
      ["licenseEvidenceUrl", "https://example.test/unreviewed-evidence"],
      ["license", "Synthetic unsupported license"],
      ["reviewedOn", "2030-01-01"],
    ]) {
      const record = JSON.parse(original);
      record.source[field] = value;
      await writeFile(file, JSON.stringify(record));
      assert.ok(
        (await blockersOf(paths)).some((b) =>
          new RegExp(`content check failed.*source ${field}`).test(b),
        ),
        field,
      );
      const provenance = await writeProvenance({ paths, source: CLEAN });
      assert.equal(provenance.publicRelease.allowed, false);
      await assert.rejects(
        verifyProvenance({ paths, requirePublic: true, source: CLEAN }),
        /source/,
      );
    }
    await writeFile(file, original);
    assert.deepEqual(substantive(await blockersOf(paths)), []);
  });
});

test("optional layers: every copied descriptor of the OpenStreetMap supplement and the proposed layer is recomputed (valid controls included)", async () => {
  const county = makeCounty();
  for (const kind of ["OSM", "Proposed"] as const) {
    const fixture = kind === "OSM" ? makeSupplement() : makeProposed();
    const part = {
      inputText: JSON.stringify(fixture.input),
      manifest: fixture.manifest,
      manifestBytes: Buffer.from(JSON.stringify(fixture.manifest)),
    };
    const built = await buildWith(
      county,
      kind === "OSM" ? { supplement: part } : { proposed: part },
    );
    const check = (record: any) =>
      checkPackage(
        record,
        built.body,
        countyManifestBytes(county),
        kind === "OSM" ? part.manifestBytes : null,
        undefined,
        kind === "Proposed" ? part.manifestBytes : null,
      );
    check(built.record); // valid control
    const descriptorOf = (record: any) =>
      kind === "OSM" ? record.supplements[0] : record.proposedLayer;
    const fields = Object.keys(descriptorOf(built.record)).filter(
      (f) => f !== "manifestSha256",
    );
    assert.ok(fields.length >= 6, `${kind} descriptor fields: ${fields}`);
    for (const field of fields) {
      const record = clone(built.record);
      const descriptor = descriptorOf(record);
      const value = descriptor[field];
      descriptor[field] =
        typeof value === "number"
          ? value + 1
          : Array.isArray(value)
            ? [...value, "forged"]
            : `${value}-forged`;
      assert.throws(
        () => check(record),
        (error: any) => error instanceof AdmissionError,
        `${kind}.${field}`,
      );
    }
    // A dropped or added descriptor field is also refused.
    for (const change of [
      (d: any) => delete d.reviewedOn,
      (d: any) => (d.grantedBy = "someone"),
    ]) {
      const record = clone(built.record);
      change(descriptorOf(record));
      assert.throws(() => check(record), AdmissionError);
    }
  }
});

test("the committed source contract is real and unapproved: evidence recorded as an observation, rights unresolved", async () => {
  const root = join(process.cwd(), "..");
  const manifest = JSON.parse(
    await readFile(
      join(root, "data", "web-reviewed-trails.manifest.json"),
      "utf8",
    ),
  );
  const contract = sourceContractOf(manifest);
  assert.equal(
    contract.evidenceSha256,
    "5123f51c9a79f75e3b386b108437e383b99702c78a63cc60dc2f077253c28845",
  );
  assert.match(manifest.sourceContract.scope, /NOT a pinned fact/);
  assert.match(
    manifest.sourceContract.licenseEvidenceObservation.meaning,
    /distinct from the review date/,
  );
  // The reviewed facts are the manifest's own top-level fields; the review date and the run time are not the same thing.
  assert.equal(manifest.reviewedOn, "2026-09-28");
  assert.notEqual(
    manifest.sourceContract.licenseEvidenceObservation.observedAtUtc.slice(
      0,
      10,
    ),
    manifest.reviewedOn,
  );
  const approval = JSON.parse(
    await readFile(
      join(process.cwd(), "release", "dataset.county.json"),
      "utf8",
    ),
  );
  assert.equal(approval.approved, false);
  assert.equal(approval.approvedBy, null);
  assert.equal(approval.approvedOn, null);
  assert.equal(approval.approvedComposition, null);
  const proposed = JSON.parse(
    await readFile(
      join(root, "data", "web-proposed-trails.manifest.json"),
      "utf8",
    ),
  );
  assert.notEqual(proposed.rights?.status, "granted");
});

// --- cardinality: one layer, one descriptor ---------------------------------------------------------------------

test("exactly one OpenStreetMap descriptor for the one supported layer: duplicates are refused at the artifact gate", async () => {
  const county = makeCounty();
  const fixture = makeSupplement();
  const part = {
    inputText: JSON.stringify(fixture.input),
    manifest: fixture.manifest,
    manifestBytes: Buffer.from(JSON.stringify(fixture.manifest)),
  };
  const withLayer = await buildWith(county, { supplement: part });
  const without = await buildWith(county);
  const checkWith = (record: any) =>
    checkPackage(
      record,
      withLayer.body,
      countyManifestBytes(county),
      part.manifestBytes,
    );
  const checkWithout = (record: any) =>
    checkPackage(record, without.body, countyManifestBytes(county));
  // Valid controls: a single descriptor with its layer; no descriptor (absent, and an empty list) with no layer.
  checkWith(withLayer.record);
  checkWithout(without.record);
  checkWithout({ ...clone(without.record), supplements: [] });
  const [descriptor] = withLayer.record.supplements;
  // The same descriptor twice.
  assert.throws(
    () =>
      checkWith({
        ...clone(withLayer.record),
        supplements: [clone(descriptor), clone(descriptor)],
      }),
    refusedWith(/at most one OpenStreetMap supplement/),
  );
  // A second descriptor with different, unsupported licence and attribution claims after the authenticated first.
  assert.throws(
    () =>
      checkWith({
        ...clone(withLayer.record),
        supplements: [
          clone(descriptor),
          {
            ...clone(descriptor),
            license: "Made-up licence",
            licenseUrl: "https://example.test/license",
            attribution: "Someone else",
          },
        ],
      }),
    refusedWith(/at most one OpenStreetMap supplement/),
  );
  // Three, and a descriptor appended to a package that has no layer at all.
  assert.throws(
    () =>
      checkWith({
        ...clone(withLayer.record),
        supplements: [descriptor, descriptor, descriptor],
      }),
    AdmissionError,
  );
  assert.throws(
    () =>
      checkWithout({
        ...clone(without.record),
        supplements: [clone(descriptor)],
      }),
    AdmissionError,
  );
  // The list shape is explicit: an object where a list belongs is refused, not iterated.
  assert.throws(
    () =>
      checkWith({ ...clone(withLayer.record), supplements: clone(descriptor) }),
    refusedWith(/at most one OpenStreetMap supplement, as a list/),
  );
  // The layer-level check refuses a repeated descriptor on its own too (it used to read only the first).
  const layer = JSON.parse(withLayer.body.toString("utf8")).layers.find(
    (l: any) => l.id === "verified-osm",
  );
  assert.throws(
    () =>
      checkSupplementLayer(
        layer,
        { supplements: [clone(descriptor), clone(descriptor)] },
        fixture.manifest,
        part.manifestBytes,
      ),
    /exactly one description/,
  );
  checkSupplementLayer(
    layer,
    { supplements: [clone(descriptor)] },
    fixture.manifest,
    part.manifestBytes,
  );
});
