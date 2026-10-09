import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { coreEntry } from "../../tools/lib/core.mjs";
import { canonicalSha256 } from "../../tools/lib/canonical-json.mjs";
import { buildPackage } from "../../tools/lib/dataset-package.mjs";
import {
  reviewRefresh,
  snapshotIdentity,
  REVIEW_SCHEMA,
} from "../../tools/lib/reviewed-refresh.mjs";
import {
  bindCompiledCatalog,
  runReviewedRouterControls,
} from "../../tools/lib/reviewed-router-controls.mjs";
import { makeCounty, DEFAULT_LIST } from "../support/county-fixture.mjs";
const skip = existsSync(coreEntry) ? false : "npm run build:core required";
const before = Date.parse("2026-09-20T00:00:00Z"),
  after = Date.parse("2027-10-01T00:00:00Z");
const p = (latitude, longitude) => ({ latitude, longitude });
async function fixture({ withAccess = false } = {}) {
  const core = await import(pathToFileURL(coreEntry).href);
  const catalog = JSON.parse(
    core.dispatch(JSON.stringify({ op: "closureCatalog" })),
  );
  assert.equal(catalog.ok, true);
  const list = [
    ...DEFAULT_LIST,
    [
      "54:9100",
      "Synthetic closure approach",
      ["TrailBranches"],
      [
        [
          [-88.984202, 40.5065],
          [-88.984202, 40.507656],
        ],
      ],
    ],
    [
      "54:1305",
      "Synthetic compiled closure interval",
      ["TrailBranches"],
      [
        [
          [-88.984202, 40.507656],
          [-88.984155, 40.509023],
        ],
      ],
    ],
    [
      "54:9101",
      "Synthetic closure exit",
      ["TrailBranches"],
      [
        [
          [-88.984155, 40.509023],
          [-88.984155, 40.5105],
        ],
      ],
    ],
  ];
  const county = makeCounty({ list });
  const manifestBytes = Buffer.from(JSON.stringify(county.manifest));
  let access = null;
  if (withAccess) {
    const { makeAccessExtract, makeAccessManifest } = await import(
      "../support/access-fixture.mjs"
    );
    const inputText = JSON.stringify(makeAccessExtract());
    access = {
      inputText,
      manifestBytes: Buffer.from(JSON.stringify(makeAccessManifest(inputText))),
    };
  }
  const snapshot = {
    ...(await buildPackage({
      inputText: JSON.stringify(county.input),
      manifest: county.manifest,
      manifestBytes,
      approval: county.approval,
      access,
    })),
    manifestBytes,
    ...(access ? { accessManifestBytes: access.manifestBytes } : {}),
  };
  snapshot.parts = Object.fromEntries(
    snapshot.accessFiles.map((part) => [part.file, part.body]),
  );
  const ledger = {
    schema: REVIEW_SCHEMA,
    dataset: snapshotIdentity(snapshot),
    closures: catalog.closures.map((c) => ({
      id: c.id,
      affectedIds: [c.featureId],
      compiledClosure: c,
      compiledSha256: canonicalSha256(c),
    })),
  };
  const report = reviewRefresh({
    baseline: snapshot,
    target: snapshot,
    ledger,
    candidates: [],
    decisions: [],
    policy: { reviewers: ["fixture-reviewer"], syntheticFixture: true },
    evidence: {},
  });
  const a = (path, equals) => ({ path, equals });
  const cases = [
    {
      id: "point",
      category: "point",
      saveAs: "rectangle",
      request: {
        op: "plan",
        start: p(40.5, -88.99),
        destination: p(40.52, -88.95),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], true)],
    },
    {
      id: "loop",
      category: "loop",
      request: {
        op: "plan",
        start: p(40.5, -88.99),
        miles: 3,
        proposed: false,
        now: before,
      },
      assertions: [a(["route", "kind"], "ExerciseLoop")],
    },
    {
      id: "detached",
      category: "disconnected",
      request: {
        op: "plan",
        start: p(40.5, -88.99),
        destination: p(40.55, -88.89),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], false)],
    },
    {
      id: "access",
      category: "unverified-access",
      request: {
        op: "plan",
        start: withAccess ? p(40.49753, -89) : p(40.499, -88.99),
        destination: p(40.52, -88.95),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], false)],
    },
    {
      id: "preclosure",
      category: "point",
      saveAs: "closed",
      request: {
        op: "plan",
        start: p(40.5065, -88.984202),
        destination: p(40.5105, -88.984155),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], true)],
    },
    {
      id: "closure-after-estimate",
      category: "closure",
      routeFrom: "closed",
      request: { op: "inspect", now: after },
      assertions: [
        a(["canNavigate"], false),
        a(["closures", "0", "id"], catalog.closures[0].id),
      ],
    },
    {
      id: "saved-current",
      category: "saved-route",
      routeFrom: "rectangle",
      request: { op: "inspect", now: after },
      assertions: [
        a(["network", "status"], "current"),
        a(["canNavigate"], true),
      ],
    },
  ];
  return { report, snapshot, cases, now: before, catalog, ledger };
}
test(
  "exact compiled catalog includes all scheduled and active rules; omitted or changed rules refuse admission",
  { skip },
  async () => {
    const { catalog, ledger } = await fixture();
    assert.equal(catalog.closures.length, 3);
    assert.ok(catalog.closures.some((c) => c.boundsProjected));
    assert.ok(catalog.closures.some((c) => c.isCrossing));
    assert.equal(
      bindCompiledCatalog(ledger, catalog),
      canonicalSha256(catalog.closures),
    );
    const changed = structuredClone(ledger);
    changed.closures.pop();
    assert.throws(
      () => bindCompiledCatalog(changed, catalog),
      /complete compiled/,
    );
    const altered = structuredClone(ledger);
    altered.closures[0].compiledClosure.activeFromEpochMillis++;
    assert.throws(
      () => bindCompiledCatalog(altered, catalog),
      /exact reviewed closure/,
    );
  },
);
test(
  "verified real core runs package-bound point/loop/access/closure/saved-route admission controls",
  { skip },
  async () => {
    const args = await fixture();
    const result = await runReviewedRouterControls(args);
    if (process.env.TRAIL_REVIEW_CONTROL_REPORT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        process.env.TRAIL_REVIEW_CONTROL_REPORT,
        JSON.stringify(result, null, 2) + "\n",
      );
    }
    assert.equal(result.cases.length, 7);
    assert.equal(result.approved, false);
    assert.equal(result.reviewSha256, canonicalSha256(args.report));
    assert.match(result.core.inputsSha256, /^[a-f0-9]{64}$/);
    const missing = {
      ...args,
      cases: args.cases.filter((c) => c.category !== "closure"),
    };
    await assert.rejects(
      runReviewedRouterControls(missing),
      /missing representative/,
    );
    const lied = structuredClone(args.cases);
    lied.find((c) => c.category === "closure").category = "unverified-access";
    await assert.rejects(
      runReviewedRouterControls({ ...args, cases: lied }),
      /missing representative/,
    );
  },
);

test(
  "explicit reviewed reopening cannot pass admission while the compiled core still closes that exact ID",
  { skip },
  async () => {
    const args = await fixture();
    const prior = args.ledger.closures[0];
    const { sha256 } = await import("../../tools/lib/core.mjs");
    const bytes = Buffer.from(
      "Synthetic authority explicitly reopened the reviewed interval.",
    );
    const h = sha256(bytes);
    const c = {
      schema: "trail-mapper.refresh-candidate/1",
      id: "reviewed-reopening",
      kind: "reopening",
      baseline: snapshotIdentity(args.snapshot),
      target: snapshotIdentity(args.snapshot),
      affectedIds: prior.affectedIds,
      closureId: prior.id,
      supersedesSha256: canonicalSha256(prior),
      authoritativeDecision: "reopened",
      confidence: "verified",
      status: "present",
      evidence: {
        authorityId: "synthetic-authority",
        url: "https://example.test/reopening",
        sha256: h,
        statement: bytes.toString(),
        publishedAtUtc: "2026-01-01T00:00:00Z",
        retrievedAtUtc: "2026-01-02T00:00:00Z",
      },
    };
    const d = {
      candidateId: c.id,
      candidateSha256: canonicalSha256(c),
      reviewer: "fixture-reviewer",
      reviewedAtUtc: "2026-01-03T00:00:00Z",
      decision: "accept",
      reason:
        "Reviewed exact synthetic authoritative reopening and prior closure.",
    };
    const report = reviewRefresh({
      baseline: args.snapshot,
      target: args.snapshot,
      ledger: args.ledger,
      candidates: [c],
      decisions: [d],
      policy: {
        syntheticFixture: true,
        reviewers: ["fixture-reviewer"],
        authorities: [{ id: "synthetic-authority", urls: [c.evidence.url] }],
      },
      evidence: { [h]: bytes },
    });
    assert.equal(report.ledger.closures.length, 2);
    await assert.rejects(
      runReviewedRouterControls({ ...args, report }),
      /complete compiled closure catalog/,
    );
  },
);

test(
  "successful real-router report is hash-indexed in artifact; corruption refuses verification",
  { skip },
  async () => {
    const args = await fixture();
    const routerAdmission = await runReviewedRouterControls(args);
    const { writeReviewArtifact, verifyReviewArtifact } = await import(
      "../../tools/lib/reviewed-refresh.mjs"
    );
    const { mkdtemp, readFile, writeFile, rm } = await import(
      "node:fs/promises"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const outDir = await mkdtemp(join(tmpdir(), "verified-router-artifact-"));
    try {
      const result = await writeReviewArtifact({
        outDir,
        report: args.report,
        baseline: args.snapshot,
        target: args.snapshot,
        baselineLedger: args.ledger,
        evidence: {},
        routerAdmission,
      });
      assert.ok(
        result.index.files.some((f) => f.file === "router-admission.json"),
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(join(result.dir, "router-admission.json"), "utf8"),
        ),
        routerAdmission,
      );
      assert.deepEqual(
        await verifyReviewArtifact(result.dir, result.artifactSha256),
        args.report,
      );
      await writeFile(join(result.dir, "router-admission.json"), "{}");
      await assert.rejects(
        verifyReviewArtifact(result.dir, result.artifactSha256),
        /artifact bytes mismatch/,
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  },
);

test(
  "real-router controls use the runtime hash-verified base and endpoint-local tile loader",
  { skip },
  async () => {
    const args = await fixture({ withAccess: true });
    args.cases.push({
      id: "mapped-service-access",
      category: "point",
      request: {
        op: "plan",
        start: p(40.4975, -89),
        destination: p(40.5, -88.99),
        proposed: false,
        now: before,
      },
      assertions: [{ path: ["canNavigate"], equals: true }],
    });
    const report = await runReviewedRouterControls(args);
    if (process.env.TRAIL_REVIEW_CONTROL_REPORT) {
      const { writeFile } = await import("node:fs/promises");
      const path = process.env.TRAIL_REVIEW_CONTROL_REPORT.replace(
        /\.json$/,
        "-access.json",
      );
      await writeFile(path, JSON.stringify(report, null, 2) + "\n");
    }

    assert.ok(
      report.accessFiles.some((f) => f.file.startsWith("access-base.")),
    );
    assert.ok(
      report.accessFiles.some((f) => f.file.startsWith("access-tile.")),
    );
    assert.ok(
      report.accessFiles.length < Object.keys(args.snapshot.parts).length,
    );
  },
);

test(
  "a separately reviewed close requires a gate control for its exact closure and affected feature",
  { skip },
  async () => {
    const args = await fixture();
    const closure = args.catalog.closures[0];
    const { sha256 } = await import("../../tools/lib/core.mjs");
    const bytes = Buffer.from(
      "Synthetic evidence explicitly closes this exact fixture interval.",
    );
    const h = sha256(bytes);
    const coordinates = [
      [closure.closedFrom.longitude, closure.closedFrom.latitude],
      [closure.closedTo.longitude, closure.closedTo.latitude],
    ];
    const c = {
      schema: "trail-mapper.refresh-candidate/1",
      id: "reviewed-close",
      kind: "closure",
      baseline: snapshotIdentity(args.snapshot),
      target: snapshotIdentity(args.snapshot),
      affectedIds: [closure.featureId],
      closureId: closure.id,
      authoritativeDecision: "closed",
      activeFromUtc: new Date(closure.activeFromEpochMillis).toISOString(),
      compiledClosure: closure,
      geometry: [
        {
          id: closure.featureId,
          pathIndex: 0,
          fromVertex: 0,
          toVertex: 1,
          coordinates,
        },
      ],
      confidence: "verified",
      status: "present",
      evidence: {
        authorityId: "synthetic-authority",
        url: closure.noticeUrl,
        sha256: h,
        statement: bytes.toString(),
        publishedAtUtc: "2026-01-01T00:00:00Z",
        retrievedAtUtc: "2026-01-02T00:00:00Z",
      },
    };
    const d = {
      candidateId: c.id,
      candidateSha256: canonicalSha256(c),
      reviewer: "fixture-reviewer",
      reviewedAtUtc: "2026-01-03T00:00:00Z",
      decision: "accept",
      reason: "Synthetic exact interval and compiled schedule reviewed.",
    };
    const ledger = {
      ...args.ledger,
      closures: args.ledger.closures.filter((entry) => entry.id !== closure.id),
    };
    const report = reviewRefresh({
      baseline: args.snapshot,
      target: args.snapshot,
      ledger,
      candidates: [c],
      decisions: [d],
      policy: {
        syntheticFixture: true,
        reviewers: ["fixture-reviewer"],
        authorities: [{ id: "synthetic-authority", urls: [closure.noticeUrl] }],
      },
      evidence: { [h]: bytes },
    });
    assert.equal(
      (await runReviewedRouterControls({ ...args, report })).approved,
      false,
    );
    const mismapped = structuredClone(report);
    mismapped.reviews[0].candidate.affectedIds = ["54:9001"];
    await assert.rejects(
      runReviewedRouterControls({ ...args, report: mismapped }),
      /exact accepted closure gate control/,
    );
  },
);

test(
  "catalog binding rejects unknown or omitted compiled descriptor fields even when both catalog and ledger are rehashed identically",
  { skip },
  async () => {
    const { catalog, ledger } = await fixture();
    for (const change of [
      (c) => {
        c.unknownDefault = false;
      },
      (c) => {
        delete c.mappingNote;
      },
      (c) => {
        c.closedFrom.extra = 0;
      },
    ]) {
      const altered = structuredClone(catalog),
        changed = structuredClone(ledger);
      change(altered.closures[0]);
      changed.closures[0].compiledClosure = structuredClone(
        altered.closures[0],
      );
      changed.closures[0].compiledSha256 = canonicalSha256(altered.closures[0]);
      assert.throws(
        () => bindCompiledCatalog(changed, altered),
        /compiled descriptor/,
      );
    }
  },
);
