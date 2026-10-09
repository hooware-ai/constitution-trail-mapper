import test from "node:test";
import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";
import { canonicalSha256 } from "../../tools/lib/canonical-json.mjs";
import { bindRuntimeRelease } from "../../tools/lib/runtime-release-binding.mjs";
const { refreshFixture } = await tsImport(
  "../support/refresh-fixture.ts",
  import.meta.url,
);
const { assertSafeSuccessor } = await tsImport(
  "../../src/runtime/manifest.ts",
  import.meta.url,
);

async function fixture() {
  const { manifest } = await refreshFixture(41);
  const descriptor = {
    id: "synthetic-rule",
    title: "Synthetic closure",
    guidance: "Fixture only",
    noticeUrl: "https://example.test/notice",
    featureId: "54:9001",
    closedFrom: { latitude: 40, longitude: -89 },
    closedTo: { latitude: 40.01, longitude: -89 },
    activeFromEpochMillis: 0,
    estimatedEndEpochMillis: null,
    boundsProjected: false,
    isCrossing: false,
    closedPath: [
      { latitude: 40, longitude: -89 },
      { latitude: 40.01, longitude: -89 },
    ],
    sourceLine: [],
    mappingNote: "Synthetic test only",
    checkedOn: "2026-10-09",
  };
  const identity = {
    id: manifest.dataset.id,
    version: manifest.dataset.version,
    recordSha256: canonicalSha256(manifest.dataset),
    contentSha256: manifest.dataset.content.sha256,
  };
  const entry = {
    id: descriptor.id,
    affectedIds: [descriptor.featureId],
    compiledClosure: descriptor,
    compiledSha256: canonicalSha256(descriptor),
    evidence: { statement: "Prior synthetic review" },
  };
  const ledger = {
    schema: "trail-mapper.refresh-review/1",
    dataset: identity,
    closures: [entry],
  };
  manifest.closures = [{ id: entry.id, contentSha256: entry.compiledSha256 }];
  manifest.reopenings = [
    {
      id: "old-synthetic-rule",
      fromSequence: 1,
      toSequence: 2,
      fromContentSha256: "a".repeat(64),
      toContentSha256: null,
      evidenceUrl: "https://example.test/old",
      reviewedBy: "Synthetic reviewer",
      reviewedAtUtc: "2026-10-09T10:00:00Z",
    },
  ];
  const candidate = {
    id: "synthetic-reopening",
    kind: "reopening",
    closureId: entry.id,
    baseline: identity,
    target: identity,
    authoritativeDecision: "reopened",
    confidence: "verified",
    status: "present",
    affectedIds: entry.affectedIds,
    supersedesSha256: canonicalSha256(entry),
    evidence: { authorityId: "synthetic-authority", url: descriptor.noticeUrl },
  };
  const report = {
    schema: ledger.schema,
    baseline: identity,
    target: identity,
    ledger: { ...ledger, closures: [] },
    rollback: { ledgerSha256: canonicalSha256(ledger) },
    release: { approved: false },
    reviewPolicy: {
      reviewers: ["synthetic-reviewer"],
      authorities: [
        { id: "synthetic-authority", urls: [descriptor.noticeUrl] },
      ],
    },
    reviews: [
      {
        candidate,
        decision: {
          candidateId: candidate.id,
          candidateSha256: canonicalSha256(candidate),
          decision: "accept",
          reviewer: "synthetic-reviewer",
          reviewedAtUtc: "2026-10-09T11:30:00Z",
        },
      },
    ],
  };
  const args = {
    report,
    baselineLedger: ledger,
    previousManifest: manifest,
    priorCatalog: {
      schema: "trail-mapper.compiled-closures/1",
      closures: [descriptor],
    },
    targetCatalog: { schema: "trail-mapper.compiled-closures/1", closures: [] },
    releaseDecision: {
      schema: "trail-mapper.release-sequence-decision/1",
      priorSequence: 41,
      targetSequence: 45,
      releasedAtUtc: "2026-10-09T12:00:00Z",
      issuer: "SYNTHETIC TEST ONLY; not production sequence authority",
    },
  };
  repin(args);
  return args;
}
function repin(args) {
  args.pins = {
    reviewSha256: canonicalSha256(args.report),
    priorLedgerSha256: canonicalSha256(args.baselineLedger),
    priorManifestSha256: canonicalSha256(args.previousManifest),
    releaseDecisionSha256: canonicalSha256(args.releaseDecision),
  };
}
test("whole-ledger supersedes digest maps to exact compiled digest and retained sequence history; never activates", async () => {
  const args = await fixture(),
    result = await bindRuntimeRelease(args);
  assert.notEqual(
    args.report.reviews[0].candidate.supersedesSha256,
    args.baselineLedger.closures[0].compiledSha256,
  );
  assert.equal(
    result.bindings[0].supersedesLedgerEntrySha256,
    args.report.reviews[0].candidate.supersedesSha256,
  );
  assert.equal(
    result.reopenings.at(-1).fromContentSha256,
    args.baselineLedger.closures[0].compiledSha256,
  );
  assert.deepEqual(result.reopenings[0], args.previousManifest.reopenings[0]);
  assert.equal(result.targetSequence, 45);
  assert.equal(result.approved, false);
  assert.equal(result.activationAllowed, false);
  const next = {
    ...args.previousManifest,
    sequence: result.targetSequence,
    releasedAtUtc: result.releasedAtUtc,
    closures: result.closures,
    reopenings: result.reopenings,
  };
  assert.doesNotThrow(() => assertSafeSuccessor(args.previousManifest, next));
  next.reopenings.at(-1).fromContentSha256 =
    args.report.reviews[0].candidate.supersedesSha256;
  assert.throws(
    () => assertSafeSuccessor(args.previousManifest, next),
    /authoritative reopening review/,
  );
});
for (const [name, mutate, rehash] of [
  [
    "target-only compiled addition",
    (a) => {
      const entry = structuredClone(a.baselineLedger.closures[0]);
      entry.id = "synthetic-added-rule";
      entry.compiledClosure.id = entry.id;
      entry.compiledSha256 = canonicalSha256(entry.compiledClosure);
      a.report.ledger.closures.push(entry);
      a.targetCatalog.closures.push(entry.compiledClosure);
    },
    true,
  ],
  [
    "duplicate target ledger IDs",
    (a) => {
      a.report.ledger.closures = [
        a.baselineLedger.closures[0],
        a.baselineLedger.closures[0],
      ];
      a.targetCatalog = a.priorCatalog;
    },
    true,
  ],
  ["unpinned review change", (a) => (a.report.release.approved = true), false],
  [
    "unpinned prior runtime history",
    (a) => (a.previousManifest.reopenings = []),
    false,
  ],
  [
    "missing known compiled rule",
    (a) => (a.previousManifest.closures = []),
    true,
  ],
  [
    "ledger digest used as descriptor digest",
    (a) =>
      (a.previousManifest.closures[0].contentSha256 = canonicalSha256(
        a.baselineLedger.closures[0],
      )),
    true,
  ],
  [
    "wrong complete target catalog",
    (a) => (a.targetCatalog = a.priorCatalog),
    true,
  ],
  ["wrong parent sequence", (a) => a.releaseDecision.priorSequence--, true],
  [
    "rollback target sequence",
    (a) => (a.releaseDecision.targetSequence = 40),
    true,
  ],
  [
    "release before reviewed reopening",
    (a) => (a.releaseDecision.releasedAtUtc = "2026-10-09T11:15:00Z"),
    true,
  ],
  [
    "unreviewed removal",
    (a) => (a.report.reviews[0].decision.decision = "unresolved"),
    true,
  ],
  [
    "wrong whole-entry supersedes digest",
    (a) => {
      a.report.reviews[0].candidate.supersedesSha256 =
        a.baselineLedger.closures[0].compiledSha256;
      a.report.reviews[0].decision.candidateSha256 = canonicalSha256(
        a.report.reviews[0].candidate,
      );
    },
    true,
  ],
  [
    "candidate decision not hash-bound",
    (a) => (a.report.reviews[0].decision.candidateSha256 = "0".repeat(64)),
    true,
  ],
  [
    "unapproved reviewer",
    (a) => (a.report.reviews[0].decision.reviewer = "foreign"),
    true,
  ],
  [
    "unapproved evidence URL",
    (a) => {
      a.report.reviews[0].candidate.evidence.url =
        "https://example.test/foreign";
      a.report.reviews[0].decision.candidateSha256 = canonicalSha256(
        a.report.reviews[0].candidate,
      );
    },
    true,
  ],
])
  test(`refuses ${name}`, async () => {
    const args = await fixture();
    mutate(args);
    if (rehash) repin(args);
    await assert.rejects(bindRuntimeRelease(args), /refused/);
  });
