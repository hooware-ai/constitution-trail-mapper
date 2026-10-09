# Source candidate foundation (#105)

This offline-first foundation references existing manifests in
`data/web-source-registry.json`. Every production entry has
`executionApproved: false`; #47/#48 and specific reviews #1/#2 remain gates.
Cadence and review owner are explicitly unresolved, and fetch limits are proposed
conservative local caps, not provider permission. Overpass entries need a reviewed
query adapter. Metadata endpoints are not complete geometry/status feeds.
No schedule, credentials, paid service, release or routing behavior changes here.

## Minimal interface for admission and runtime developers

Import `tools/source_candidates.py` (standard library only). Call `observe` with
an injected transport and parser, explicit parser/schema versions, UTC retrieval
time and numeric clock, last-attempt clock, last successful `observation`, and
optional read-only `accepted` snapshot. The caller owns persisted last-attempt
state, including failures; serialize runs per source so rate checks cannot race.
The caller must enforce execution approval before injecting `https_transport`.
There is no production CLI or scheduler. Synthetic transport needs no approval.

Transport returns a context manager with `status`, `headers`, and bounded `read`.
No redirects or retries are allowed by the HTTPS adapter; opening and reads share
a total deadline, with the socket timeout limiting blocking reads. A transport
must honor its timeout; Python cannot forcibly cancel arbitrary injected code.

Parser must reject incomplete/partial queries and return:

```json
{"records":{"54:61":"<sha256>"},"sourcePublishedAtUtc":null}
```

Only stable public IDs and hashes persist. Parser/adapters must avoid user data
and supply a complete record set; an empty complete set creates removed IDs and
requires review, never automatic reopening. Parser errors flag stale evidence.
Use the existing extractors' canonical JSON/hash rules (sorted keys, compact JSON,
UTF-8, no NaN, preserve array ordering). `contentSha256` hashes exact fetched bytes;
`parsedSha256` hashes the minimal record index.

Result contains `status` (`candidate`, `no-change`, `failed`, `rate-limited`),
`staleEvidence`, immutable `acceptedSnapshotId`, and optional `observation` and
`candidate`. Failed and rate-limited runs contain no replacement observation.
Preserve last successful observation and accepted snapshot on failure.
Use `observation` as the next conditional baseline, never as an admission approval.
A parser/schema/registry change suppresses conditional headers and requires a
complete new fetch. A 304 without compatible verified baseline fails closed.

Candidate JSON (schemaVersion 1) contains `candidateId` (SHA-256 of `identity`),
`sourceId`, `identity` (URL, registry/raw/parsed hashes, parser/schema versions),
`retrievedAtUtc`, separate `sourcePublishedAtUtc` and manifest `reviewedOn`,
`manifestPath`, `parentCandidateId`, `records`, sorted `diff` arrays (`added`,
`removed`, `changed`), and `requiresReview: true`. Hash identity excludes retrieval
time, so repeated identical observations create no duplicate. Byte changes with
identical parsed records remain reviewable provenance changes. Candidate filenames
are hash-based, and writes publish complete files without replacing existing ones;
the first retrieval timestamp remains immutable. Minimal evidence cannot reconstruct
raw bodies; independently retained permitted source bundles are needed for full
parser replay. Publication time must come from source semantics, not HTTP caching
time, retrieval time or manifest review time.

Admission owns approval and replacement of accepted snapshots. Runtime consumes
only accepted inputs. This module never writes manifests, packaged datasets,
closure rules, native files or release configuration. Candidate disappearance
cannot remove a runtime closure.

## Offline verification

```sh
python -m unittest discover -s tools -p test_source_candidates.py -v
python -m unittest discover -s tools -p 'test_web_*.py' -v
```

Synthetic scheduled clock runs prove change, no-change (200/304), failure,
disappearance, parser changes, immutable writes, byte/deadline/rate bounds and
accepted-snapshot preservation. No network call is needed.
