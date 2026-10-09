# Offline reviewed refresh admission (#106)

`webApp/tools/review-refresh.mjs` reviews candidates and writes immutable private
review artifacts. It never fetches, schedules, changes release approvals, publishes,
or changes the compiled shared closure catalog. Existing Start and saved-route
revalidation gates and native feature freeze remain intact. Every report is blocked
from release. This is admission preparation, not a production release mechanism.

## Detection interface

Based on PR109 head `1c56268ec60a9f58498f4c01aa9574b844c4dffc` and its
`docs/web/source-candidate-contract.md`. Keep the entire detection envelope under
`candidate.detection.observation`. Put the sorted exact union of its added, removed
and changed source record IDs under `candidate.detection.sourceRecordIds`. Routing
IDs are separate reviewer-owned mapping decisions. Policy `detectionSources` pins
`sourceId`, `url`, `registrySha256`, `parserVersion`, `sourceSchemaVersion`. Both
identity and parsed record hashes must reproduce. Removed notices cannot authorize
reopening. Raw/minimized authoritative evidence must be independently retained;
the detector's hash-only index does not establish authority or semantic truth.

For the additive provenance contract, preserve `provenanceSha256`,
`identity.componentHashes` and `identity.sourceTimes` without normalizing or
replacing them. Admission verifies the digest of the complete immutable candidate
excluding `provenanceSha256`, as well as its identity and record hashes. Copy the
current detector result's `status`, `staleEvidence`, `parentCandidateId` and
`runDiff` under `candidate.detection.transition`. This transition is separately
bound by the reviewer's complete candidate digest. Only a nonstale `candidate`
result can supply it. `sourceRecordIds` must cover the exact current `runDiff`,
not the stored candidate's first-observation `diff`. In repeated-content runs,
the immutable first retrieval/diff stays intact and is never presented as today's
change; current removals still cannot authorize reopening.

Retain the exact producer JSON as `detection.observationText`, including numeric
spelling and Unicode, and the preceding observation as
`detection.previousObservationText` (explicit null for the first observation).
The reviewer-owned source policy independently pins `baselineDataset` and
`previousObservationSha256` (null for an initial observation). Admission computes
the preceding candidate ID and current diff from retained records and rejects a
parent, baseline identity or diff mismatch. Production candidates require this
binding; an immutable candidate's original diff cannot substitute for the current
transition. `requireProvenance:true` additionally refuses stripped provenance.

Synthetic tests may use `policy.syntheticFixture:true` without detection. This is
never production approval. No production source policy or review owner is invented.

## Reviewer contract

Review candidate schema is `trail-mapper.refresh-candidate/1`. Required fields:
`id`, `kind` (closure/reopening/geometry/package/information), `baseline`, `target` (from
`snapshotIdentity`), exact distinct canonical `affectedIds`, `confidence`
(verified/ambiguous/unverified), `status` (present/withdrawn/fetch-failed), and
`evidence`. Evidence includes approved `authorityId`, exact approved `url`, retained
bytes `sha256`, an exact retained `statement`, `publishedAtUtc`, `retrievedAtUtc`.
Publication cannot be inferred from HTTP caching, retrieval or manifest dates.

Closing additionally requires `closureId`, `authoritativeDecision:'closed'`, and
exact `geometry` entries `{id,pathIndex,fromVertex,toVertex,coordinates}` matching
source vertices. Projected or crossing-only extents are not inferred; existing
compiled gates for those remain intact. Ambiguous extents stay unresolved.
Reopening requires `authoritativeDecision:'reopened'`, the same `closureId`, exact
prior affected IDs and `supersedesSha256` of the prior ledger closure. Elapsed dates,
missing candidates, withdrawn notices and failed fetches never reopen anything.
Information requires `routingEffect:'none'`; road works cannot become exclusions.
Geometry requires `geometry:[{id,paths}]` exactly matching all changed features
(including changed attributes). IDs must persist. Additions/removals/migrations
are refused pending a separate reviewed migration contract. Endpoints must each
match exactly one source vertex within the native one-metre tolerance across all
paths. Repeated vertices and multiple possible intervals are refused. A new compiled
vertex rule's `closedPath` must equal the complete interval and `sourceLine` must
be empty; alternative source frames require a separate reviewed contract.

`packageChangesOf(baseline,target)` identifies exact manifest, record, network/layer
metadata and auxiliary input changes. Geometry reviews bind this complete list
when package inputs change. A metadata-only `package` review names every routing
ID and the exact list. Unreviewed source/layer metadata changes are rejected.
Changed OSM/Proposed/access manifests or parts are conservatively refused pending
an exact auxiliary source-ID refresh contract. Unchanged admitted auxiliaries remain
supported. Dataset IDs, schemas and kinds cannot migrate through this interface.

Separate decisions are `{candidateId,candidateSha256,reviewer,reviewedAtUtc,
decision,reason}`. Decisions are accept/reject/unresolved. Approved reviewer IDs in
`policy.reviewers` and exact authority URL lists in `policy.authorities:[{id,urls}]`
are trusted reviewer-owned inputs, never fetched approvals. The candidate hash
covers all fields, including detection. Accept requires verified/present evidence.
Reviews cannot predate retrieval. Missing decisions and conflicting accepted
operations on one closure fail the whole review. Reject/unresolved entries stay
in the report and retain known closures. A hash proves integrity, not that a
statement actually supports the reviewer's interpretation.

The complete reviewer-owned baseline ledger is
`{schema:'trail-mapper.refresh-review/1',dataset:<snapshotIdentity>,closures:[...]}`.
Do not start production with an empty ledger that omits compiled known exclusions.
Its identity must match the baseline. Output retains every closure without a
separately accepted explicit reopening.

## Offline use, verification and rollback

From `webApp`:

```sh
node --test tests/unit/reviewed-refresh.test.mjs
node tools/review-refresh.mjs --config /private/review-input.json --out generated/refresh
```

Config schema `trail-mapper.refresh-input/1` names paths `ledger`, `candidates`,
`decisions`, `policy`, evidence mapping `{sha256:path}`, and `baseline`/`target`
snapshot specs. Each spec names `dir` (package containing dataset.json), `manifest`
(reviewed county manifest), optional `parts` filenames, optional
`osmManifestBytes`, `proposedManifestBytes`, `accessManifestBytes` paths. Paths are
relative to the config. Inputs are read only.

Existing county admission re-verifies evidence, geometry, attributes, layer,
license/composition, rights-gated opt-in Proposed and access parts. Review also
refuses duplicate IDs and invalid/degenerate paths. It never repairs or invents
connections. Version binds exact target identity, complete closure ledger and
review decisions. Artifacts retain candidate and rollback packages, all parts and
manifests, minimized evidence, source/change notices, and review.json. artifact.json
indexes exact hashes and lengths. Save returned `artifactSha256` independently.
Outputs cannot overwrite an existing version. Partial writes have no final index.
Identical inputs reproduce identical reports and index bytes.

`verifyReviewArtifact(dir, expectedSha256)` verifies the pinned inventory, re-admits
both complete snapshots and reproduces the review from retained policy, decisions
and evidence. Reserved filenames, collisions, unreferenced parts, unindexed files
and symlinks are refused. Artifact writing also performs this complete round trip.

`selectRollback(dir, expectedSha256)` returns the complete reconstructed baseline,
including every auxiliary manifest/part, `baselineLedger` and separately retained
`currentClosureEvidence`. Its purpose is baseline evidence only; activation remains
false. Production rollback requires a higher release sequence, current complete
closure evidence and a separately reviewed compatible core/package. Restoring an
older ledger/core must never drop a newly known closure. Saved-route revalidation
and canonical IDs remain mandatory; no deployment is performed by this tool.

## Outstanding integration gates

The `closureCatalog` operation exposes the complete compiled catalog (not only active
closures). Ledger entries for existing compiled rules retain `compiledClosure` and
`compiledSha256` plus exact `affectedIds`. The admission runner compares every rule,
field and digest; it refuses omitted, extra or changed rules. Geometry changes to
any feature referenced by those rules require an explicit remapping review.

`runReviewedRouterControls` in `tools/lib/reviewed-router-controls.mjs` verifies the
checkout's core input/output manifest before and after running actual Kotlin
`dispatch`. It initializes the exact admitted package with estimated access and
serialized-route trust disabled. Access packages use the same hash-verifying base and
endpoint-local tile loader as the worker, with tile loads before each operation;
the report records exactly which admitted parts were loaded. Required control categories are point, loop,
disconnected, unverified-access, closure and saved-route. Category-specific behavior
checks cannot be replaced with a generic successful-dispatch assertion. Caller-owned
assertions pin additional exact expected fields. Every accepted close must have a
gate control naming its exact closure and affected features; every accepted reopen
must have a navigable saved-route control on its exact affected features.
Saved routes come from preceding
control cases, not invented serialized inputs. Output binds full review/package,
compiled catalog, core source/output hashes, requests, assertions and response hashes.

CLI config `routerControls:{cases:<path>,now:<epoch millis>}` runs this gate before
writing the artifact and includes a hash-indexed `router-admission.json`. Failed
controls or catalog mismatches produce no output artifact. Omitting controls only
produces a release-blocked preparatory artifact. Artifacts still never grant approval.

A new vertex-bounded closure may include the exact reviewed `compiledClosure`
descriptor and `activeFromUtc`; review checks its endpoints, source, ID and activation
against the source interval. It must then exactly match a separately reviewed,
rebuilt compiled core. A reopening must actually be removed from that compiled
catalog before controls can succeed. There is no runtime override or mutable catalog.
The integration owner owns those source changes and all release decisions.
A claimed test report or schema check cannot
satisfy that requirement. Existing owner composition/license/provider gates and
artifact verification remain mandatory. Reports hard-code release blockers and
cannot activate candidates. Specific authoritative condition research belongs to
#1/#2; public approval, physical acceptance and release remain unresolved.

Self-authored minimized fixtures cover acceptance and refusal, #105 binding,
deterministic reports, changed geometry, retained closures, rollback and tampering.
They do not claim real-county topology or physical-mobile acceptance. The supported
environment setup resolved the earlier build failure:

```sh
source /workspace/.setup/activate.sh
cd webApp
npm run build:core
TRAIL_REVIEW_CONTROL_REPORT=../docs/web/reviewed-router-control-evidence.json node --test tests/unit/reviewed-router-controls.test.mjs
```

The setup selects the installed JDK 21, Android SDK and Gradle cache; no access
workaround or new credentials are required. The rebuilt core ran the full web unit
suite with no skips. `reviewed-router-control-evidence.json` records the minimized
synthetic admission run against exact source/output hashes. The fixtures prove
control execution and conservative binding, not real-county or physical acceptance.
The companion `reviewed-router-control-evidence-access.json` records mapped and
unverified access against an admitted synthetic tiled package. Shared and bridge
JVM suites passed: 391 shared and 63 bridge tests, including 12 real-data timed
closure tests, with no skips or failures. Production admission still requires the
actual new licensed source package and reviewer decisions; no synthetic report
supplies that approval.

The genuine detector fixture is emitted by the pinned Python producer, not a JS
facsimile. It exercises A→B→A immutable reuse, current removals, Unicode ordering,
1.0, -0.0 and exponent spelling. Regenerate offline against PR109 commit
`1c56268ec60a9f58498f4c01aa9574b844c4dffc`:

```sh
python webApp/tests/support/generate-detector-admission-fixture.py --detector-dir /path/to/pinned-checkout/tools --out webApp/tests/support/detector-admission.fixture.json
```

The driver verifies the producer file digest before importing it, injects only
self-authored transport bytes, and never fetches or activates a schedule.
