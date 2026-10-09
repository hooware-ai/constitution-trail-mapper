// Offline review only. No fetching, scheduling, mutation of release approvals or publication.
import {
  canonical,
  sha256Text,
  canonicalSha256,
  parseWithNumbers,
  toPlain,
  codePointOrder,
} from "./canonical-json.mjs";
import { checkPackage } from "./dataset-package.mjs";
import { SUPPLEMENT_LAYER_ID } from "./osm-supplement.mjs";
import { PROPOSED_LAYER_ID } from "./proposed-layer.mjs";
import { sha256 } from "./core.mjs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const REVIEW_SCHEMA = "trail-mapper.refresh-review/1";
const fail = (message) => {
  throw new Error(`Refresh refused: ${message}`);
};
const digest = (value, label) => {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) fail(`${label} needs a SHA-256`);
};
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is missing`);
};
const instant = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().replace(".000Z", "Z") !==
      value.replace(".000Z", "Z")
  )
    fail("invalid UTC instant");
  return Date.parse(value);
};
const exactIds = (ids) => {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some(
      (id) =>
        typeof id !== "string" || !/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(id),
    ) ||
    new Set(ids).size !== ids.length
  )
    fail("exact distinct canonical affected IDs required");
};
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const features = (network) =>
  new Map(
    network.layers.flatMap((layer) => layer.features.map((f) => [f.id, f])),
  );

// A snapshot uses existing package admission, including evidence/license/layer/Proposed/access/composition checks.
export function verifySnapshot(snapshot) {
  const {
    record,
    body,
    manifestBytes,
    osmManifestBytes,
    proposedManifestBytes,
    accessManifestBytes,
    parts = {},
  } = snapshot;
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(record.content?.file ?? "") ||
    [".", ".."].includes(record.content.file)
  )
    fail("unsafe content filename");
  const reserved = new Set([
    "dataset.json",
    "ledger.json",
    "manifest.json",
    "osmManifestBytes.json",
    "proposedManifestBytes.json",
    "accessManifestBytes.json",
  ]);
  if (
    !/^trails\.[0-9a-f]{12}\.json$/.test(record.content.file) ||
    reserved.has(record.content.file)
  )
    fail("reserved or incompatible network filename");
  for (const name of Object.keys(parts))
    if (
      !/^[a-zA-Z0-9_.-]+$/.test(name) ||
      reserved.has(name) ||
      name === record.content.file ||
      [".", ".."].includes(name)
    )
      fail("reserved or colliding package part name");
  for (const [key, present] of [
    ["osmManifestBytes", Boolean(record.supplements?.length)],
    ["proposedManifestBytes", Boolean(record.proposedLayer)],
    ["accessManifestBytes", Boolean(record.access)],
  ])
    if (Boolean(snapshot[key]) !== present)
      fail("missing or unexpected auxiliary manifest");
  const usedParts = new Set();
  const network = checkPackage(
    record,
    body,
    manifestBytes,
    osmManifestBytes,
    (name) => {
      if (Object.hasOwn(parts, name)) usedParts.add(name);
      return parts[name];
    },
    proposedManifestBytes,
    accessManifestBytes,
  );
  if (Object.keys(parts).some((name) => !usedParts.has(name)))
    fail("unexpected unreferenced package parts");
  const expectedLayers = [
    8,
    ...(record.supplements?.length ? [SUPPLEMENT_LAYER_ID] : []),
    ...(record.proposedLayer ? [PROPOSED_LAYER_ID] : []),
  ];
  if (
    !same(
      network.layers.map((layer) => layer.id),
      expectedLayers,
    )
  )
    fail("incompatible layer attribution/order");
  const ids = network.layers.flatMap((layer) =>
    layer.features.map((f) => f.id),
  );
  if (new Set(ids).size !== ids.length)
    fail("duplicate canonical ID across layers");
  for (const f of features(network).values()) {
    if (
      !Array.isArray(f.paths) ||
      !f.paths.length ||
      !f.paths.every(
        (path) =>
          Array.isArray(path) &&
          path.length >= 2 &&
          path.every(
            (p) =>
              Array.isArray(p) &&
              p.length === 2 &&
              p.every(Number.isFinite) &&
              Math.abs(p[0]) <= 180 &&
              Math.abs(p[1]) <= 90,
          ) &&
          path.slice(1).some((p, i) => !same(p, path[i])),
      )
    )
      fail(`invalid geometry for ${f.id}`);
  }
  return network;
}
export function snapshotIdentity(snapshot) {
  return {
    id: snapshot.record.id,
    version: snapshot.record.version,
    recordSha256: canonicalSha256(snapshot.record),
    contentSha256: sha256(snapshot.body),
  };
}

const routingProjections = (network) =>
  new Map(
    network.layers.flatMap((layer, layerIndex) => {
      const { features, ...metadata } = layer;
      return features.map((feature, featureIndex) => [
        feature.id,
        { feature, layer: metadata, layerIndex, featureIndex },
      ]);
    }),
  );
/** Every admitted package input, beyond derived version/network filenames, is bound to review. */
export function packageChangesOf(baseline, target) {
  const inputs = (snapshot) => {
    const tree = parseWithNumbers(snapshot.body.toString("utf8"));
    const metadata = { ...snapshot.record };
    delete metadata.content;
    delete metadata.version;
    const networkMetadata = {
      ...tree,
      layers: tree.layers.map((layer) => {
        const { features, ...meta } = layer;
        return meta;
      }),
    };
    const hashes = {
      "county-manifest": sha256(snapshot.manifestBytes),
      "record-metadata": canonicalSha256(metadata),
      "network-metadata": sha256Text(canonical(networkMetadata)),
    };
    for (const key of [
      "osmManifestBytes",
      "proposedManifestBytes",
      "accessManifestBytes",
    ])
      hashes[key] = snapshot[key] ? sha256(snapshot[key]) : null;
    for (const [name, bytes] of Object.entries(snapshot.parts ?? {}))
      hashes[`part:${name}`] = sha256(bytes);
    return hashes;
  };
  const old = inputs(baseline),
    next = inputs(target);
  return [...new Set([...Object.keys(old), ...Object.keys(next)])]
    .sort(codePointOrder)
    .filter((id) => (old[id] ?? null) !== (next[id] ?? null))
    .map((id) => ({
      id,
      beforeSha256: old[id] ?? null,
      afterSha256: next[id] ?? null,
    }));
}
const meters = (a, b) => {
  const radians = Math.PI / 180,
    dLat = (b[1] - a[1]) * radians,
    dLon = (b[0] - a[0]) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * radians) *
      Math.cos(b[1] * radians) *
      Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
function requireUniqueInterval(feature, geometry) {
  const from = geometry.coordinates[0],
    to = geometry.coordinates.at(-1),
    fromMatches = [],
    toMatches = [];
  feature.paths.forEach((path, pathIndex) =>
    path.forEach((p, index) => {
      if (meters(p, from) <= 1.0) fromMatches.push([pathIndex, index]);
      if (meters(p, to) <= 1.0) toMatches.push([pathIndex, index]);
    }),
  );
  if (
    fromMatches.length !== 1 ||
    toMatches.length !== 1 ||
    !same(fromMatches[0], [geometry.pathIndex, geometry.fromVertex]) ||
    !same(toMatches[0], [geometry.pathIndex, geometry.toVertex])
  )
    fail("ambiguous compiled endpoint interval across source paths/vertices");
}

/** PR109 (#105) envelope stays intact; routing mapping is a separate reviewer-owned field. */
export function verifyDetection(candidate, policy) {
  const detection = candidate.detection;
  if (!detection) {
    if (policy.syntheticFixture === true) return;
    fail("immutable #105 detection candidate required");
  }
  const { observation: d, sourceRecordIds } = detection;
  if (
    !d ||
    d.schemaVersion !== 1 ||
    d.requiresReview !== true ||
    d.sourceId !== d.identity?.sourceId
  )
    fail("incompatible detection envelope");
  let sourceTree = null;
  if (detection.observationText !== undefined) {
    text(detection.observationText, "retained detector candidate text");
    sourceTree = parseWithNumbers(detection.observationText);
    if (!same(toPlain(sourceTree), d))
      fail("detector candidate object/text mismatch");
  }
  if (policy.syntheticFixture !== true && !sourceTree)
    fail("retained exact detector candidate text required");
  const sourceHash = (value) =>
    sourceTree ? sha256Text(canonical(value)) : canonicalSha256(value);
  const hasProvenance = Object.hasOwn(d, "provenanceSha256");
  if (hasProvenance) {
    digest(d.provenanceSha256, "detection provenance");
    const { provenanceSha256, ...provenance } = sourceTree ?? d;
    if (sourceHash(provenance) !== provenanceSha256)
      fail("detection provenance hash mismatch");
  }
  if (d.identity?.componentHashes !== undefined) {
    if (
      !hasProvenance ||
      !d.identity.componentHashes ||
      typeof d.identity.componentHashes !== "object" ||
      Array.isArray(d.identity.componentHashes) ||
      Object.entries(d.identity.componentHashes).some(
        ([name, h]) => !name || !/^[a-f0-9]{64}$/.test(h),
      )
    )
      fail("invalid detection component provenance");
  }
  const transition = detection.transition;
  if ((hasProvenance || policy.syntheticFixture !== true) && !transition)
    fail("current detection runDiff/parent transition required");
  if (
    transition &&
    (transition.status !== "candidate" ||
      transition.staleEvidence !== false ||
      !Object.hasOwn(transition, "parentCandidateId"))
  )
    fail("failed, stale or incomplete current detection transition");
  if (
    transition?.parentCandidateId !== undefined &&
    transition.parentCandidateId !== null
  )
    digest(transition.parentCandidateId, "current transition parent");
  digest(d.candidateId, "detection candidate ID");
  if (sourceHash(sourceTree?.identity ?? d.identity) !== d.candidateId)
    fail("detection identity hash mismatch");
  const approvedSource = policy.detectionSources?.find(
    (source) =>
      source.sourceId === d.sourceId &&
      source.registrySha256 === d.identity.registrySha256 &&
      source.url === d.identity.sourceUrl &&
      source.parserVersion === d.identity.parserVersion &&
      source.sourceSchemaVersion === d.identity.sourceSchemaVersion,
  );
  if (!approvedSource)
    fail("unapproved or incompatible detection registry/parser");
  if (approvedSource.requireProvenance === true && !hasProvenance)
    fail(
      "approved detection contract requires provenance and current transition",
    );
  for (const key of ["registrySha256", "contentSha256", "parsedSha256"])
    digest(d.identity[key], key);
  if (
    !d.records ||
    typeof d.records !== "object" ||
    Array.isArray(d.records) ||
    Object.entries(d.records).some(
      ([id, h]) => !id || !/^[a-f0-9]{64}$/.test(h),
    )
  )
    fail("invalid detection record index");
  if (canonicalSha256(d.records) !== d.identity.parsedSha256)
    fail("detection record hash mismatch");
  instant(d.retrievedAtUtc);
  if (d.sourcePublishedAtUtc !== null) instant(d.sourcePublishedAtUtc);
  if (d.parentCandidateId !== null)
    digest(d.parentCandidateId, "parent detection candidate");
  const checkedDiff = (diff) => {
    if (!diff || Object.keys(diff).sort().join(",") !== "added,changed,removed")
      fail("invalid detection diff");
    const all = [];
    for (const kind of ["added", "changed", "removed"]) {
      const ids = diff[kind];
      if (
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== "string" || !id) ||
        !same(ids, [...new Set(ids)].sort(codePointOrder))
      )
        fail("invalid detection diff IDs");
      if (
        ids.some((id) =>
          kind === "removed"
            ? Object.hasOwn(d.records, id)
            : !Object.hasOwn(d.records, id),
        )
      )
        fail("detection diff disagrees with record index");
      all.push(...ids);
    }
    if (new Set(all).size !== all.length)
      fail("overlapping detection diff IDs");
    return all.sort(codePointOrder);
  };
  checkedDiff(d.diff); // Stored immutable first-observation provenance is verified, never repurposed as today's transition.
  if (
    transition &&
    (policy.syntheticFixture !== true ||
      detection.previousObservationText !== undefined ||
      approvedSource.previousObservationSha256 !== undefined)
  ) {
    if (
      !Object.hasOwn(approvedSource, "previousObservationSha256") ||
      !same(approvedSource.baselineDataset, candidate.baseline)
    )
      fail("trusted detector baseline must be pinned to exact dataset");
    let previousRecords = {},
      previousId = null;
    if (detection.previousObservationText !== null) {
      text(
        detection.previousObservationText,
        "retained detector baseline text",
      );
      digest(
        approvedSource.previousObservationSha256,
        "trusted baseline observation",
      );
      if (
        sha256Text(detection.previousObservationText) !==
        approvedSource.previousObservationSha256
      )
        fail("retained detector baseline hash mismatch");
      const tree = parseWithNumbers(detection.previousObservationText),
        previous = toPlain(tree);
      if (
        previous.sourceId !== d.sourceId ||
        !previous.records ||
        typeof previous.records !== "object" ||
        Array.isArray(previous.records) ||
        Object.entries(previous.records).some(
          ([id, h]) => !id || !/^[a-f0-9]{64}$/.test(h),
        )
      )
        fail("incompatible retained detector baseline");
      const identity = {};
      for (const key of [
        "sourceId",
        "sourceUrl",
        "registrySha256",
        "contentSha256",
        "parsedSha256",
        "parserVersion",
        "sourceSchemaVersion",
      ]) {
        if (!Object.hasOwn(tree, key))
          fail("incomplete retained detector baseline identity");
        identity[key] = tree[key];
      }
      for (const key of ["componentHashes", "sourceTimes"])
        if (Object.hasOwn(tree, key)) identity[key] = tree[key];
      previousId = sha256Text(canonical(identity));
      if (
        previousId !== previous.candidateId ||
        sha256Text(canonical(tree.records)) !== previous.parsedSha256
      )
        fail("retained detector baseline identity/records mismatch");
      previousRecords = previous.records;
    } else if (approvedSource.previousObservationSha256 !== null)
      fail("missing pinned detector baseline observation");
    if (transition.parentCandidateId !== previousId)
      fail("current transition parent does not match retained baseline");
    const expectedDiff = {
      added: Object.keys(d.records)
        .filter((id) => !Object.hasOwn(previousRecords, id))
        .sort(codePointOrder),
      removed: Object.keys(previousRecords)
        .filter((id) => !Object.hasOwn(d.records, id))
        .sort(codePointOrder),
      changed: Object.keys(d.records)
        .filter(
          (id) =>
            Object.hasOwn(previousRecords, id) &&
            d.records[id] !== previousRecords[id],
        )
        .sort(codePointOrder),
    };
    if (!same(transition.runDiff, expectedDiff))
      fail("current runDiff does not match retained baseline records");
    if (
      policy.syntheticFixture !== true ||
      detection.currentTransitionText !== undefined
    ) {
      text(
        detection.currentTransitionText,
        "retained durable current transition text",
      );
      digest(detection.transitionId, "durable current transition ID");
      const journalTree = parseWithNumbers(detection.currentTransitionText),
        journal = toPlain(journalTree);
      const { transitionId: journalId, ...payload } = journalTree;
      if (
        journalId !== detection.transitionId ||
        sha256Text(canonical(payload)) !== journalId
      )
        fail("durable current transition integrity mismatch");
      let parent = null;
      if (previousId !== null) {
        text(detection.previousCandidateText, "retained parent candidate text");
        const parentTree = parseWithNumbers(detection.previousCandidateText);
        parent = toPlain(parentTree);
        const { provenanceSha256, ...parentPayload } = parentTree;
        if (
          parent.schemaVersion !== 1 ||
          parent.requiresReview !== true ||
          parent.sourceId !== d.sourceId ||
          parent.candidateId !== previousId ||
          sha256Text(canonical(parentTree.identity)) !== previousId ||
          sha256Text(canonical(parentPayload)) !== provenanceSha256 ||
          sha256Text(canonical(parentTree.records)) !==
            parent.identity.parsedSha256 ||
          !same(parent.records, previousRecords)
        )
          fail("retained parent candidate provenance mismatch");
      } else if (detection.previousCandidateText !== null)
        fail("initial durable transition needs explicit null parent candidate");
      const kind =
        parent === null
          ? "initial"
          : d.candidateId === parent.candidateId
            ? "no-change"
            : Object.values(expectedDiff).some((ids) => ids.length)
              ? "records"
              : ["registrySha256", "parserVersion", "sourceSchemaVersion"].some(
                    (key) => d.identity[key] !== parent.identity[key],
                  )
                ? "contract"
                : "provenance-only";
      if (
        journal.schemaVersion !== 1 ||
        journal.sourceId !== d.sourceId ||
        journal.candidateId !== d.candidateId ||
        journal.parentCandidateId !== previousId ||
        journal.candidateProvenanceSha256 !== d.provenanceSha256 ||
        journal.parentProvenanceSha256 !== (parent?.provenanceSha256 ?? null) ||
        !same(journal.diff, expectedDiff) ||
        journal.status !== transition.status ||
        journal.changeKind !== kind ||
        journal.observationOnly !== (kind === "provenance-only") ||
        typeof journal.attemptedAtSeconds !== "number" ||
        !Number.isFinite(journal.attemptedAtSeconds) ||
        journal.attemptedAtSeconds < 0
      )
        fail("durable current transition differs from bound snapshots");
      if (instant(journal.retrievedAtUtc) < instant(d.retrievedAtUtc))
        fail("durable transition predates immutable candidate");
      if (journal.observationOnly)
        fail("observation-only provenance is not fresh admission evidence");
    }
  }
  const currentDiff = transition ? transition.runDiff : d.diff;
  const affected = checkedDiff(currentDiff);
  if (!Array.isArray(sourceRecordIds) || !same(sourceRecordIds, affected))
    fail("review must cover exact detection diff IDs for current runDiff");
  if (candidate.kind === "reopening" && currentDiff.removed.length)
    fail("notice disappearance cannot authorize reopening");
}

function evidenceOf(candidate, policy, evidence) {
  const e = candidate.evidence;
  if (
    !e ||
    !policy.authorities?.some(
      (a) => a.id === e.authorityId && a.urls?.includes(e.url),
    )
  )
    fail("unapproved authoritative source");
  digest(e.sha256, "evidence");
  const bytes = evidence[e.sha256];
  if (!bytes || sha256(bytes) !== e.sha256)
    fail("missing or corrupt minimized evidence");
  if (instant(e.publishedAtUtc) > instant(e.retrievedAtUtc))
    fail("publication after retrieval");
  text(e.statement, "authoritative statement");
  if (!bytes.toString("utf8").includes(e.statement))
    fail("statement not in retained evidence");
  return e;
}

/** Trusted inputs: policy, decisions and baseline ledger are reviewer-owned, never learned from a fetch. */
export function reviewRefresh({
  baseline,
  target,
  ledger,
  candidates,
  decisions,
  policy,
  evidence,
}) {
  const oldNetwork = verifySnapshot(baseline),
    nextNetwork = verifySnapshot(target);
  const old = features(oldNetwork),
    next = features(nextNetwork);
  const oldProjections = routingProjections(oldNetwork),
    nextProjections = routingProjections(nextNetwork);
  if (
    ["schema", "kind", "id"].some(
      (key) => baseline.record[key] !== target.record[key],
    )
  )
    fail("dataset identity migration requires separate admission contract");
  const changedPackageInputs = packageChangesOf(baseline, target);
  if (
    changedPackageInputs.some(
      (change) =>
        [
          "osmManifestBytes",
          "proposedManifestBytes",
          "accessManifestBytes",
        ].includes(change.id) || change.id.startsWith("part:"),
    )
  )
    fail(
      "auxiliary source/part refresh requires separate exact source-ID admission contract",
    );
  let packageReviewed = changedPackageInputs.length === 0;
  if (
    ledger.schema !== REVIEW_SCHEMA ||
    !same(ledger.dataset, snapshotIdentity(baseline)) ||
    !Array.isArray(ledger.closures)
  )
    fail("baseline ledger identity mismatch");
  if (new Set(ledger.closures.map((c) => c.id)).size !== ledger.closures.length)
    fail("duplicate baseline closure");
  const closures = new Map(
    ledger.closures.map((c) => {
      text(c.id, "closure ID");
      exactIds(c.affectedIds);
      if (c.affectedIds.some((id) => !old.has(id)))
        fail("baseline closure refers to absent ID");
      return [c.id, structuredClone(c)];
    }),
  );
  if (
    !Array.isArray(candidates) ||
    !Array.isArray(decisions) ||
    !policy.reviewers?.length
  )
    fail("invalid review inputs");
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    fail("duplicate candidate");
  if (
    new Set(decisions.map((d) => d.candidateId)).size !== decisions.length ||
    decisions.some((d) => !candidates.some((c) => c.id === d.candidateId))
  )
    fail("duplicate or orphan decision");
  const changedIds = [...new Set([...old.keys(), ...next.keys()])]
    .filter(
      (id) =>
        !same(oldProjections.get(id) ?? null, nextProjections.get(id) ?? null),
    )
    .sort();
  const admittedIds = new Set();
  const reviews = [];
  const decidedClosures = new Set();
  for (const c of candidates) {
    text(c.id, "candidate ID");
    if (
      c.schema !== "trail-mapper.refresh-candidate/1" ||
      !["closure", "reopening", "geometry", "package", "information"].includes(
        c.kind,
      )
    )
      fail("incompatible candidate schema/kind");
    if (
      !same(c.baseline, snapshotIdentity(baseline)) ||
      !same(c.target, snapshotIdentity(target))
    )
      fail("candidate dataset identity mismatch");
    exactIds(c.affectedIds);
    if (c.affectedIds.some((id) => !old.has(id) && !next.has(id)))
      fail("unknown affected ID");
    verifyDetection(c, policy);
    const e = evidenceOf(c, policy, evidence);
    const d = decisions.find((d) => d.candidateId === c.id);
    if (
      !d ||
      !["accept", "reject", "unresolved"].includes(d.decision) ||
      !policy.reviewers.includes(d.reviewer)
    )
      fail("explicit approved reviewer decision required");
    if (d.candidateSha256 !== canonicalSha256(c))
      fail("decision is not bound to exact candidate");
    if (instant(d.reviewedAtUtc) < instant(e.retrievedAtUtc))
      fail("review predates retrieval");
    if (
      c.detection?.currentTransitionText &&
      instant(d.reviewedAtUtc) <
        instant(JSON.parse(c.detection.currentTransitionText).retrievedAtUtc)
    )
      fail("review predates current durable transition retrieval");
    text(d.reason, "decision reason");
    if (
      !["verified", "ambiguous", "unverified"].includes(c.confidence) ||
      !["present", "withdrawn", "fetch-failed"].includes(c.status)
    )
      fail("invalid confidence/status");
    if (d.decision === "accept") {
      if (c.confidence !== "verified" || c.status !== "present")
        fail(
          "ambiguous, withdrawn or failed-fetch candidate cannot be accepted",
        );
      if (
        ["geometry", "package"].includes(c.kind) &&
        changedPackageInputs.length
      ) {
        if (!same(c.packageChanges, changedPackageInputs))
          fail("exact complete package input changes require explicit review");
        packageReviewed = true;
      }
      if (c.kind === "geometry") {
        if (!same([...c.affectedIds].sort(), changedIds))
          fail("geometry review must name exactly all changed IDs");
        if (c.affectedIds.some((id) => !old.has(id) || !next.has(id)))
          fail(
            "ID migration/addition/removal requires a separate reviewed migration contract",
          );
        if (
          !same(
            c.geometry,
            c.affectedIds.map((id) => ({ id, paths: next.get(id).paths })),
          )
        )
          fail("geometry is not exact admitted source geometry");
        c.affectedIds.forEach((id) => admittedIds.add(id));
      } else if (c.kind === "package") {
        if (
          changedIds.length ||
          !same(
            [...c.affectedIds].sort(codePointOrder),
            [...new Set([...old.keys(), ...next.keys()])].sort(codePointOrder),
          )
        )
          fail(
            "package metadata review must cover exactly the complete routing ID scope without geometry changes",
          );
      } else if (c.kind === "information") {
        if (c.routingEffect !== "none")
          fail("informational road works cannot exclude trails");
      } else {
        text(c.closureId, "closure ID");
        if (decidedClosures.has(c.closureId))
          fail("conflicting decisions for same closure");
        decidedClosures.add(c.closureId);
        if (
          c.authoritativeDecision !==
          (c.kind === "closure" ? "closed" : "reopened")
        )
          fail("explicit authoritative closing/reopening decision required");
        if (c.kind === "reopening") {
          const prior = closures.get(c.closureId);
          if (
            !prior ||
            !same([...prior.affectedIds].sort(), [...c.affectedIds].sort()) ||
            c.supersedesSha256 !== canonicalSha256(prior)
          )
            fail(
              "reopening must supersede exact existing closure and affected IDs",
            );
          closures.delete(c.closureId);
        } else {
          if (closures.has(c.closureId))
            fail("existing closure cannot be silently replaced");
          // Exact source path/leg indices. No notice corridor is projected or invented here.
          if (
            !Array.isArray(c.geometry) ||
            !c.geometry.length ||
            !same(
              [...new Set(c.geometry.map((g) => g.id))].sort(),
              [...c.affectedIds].sort(),
            )
          )
            fail("exact closure geometry required");
          for (const g of c.geometry) {
            const path = next.get(g.id)?.paths?.[g.pathIndex];
            if (
              !Number.isInteger(g.pathIndex) ||
              !Number.isInteger(g.fromVertex) ||
              !Number.isInteger(g.toVertex) ||
              g.fromVertex < 0 ||
              g.toVertex <= g.fromVertex ||
              !path ||
              g.toVertex >= path.length ||
              !same(g.coordinates, path.slice(g.fromVertex, g.toVertex + 1))
            )
              fail("closure geometry not exact source interval");
          }
          c.geometry.forEach((g) => requireUniqueInterval(next.get(g.id), g));
          if (c.compiledClosure) {
            const compiled = c.compiledClosure;
            const g = c.geometry[0];
            const from = g.coordinates[0],
              to = g.coordinates.at(-1);
            if (
              c.geometry.length !== 1 ||
              compiled.id !== c.closureId ||
              compiled.featureId !== g.id ||
              compiled.noticeUrl !== e.url ||
              compiled.boundsProjected !== false ||
              compiled.isCrossing !== false ||
              !same(compiled.closedFrom, {
                latitude: from[1],
                longitude: from[0],
              }) ||
              !same(compiled.closedTo, { latitude: to[1], longitude: to[0] }) ||
              compiled.activeFromEpochMillis !== instant(c.activeFromUtc) ||
              !same(
                compiled.closedPath,
                g.coordinates.map(([longitude, latitude]) => ({
                  latitude,
                  longitude,
                })),
              ) ||
              !same(compiled.sourceLine, [])
            )
              fail(
                "compiled closure does not match exact reviewed source interval/activation",
              );
            text(compiled.title, "compiled closure title");
            text(compiled.guidance, "compiled closure guidance");
          }
          closures.set(c.closureId, {
            id: c.closureId,
            affectedIds: c.affectedIds,
            geometry: c.geometry,
            candidateSha256: canonicalSha256(c),
            evidence: e,
            review: d,
            ...(c.compiledClosure
              ? {
                  compiledClosure: c.compiledClosure,
                  compiledSha256: canonicalSha256(c.compiledClosure),
                }
              : {}),
          });
        }
      }
    }
    reviews.push({ candidate: c, decision: d });
  }
  if (!packageReviewed) fail("unreviewed package inputs/source metadata");
  if (changedIds.some((id) => !admittedIds.has(id)))
    fail("unreviewed geometry/attribute changes");
  if (
    [...closures.values()].some((c) =>
      c.affectedIds.some((id) => !next.has(id)),
    )
  )
    fail("known closure lost its canonical ID");
  for (const closure of closures.values()) {
    if (closure.compiledClosure) {
      const compiled = closure.compiledClosure;
      if (
        compiled.id !== closure.id ||
        !same(closure.affectedIds, [compiled.featureId]) ||
        closure.compiledSha256 !== canonicalSha256(compiled)
      )
        fail("compiled baseline closure identity mismatch");
      if (
        !same(
          old.get(compiled.featureId)?.paths,
          next.get(compiled.featureId)?.paths,
        )
      )
        fail("geometry refresh invalidates compiled closure mapping");
      continue;
    }
    if (
      !Array.isArray(closure.geometry) ||
      !closure.geometry.length ||
      !same(
        [...new Set(closure.geometry.map((g) => g.id))].sort(),
        [...closure.affectedIds].sort(),
      )
    )
      fail("baseline closure has no reviewed geometry");
    for (const g of closure.geometry) {
      const path = next.get(g.id)?.paths?.[g.pathIndex];
      requireUniqueInterval(next.get(g.id), g);
      if (
        !path ||
        !Number.isInteger(g.pathIndex) ||
        !Number.isInteger(g.fromVertex) ||
        !Number.isInteger(g.toVertex) ||
        g.fromVertex < 0 ||
        g.toVertex <= g.fromVertex ||
        g.toVertex >= path.length ||
        !same(g.coordinates, path.slice(g.fromVertex, g.toVertex + 1))
      )
        fail(
          "geometry refresh invalidates known closure mapping; explicit remapping review required",
        );
    }
  }
  const nextLedger = {
    schema: REVIEW_SCHEMA,
    dataset: snapshotIdentity(target),
    closures: [...closures.values()].sort((a, b) => codePointOrder(a.id, b.id)),
  };
  return structuredClone({
    schema: REVIEW_SCHEMA,
    version: `refresh.${canonicalSha256({ target: snapshotIdentity(target), nextLedger, reviews, policy }).slice(0, 16)}`,
    baseline: snapshotIdentity(baseline),
    target: snapshotIdentity(target),
    ledger: nextLedger,
    reviews,
    changedIds,
    changedPackageInputs,
    reviewPolicy: policy,
    notices: {
      source: target.record.source,
      supplements: target.record.supplements ?? [],
      change: reviews.map((r) => ({
        id: r.candidate.id,
        decision: r.decision.decision,
        reason: r.decision.reason,
      })),
    },
    rollback: {
      dataset: snapshotIdentity(baseline),
      ledgerSha256: canonicalSha256(ledger),
      purpose: "baseline-evidence-only",
      requiresHigherReleaseSequence: true,
      requiresCurrentCompleteClosureEvidence: true,
    },
    // Separate release owner must bind compiled closure catalog + representative real-router controls to this report.
    release: {
      approved: false,
      blockers: [
        "Owner release approval required",
        "Exact compiled core closure catalog and real-router route/loop/access/revalidation controls required",
      ],
    },
  });
}

function addFile(files, file, bytes) {
  if (Object.hasOwn(files, file)) fail(`artifact filename collision: ${file}`);
  files[file] = bytes;
}
function snapshotFiles(snapshot, prefix) {
  const files = Object.create(null);
  addFile(
    files,
    `${prefix}/dataset.json`,
    Buffer.from(canonical(snapshot.record)),
  );
  addFile(files, `${prefix}/${snapshot.record.content.file}`, snapshot.body);
  addFile(files, `${prefix}/manifest.json`, snapshot.manifestBytes);
  for (const [name, bytes] of Object.entries(snapshot.parts ?? {}))
    addFile(files, `${prefix}/${name}`, bytes);
  for (const key of [
    "osmManifestBytes",
    "proposedManifestBytes",
    "accessManifestBytes",
  ])
    if (snapshot[key]) addFile(files, `${prefix}/${key}.json`, snapshot[key]);
  return files;
}
function reproduceReport(report, baseline, target, baselineLedger, evidence) {
  if (!report.reviewPolicy || !Array.isArray(report.reviews))
    fail("artifact lacks complete replayable review inputs");
  const replay = reviewRefresh({
    baseline,
    target,
    ledger: baselineLedger,
    candidates: report.reviews.map((r) => r.candidate),
    decisions: report.reviews.map((r) => r.decision),
    policy: report.reviewPolicy,
    evidence,
  });
  if (!same(replay, report))
    fail("artifact review report does not reproduce from retained inputs");
}
function checkRouterReport(routerAdmission, report) {
  if (
    routerAdmission.schema !== "trail-mapper.router-admission/1" ||
    routerAdmission.approved !== false ||
    routerAdmission.reviewSha256 !== canonicalSha256(report) ||
    !same(routerAdmission.dataset, report.target)
  )
    fail("router admission/report mismatch");
  digest(routerAdmission.core?.inputsSha256, "router core inputs");
  digest(routerAdmission.core?.outputsSha256, "router core outputs");
  digest(routerAdmission.catalogSha256, "router catalog");
}
/** Immutable private evidence bundle. No result of this API authorizes runtime activation. */
export async function writeReviewArtifact({
  outDir,
  report,
  baseline,
  target,
  baselineLedger,
  evidence,
  routerAdmission = null,
}) {
  verifySnapshot(baseline);
  verifySnapshot(target);
  reproduceReport(report, baseline, target, baselineLedger, evidence);
  const files = Object.create(null);
  for (const [name, bytes] of Object.entries({
    ...snapshotFiles(baseline, "rollback"),
    ...snapshotFiles(target, "candidate"),
  }))
    addFile(files, name, bytes);
  addFile(files, "review.json", Buffer.from(canonical(report)));
  addFile(
    files,
    "rollback/ledger.json",
    Buffer.from(canonical(baselineLedger)),
  );
  if (routerAdmission) {
    checkRouterReport(routerAdmission, report);
    addFile(
      files,
      "router-admission.json",
      Buffer.from(canonical(routerAdmission)),
    );
  }
  for (const r of report.reviews) {
    const h = r.candidate.evidence.sha256;
    if (!evidence[h] || sha256(evidence[h]) !== h)
      fail("artifact evidence mismatch");
    const name = `evidence/${h}.txt`;
    if (Object.hasOwn(files, name)) {
      if (sha256(files[name]) !== h) fail("evidence filename collision");
    } else addFile(files, name, evidence[h]);
  }
  const index = {
    schema: "trail-mapper.refresh-artifact/1",
    version: report.version,
    files: Object.entries(files)
      .sort(([a], [b]) => codePointOrder(a, b))
      .map(([file, bytes]) => ({
        file,
        sha256: sha256(bytes),
        bytes: bytes.length,
      })),
  };
  if (!/^refresh\.[0-9a-f]{16}$/.test(report.version))
    fail("unsafe artifact version");
  const dir = join(outDir, report.version);
  await mkdir(outDir, { recursive: true });
  await mkdir(dir);
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(join(dir, file, ".."), { recursive: true });
    await writeFile(join(dir, file), bytes, { flag: "wx" });
  }
  await writeFile(join(dir, "artifact.json"), canonical(index), { flag: "wx" });
  const artifactSha256 = canonicalSha256(index);
  await verifyReviewArtifact(dir, artifactSha256); // Complete package and review replay, not only file hashes.
  return { dir, index, artifactSha256 };
}
async function artifactSnapshot(files, prefix) {
  const get = (name) => {
    const bytes = files.get(`${prefix}/${name}`);
    if (!bytes) fail(`incomplete artifact snapshot: ${prefix}/${name}`);
    return bytes;
  };
  const record = JSON.parse(get("dataset.json").toString("utf8"));
  if (!/^trails\.[0-9a-f]{12}\.json$/.test(record.content?.file ?? ""))
    fail("reserved or incompatible artifact network filename");
  const snapshot = {
    record,
    body: get(record.content.file),
    manifestBytes: get("manifest.json"),
    parts: Object.create(null),
  };
  const consumed = new Set([
    "dataset.json",
    record.content.file,
    "manifest.json",
    ...(prefix === "rollback" ? ["ledger.json"] : []),
  ]);
  for (const key of [
    "osmManifestBytes",
    "proposedManifestBytes",
    "accessManifestBytes",
  ])
    if (files.has(`${prefix}/${key}.json`)) {
      snapshot[key] = get(`${key}.json`);
      consumed.add(`${key}.json`);
    }
  for (const [file, bytes] of files)
    if (file.startsWith(`${prefix}/`)) {
      const name = file.slice(prefix.length + 1);
      if (!consumed.has(name)) snapshot.parts[name] = bytes;
    }
  verifySnapshot(snapshot);
  return snapshot;
}
async function onDiskFiles(dir, prefix = "") {
  const names = [];
  for (const entry of await readdir(join(dir, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail("artifact symlinks are unsupported");
    if (entry.isDirectory()) names.push(...(await onDiskFiles(dir, name)));
    else if (entry.isFile()) names.push(name);
    else fail("unsupported artifact filesystem entry");
  }
  return names;
}
async function loadReviewArtifact(dir, expectedSha256) {
  digest(expectedSha256, "pinned artifact");
  const index = JSON.parse(await readFile(join(dir, "artifact.json"), "utf8"));
  if (
    index.schema !== "trail-mapper.refresh-artifact/1" ||
    canonicalSha256(index) !== expectedSha256 ||
    !Array.isArray(index.files)
  )
    fail("artifact index mismatch");
  const files = new Map();
  for (const entry of index.files) {
    if (
      (!/^(candidate|rollback|evidence)\/[a-zA-Z0-9_.-]+$/.test(entry.file) &&
        !["review.json", "router-admission.json"].includes(entry.file)) ||
      entry.file.split("/").some((part) => [".", ".."].includes(part))
    )
      fail("unsafe artifact path");
    if (files.has(entry.file)) fail("duplicate artifact file");
    const bytes = await readFile(join(dir, entry.file));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
      fail("artifact bytes mismatch");
    files.set(entry.file, bytes);
  }
  if (
    !same(
      (await onDiskFiles(dir)).sort(codePointOrder),
      ["artifact.json", ...files.keys()].sort(codePointOrder),
    )
  )
    fail("unexpected unindexed artifact files");
  for (const name of [
    "review.json",
    "rollback/ledger.json",
    "candidate/dataset.json",
    "rollback/dataset.json",
  ])
    if (!files.has(name)) fail("incomplete artifact");
  const report = JSON.parse(files.get("review.json").toString("utf8"));
  if (index.version !== report.version)
    fail("artifact version/report mismatch");
  const baseline = await artifactSnapshot(files, "rollback"),
    target = await artifactSnapshot(files, "candidate");
  const baselineLedger = JSON.parse(
    files.get("rollback/ledger.json").toString("utf8"),
  );
  if (
    !same(report.baseline, snapshotIdentity(baseline)) ||
    !same(report.target, snapshotIdentity(target)) ||
    report.rollback.ledgerSha256 !== canonicalSha256(baselineLedger)
  )
    fail("artifact snapshot/review/rollback identity mismatch");
  const evidence = Object.create(null),
    wanted = new Set(
      report.reviews.map((r) => `evidence/${r.candidate.evidence.sha256}.txt`),
    );
  for (const name of wanted) {
    if (!files.has(name)) fail("missing retained artifact evidence");
    evidence[name.slice("evidence/".length, -".txt".length)] = files.get(name);
  }
  if (
    [...files.keys()].some(
      (name) => name.startsWith("evidence/") && !wanted.has(name),
    )
  )
    fail("unreferenced artifact evidence");
  reproduceReport(report, baseline, target, baselineLedger, evidence);
  if (files.has("router-admission.json"))
    checkRouterReport(
      JSON.parse(files.get("router-admission.json").toString("utf8")),
      report,
    );
  return { report, baseline, target, baselineLedger };
}
export async function verifyReviewArtifact(dir, expectedSha256) {
  return (await loadReviewArtifact(dir, expectedSha256)).report;
}
/** Returns reconstructed baseline evidence. It never authorizes restoring an old core/closure catalog. */
export async function selectRollback(dir, expectedSha256) {
  const { report, baseline, baselineLedger } = await loadReviewArtifact(
    dir,
    expectedSha256,
  );
  return {
    ...baseline,
    baselineLedger,
    currentClosureEvidence: report.ledger,
    purpose: "baseline-evidence-only",
    activationAllowed: false,
    requiresHigherReleaseSequence: true,
    requiresCurrentCompleteClosureEvidence: true,
  };
}
