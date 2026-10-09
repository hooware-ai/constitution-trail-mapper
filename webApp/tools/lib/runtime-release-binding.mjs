// Offline contract verification only. This does not emit or approve a runtime manifest.
import { tsImport } from "tsx/esm/api";
import { canonicalSha256, codePointOrder } from "./canonical-json.mjs";
import { bindCompiledCatalog } from "./reviewed-router-controls.mjs";

const refuse = (message) => {
  throw new Error(`Runtime release binding refused: ${message}`);
};
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const pin = (value, expected, label) => {
  if (
    !/^[a-f0-9]{64}$/.test(expected ?? "") ||
    canonicalSha256(value) !== expected
  )
    refuse(`${label} independent digest mismatch`);
};
const closurePins = (ledger) =>
  ledger.closures
    .map((entry) => ({ id: entry.id, contentSha256: entry.compiledSha256 }))
    .sort((a, b) => codePointOrder(a.id, b.id));

/** All pins and the sequence decision must come from the release owner, not the candidate. */
export async function bindRuntimeRelease({
  report,
  baselineLedger,
  priorCatalog,
  targetCatalog,
  previousManifest,
  releaseDecision,
  pins,
}) {
  const { parseSafetyHistory, utcTime } = await tsImport(
    "../../src/runtime/manifest.ts",
    import.meta.url,
  );
  pin(report, pins.reviewSha256, "review");
  pin(baselineLedger, pins.priorLedgerSha256, "prior ledger");
  pin(previousManifest, pins.priorManifestSha256, "prior runtime history");
  pin(releaseDecision, pins.releaseDecisionSha256, "sequence decision");
  const previous = parseSafetyHistory(previousManifest);
  if (
    report.schema !== "trail-mapper.refresh-review/1" ||
    report.release?.approved !== false ||
    baselineLedger.schema !== report.schema ||
    !same(baselineLedger.dataset, report.baseline) ||
    !same(report.ledger.dataset, report.target) ||
    report.rollback?.ledgerSha256 !== pins.priorLedgerSha256 ||
    previous.dataset.id !== report.baseline.id ||
    previous.dataset.version !== report.baseline.version ||
    canonicalSha256(previous.dataset) !== report.baseline.recordSha256 ||
    previous.dataset.content.sha256 !== report.baseline.contentSha256
  )
    refuse("review, rollback ledger and accepted runtime dataset differ");
  bindCompiledCatalog(baselineLedger, priorCatalog);
  bindCompiledCatalog(report.ledger, targetCatalog);
  const priorPins = [...previous.closures].sort((a, b) =>
    codePointOrder(a.id, b.id),
  );
  if (!same(priorPins, closurePins(baselineLedger)))
    refuse("accepted history omits or changes a complete prior compiled rule");
  if (
    !same(
      Object.keys(releaseDecision).sort(),
      [
        "schema",
        "priorSequence",
        "targetSequence",
        "releasedAtUtc",
        "issuer",
      ].sort(),
    ) ||
    releaseDecision.schema !== "trail-mapper.release-sequence-decision/1" ||
    releaseDecision.priorSequence !== previous.sequence ||
    !Number.isSafeInteger(releaseDecision.targetSequence) ||
    releaseDecision.targetSequence <= previous.sequence ||
    !utcTime(releaseDecision.releasedAtUtc) ||
    Date.parse(releaseDecision.releasedAtUtc) <
      Date.parse(previous.releasedAtUtc) ||
    typeof releaseDecision.issuer !== "string" ||
    !releaseDecision.issuer.trim()
  )
    refuse("explicit owner-issued forward sequence decision required");

  const target = new Map(
    report.ledger.closures.map((entry) => [entry.id, entry]),
  );
  const priorIds = new Set(baselineLedger.closures.map((entry) => entry.id));
  if (report.ledger.closures.some((entry) => !priorIds.has(entry.id)))
    refuse(
      "added compiled descriptor requires a separate reviewed transition contract",
    );
  const reopenings = structuredClone(previous.reopenings);
  const bindings = [];
  const usedCandidates = new Set();
  for (const prior of baselineLedger.closures) {
    const next = target.get(prior.id);
    if (next?.compiledSha256 === prior.compiledSha256) continue;
    // Changed descriptors require a separately supported admission operation; do not reinterpret them as removal.
    if (next)
      refuse(
        "changed compiled descriptor requires a separate reviewed transition contract",
      );
    const matches = report.reviews.filter(
      ({ candidate, decision }) =>
        candidate.kind === "reopening" &&
        candidate.closureId === prior.id &&
        decision.decision === "accept",
    );
    if (matches.length !== 1)
      refuse("removed rule requires one exact accepted reopening");
    const { candidate, decision } = matches[0];
    if (
      candidate.authoritativeDecision !== "reopened" ||
      candidate.confidence !== "verified" ||
      candidate.status !== "present" ||
      candidate.supersedesSha256 !== canonicalSha256(prior) ||
      !same(candidate.affectedIds, prior.affectedIds) ||
      !same(candidate.baseline, report.baseline) ||
      !same(candidate.target, report.target) ||
      decision.candidateId !== candidate.id ||
      decision.candidateSha256 !== canonicalSha256(candidate) ||
      !report.reviewPolicy.reviewers.includes(decision.reviewer) ||
      !report.reviewPolicy.authorities.some(
        (authority) =>
          authority.id === candidate.evidence.authorityId &&
          authority.urls.includes(candidate.evidence.url),
      ) ||
      !/^https:\/\/[^\s]+$/.test(candidate.evidence.url) ||
      !utcTime(decision.reviewedAtUtc) ||
      Date.parse(decision.reviewedAtUtc) < Date.parse(previous.releasedAtUtc) ||
      Date.parse(decision.reviewedAtUtc) >
        Date.parse(releaseDecision.releasedAtUtc) ||
      usedCandidates.has(candidate.id)
    )
      refuse(
        "reopening does not bind prior ledger, compiled rule and exact review interval",
      );
    usedCandidates.add(candidate.id);
    reopenings.push({
      id: prior.id,
      fromSequence: previous.sequence,
      toSequence: releaseDecision.targetSequence,
      fromContentSha256: prior.compiledSha256,
      toContentSha256: null,
      evidenceUrl: candidate.evidence.url,
      reviewedBy: decision.reviewer,
      reviewedAtUtc: decision.reviewedAtUtc,
    });
    bindings.push({
      id: prior.id,
      supersedesLedgerEntrySha256: candidate.supersedesSha256,
      fromCompiledDescriptorSha256: prior.compiledSha256,
      candidateSha256: decision.candidateSha256,
      decisionSha256: canonicalSha256(decision),
    });
  }
  if (
    report.reviews.some(
      ({ candidate, decision }) =>
        candidate.kind === "reopening" &&
        decision.decision === "accept" &&
        !usedCandidates.has(candidate.id),
    )
  )
    refuse("accepted reopening is not an exact compiled removal");
  return {
    schema: "trail-mapper.runtime-release-binding/1",
    purpose: "offline-binding-verification-only",
    approved: false,
    activationAllowed: false,
    pins: structuredClone(pins),
    priorSequence: previous.sequence,
    targetSequence: releaseDecision.targetSequence,
    releasedAtUtc: releaseDecision.releasedAtUtc,
    closures: closurePins(report.ledger),
    reopenings,
    bindings,
    blockers: [
      "Verify the immutable admission artifact and representative real-router controls",
      "Approve and persist authoritative sequence issuance and complete release history",
      "Approve sources, provider rights, dataset, endpoint and production activation separately",
    ],
  };
}
