# Runtime freshness and review contract (#107)

The runtime prepares a separate validated worker and atomically adopts it only after
all mandatory bytes, access index, dataset identity and complete compiled closure
catalog pass. Failures retain accepted data. During an active ride, an update is
staged; current guidance keeps its worker until Stop and an explicit checked Start.
Every saved/restored route is inspected using the accepted worker before Start.
An interrupted check or route selection cannot launch navigation late.

App accepts an explicit optional `refresh` dependency injection. The production
entry point supplies none: no endpoint, source policy, release approval or automatic
activation is invented. The integrated status uses accessible live status, alerts,
manual recovery and collapsed date details. PR103's three connection/private-test
cards remain removed. Private access and native feature freeze remain unchanged.

## Minimal admitted manifest

`webApp/src/runtime/manifest.ts` defines `trail-mapper.refresh/1`:

- Positive monotonic `sequence`, `releasedAtUtc`, complete existing public-approved
  `DatasetRecord` with no approval blockers.
- `sources`: unique registry `id`, upstream `publishedAtUtc` (null if unknown),
  `checkedAtUtc`, distinct `reviewedAtUtc`, approved positive `staleAfterMs`.
- `closures`: complete compiled catalog pins `{id, contentSha256}`, including
  scheduled and inactive rules. Hash UTF-8 canonical recursively key-sorted JSON
  of each exact raw descriptor from worker operation `closureCatalog`, schema
  `trail-mapper.compiled-closures/1`. Array order is preserved. Display-time
  `Network.closures` is insufficient and unsupported cores fail visibly.
- `reopenings`: retained distinct review events with `id`, `fromSequence`,
  `toSequence`, exact `fromContentSha256`, exact `toContentSha256` (null for
  removal), authoritative HTTPS `evidenceUrl`, named `reviewedBy`, `reviewedAtUtc`.

A changed or removed known closure requires an exact direct reviewed transition
from the retained prior sequence/hash to the candidate sequence/target. Review
must fall between those releases. Old events must remain byte-equivalent; an event
cannot authorize a later close/reopen cycle, a different geometry/message or a
skipped release transition. A producer serving skipped versions must supply the
exact reviewed bridge from the client's retained floor; absent evidence fails
closed. This conservative contract does not infer reopenings from estimated ends,
missing notices or successful retrieval. A dropped source, downgrade, foreign
dataset or conflicting same sequence also fails closed.

Detection PR109 (`1c56268`) provides observations/private candidates and never
runtime authority. Admission PR111 (`b2fc8d4`) provides reviewed candidate/decision,
compiled catalog and real-router bindings; its output remains release-blocked.
Runtime does not convert either into approved releases. App build, dataset release,
upstream publication, source check, human review and runtime check remain distinct.
A successful runtime check never refreshes source evidence age.

## Durable rejection history and tabs

An enabled App requires `readSafetyFloor` and `commitSafetyFloor`. Browser helpers
persist a single metadata envelope `trail-mapper.refresh-safety-floor/1`, containing
validated manifest identity, complete closure pins, sources and transition history.
It contains no routing bytes, routes or location. It can only reject responses;
reload/new-tab still needs fresh network metadata and separately validated bytes.
The floor advances after validation, including staged active-ride updates, before
adoption. Failed durable writes block Start and preserve accepted data; the tab
retains its newer in-memory rejection floor until a successful retry.

Web Locks serializes compare-and-write across tabs; storage is reread inside the
lock and verified afterward. Unavailable locks, corrupt/unreadable storage or quota
failure fails visibly. Clearing site storage erases this local protection; an
admitted endpoint still needs an authoritative monotonic release history before
activation. No new browser permissions are requested. A separate schema/sequence/
version hint is a wake-up signal only. Hint write failure is visible but does not
undo validated routing data and durable history.

Foreground launch/resume/pageshow, manual recovery, reconnect and tab hints check
with no-store and a bounded 15-second metadata fetch/body timeout. Hidden pages
invalidate eligibility. Repeated triggers share one attempt; invalidation during
an attempt visibly requires another check. There is no polling or background ride
tracking. Immutable parts retain hash/size/schema validation and the existing
worker timeout. Source check or review expiry blocks Start; a rearming UI timer
handles policies beyond the browser's 24.8-day timeout cap without network work.

## Validation and activation boundary

Run `npm run typecheck`, `npm test` and
`TRAIL_TEST_PORT=4185 npx playwright test -c playwright.runtime.config.ts` from
`webApp`. Complete-catalog real worker/App controls require PR111's compatible
rebuilt core. Tests use self-authored synthetic fixtures only; they do not claim
real county/current-condition or physical-device acceptance.

The dependency integration was tested in a disposable worktree at exact PR111
`b2fc8d4` with this branch's web source/tests overlaid and its core rebuilt. No
Kotlin changes or dependency merge are included in this branch. Chromium and
Playwright WebKit exercise actual App Start/restoration/active guidance, separate
workers, interrupted flows, partial/incompatible/unapproved responses, concurrent
tabs, reload rollback/closure retention, offline/cache/history write failures,
accessible recovery and long-horizon stale status. Local WebKit libraries were
extracted under `/tmp`; host ldconfig-only preflight was bypassed, but actual
WebKit runs execute rather than skip.

Activation still needs the compatible PR111 core, an admitted immutable release
and exact reviewer-ledger/transition binding, approved per-source policies and
endpoint, existing source/provider/package/release gates, #108 integration and
#41 physical acceptance. Final Opus review is owned by the integration owner.
No merge, deployment, notifications, production monitoring, new credentials,
paid service or permissions are enabled by this draft.

Latest validation: **636 web unit tests passed, zero failed/skipped**, including
22 focused runtime controls; **26 runtime browser controls passed, zero
failed/skipped**, 13 each in Chromium and WebKit with the dependency core above.
TypeScript, focused Prettier, app build/provenance and distribution audit pass.
The build remains private synthetic review output with public release blocked.
