import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tsImport } from "tsx/esm/api";
import { reviewedRouterFixture } from "../support/reviewed-router-fixture.mjs";
import {
  canonicalSha256,
  codePointOrder,
} from "../../tools/lib/canonical-json.mjs";
import { sha256 } from "../../tools/lib/core.mjs";
import {
  reviewRefresh,
  snapshotIdentity,
  writeReviewArtifact,
  verifyReviewArtifact,
  selectRollback,
} from "../../tools/lib/reviewed-refresh.mjs";
import { runReviewedRouterControls } from "../../tools/lib/reviewed-router-controls.mjs";
import { bindRuntimeRelease } from "../../tools/lib/runtime-release-binding.mjs";
const { parseSafetyHistory, assertSafeSuccessor } = await tsImport(
  "../../src/runtime/manifest.ts",
  import.meta.url,
);

async function chain(runIndex = 2) {
  const args = await reviewedRouterFixture({ approvedSynthetic: true });
  const data = JSON.parse(
    await readFile(
      new URL("../support/detector-admission.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  const run = data.runs[runIndex]; // Actual Python A→B→A journal: current removals differ from first A.
  const observation = run.result.candidate;
  const evidence = Buffer.from(
    "SELF-AUTHORED TEST ONLY: source change reviewed as information; no reopening decision. Synthetic authority explicitly reopened this trail.",
  );
  const evidenceSha256 = sha256(evidence);
  const candidate = {
    schema: "trail-mapper.refresh-candidate/1",
    id: "genuine-transition-information",
    kind: "information",
    routingEffect: "none",
    baseline: snapshotIdentity(args.snapshot),
    target: snapshotIdentity(args.snapshot),
    affectedIds: ["54:9001"],
    confidence: "verified",
    status: "present",
    evidence: {
      authorityId: "self-authored-test-authority",
      url: data.source.url,
      sha256: evidenceSha256,
      statement:
        "source change reviewed as information; no reopening decision.",
      publishedAtUtc: "2026-01-01T00:00:00Z",
      retrievedAtUtc: "2026-01-04T00:00:00Z",
    },
    detection: {
      observation,
      observationText: run.candidateText,
      previousObservationText: run.previousObservationText,
      previousCandidateText: run.previousCandidateText,
      currentTransitionText: run.currentTransitionText,
      transitionId: run.result.transitionId,
      sourceRecordIds: [
        ...run.result.runDiff.added,
        ...run.result.runDiff.changed,
        ...run.result.runDiff.removed,
      ].sort(),
      transition: {
        status: run.result.status,
        staleEvidence: run.result.staleEvidence,
        parentCandidateId: run.result.parentCandidateId,
        runDiff: run.result.runDiff,
      },
    },
  };
  const decision = {
    candidateId: candidate.id,
    candidateSha256: canonicalSha256(candidate),
    decision: "accept",
    reviewer: "self-authored-test-reviewer",
    reviewedAtUtc: "2026-01-06T00:00:00Z",
    reason: "Synthetic fixture contract control only.",
  };
  const review = {
    baseline: args.snapshot,
    target: args.snapshot,
    ledger: args.ledger,
    candidates: [candidate],
    decisions: [decision],
    evidence: { [evidenceSha256]: evidence },
    policy: {
      reviewers: [decision.reviewer],
      authorities: [
        { id: candidate.evidence.authorityId, urls: [candidate.evidence.url] },
      ],
      detectionSources: [
        {
          sourceId: observation.sourceId,
          url: observation.identity.sourceUrl,
          registrySha256: observation.identity.registrySha256,
          parserVersion: observation.identity.parserVersion,
          sourceSchemaVersion: observation.identity.sourceSchemaVersion,
          requireProvenance: true,
          baselineDataset: snapshotIdentity(args.snapshot),
          previousObservationSha256: sha256(
            Buffer.from(run.previousObservationText),
          ),
        },
      ],
    }, // No syntheticFixture bypass: genuine producer provenance and the durable transition are mandatory.
  };
  const previousManifest = {
    schema: "trail-mapper.refresh/1",
    sequence: 41,
    releasedAtUtc: "2026-01-01T00:00:00Z",
    dataset: args.snapshot.record,
    sources: [
      {
        id: data.source.sourceId,
        publishedAtUtc: "2026-01-01T00:00:00Z",
        checkedAtUtc: "2026-01-01T00:00:00Z",
        reviewedAtUtc: "2026-01-01T00:00:00Z",
        staleAfterMs: 86400000,
      },
    ],
    closures: [...args.ledger.closures]
      .sort((a, b) => codePointOrder(a.id, b.id))
      .map((c) => ({
        id: c.id,
        contentSha256: c.compiledSha256,
      })),
    reopenings: [
      {
        id: "old-self-authored-test-rule",
        fromSequence: 1,
        toSequence: 2,
        fromContentSha256: "a".repeat(64),
        toContentSha256: null,
        evidenceUrl: data.source.url,
        reviewedBy: decision.reviewer,
        reviewedAtUtc: "2025-12-31T00:00:00Z",
      },
    ],
  };
  const releaseDecision = {
    schema: "trail-mapper.release-sequence-decision/1",
    priorSequence: 41,
    targetSequence: 45,
    releasedAtUtc: "2026-01-06T00:00:00Z",
    issuer: "SELF-AUTHORED TEST ONLY; no production authority",
  };
  const binding = (report) => ({
    report,
    baselineLedger: args.ledger,
    priorCatalog: args.catalog,
    targetCatalog: args.catalog,
    previousManifest,
    releaseDecision,
    pins: {
      reviewSha256: canonicalSha256(report),
      priorLedgerSha256: canonicalSha256(args.ledger),
      priorManifestSha256: canonicalSha256(previousManifest),
      releaseDecisionSha256: canonicalSha256(releaseDecision),
    },
  });
  return { ...args, data, run, review, previousManifest, binding };
}

test("genuine current-producer journal → immutable admission → blocked runtime binding retains actual-core closure/Start safety", async () => {
  const c = await chain();
  assert.equal(
    c.data.producer.commit,
    "452eccc0fc1016f0012c923e3a4d4b45de8e3c24",
  );
  assert.equal(c.run.candidateText, c.data.runs[0].candidateText);
  assert.notDeepEqual(c.run.result.runDiff, c.run.result.candidate.diff);
  assert.ok(c.run.result.runDiff.removed.length > 0);
  const report = reviewRefresh(c.review);
  assert.deepEqual(report.ledger, {
    ...c.ledger,
    closures: [...c.ledger.closures].sort((a, b) => codePointOrder(a.id, b.id)),
  }); // A missing source record never reopens a compiled rule.
  const routerAdmission = await runReviewedRouterControls({ ...c, report });
  const outDir = await mkdtemp(join(tmpdir(), "genuine-refresh-chain-"));
  try {
    const artifact = await writeReviewArtifact({
      outDir,
      report,
      baseline: c.snapshot,
      target: c.snapshot,
      baselineLedger: c.ledger,
      evidence: c.review.evidence,
      routerAdmission,
    });
    const verified = await verifyReviewArtifact(
      artifact.dir,
      artifact.artifactSha256,
    );
    const rollback = await selectRollback(
      artifact.dir,
      artifact.artifactSha256,
    );
    const input = {
      ...c.binding(verified),
      baselineLedger: rollback.baselineLedger,
    };
    const result = await bindRuntimeRelease(input);
    assert.equal(rollback.activationAllowed, false);
    assert.equal(verified.release.approved, false);
    assert.equal(result.approved, false);
    assert.equal(result.activationAllowed, false);
    assert.deepEqual(result.closures, c.previousManifest.closures);
    assert.deepEqual(result.reopenings, c.previousManifest.reopenings);
    assert.equal(result.bindings.length, 0);
    const next = parseSafetyHistory({
      ...c.previousManifest,
      sequence: result.targetSequence,
      releasedAtUtc: result.releasedAtUtc,
      closures: result.closures,
      reopenings: result.reopenings,
    });
    assert.doesNotThrow(() => assertSafeSuccessor(c.previousManifest, next));
    await writeFile(join(artifact.dir, "review.json"), "{}");
    await assert.rejects(
      verifyReviewArtifact(artifact.dir, artifact.artifactSha256),
      /artifact bytes mismatch/,
    );
    const altered = structuredClone(input);
    altered.report.ledger.closures.pop();
    await assert.rejects(
      bindRuntimeRelease(altered),
      /review independent digest mismatch/,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("genuine chain refuses stale/tampered journal, whole-ledger runtime pins and unapproved history", async () => {
  const c = await chain();
  const approvalTamper = structuredClone(c.snapshot);
  approvalTamper.record.approval.approved = false;
  assert.notEqual(
    snapshotIdentity(approvalTamper).recordSha256,
    snapshotIdentity(c.snapshot).recordSha256,
  );
  const contradictory = {
    ...c.review,
    candidates: structuredClone(c.review.candidates),
    decisions: structuredClone(c.review.decisions),
  };
  contradictory.candidates[0].detection.transition.runDiff.removed = [];
  contradictory.decisions[0].candidateSha256 = canonicalSha256(
    contradictory.candidates[0],
  );
  assert.throws(
    () => reviewRefresh(contradictory),
    /current runDiff does not match retained baseline records/,
  );
  const stale = {
    ...c.review,
    candidates: structuredClone(c.review.candidates),
    decisions: structuredClone(c.review.decisions),
  };
  stale.candidates[0].detection.transition.staleEvidence = true;
  stale.decisions[0].candidateSha256 = canonicalSha256(stale.candidates[0]);
  assert.throws(() => reviewRefresh(stale), /stale/);
  const changed = {
    ...c.review,
    candidates: structuredClone(c.review.candidates),
    decisions: structuredClone(c.review.decisions),
  };
  const originalJournal = changed.candidates[0].detection.currentTransitionText;
  const candidateId = JSON.parse(originalJournal).candidateId;
  changed.candidates[0].detection.currentTransitionText =
    originalJournal.replace(candidateId, "0".repeat(64));
  changed.decisions[0].candidateSha256 = canonicalSha256(changed.candidates[0]);
  assert.throws(
    () => reviewRefresh(changed),
    /durable current transition integrity mismatch/,
  );
  const report = reviewRefresh(c.review);
  const wrongHash = c.binding(report);
  wrongHash.previousManifest = structuredClone(wrongHash.previousManifest);
  wrongHash.previousManifest.closures[0].contentSha256 = canonicalSha256(
    c.ledger.closures[0],
  );
  wrongHash.pins.priorManifestSha256 = canonicalSha256(
    wrongHash.previousManifest,
  );
  await assert.rejects(
    bindRuntimeRelease(wrongHash),
    /accepted history.*compiled/,
  );
  const unapproved = c.binding(report);
  unapproved.previousManifest = structuredClone(unapproved.previousManifest);
  unapproved.previousManifest.dataset.approval.approved = false;
  unapproved.pins.priorManifestSha256 = canonicalSha256(
    unapproved.previousManifest,
  );
  await assert.rejects(bindRuntimeRelease(unapproved), {
    code: "data-unapproved",
    message:
      "This trail data has not been approved for public use, so it will not be shown.",
  });
});

test("genuine explicitly reviewed removal maps ledger hash to descriptor hash but cannot override the actual unchanged compiled core", async () => {
  const c = await chain(1);
  const prior = c.ledger.closures[0];
  const candidate = c.review.candidates[0];
  candidate.kind = "reopening";
  delete candidate.routingEffect;
  candidate.id = "genuine-self-authored-reviewed-removal";
  candidate.closureId = prior.id;
  candidate.affectedIds = prior.affectedIds;
  candidate.authoritativeDecision = "reopened";
  candidate.supersedesSha256 = canonicalSha256(prior);
  candidate.evidence.statement =
    "Synthetic authority explicitly reopened this trail.";
  c.review.decisions[0].candidateId = candidate.id;
  c.review.decisions[0].candidateSha256 = canonicalSha256(candidate);
  const report = reviewRefresh(c.review);
  const input = c.binding(report);
  // Desired future catalog fixture only, not a claim that a changed target core was built.
  input.targetCatalog = {
    ...c.catalog,
    closures: c.catalog.closures.filter((rule) => rule.id !== prior.id),
  };
  const result = await bindRuntimeRelease(input);
  assert.notEqual(prior.compiledSha256, candidate.supersedesSha256);
  assert.equal(
    result.bindings[0].supersedesLedgerEntrySha256,
    candidate.supersedesSha256,
  );
  assert.equal(
    result.reopenings.at(-1).fromContentSha256,
    prior.compiledSha256,
  );
  assert.deepEqual(
    result.reopenings.slice(0, -1),
    c.previousManifest.reopenings,
  );
  assert.equal(result.activationAllowed, false);
  await assert.rejects(
    runReviewedRouterControls({ ...c, report }),
    /complete compiled closure catalog/,
  );
  const unsafe = {
    ...c.previousManifest,
    sequence: result.targetSequence,
    releasedAtUtc: result.releasedAtUtc,
    closures: result.closures,
    reopenings: structuredClone(result.reopenings),
  };
  assert.doesNotThrow(() => assertSafeSuccessor(c.previousManifest, unsafe));
  unsafe.reopenings.at(-1).fromContentSha256 = candidate.supersedesSha256;
  assert.throws(
    () => assertSafeSuccessor(c.previousManifest, unsafe),
    /authoritative reopening review/,
  );
});
