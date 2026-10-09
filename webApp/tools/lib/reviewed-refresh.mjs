// Offline review only. No fetching, scheduling, mutation of release approvals or publication.
import { canonical, sha256Text, canonicalSha256 } from "./canonical-json.mjs";
import { checkPackage } from "./dataset-package.mjs";
import { sha256 } from "./core.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const network = checkPackage(
    record,
    body,
    manifestBytes,
    osmManifestBytes,
    (name) => parts[name],
    proposedManifestBytes,
    accessManifestBytes,
  );
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
  const hasProvenance = Object.hasOwn(d, "provenanceSha256");
  if (hasProvenance) {
    digest(d.provenanceSha256, "detection provenance");
    const { provenanceSha256, ...provenance } = d;
    if (canonicalSha256(provenance) !== provenanceSha256)
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
  if (hasProvenance && !transition)
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
  if (canonicalSha256(d.identity) !== d.candidateId)
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
        !same(ids, [...new Set(ids)].sort())
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
    return all.sort();
  };
  checkedDiff(d.diff); // Stored immutable first-observation provenance is verified, never repurposed as today's transition.
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
  const old = features(verifySnapshot(baseline));
  const next = features(verifySnapshot(target));
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
    .filter((id) => !same(old.get(id) ?? null, next.get(id) ?? null))
    .sort();
  const admittedIds = new Set();
  const reviews = [];
  const decidedClosures = new Set();
  for (const c of candidates) {
    text(c.id, "candidate ID");
    if (
      c.schema !== "trail-mapper.refresh-candidate/1" ||
      !["closure", "reopening", "geometry", "information"].includes(c.kind)
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
              compiled.activeFromEpochMillis !== instant(c.activeFromUtc)
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
    closures: [...closures.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return structuredClone({
    schema: REVIEW_SCHEMA,
    version: `refresh.${canonicalSha256({ target: snapshotIdentity(target), nextLedger, reviews }).slice(0, 16)}`,
    baseline: snapshotIdentity(baseline),
    target: snapshotIdentity(target),
    ledger: nextLedger,
    reviews,
    changedIds,
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

function snapshotFiles(snapshot, prefix) {
  const files = {
    [`${prefix}/dataset.json`]: Buffer.from(canonical(snapshot.record)),
    [`${prefix}/${snapshot.record.content.file}`]: snapshot.body,
    [`${prefix}/manifest.json`]: snapshot.manifestBytes,
  };
  for (const [name, bytes] of Object.entries(snapshot.parts ?? {})) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..")
      fail("unsafe package part name");
    files[`${prefix}/${name}`] = bytes;
  }
  for (const key of [
    "osmManifestBytes",
    "proposedManifestBytes",
    "accessManifestBytes",
  ])
    if (snapshot[key]) files[`${prefix}/${key}.json`] = snapshot[key];
  return files;
}
/** Immutable directory, with both candidate and last accepted package. Existing outputs are never overwritten. */
export async function writeReviewArtifact({
  outDir,
  report,
  baseline,
  target,
  baselineLedger,
  evidence,
  routerAdmission = null,
}) {
  if (
    !same(report.baseline, snapshotIdentity(baseline)) ||
    !same(report.target, snapshotIdentity(target)) ||
    report.rollback.ledgerSha256 !== canonicalSha256(baselineLedger)
  )
    fail("artifact/report mismatch");
  verifySnapshot(baseline);
  verifySnapshot(target);
  const files = {
    ...snapshotFiles(baseline, "rollback"),
    ...snapshotFiles(target, "candidate"),
    "review.json": Buffer.from(canonical(report)),
    "rollback/ledger.json": Buffer.from(canonical(baselineLedger)),
  };
  if (routerAdmission) {
    if (
      routerAdmission.schema !== "trail-mapper.router-admission/1" ||
      routerAdmission.approved !== false ||
      routerAdmission.reviewSha256 !== canonicalSha256(report) ||
      !same(routerAdmission.dataset, report.target)
    )
      fail("router admission/report mismatch");
    files["router-admission.json"] = Buffer.from(canonical(routerAdmission));
  }
  for (const r of report.reviews) {
    const h = r.candidate.evidence.sha256;
    if (!evidence[h] || sha256(evidence[h]) !== h)
      fail("artifact evidence mismatch");
    files[`evidence/${h}.txt`] = evidence[h];
  }
  const index = {
    schema: "trail-mapper.refresh-artifact/1",
    version: report.version,
    files: Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, bytes]) => ({
        file,
        sha256: sha256(bytes),
        bytes: bytes.length,
      })),
  };
  // Reserve a fresh immutable version. A partial write has no index and cannot verify.
  const dir = join(outDir, report.version);
  await mkdir(outDir, { recursive: true });
  await mkdir(dir);
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(join(dir, file, ".."), { recursive: true });
    await writeFile(join(dir, file), bytes, { flag: "wx" });
  }
  await writeFile(join(dir, "artifact.json"), canonical(index), { flag: "wx" });
  return { dir, index, artifactSha256: canonicalSha256(index) };
}
export async function verifyReviewArtifact(dir, expectedSha256) {
  digest(expectedSha256, "pinned artifact");
  const index = JSON.parse(await readFile(join(dir, "artifact.json"), "utf8"));
  if (
    index.schema !== "trail-mapper.refresh-artifact/1" ||
    canonicalSha256(index) !== expectedSha256 ||
    !Array.isArray(index.files)
  )
    fail("artifact index mismatch");
  const seen = new Set();
  for (const entry of index.files) {
    if (
      !/^(candidate|rollback|evidence)\/[a-zA-Z0-9_.-]+$/.test(entry.file) &&
      !["review.json", "router-admission.json"].includes(entry.file)
    )
      fail("unsafe artifact path");
    if (seen.has(entry.file)) fail("duplicate artifact file");
    seen.add(entry.file);
    const bytes = await readFile(join(dir, entry.file));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
      fail("artifact bytes mismatch");
  }
  for (const required of [
    "candidate/dataset.json",
    "rollback/dataset.json",
    "rollback/ledger.json",
    "review.json",
  ])
    if (!seen.has(required)) fail("incomplete artifact");
  return JSON.parse(await readFile(join(dir, "review.json"), "utf8"));
}

/** Read-only rollback selection. Deployment remains an explicit integration-owner action. */
export async function selectRollback(dir, expectedSha256) {
  const report = await verifyReviewArtifact(dir, expectedSha256);
  const record = JSON.parse(
    await readFile(join(dir, "rollback/dataset.json"), "utf8"),
  );
  const ledger = JSON.parse(
    await readFile(join(dir, "rollback/ledger.json"), "utf8"),
  );
  const body = await readFile(join(dir, "rollback", record.content.file));
  if (
    !same(report.rollback.dataset, snapshotIdentity({ record, body })) ||
    canonicalSha256(ledger) !== report.rollback.ledgerSha256
  )
    fail("rollback identity mismatch");
  return { record, ledger, body };
}
