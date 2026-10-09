# Offline reviewed refresh admission (#106)

`webApp/tools/review-refresh.mjs` reviews candidates and writes immutable private
review artifacts. It never fetches, schedules, changes release approvals, publishes,
or changes the compiled shared closure catalog. Existing Start and saved-route
revalidation gates and native feature freeze remain intact. Every report is blocked
from release. This is admission preparation, not a production release mechanism.

## Detection interface

Based on PR109 head `62832b321a81e926e76fd1419c2b2b4f91aa3a07` and its
`docs/web/source-candidate-contract.md`. Keep the entire detection envelope under
`candidate.detection.observation`. Put the sorted exact union of its added, removed
and changed source record IDs under `candidate.detection.sourceRecordIds`. Routing
IDs are separate reviewer-owned mapping decisions. Policy `detectionSources` pins
`sourceId`, `url`, `registrySha256`, `parserVersion`, `sourceSchemaVersion`. Both
identity and parsed record hashes must reproduce. Removed notices cannot authorize
reopening. Raw/minimized authoritative evidence must be independently retained;
the detector's hash-only index does not establish authority or semantic truth.

Synthetic tests may use `policy.syntheticFixture:true` without detection. This is
never production approval. No production source policy or review owner is invented.

## Reviewer contract

Review candidate schema is `trail-mapper.refresh-candidate/1`. Required fields:
`id`, `kind` (closure/reopening/geometry/information), `baseline`, `target` (from
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
are refused pending a separate reviewed migration contract.

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

`verifyReviewArtifact(dir, expectedSha256)` verifies the pinned index and files.
`selectRollback(dir, expectedSha256)` returns retained baseline record, bytes and
closure ledger; it performs no deployment. The integration owner restores the
complete previous site/core/dataset artifact together, retaining immutable network
and access files. Existing saved-route revalidation checks routes opened against
that older dataset and may require recalculation; rollback never rewrites saved IDs.

## Outstanding integration gates

The integration owner must bind the complete compiled core closure catalog to the
review ledger and execute representative real-router point routes, loops,
disconnected/unverified access, closure Start gates and saved-route revalidation
against the exact core/package. A claimed test report or schema check cannot
satisfy that requirement. Existing owner composition/license/provider gates and
artifact verification remain mandatory. Reports hard-code release blockers and
cannot activate candidates. Specific authoritative condition research belongs to
#1/#2; public approval, physical acceptance and release remain unresolved.

Self-authored minimized fixtures cover acceptance and refusal, #105 binding,
deterministic reports, changed geometry, retained closures, rollback and tampering.
They do not claim real-county topology or physical-mobile acceptance. In this
execution environment the compiled Kotlin JS core was absent, and rebuilding with
writable Gradle cache failed fetching Gradle 9.6.1 with Connection refused.
