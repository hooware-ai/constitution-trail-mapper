# Runtime freshness foundation (#107)

This draft supplies independent runtime modules, a replacement-worker adapter,
a browser lifecycle adapter, and an accessible React status component. It does
not activate a runtime release endpoint or modify App.tsx, shared styles, or the
three PR103 connection/private-test cards. App/UI wiring remains with integration
owner 01a11e5e-a6aa-73d3-9948-6e8c4a71303a. Native features and private access stay
unchanged. No notifications, monitoring service, credentials, or scheduling.

## Admission boundary and minimal manifest

Runtime consumes accepted release metadata only, never #105 candidates. PR109
commit 62832b321a81e926e76fd1419c2b2b4f91aa3a07 defines the source observation and
candidate boundary. Admission (#106) maps `sourceId` to runtime `sources[].id`,
`sourcePublishedAtUtc` to nullable `publishedAtUtc`, and a successful observation's
`retrievedAtUtc` to `checkedAtUtc`. `reviewedAtUtc` must be the actual admission
human review, not a fabricated timestamp from the source check. The approved
source registry must provide each source's positive `staleAfterMs`; runtime has
no invented universal source cadence or threshold. PR111 head c948682daf192feac7ed9e570793f4363e4876ca
produces immutable **blocked private review artifacts**, not runtime manifests.
Its accepted reviewer decisions/closure ledger may inform the fields above ONLY
after complete compiled-core catalog binding and existing release gates pass.
Neither its artifact version/hash nor `selectRollback` authorizes sequence
downgrade, source freshness claims, or candidate activation. This draft preserves
that distinction; no artifact converter silently grants release approval.

`src/runtime/manifest.ts` is the TypeScript contract:

```ts
{
  schema: "trail-mapper.refresh/1",
  sequence: 1, // positive monotonic safe integer, assigned by admission
  releasedAtUtc: "2026-10-09T11:00:00Z",
  dataset: /* existing complete DatasetRecord, approved, no blockers */,
  sources: [{
    id: "source-registry-id",
    publishedAtUtc: null, // unknown remains unknown
    checkedAtUtc: "2026-10-09T10:00:00Z",
    reviewedAtUtc: "2026-10-09T10:30:00Z",
    staleAfterMs: /* approved per-source evidence-age policy */
  }],
  closures: [{ id: "known-closure-id", contentSha256: "<64 lowercase hex>" }],
  reopenings: [{
    id: "previously-closed-id", evidenceUrl: "https://authoritative.example/notice",
    reviewedBy: "named reviewer", reviewedAtUtc: "2026-10-09T10:30:00Z"
  }]
}
```

Closures are the COMPLETE router catalog, not only today's fetched notices.
Empty catalog is allowed only if no previously accepted closure is lost or every
changed/removed closure has explicit reopening review at or after the preceding
release. Estimated ends, missing notices, parser errors and network errors supply
no such evidence. A geometry/message change can weaken an exclusion and receives
the same strict guard as removal. A source disappearing also fails visibly.

Closure pins hash UTF-8 `canonical(closure)` from the exact initialized worker's
`Network.closures` output: recursively sorted object keys, preserved array order,
JSON number/string encoding from the JS output, no whitespace. These are NOT
raw source record hashes or extracted geometry hashes: Python evidence retains
numeric source-token rules, while runtime pins the browser router output. #106's
release producer must verify this complete catalog against the compatible core.
If a new release requires a different app/core, preparation fails and asks for
reload; no core is downloaded dynamically. Dataset content/access schemas and
hash/size contracts stay unchanged.

Same sequence must describe exactly the same manifest. An older sequence or
conflicting same sequence is a failed check. Rollback is another reviewed release
with a higher sequence and current closure/reopening evidence, not an unchecked
sequence downgrade. HTTPS/private hosting is the existing metadata trust boundary;
timestamps or a storage event never grant admission or public release authority.

## Actual triggers and cache semantics

`bindRefreshLifecycle` checks on foreground launch, resume/visibility/pageshow,
manual recovery, reconnect, and localStorage tab hints while visible. Hidden
pages invalidate Start eligibility and check on next foreground resume. There is
no network polling interval, background navigation, background worker update,
automatic retry loop, or scheduling. Before **every** Start, `runtime.start`
requires a new successful manifest check and saved-route inspection. Rapid
triggers share one attempt. A tab invalidation during a check or route inspection
blocks Start until a later successful check. Source stale thresholds use the age
of BOTH successful source check and human review; reaching either threshold is
stale. Runtime successful checks never reset source evidence age.

Mutable manifest fetch uses `cache: no-store`, same-origin credentials, and a
15-second fetch/body timeout. Existing worker requests for immutable hash-named
parts use `no-cache`, verify exact length/hash/schema, and retain their pinned
record on cancellation/recovery. Refresh boot additionally validates the
mandatory access index. Lazy endpoint tiles remain hash-pinned; inspection must
load and validate the route's needed tiles before Start. Browser HTTP caching of
a hash-named verified part is acceptable. Missing/corrupt/incompatible/partial/
unapproved parts never fall back to fixtures.

The only localStorage entry is `trail-mapper.refresh-hint/1`: a schema/sequence/
version hint. Writes are atomic, contain no routes/GPS/history, and convey no
trusted dataset bytes. A saved storage hint or forged tab signal requires a fresh
network check; it cannot authorize navigation. Storage quota/private-mode errors
are visible and retain accepted data in memory. Another tab always checks before
Start even when tab signaling failed. Reload/reopen cannot manufacture accepted
data offline: it shows recovery and blocks Start until a full validated load.
Already accepted data in an open tab is retained on offline/fetch failure.

## Atomic adoption and active rides

`prepareRefreshRouting` boots a **separate RoutingClient/worker** pinned to the
reviewed record. It validates echoed dataset identity, mandatory data/index, and
actual closure hashes before returning a prepared object. A failure disposes only
that candidate worker. The accepted worker and record stay intact. Controller
adoption exchanges one prepared object; no partially initialized worker/network
is exposed. Generation checks reject obsolete route inspections. Interrupted or
disposed operations cannot resurrect data or start a ride.

During an active ride, a successful changed release is staged. The accepted
router, route and known closure catalog remain pinned. Status announces the
pending change and asks the rider to stop safely and review before restarting.
Ending a ride does not silently adopt the staged data: another successful check
is required. A failed later check keeps both accepted ride data and pending
metadata. Accepted sequence advancement requires route inspection. If the core
returns stale/unverifiable network identity, closures/access warnings or any
`canNavigate: false`, Start is blocked and recalculation/review is required.
Saved route records are never overwritten by this controller. Existing proposed,
closure, fresh-location, foreground and physical-acceptance gates still apply.

## Integration owner bindings

1. Create one `RuntimeFreshness<RuntimeRoutingData>` for the selected county
   source, with `readManifest: signal => fetchRefreshManifest(sameOriginUrl, signal)`,
   `prepare: prepareRefreshRouting`, and `saveManifest: m => saveRefreshHint(storage,m)`.
   Only activate after #106 supplies the admitted endpoint and source policies.
   Do not mix fixture/local private review boot into runtime admission.
2. Subscribe to controller changes. Adopt `runtime.accepted.value.client` and
   `.network` together synchronously when their prepared object changes, updating
   client/controller refs as one operation. React map state describes this same
   prepared object. Bind navigation callbacks to that client; never retain the
   previous client's evaluate closure after adoption.
3. Call `setActiveRide(true)` for restored as well as new active rides BEFORE any
   launch/resume refresh. Call `setActiveRide(false)` only when that ride actually
   ends. Prefer `runtime.start(savedRoute, inspect, begin)` to perform the atomic
   Start gate. The helper calls accepted client `op: inspect`, checks existing
   `routeOkay`/`routeNeedsRecalculation`, sets the preview, and returns the core's
   `canNavigate`. `begin` synchronously starts the existing foreground controller,
   preserving fresh location/visibility/closure gates. Do not start before this
   method completes its check. Route inspection must not write saved routes.
4. Place `RuntimeFreshnessStatus` beside existing Data/credits and closure/uncertainty
   notices, passing actual build provenance separately. It supplies polite live
   state, alerts, explicit publication/check/review labels, and a keyboard-accessible
   recovery button. Its UI clock renders at source-threshold expiry without any
   additional network cadence. Start independently enforces the threshold even
   if no render has occurred. This component does not remove attribution.
5. Bind the lifecycle adapter once and unbind/dispose on source change/unmount.
   Old client recovery stays pinned; fixture mode continues its existing isolated
   behavior. Keep private access policy and feature-freeze decisions intact.

These bindings are intentionally reserved for the integration owner to avoid
App/UI overlap with PR103. Full-app activation, actual published closure updates,
complete refresh-chain #108 and real-device #41 acceptance remain integration
work; synthetic tests do not claim real county/current-condition coverage.

## Minimal failures and monitoring gates

Runtime state contains only accepted/pending sequence, successful/failed runtime
check times, source stale IDs, consecutive failure count and actionable errors.
It stores/sends no rider information and enables no notification destination.
Source/job observations stay with #105; runtime does not manufacture successful
source checks or release completions. Suggested review thresholds: three consecutive
failed source/runtime checks; two stale expected source runs; any parser/schema
change; any failed admitted release/integrity check. These are proposed operational
thresholds, not notification activation. Source cadence/stale thresholds must be
approved per registry; review owner and alert destination remain **unresolved**.
No notifications can be enabled until owner, thresholds, destination, cadence,
quota/cost and source permissions are explicitly reviewed. Manual visible recovery
is active in the supplied component; no paid monitoring or unsolicited messages.

## Reproducible validation

```sh
cd webApp
npm ci --cache /tmp/issue107-npm-cache
npm run typecheck
npx tsx --test tests/unit/runtime-freshness.test.ts tests/unit/runtime-routing.test.ts
TRAIL_TEST_PORT=4185 npx playwright test -c playwright.runtime.config.ts
```

The standalone browser harness is self-authored synthetic data and is NOT a
production entry point or fallback. Chromium and Playwright WebKit cover controlled
clock/network failure, missing/incompatible/unapproved versions, repeated checks,
interruption/disposal, real same-context tab storage signals, stale rollback,
closure retention, active rides, offline reconnect, quota failure, reopened tabs,
and accessible recovery. They exercise generic prepared-data adoption with real
network-file verification. `real-worker.spec.ts` additionally runs actual isolated
Kotlin routing workers in both engines: it plans/inspects a real synthetic route,
proves failed candidate bytes/catalog cannot mutate the active router, stages a
validated replacement, and reinspects the saved route after explicit adoption.
That control skips explicitly if the compiled core is absent. The exact production
release chain/full-app wiring still belongs to integration; these tests do not
claim a published current-condition release or physical acceptance.

### Validation on this branch

- TypeScript typecheck and focused Prettier check pass.
- Full web unit suite with rebuilt core: **629 passed, zero failed/skipped**,
  including all 18 new runtime unit controls and existing closure/access/route gates.
- Runtime browser suite: **14 passed, zero skipped**, seven each in Chromium and
  Playwright WebKit, including the actual-worker transaction control. Axe check
  finds zero violations in the accessible recovery component.
- Exact Kotlin/JS core build succeeds; default `npm run build` succeeds, including
  provenance writing and distribution audit. Build output remains private fixture
  review output, with public release blocked. Generated outputs are not committed.
- In this sandbox, dependencies use writable `/tmp` caches. Gradle distribution
  was fetched through the existing proxy, Gradle ran with writable
  `GRADLE_USER_HOME`/`ANDROID_USER_HOME` and `--no-configuration-cache`, through
  the existing `buildCore` manifest guard. No source/build configuration was edited.
- WebKit system libraries were locally extracted into `/tmp` and linked into its
  temporary bundled library directory. `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`
  bypasses the ldconfig-only preflight that cannot see locally extracted GLES; the
  actual WebKit engine runs all seven tests. Normal hosts with installed Playwright
  dependencies need no such workaround. This is not a skipped browser test.

Remaining activation blockers: admitted manifest endpoint and per-source approved
freshness policies, complete production compiled-closure catalog/reviewer-ledger
binding (#106), integration-owner App/UI/navigation-controller wiring, and the
existing source/provider/release/physical-acceptance gates. Review/alert owner and
notification destination remain unresolved; no notifications are enabled.
