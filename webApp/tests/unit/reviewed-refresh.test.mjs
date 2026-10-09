import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCounty } from "../support/county-fixture.mjs";
import { buildPackage } from "../../tools/lib/dataset-package.mjs";
import { canonicalSha256 } from "../../tools/lib/canonical-json.mjs";
import { sha256 } from "../../tools/lib/core.mjs";
import {
  REVIEW_SCHEMA,
  snapshotIdentity,
  packageChangesOf,
  reviewRefresh,
  writeReviewArtifact,
  verifyReviewArtifact,
  selectRollback,
} from "../../tools/lib/reviewed-refresh.mjs";
const clone = (value) => structuredClone(value);
async function fixture() {
  const county = makeCounty();
  const manifestBytes = Buffer.from(JSON.stringify(county.manifest));
  const baseline = {
    ...(await buildPackage({
      inputText: JSON.stringify(county.input),
      manifest: county.manifest,
      manifestBytes,
      approval: county.approval,
    })),
    manifestBytes,
  };
  const bytes = Buffer.from(
    "Synthetic authority explicitly closed this trail. Synthetic authority explicitly reopened this trail.",
  );
  const h = sha256(bytes);
  const args = {
    baseline,
    target: baseline,
    ledger: {
      schema: REVIEW_SCHEMA,
      dataset: snapshotIdentity(baseline),
      closures: [],
    },
    candidates: [],
    decisions: [],
    policy: {
      syntheticFixture: true,
      reviewers: ["fixture-reviewer"],
      authorities: [
        { id: "fixture-authority", urls: ["https://example.test/notice"] },
      ],
    },
    evidence: { [h]: bytes },
  };
  const paths = JSON.parse(baseline.body).layers[0].features[0].paths;
  const c = {
    schema: "trail-mapper.refresh-candidate/1",
    id: "candidate-1",
    kind: "closure",
    baseline: snapshotIdentity(baseline),
    target: snapshotIdentity(baseline),
    affectedIds: ["54:9001"],
    closureId: "fixture-closure",
    confidence: "verified",
    status: "present",
    authoritativeDecision: "closed",
    geometry: [
      {
        id: "54:9001",
        pathIndex: 0,
        fromVertex: 0,
        toVertex: 1,
        coordinates: paths[0],
      },
    ],
    evidence: {
      authorityId: "fixture-authority",
      url: "https://example.test/notice",
      sha256: h,
      statement: "Synthetic authority explicitly closed this trail.",
      publishedAtUtc: "2026-01-01T00:00:00Z",
      retrievedAtUtc: "2026-01-02T00:00:00Z",
    },
  };
  args.candidates = [c];
  args.decisions = [decision(c)];
  return args;
}
function decision(c, value = "accept") {
  return {
    candidateId: c.id,
    candidateSha256: canonicalSha256(c),
    decision: value,
    reviewer: "fixture-reviewer",
    reviewedAtUtc: "2026-01-03T00:00:00Z",
    reason: "Exact synthetic authority and source interval reviewed.",
  };
}
function update(args, change) {
  change(args.candidates[0], args);
  args.decisions = [decision(args.candidates[0])];
  return args;
}
test("explicit closing and separately reviewed reopening; deterministic review; private approval remains false", async () => {
  const args = await fixture();
  const first = reviewRefresh(args);
  assert.deepEqual(first, reviewRefresh(args));
  assert.equal(first.ledger.closures.length, 1);
  assert.equal(first.release.approved, false);
  assert.equal(args.baseline.record.approval.approved, false);
  args.ledger = first.ledger;
  update(args, (c) => {
    c.id = "reopen";
    c.kind = "reopening";
    c.authoritativeDecision = "reopened";
    c.supersedesSha256 = canonicalSha256(first.ledger.closures[0]);
    c.evidence.statement =
      "Synthetic authority explicitly reopened this trail.";
    delete c.geometry;
  });
  assert.equal(reviewRefresh(args).ledger.closures.length, 0);
});
test("elapsed dates, missing candidates and rejected withdrawn notices never reopen a known closure", async () => {
  const args = await fixture();
  args.ledger = reviewRefresh(args).ledger;
  args.candidates = [];
  args.decisions = [];
  assert.equal(reviewRefresh(args).ledger.closures.length, 1);
  const original = await fixture();
  args.candidates = original.candidates;
  update(args, (c) => {
    c.kind = "reopening";
    c.status = "withdrawn";
    c.authoritativeDecision = "reopened";
    c.estimatedEndUtc = "2000-01-01T00:00:00Z";
  });
  args.decisions = [decision(args.candidates[0], "unresolved")];
  assert.equal(reviewRefresh(args).ledger.closures.length, 1);
});
const refusals = [
  [
    "ambiguous extent",
    (c) => {
      c.confidence = "ambiguous";
    },
    /ambiguous/,
  ],
  [
    "withdrawn notice",
    (c) => {
      c.status = "withdrawn";
    },
    /withdrawn/,
  ],
  [
    "fetch failure",
    (c) => {
      c.status = "fetch-failed";
    },
    /failed-fetch/,
  ],
  [
    "invented interval",
    (c) => {
      c.geometry[0].coordinates[0][0] += 0.001;
    },
    /exact source interval/,
  ],
  [
    "unknown ID",
    (c) => {
      c.affectedIds = ["54:UNKNOWN"];
    },
    /unknown affected ID/,
  ],
  [
    "duplicate ID",
    (c) => {
      c.affectedIds.push(c.affectedIds[0]);
    },
    /distinct canonical/,
  ],
  [
    "informational road works",
    (c) => {
      c.kind = "information";
      c.routingEffect = "exclude";
    },
    /informational road works/,
  ],
  [
    "no explicit reopening",
    (c) => {
      c.kind = "reopening";
      delete c.authoritativeDecision;
    },
    /explicit authoritative/,
  ],
  [
    "unapproved authority",
    (c) => {
      c.evidence.authorityId = "unknown";
    },
    /unapproved authoritative/,
  ],
  [
    "invalid date",
    (c) => {
      c.evidence.publishedAtUtc = "2026-02-30T00:00:00Z";
    },
    /invalid UTC/,
  ],
  [
    "no retained statement",
    (c) => {
      c.evidence.statement = "unsupported all clear";
    },
    /statement not in/,
  ],
  [
    "incompatible schema",
    (c) => {
      c.schema = "unknown";
    },
    /incompatible/,
  ],
];
for (const [name, change, expected] of refusals)
  test(`refuses ${name}`, async () => {
    const args = update(await fixture(), change);
    assert.throws(() => reviewRefresh(args), expected);
  });
test("stale review hash, missing review, and unauthorized reviewer fail closed", async () => {
  const args = await fixture();
  args.candidates[0].closureId = "changed";
  assert.throws(() => reviewRefresh(args), /exact candidate/);
  args.decisions = [];
  assert.throws(() => reviewRefresh(args), /explicit approved reviewer/);
  args.decisions = [decision(args.candidates[0])];
  args.decisions[0].reviewer = "outsider";
  assert.throws(() => reviewRefresh(args), /explicit approved reviewer/);
});
test("invalid geometry and changed network bytes fail existing artifact verification", async () => {
  const args = await fixture();
  args.target = { ...args.target, body: Buffer.from("{}") };
  assert.throws(() => reviewRefresh(args), /recorded hash/);
});
test("rollback bytes are retained and pinned; corruption or overwrite is refused", async () => {
  const args = await fixture();
  const report = reviewRefresh(args);
  const outDir = await mkdtemp(join(tmpdir(), "review-refresh-"));
  try {
    const artifact = await writeReviewArtifact({
      outDir,
      report,
      baseline: args.baseline,
      target: args.target,
      baselineLedger: args.ledger,
      evidence: args.evidence,
    });
    assert.deepEqual(
      await verifyReviewArtifact(artifact.dir, artifact.artifactSha256),
      report,
    );
    assert.deepEqual(
      (await selectRollback(artifact.dir, artifact.artifactSha256)).body,
      args.baseline.body,
    );
    assert.deepEqual(
      await readFile(
        join(artifact.dir, "rollback", args.baseline.record.content.file),
      ),
      args.baseline.body,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(join(artifact.dir, "rollback/ledger.json"), "utf8"),
      ),
      args.ledger,
    );
    await assert.rejects(
      writeReviewArtifact({
        outDir,
        report,
        baseline: args.baseline,
        target: args.target,
        baselineLedger: args.ledger,
        evidence: args.evidence,
      }),
      /EEXIST/,
    );
    await writeFile(
      join(artifact.dir, "rollback", args.baseline.record.content.file),
      "tampered",
    );
    await assert.rejects(
      verifyReviewArtifact(artifact.dir, artifact.artifactSha256),
      /artifact bytes mismatch/,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("reviewed refreshed geometry is admitted only with exact changed IDs; ID migration is refused", async () => {
  const args = await fixture();
  const county = makeCounty();
  const feature = county.input.layers[0].features[0];
  feature.paths[0][1][0] += 0.0001;
  feature.provenance.geometrySha256 = canonicalSha256(feature.paths);
  county.manifest.features[0].geometrySha256 =
    feature.provenance.geometrySha256;
  const manifestBytes = Buffer.from(JSON.stringify(county.manifest));
  args.target = {
    ...(await buildPackage({
      inputText: JSON.stringify(county.input),
      manifest: county.manifest,
      manifestBytes,
      approval: county.approval,
    })),
    manifestBytes,
  };
  update(args, (c) => {
    c.kind = "geometry";
    c.packageChanges = packageChangesOf(args.baseline, args.target);
    c.target = snapshotIdentity(args.target);
    c.geometry = [{ id: feature.id, paths: feature.paths }];
  });
  const report = reviewRefresh(args);
  assert.deepEqual(report.changedIds, [feature.id]);
  assert.notEqual(report.target.contentSha256, report.baseline.contentSha256);
  args.decisions[0].decision = "unresolved";
  assert.throws(() => reviewRefresh(args), /unreviewed (geometry|package)/);
  update(args, (c) => {
    c.affectedIds.push("54:9002");
  });
  assert.throws(() => reviewRefresh(args), /exactly all changed IDs/);
});
test("geometry alteration without re-reviewed evidence is rejected before review", async () => {
  const args = await fixture();
  const county = makeCounty();
  county.input.layers[0].features[0].paths[0][1][0] += 0.001;
  await assert.rejects(
    buildPackage({
      inputText: JSON.stringify(county.input),
      manifest: county.manifest,
      manifestBytes: Buffer.from(JSON.stringify(county.manifest)),
      approval: county.approval,
    }),
    /reviewed evidence/,
  );
});
test("accepted conflicting close and reopen candidates are rejected as ambiguous", async () => {
  const args = await fixture();
  const c = clone(args.candidates[0]);
  c.id = "second";
  args.candidates.push(c);
  args.decisions.push(decision(c));
  assert.throws(() => reviewRefresh(args), /conflicting decisions/);
});

test("#105 envelope is bound to approved registry/parser and exact source diff", async () => {
  const args = await fixture();
  const records = { "notice-1": sha256(Buffer.from("source-record")) };
  const identity = {
    sourceId: "official-notices",
    sourceUrl: "https://example.test/notice",
    registrySha256: sha256(Buffer.from("registry")),
    contentSha256: sha256(Buffer.from("raw")),
    parsedSha256: canonicalSha256(records),
    parserVersion: "fixture/1",
    sourceSchemaVersion: "notice/1",
  };
  args.policy.detectionSources = [
    {
      sourceId: identity.sourceId,
      url: identity.sourceUrl,
      registrySha256: identity.registrySha256,
      parserVersion: identity.parserVersion,
      sourceSchemaVersion: identity.sourceSchemaVersion,
    },
  ];
  const observation = {
    schemaVersion: 1,
    candidateId: canonicalSha256(identity),
    identity,
    sourceId: identity.sourceId,
    retrievedAtUtc: "2026-01-02T00:00:00Z",
    sourcePublishedAtUtc: null,
    reviewedOn: "2026-01-01",
    manifestPath: "fixture.manifest.json",
    parentCandidateId: null,
    records,
    diff: { added: ["notice-1"], changed: [], removed: [] },
    requiresReview: true,
  };
  update(args, (c) => {
    c.detection = { observation, sourceRecordIds: ["notice-1"] };
  });
  assert.equal(
    reviewRefresh(args).reviews[0].candidate.detection.observation.candidateId,
    observation.candidateId,
  );
  update(args, (c) => {
    c.detection.sourceRecordIds = [];
  });
  assert.throws(() => reviewRefresh(args), /exact detection diff/);
  update(args, (c) => {
    c.detection.sourceRecordIds = ["notice-1"];
    c.detection.observation.identity.parserVersion = "different";
  });
  assert.throws(() => reviewRefresh(args), /identity hash mismatch/);
});
test("non-fixture candidates require detection without deriving approval from it", async () => {
  const args = await fixture();
  delete args.policy.syntheticFixture;
  assert.throws(() => reviewRefresh(args), /immutable #105/);
});

test("offline CLI produces a reproducible pinned artifact and preserves input package", async () => {
  const { spawnSync } = await import("node:child_process");
  const args = await fixture();
  const dir = await mkdtemp(join(tmpdir(), "review-cli-"));
  try {
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(join(dir, "package")),
    );
    await writeFile(
      join(dir, "package/dataset.json"),
      JSON.stringify(args.baseline.record),
    );
    await writeFile(
      join(dir, "package", args.baseline.record.content.file),
      args.baseline.body,
    );
    await writeFile(join(dir, "manifest.json"), args.baseline.manifestBytes);
    for (const key of ["ledger", "candidates", "decisions", "policy"])
      await writeFile(join(dir, `${key}.json`), JSON.stringify(args[key]));
    const evidence = {};
    for (const [hash, bytes] of Object.entries(args.evidence)) {
      evidence[hash] = `${hash}.txt`;
      await writeFile(join(dir, evidence[hash]), bytes);
    }
    const config = {
      schema: "trail-mapper.refresh-input/1",
      baseline: { dir: "package", manifest: "manifest.json" },
      target: { dir: "package", manifest: "manifest.json" },
      ledger: "ledger.json",
      candidates: "candidates.json",
      decisions: "decisions.json",
      policy: "policy.json",
      evidence,
    };
    await writeFile(join(dir, "config.json"), JSON.stringify(config));
    const cli = new URL("../../tools/review-refresh.mjs", import.meta.url);
    const run = (out) =>
      spawnSync(
        process.execPath,
        [
          cli.pathname,
          "--config",
          join(dir, "config.json"),
          "--out",
          join(dir, out),
        ],
        { encoding: "utf8" },
      );
    const first = run("one");
    assert.equal(first.status, 0, first.stderr);
    const second = run("two");
    assert.equal(second.status, 0, second.stderr);
    const a = JSON.parse(first.stdout),
      b = JSON.parse(second.stdout);
    assert.equal(a.artifactSha256, b.artifactSha256);
    assert.deepEqual(
      await verifyReviewArtifact(a.dir, a.artifactSha256),
      reviewRefresh(args),
    );
    assert.deepEqual(
      (await selectRollback(a.dir, a.artifactSha256)).body,
      args.baseline.body,
    );
    assert.deepEqual(
      await readFile(join(dir, "package", args.baseline.record.content.file)),
      args.baseline.body,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function additiveDetection() {
  const records = { "notice-1": sha256(Buffer.from("retained-record")) };
  const identity = {
    sourceId: "official-notices",
    sourceUrl: "https://example.test/notice",
    registrySha256: sha256(Buffer.from("registry")),
    contentSha256: sha256(Buffer.from("aggregate")),
    parsedSha256: canonicalSha256(records),
    parserVersion: "adapter/2",
    sourceSchemaVersion: "notice/1",
    componentHashes: { notice: sha256(Buffer.from("raw notice")) },
    sourceTimes: { notice: { publishedAtUtc: "2026-01-01T00:00:00Z" } },
  };
  const observation = {
    schemaVersion: 1,
    candidateId: canonicalSha256(identity),
    identity,
    sourceId: identity.sourceId,
    retrievedAtUtc: "2026-01-02T00:00:00Z",
    sourcePublishedAtUtc: "2026-01-01T00:00:00Z",
    reviewedOn: "2026-01-01",
    manifestPath: "notice.manifest.json",
    parentCandidateId: null,
    records,
    diff: { added: ["notice-1"], removed: [], changed: [] },
    requiresReview: true,
  };
  observation.provenanceSha256 = canonicalSha256(observation);
  const transition = {
    status: "candidate",
    staleEvidence: false,
    parentCandidateId: sha256(Buffer.from("intervening observation")),
    runDiff: { added: [], removed: [], changed: ["notice-1"] },
  };
  const source = {
    sourceId: identity.sourceId,
    url: identity.sourceUrl,
    registrySha256: identity.registrySha256,
    parserVersion: identity.parserVersion,
    sourceSchemaVersion: identity.sourceSchemaVersion,
    requireProvenance: true,
  };
  return {
    detection: { observation, transition, sourceRecordIds: ["notice-1"] },
    source,
  };
}
test("latest #105 additive provenance and component/source times bind the current transition separately", async () => {
  const args = await fixture();
  const { detection, source } = additiveDetection();
  args.policy.detectionSources = [source];
  update(args, (c) => {
    c.detection = detection;
  });
  const report = reviewRefresh(args);
  assert.deepEqual(report.reviews[0].candidate.detection, detection);
  update(args, (c) => {
    delete c.detection.transition;
  });
  assert.throws(() => reviewRefresh(args), /current detection runDiff/);
});
test("repeated content uses current runDiff, and does not replay the immutable first diff", async () => {
  const args = await fixture();
  const { detection, source } = additiveDetection();
  args.policy.detectionSources = [source];
  detection.transition.runDiff = {
    added: [],
    removed: ["notice-2"],
    changed: [],
  };
  detection.sourceRecordIds = ["notice-2"];
  update(args, (c) => {
    c.kind = "information";
    c.routingEffect = "none";
    c.detection = detection;
  });
  assert.equal(reviewRefresh(args).reviews[0].decision.decision, "accept");
  update(args, (c) => {
    c.detection.sourceRecordIds = ["notice-1"];
  });
  assert.throws(() => reviewRefresh(args), /current runDiff/);
  update(args, (c) => {
    c.detection.sourceRecordIds = ["notice-2"];
    c.kind = "reopening";
    c.authoritativeDecision = "reopened";
  });
  assert.throws(() => reviewRefresh(args), /disappearance/);
});
test("provenance tampering, stale run results and missing latest-contract provenance fail closed", async () => {
  const args = await fixture();
  const { detection, source } = additiveDetection();
  args.policy.detectionSources = [source];
  update(args, (c) => {
    c.detection = detection;
    c.detection.observation.retrievedAtUtc = "2026-01-04T00:00:00Z";
  });
  assert.throws(() => reviewRefresh(args), /provenance hash mismatch/);
  update(args, (c) => {
    c.detection = additiveDetection().detection;
    c.detection.transition.staleEvidence = true;
  });
  assert.throws(() => reviewRefresh(args), /stale/);
  update(args, (c) => {
    c.detection = additiveDetection().detection;
    delete c.detection.observation.provenanceSha256;
    delete c.detection.observation.identity.componentHashes;
    c.detection.observation.candidateId = canonicalSha256(
      c.detection.observation.identity,
    );
  });
  assert.throws(() => reviewRefresh(args), /contract requires provenance/);
});

async function genuineDetectorReview(runIndex = 2) {
  const fixtureData = JSON.parse(
    await readFile(
      new URL("../support/detector-admission.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  const run = fixtureData.runs[runIndex];
  const args = await fixture();
  delete args.policy.syntheticFixture;
  const candidate = run.result.candidate;
  const source = {
    sourceId: candidate.sourceId,
    url: candidate.identity.sourceUrl,
    registrySha256: candidate.identity.registrySha256,
    parserVersion: candidate.identity.parserVersion,
    sourceSchemaVersion: candidate.identity.sourceSchemaVersion,
    requireProvenance: true,
    baselineDataset: snapshotIdentity(args.baseline),
    previousObservationSha256:
      run.previousObservationText === null
        ? null
        : sha256(Buffer.from(run.previousObservationText)),
  };
  args.policy.detectionSources = [source];
  update(args, (c) => {
    c.kind = "information";
    c.routingEffect = "none";
    c.detection = {
      observation: candidate,
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
    };
  });
  args.decisions[0].reviewedAtUtc = "2026-01-06T00:00:00Z";
  return { args, fixtureData, run };
}
test("genuine pinned Python detector A→B→A feeds JS admission with numeric and non-ASCII canonical bytes", async () => {
  const { args, fixtureData, run } = await genuineDetectorReview();
  assert.equal(
    fixtureData.producer.commit,
    "452eccc0fc1016f0012c923e3a4d4b45de8e3c24",
  );
  assert.equal(run.candidateText, fixtureData.runs[0].candidateText);
  assert.notDeepEqual(run.result.runDiff, run.result.candidate.diff);
  assert.match(run.candidateText, /1\.0/);
  assert.match(run.candidateText, /1e-07/);
  assert.match(run.candidateText, /réouverture 🚴/);
  const report = reviewRefresh(args);
  assert.equal(report.release.approved, false);
  assert.deepEqual(
    report.reviews[0].candidate.detection.transition.runDiff,
    run.result.runDiff,
  );
  const normalized = JSON.stringify(run.result.candidate);
  update(args, (c) => {
    c.detection.observationText = normalized;
  });
  assert.throws(() => reviewRefresh(args), /provenance hash mismatch/);
});
test("genuine first observation binds an explicit empty previous baseline to exact dataset", async () => {
  const { args } = await genuineDetectorReview(0);
  assert.equal(reviewRefresh(args).reviews.length, 1);
  update(args, (c, a) => {
    a.policy.detectionSources[0].baselineDataset = {
      ...c.baseline,
      version: "wrong",
    };
  });
  assert.throws(() => reviewRefresh(args), /exact dataset/);
});
test("genuine transition parent, previous bytes and recomputed record diff independently fail closed", async () => {
  let { args } = await genuineDetectorReview();
  update(args, (c) => {
    c.detection.transition.parentCandidateId = sha256(
      Buffer.from("wrong parent"),
    );
  });
  assert.throws(() => reviewRefresh(args), /parent.*retained baseline/);
  ({ args } = await genuineDetectorReview());
  update(args, (c) => {
    c.detection.previousObservationText += " ";
  });
  assert.throws(() => reviewRefresh(args), /baseline hash mismatch/);
  ({ args } = await genuineDetectorReview());
  update(args, (c) => {
    c.detection.transition.runDiff = {
      added: [],
      changed: ["notice-é"],
      removed: [],
    };
    c.detection.sourceRecordIds = ["notice-é"];
  });
  assert.throws(() => reviewRefresh(args), /runDiff.*baseline records/);
  ({ args } = await genuineDetectorReview());
  update(args, (c) => {
    delete c.detection.previousObservationText;
  });
  assert.throws(() => reviewRefresh(args), /baseline text/);
});

async function countySnapshot(county = makeCounty(), options = {}) {
  const manifestBytes = Buffer.from(JSON.stringify(county.manifest));
  const built = await buildPackage({
    inputText: JSON.stringify(county.input),
    manifest: county.manifest,
    manifestBytes,
    approval: county.approval,
    ...options,
  });
  return {
    ...built,
    manifestBytes,
    parts: Object.fromEntries(built.accessFiles.map((p) => [p.file, p.body])),
    ...(options.access
      ? { accessManifestBytes: options.access.manifestBytes }
      : {}),
    ...(options.supplement
      ? { osmManifestBytes: options.supplement.manifestBytes }
      : {}),
    ...(options.proposed
      ? { proposedManifestBytes: options.proposed.manifestBytes }
      : {}),
  };
}
function emptyReview(baseline, target = baseline) {
  return {
    baseline,
    target,
    ledger: {
      schema: REVIEW_SCHEMA,
      dataset: snapshotIdentity(baseline),
      closures: [],
    },
    candidates: [],
    decisions: [],
    policy: { syntheticFixture: true, reviewers: ["fixture-reviewer"] },
    evidence: {},
  };
}
async function changedNetwork(snapshot, mutate) {
  const { reconstructComposition } = await import(
    "../../tools/lib/composition.mjs"
  );
  const network = JSON.parse(snapshot.body);
  mutate(network);
  const body = Buffer.from(JSON.stringify(network)),
    record = clone(snapshot.record);
  record.content.sha256 = sha256(body);
  record.content.bytes = body.length;
  record.content.file = `trails.${record.content.sha256.slice(0, 12)}.json`;
  record.version = `2026-01-01.${record.content.sha256.slice(0, 12)}`;
  record.composition = reconstructComposition({
    record,
    body,
    network,
    manifestBytes: snapshot.manifestBytes,
    readPart: (name) => snapshot.parts?.[name],
  });
  return { ...snapshot, record, body };
}
test("layer attribution and ordering cannot drift behind unchanged feature objects", async () => {
  const baseline = await countySnapshot();
  const target = await changedNetwork(baseline, (n) => {
    n.layers[0].id = 999;
  });
  assert.throws(
    () => reviewRefresh(emptyReview(baseline, target)),
    /layer attribution\/order/,
  );
  const renamed = await changedNetwork(baseline, (n) => {
    n.layers[0].name = "different source layer";
  });
  assert.throws(
    () => reviewRefresh(emptyReview(baseline, renamed)),
    /unreviewed package/,
  );
});
test("manifest/source metadata changes need an exact separately accepted package-input review", async () => {
  const args = await fixture();
  const county = makeCounty();
  county.manifest.sourceContract.changes += " Synthetic metadata revision.";
  county.input.sources.changes = county.manifest.sourceContract.changes;
  args.target = await countySnapshot(county);
  args.candidates = [];
  args.decisions = [];
  assert.throws(() => reviewRefresh(args), /unreviewed package/);
  const source = await fixture();
  args.candidates = source.candidates;
  update(args, (c) => {
    c.kind = "package";
    c.target = snapshotIdentity(args.target);
    c.affectedIds = JSON.parse(args.target.body).layers.flatMap((layer) =>
      layer.features.map((f) => f.id),
    );
    c.packageChanges = packageChangesOf(args.baseline, args.target);
    delete c.geometry;
  });
  assert.ok(
    reviewRefresh(args).changedPackageInputs.some(
      (c) => c.id === "county-manifest",
    ),
  );
  update(args, (c) => {
    c.packageChanges.pop();
  });
  assert.throws(() => reviewRefresh(args), /exact complete package input/);
});
test("new access graph, OSM manifest and Proposed manifest cannot bypass exact source-ID review", async () => {
  const { makeAccessExtract, makeAccessManifest } = await import(
    "../support/access-fixture.mjs"
  );
  const { makeSupplement } = await import("../support/osm-fixture.mjs");
  const baseline = await countySnapshot();
  const inputText = JSON.stringify(makeAccessExtract());
  const access = {
    inputText,
    manifestBytes: Buffer.from(JSON.stringify(makeAccessManifest(inputText))),
  };
  const withAccess = await countySnapshot(makeCounty(), { access });
  assert.throws(
    () => reviewRefresh(emptyReview(baseline, withAccess)),
    /auxiliary source\/part refresh/,
  );
  const s = makeSupplement();
  const supplement = {
    inputText: JSON.stringify(s.input),
    manifest: s.manifest,
    manifestBytes: Buffer.from(JSON.stringify(s.manifest)),
  };
  const withOsm = await countySnapshot(makeCounty(), { supplement });
  assert.throws(
    () => reviewRefresh(emptyReview(baseline, withOsm)),
    /auxiliary source\/part refresh/,
  );
  assert.throws(
    () =>
      reviewRefresh(
        emptyReview(baseline, {
          ...baseline,
          proposedManifestBytes: Buffer.from("{}"),
        }),
      ),
    /unexpected auxiliary manifest/,
  );
});
test("reserved network/part filenames and unreferenced parts are rejected before artifact output", async () => {
  const args = await fixture(),
    report = reviewRefresh(args),
    outDir = await mkdtemp(join(tmpdir(), "collision-controls-"));
  try {
    for (const name of [
      "dataset.json",
      "manifest.json",
      "ledger.json",
      "accessManifestBytes.json",
    ]) {
      const baseline = {
        ...args.baseline,
        parts: { [name]: Buffer.from("collision") },
      };
      await assert.rejects(
        writeReviewArtifact({
          outDir,
          report,
          baseline,
          target: args.target,
          baselineLedger: args.ledger,
          evidence: args.evidence,
        }),
        /reserved or colliding/,
      );
    }
    const baseline = {
      ...args.baseline,
      parts: { "unused.json": Buffer.from("{}") },
    };
    await assert.rejects(
      writeReviewArtifact({
        outDir,
        report,
        baseline,
        target: args.target,
        baselineLedger: args.ledger,
        evidence: args.evidence,
      }),
      /unexpected unreferenced/,
    );
    const badRecord = {
      ...args.baseline.record,
      content: { ...args.baseline.record.content, file: "manifest.json" },
    };
    await assert.rejects(
      writeReviewArtifact({
        outDir,
        report,
        baseline: { ...args.baseline, record: badRecord },
        target: args.target,
        baselineLedger: args.ledger,
        evidence: args.evidence,
      }),
      /reserved or incompatible/,
    );
    assert.deepEqual(
      await import("node:fs/promises").then((fs) => fs.readdir(outDir)),
      [],
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
test("artifact verification re-admits rollback manifests even when a corrupt archive is rehashed", async () => {
  const args = await fixture(),
    report = reviewRefresh(args),
    outDir = await mkdtemp(join(tmpdir(), "rehash-controls-"));
  try {
    const result = await writeReviewArtifact({
      outDir,
      report,
      baseline: args.baseline,
      target: args.target,
      baselineLedger: args.ledger,
      evidence: args.evidence,
    });
    const bytes = Buffer.from("{}");
    await writeFile(join(result.dir, "rollback/manifest.json"), bytes);
    const index = clone(result.index),
      entry = index.files.find((f) => f.file === "rollback/manifest.json");
    entry.sha256 = sha256(bytes);
    entry.bytes = bytes.length;
    await writeFile(join(result.dir, "artifact.json"), JSON.stringify(index));
    await assert.rejects(
      selectRollback(result.dir, canonicalSha256(index)),
      /manifest|version|reviewed/,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
test("rollback reconstructs every access part and preserves current closure evidence without authorizing activation", async () => {
  const args = await fixture();
  const { makeAccessExtract, makeAccessManifest } = await import(
    "../support/access-fixture.mjs"
  );
  const inputText = JSON.stringify(makeAccessExtract());
  args.baseline = args.target = await countySnapshot(makeCounty(), {
    access: {
      inputText,
      manifestBytes: Buffer.from(JSON.stringify(makeAccessManifest(inputText))),
    },
  });
  args.ledger.dataset = snapshotIdentity(args.baseline);
  update(args, (c) => {
    c.baseline = c.target = snapshotIdentity(args.baseline);
  });
  const report = reviewRefresh(args),
    outDir = await mkdtemp(join(tmpdir(), "rollback-evidence-"));
  try {
    const result = await writeReviewArtifact({
      outDir,
      report,
      baseline: args.baseline,
      target: args.target,
      baselineLedger: args.ledger,
      evidence: args.evidence,
    });
    const selected = await selectRollback(result.dir, result.artifactSha256);
    assert.equal(selected.baselineLedger.closures.length, 0);
    assert.equal(selected.currentClosureEvidence.closures.length, 1);
    assert.equal(selected.activationAllowed, false);
    assert.equal(selected.requiresHigherReleaseSequence, true);
    assert.equal(selected.requiresCurrentCompleteClosureEvidence, true);
    assert.deepEqual(selected.manifestBytes, args.baseline.manifestBytes);
    assert.deepEqual(
      selected.accessManifestBytes,
      args.baseline.accessManifestBytes,
    );
    assert.ok(Object.keys(selected.parts).length > 1);
    for (const [name, bytes] of Object.entries(args.baseline.parts))
      assert.deepEqual(selected.parts[name], Buffer.from(bytes));
    await writeFile(join(result.dir, "unindexed.json"), "{}");
    await assert.rejects(
      verifyReviewArtifact(result.dir, result.artifactSha256),
      /unexpected unindexed/,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
test("repeated vertices and duplicate source paths cannot select a different native closure interval", async () => {
  for (const duplicatePath of [false, true]) {
    const args = await fixture(),
      county = makeCounty();
    const f = county.input.layers[0].features[0],
      original = clone(f.paths[0]);
    f.paths = duplicatePath
      ? [original, clone(original)]
      : [[...original, ...clone(original)]];
    f.provenance.geometrySha256 = canonicalSha256(f.paths);
    county.manifest.features[0].geometrySha256 = f.provenance.geometrySha256;
    args.baseline = args.target = await countySnapshot(county);
    args.ledger.dataset = snapshotIdentity(args.baseline);
    update(args, (c) => {
      c.baseline = c.target = snapshotIdentity(args.baseline);
      c.geometry = [
        {
          id: f.id,
          pathIndex: duplicatePath ? 1 : 0,
          fromVertex: duplicatePath ? 0 : 2,
          toVertex: duplicatePath ? 1 : 3,
          coordinates: original,
        },
      ];
    });
    assert.throws(
      () => reviewRefresh(args),
      /ambiguous compiled endpoint interval/,
    );
  }
});
test("compiled closedPath and sourceLine must bind the same complete reviewed interval", async () => {
  const args = await fixture();
  update(args, (c) => {
    c.activeFromUtc = "2026-01-01T00:00:00Z";
    c.compiledClosure = {
      id: c.closureId,
      featureId: c.affectedIds[0],
      noticeUrl: c.evidence.url,
      title: "Synthetic closure",
      guidance: "Synthetic exact interval",
      closedFrom: {
        longitude: c.geometry[0].coordinates[0][0],
        latitude: c.geometry[0].coordinates[0][1],
      },
      closedTo: {
        longitude: c.geometry[0].coordinates[1][0],
        latitude: c.geometry[0].coordinates[1][1],
      },
      activeFromEpochMillis: Date.parse(c.activeFromUtc),
      boundsProjected: false,
      isCrossing: false,
      closedPath: c.geometry[0].coordinates.map(([longitude, latitude]) => ({
        latitude,
        longitude,
      })),
      sourceLine: [],
      estimatedEndEpochMillis: null,
      mappingNote: "",
      checkedOn: "",
    };
  });
  const admitted = reviewRefresh(args);
  assert.equal(admitted.ledger.closures.length, 1);
  const descriptor = clone(args.candidates[0].compiledClosure);
  for (const key of Object.keys(descriptor)) {
    update(args, (c) => {
      c.compiledClosure = clone(descriptor);
      delete c.compiledClosure[key];
    });
    assert.throws(() => reviewRefresh(args), /exact key schema/);
  }
  for (const change of [
    (c) => {
      c.unknownDefault = false;
    },
    (c) => {
      c.closedFrom.altitude = 0;
    },
    (c) => {
      c.sourceLine = [{ latitude: 40, longitude: -88, unknown: 0 }];
    },
    (c) => {
      c.estimatedEndEpochMillis = "2026-01-01";
    },
    (c) => {
      c.boundsProjected = 0;
    },
  ]) {
    update(args, (c) => {
      c.compiledClosure = clone(descriptor);
      change(c.compiledClosure);
    });
    assert.throws(() => reviewRefresh(args), /compiled descriptor/);
  }
  args.candidates[0].compiledClosure = descriptor;
  const invalidLedger = clone(admitted.ledger);
  invalidLedger.closures[0].compiledClosure.unknownDefault = false;
  invalidLedger.closures[0].compiledSha256 = canonicalSha256(
    invalidLedger.closures[0].compiledClosure,
  );
  assert.throws(
    () =>
      reviewRefresh({
        ...args,
        ledger: invalidLedger,
        candidates: [],
        decisions: [],
      }),
    /exact key schema/,
  );
  update(args, (c) => {
    c.compiledClosure.closedPath[1].longitude += 0.001;
  });
  assert.throws(() => reviewRefresh(args), /compiled closure does not match/);
  update(args, (c) => {
    c.compiledClosure.closedPath = c.geometry[0].coordinates.map(
      ([longitude, latitude]) => ({ latitude, longitude }),
    );
    c.compiledClosure.sourceLine = clone(c.compiledClosure.closedPath);
  });
  assert.throws(() => reviewRefresh(args), /compiled closure does not match/);
});

test("genuine durable transition integrity, both snapshot provenance and observation-only classification fail closed", async () => {
  let { args } = await genuineDetectorReview();
  update(args, (c) => {
    const journal = JSON.parse(c.detection.currentTransitionText);
    journal.diff.removed = [];
    c.detection.currentTransitionText = JSON.stringify(journal);
  });
  assert.throws(
    () => reviewRefresh(args),
    /durable current transition integrity/,
  );
  ({ args } = await genuineDetectorReview());
  update(args, (c) => {
    delete c.detection.currentTransitionText;
  });
  assert.throws(() => reviewRefresh(args), /durable current transition text/);
  ({ args } = await genuineDetectorReview());
  update(args, (c) => {
    const parent = JSON.parse(c.detection.previousCandidateText);
    parent.retrievedAtUtc = "2026-01-01T00:00:00Z";
    c.detection.previousCandidateText = JSON.stringify(parent);
  });
  assert.throws(() => reviewRefresh(args), /parent candidate provenance/);
  ({ args } = await genuineDetectorReview());
  args.decisions[0].reviewedAtUtc = "2026-01-03T00:00:00Z";
  assert.throws(() => reviewRefresh(args), /review predates current durable/);
  ({ args } = await genuineDetectorReview(3));
  assert.throws(() => reviewRefresh(args), /observation-only provenance/);
});

test("a correctly rehashed durable journal cannot change its bound snapshot, diff or classification", async () => {
  for (const [key, value] of Object.entries({
    candidateProvenanceSha256: "0".repeat(64),
    parentProvenanceSha256: "0".repeat(64),
    diff: { added: [], changed: [], removed: [] },
    changeKind: "initial",
    observationOnly: true,
    sourceId: "different-source",
  })) {
    const { args } = await genuineDetectorReview();
    update(args, (c) => {
      const { transitionId, ...journal } = JSON.parse(
        c.detection.currentTransitionText,
      );
      journal[key] = value;
      const id = canonicalSha256(journal);
      c.detection.transitionId = id;
      c.detection.currentTransitionText = JSON.stringify({
        ...journal,
        transitionId: id,
      });
    });
    assert.throws(
      () => reviewRefresh(args),
      /durable current transition differs from bound snapshots/,
    );
  }
});
