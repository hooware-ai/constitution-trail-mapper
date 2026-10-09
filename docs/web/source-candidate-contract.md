# Source candidate foundation (#105)

This offline-first foundation references existing dataset manifests in
`data/web-source-registry.json`. Every production entry has
`executionApproved: false`; #47/#48 and specific reviews #1/#2 remain gates.
Cadence and review owner are explicitly unresolved. Limits are reviewable local
caps, not source-service permission. No schedule, credential, paid service,
release, native feature or routing behavior changes here.

Official notice scope is separately pinned in
`data/web-notice-sources.manifest.json`, derived from the conditions developer's
[October 9 evidence at PR110's tested commit](https://github.com/hooware-ai/constitution-trail-mapper/blob/a4474cfb11983840194fb4c8fccaf3c51938b16d/docs/local-condition-review-2026-10-09.md)
and the existing `docs/web/closure-readiness.md` City GIS review. The Hamilton/GIS
review date remains October 3, not a new retrieval claim. Blocked/absent pages,
elapsed estimates and disappeared objects cannot confirm reopening. Initial
north-of-Vernon current access and endpoints remain unresolved under #2.

## Minimal interface for admission and runtime developers

All modules are Python standard library. There is no scheduler or production CLI.

- `tools/source_candidates.py`: `observe` consumes an injected transport/parser,
  explicit parser/schema identities, UTC retrieval time, numeric attempt clock,
  last successful `observation`, and optional read-only `accepted` snapshot.
- `tools/source_adapters.py`: `observe_adapter` consumes a registry source, its
  existing manifest, and injected transport. It observes a complete bounded
  multi-request source run; failure discards every new component observation.
- `tools/source_candidate_state.py`: `run_serialized` owns per-source process
  serialization and durable cooldown state. Use this wrapper for recurring runs;
  individual `observe` calls do not themselves persist a cooldown.

Example with a synthetic or independently permitted archived-response transport:

```python
result = run_serialized(
    source, store="data/generated/source-candidate-review",  # ignored local evidence
    now_seconds=1791504000, retrieved_at_utc="2026-10-09T00:00:00Z",
    accepted=accepted_snapshot, observer=observe_adapter,
    manifest=existing_manifest, transport=synthetic_transport,
)
```

The POSIX wrapper hashes source IDs for filenames and retains lock inodes. It
holds per-source and shared-store `flock` across reservation, fetching and completion, durably writes the
attempt reservation **before** transport, and leaves that cooldown/stale state
in place after a process crash. Failed fetches retain the previous observation.
Rate-limited runs do not extend the cooldown; a backwards clock fails closed.
Corrupt state or reservation-write failure prevents fetching. Persisted state adds
`stateSha256`, covering the entire state except that field. Every read verifies it. All processes must
use the same trusted local store. This is local process coordination, not a
multi-host lock or a scheduler. Windows requires a separately reviewed lock
implementation; this wrapper and its hosted tests target the existing Linux lane.

Transport returns a context manager with `status`, `headers`, and bounded `read`
(or `read1`). The HTTPS adapter rejects redirects/retries, bounds opening/socket
reads by the remaining deadline, and uses `read1` to avoid waiting to fill a large
buffer. Declared response lengths, accumulated byte counts and total deadlines
are checked. The built-in real transport is blocked when execution approval is
false. Arbitrary injected transport must honor the timeout; Python cannot
forcibly cancel arbitrary user-provided code. No live-source tests run here.

## Source adapters and completeness

The adapters pin established URLs, request only their existing manifest scope,
retain exact per-response SHA-256 hashes, and persist no raw response body.
They share a total timeout/byte budget, request-count cap and minimum inter-request
interval; the state wrapper also enforces the per-source inter-run cooldown.

- County trails: official licence item, licensed layer 8 and transient operational
  layers 54/16. Only manifest-reviewed IDs are requested. Schema/domain/license
  and geometry/attribute/status changes create review candidates, not approvals.
- County addresses: existing prototype layer 0 and its pinned reduced field list;
  no staff fields, typed searches or personal history. The proposed bounded
  100,000-feature/64 MiB/64-request cap covers the manifest's 85,220 source rows;
  provider rate tolerance and shipment approval remain unresolved.
- TIGER endpoint access roads: the existing McLean bounding box and MTFCC classes.
  IDs are captured first, sorted IDs fetched in bounded batches, and IDs plus
  schema/edit metadata rechecked after fetching. Partial/stalled/changed snapshots
  fail rather than produce a partial replacement. These are not through-route
  or closure-detour approvals.
- Reviewed OSM paths: exact manifest way IDs through the already established OSM
  full-way XML API. Missing referenced nodes, duplicate IDs/tags and unsupported
  XML entities fail closed. Changed access tags remain hash-only review changes.
- OSM service roads: the established fixed-bounds Overpass query, with a bounded
  15-second query timeout; incomplete `remark` responses fail. Complete removals
  and access-tag changes remain reviewable, not reopening or admission events.
- Official notices: the exact dated-evidence URLs. HTML parsing requires a titled,
  keyword-matching `main`/`article` and rejects obvious error/challenge layouts.
  Other source layouts fail stale; no live HTML compatibility claim is made.
  The pinned City GIS query hashes only its five established public object IDs;
  missing objects produce removed IDs and still require review.

ArcGIS ID/metadata snapshots are repeated before/after batches. This detects
selection changes and reported edit/schema changes; it does not claim the source
provides a transactional database snapshot. Publication/edit/base-snapshot times
come from explicit source semantics, never HTTP cache time. Source adapters do not
judge real-world access, compose datasets, update closures, or promote geometry.

## Candidate and result contract (schemaVersion 1)

Generic parser output:

```json
{"records":{"54:61":"<sha256>"},"sourcePublishedAtUtc":null}
```

Only stable public IDs and hashes persist. Parser/adapters must reject incomplete
queries and provide a complete in-scope record set. A complete empty set creates
removed IDs and requires review; parser failure flags stale evidence.

Use the existing extractors' canonical JSON/hash rules: sorted keys, compact JSON,
UTF-8, no NaN, preserved array order. Generic `contentSha256` hashes exact fetched
bytes; `parsedSha256` hashes the minimal record index. For multi-request adapters,
`contentSha256` hashes the canonical minimal aggregate envelope, and the additive
`identity.componentHashes` holds **exact raw response hashes** keyed by component.
`identity.sourceTimes` distinguishes source publication, modification and OSM
base-snapshot times. Retrieval and manifest review dates remain separate.

Result fields include `status` (`candidate`, `no-change`, `failed`, `rate-limited`),
`staleEvidence`, unchanged `acceptedSnapshotId`, and optional `observation` and
`candidate`. Failures have no replacement observation. Component failures also
report a safe component name/type, never source body or exception text.
A parser/schema/registry/manifest change suppresses conditional validators and
requires complete fetching; a 304 without an intact compatible baseline fails.
`ETag`/`Last-Modified` validators are stored separately from source dates.
Bump `parser_version` when changing adapter semantics; `schema_version` is also
explicitly overridable and included in identity.

Candidate JSON contains `candidateId` (SHA-256 of `identity`), `sourceId`,
`identity` (URL, registry/raw/parsed hashes, parser/schema versions and optional
component evidence), `retrievedAtUtc`, separate `sourcePublishedAtUtc` and manifest
`reviewedOn`, `manifestPath`, `parentCandidateId`, `records`, sorted `diff` arrays
(`added`, `removed`, `changed`), and `requiresReview: true`. The additive
`provenanceSha256` hashes the complete candidate excluding that field itself.
It verifies retrieval/diff provenance as well as content identity on disk.

Hash identity excludes retrieval time, so identical observations create no
new candidate. Byte changes with equal parsed records remain provenance changes.
Files publish atomically without replacing existing snapshots; the first
observation's timestamp/diff stay immutable. If content returns after intervening
changes, the result returns that **stored** candidate, plus additive `runDiff` and
`parentCandidateId` for the current transition. Admission must use the current
result's `runDiff` when assessing that transition. Minimal evidence cannot recreate
raw bodies; permitted independently retained source bundles are needed for full
parser replay. No raw evidence is committed or automatically retained here.

`observation` is the next conditional baseline, never an admission approval.
Adapters add its `components` field for verified per-request conditional reuse.
Admission owns approval/replacement of accepted snapshots; runtime consumes only
accepted inputs. No module writes accepted manifests, packaged datasets, closure
rules, native files or release configuration.


## Durable current transitions and bounded retention

The candidate contract and `candidateId = SHA256(identity)` remain schema version 1.
A→B→A must not rewrite A's first-observation `diff`, parent or retrieval timestamp.
`run_serialized` now persists an immutable **current transition** separately under
`transitions/<transitionId>.json`, then references it in `state.lastTransitionId`.
Successful results add `transition` and `transitionId`; their `runDiff` is this
transition's diff. Failures retain the last successful observation/transition and
record safe failure type/staleness in the current state; skips do not add journals.

The transition has `schemaVersion: 1`, `sourceId`, `candidateId`,
`parentCandidateId`, `candidateProvenanceSha256`, `parentProvenanceSha256`, current
`retrievedAtUtc`, `attemptedAtSeconds`, `diff`, `status`, `changeKind`, and
`observationOnly`. `transitionId` hashes the complete transition excluding itself.
`changeKind` is `initial`, `no-change`, `records`, `contract`, or `provenance-only`.
Both snapshot identities/provenance, filename IDs, current diff and classification
are revalidated when loading a transition. State also binds the transition to its
last successful attempt/retrieval fields. Admission should read this verified
current transition plus its bound snapshot/evidence bundle, never substitute
A's first diff for a later B→A event or scan orphan snapshots as complete runs.

Snapshots and transitions fsync their files and containing directories before
success; new directory names are also synced in their parents. No-change paths,
including 304 and cooldown checks in the state wrapper, verify referenced candidate
and transition files. Missing/corrupt evidence **refuses the run stale before
fetching**, rather than silently returning no-change or guessing old provenance.
The low-level `observe` also checks referenced candidates whenever given a directory.
Every candidate reread checks full `provenanceSha256`, not just identity/record
hashes. Aggregate component key sets must equal `componentHashes` exactly, and
all component observations must pass integrity/source association checks.

Older successful local stores without a state hash/current transition are not
silently migrated: they fail stale. Repair/reseed requires a separately reviewed
permitted evidence replay; accepted snapshots stay separate and are never reset.
A partial publication can leave an unreferenced valid snapshot/transition; it
cannot advance state. Retrying verifies those bytes and durably publishes its
current transition before completing state.

Overpass's moving `timestamp_osm_base` intentionally changes exact response hashes
and `sourceTimes` even when all record hashes remain identical. The transition
then records `changeKind: "provenance-only"` and `observationOnly: true` with an
empty record diff. Keep that exact provenance. Observation-only is not fresh
closure/admission evidence, does not reopen a route, and does not update accepted
review dates. The immutable candidate keeps `requiresReview: true`; this
classification does not grant approval or prove the source provided no other
meaningful change. Parser/schema/registry changes remain `contract` review changes.

The wrapper enforces reviewable **shared-store artifact** caps, also recorded at
registry `retentionLimits`: 256 snapshots, 1,024 successful-run transitions and
64 MiB of candidate/transition files (including orphan temporary bytes). Pass
`retention_limits` explicitly to configure them. A shared-store lock serializes
quota checks/publication across sources; the temporary/link budget is reserved
conservatively before writes. At capacity, stop stale without replacing accepted
or last-successful observations. No automatic deletion or loss of diff ancestry.
These caps bound source-timestamp churn; production cadence, archival/rollover
and retention policy remain an explicit review gate. Live state files are one
bounded-current-state file per configured source, not a raw-body/history archive.
The low-level writer alone does not enforce a shared-store quota; recurring
callers must use `run_serialized`.

## Offline verification

```sh
python -m unittest discover -s tools -p 'test_source*.py' -v
python -m unittest discover -s tools -p 'test_web_*.py' -v
python -m unittest discover -s tools/tests -v
```

Synthetic explicit clocks cover change/no-change/failure, 200/304 conditionals,
disappearing records, parser changes, total request/byte/time/rate bounds, immutable
repeated-content provenance, accepted-snapshot preservation, process races,
crashes, corrupt state and disk failures. The existing secret-free hosted
`web-trip-replay` workflow now runs the source tests before its Kotlin replay.
There is no production schedule activation or external source inquiry.
