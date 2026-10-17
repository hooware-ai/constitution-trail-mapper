# Existing-feature reliability pass — 2026-10-17

Local review only. No deployment, push, merge, account-permission change, public record change, or host location-setting change occurred.

## Environment and scope

- Host: `DESKTOP-1AFV9VA`.
- Isolated branch: `reliability/existing-gps-20261017`, based on `783f2f5f48eb1beaeee4963ed53b186d6e126adf` (merged PR 156).
- Worktree: `C:\Users\Jesse Donahoo\Documents\Codex\2026-10-17\task\constitution-reliability`.
- Original Constitution Trail Mapper and older Trail Mapper checkouts were preserved. An unused clean worktree accidentally created from the older registered repository was removed.
- Playwright 1.63.0 headless Chromium: Desktop Chrome and Pixel 7 profiles. Playwright WebKit: Desktop Safari, iPhone 15 and iPhone SE profiles. These are browser profiles/engines, not physical devices or an Android emulator.
- GPS, visibility, wake-lock and selective storage failures were scoped to disposable browser contexts. Routing used the real worker and source-built Kotlin core with synthetic fixture networks and synthetic packaged county data.
- The sandbox launcher failed while enumerating `D:`. Approved host PowerShell execution worked. JDK 21 was selected only in the build process environment; no system Java/location configuration was changed.

## Confirmed defects and changes

### Estimated connections categorically disabled Start

The default bridge required `!estimated || assumeEstimatedConnections`, so any estimated start, end or intermediate connector disabled navigation. The existing browser test reproduced this with a start approximately 365 ft off the fixture trail. Even a sub-foot endpoint connection was rejected.

The bridge now applies current-network, known-closure, proposed-trail and mapped-route requirements without categorically rejecting estimated connections. `isRouted=false`, raw connector geometry, map dashes, gap metadata and export context remain intact. Ordinary connectors introduce no warning card or confirmation hurdle. Obsolete disabled-Start copy was removed.

Instructions previously omitted unverified Access legs and their distance. They now retain their order/distance, avoid inferring turns through those legs, and use neutral continuation onto the next mapped leg. A synthetic route with driveway, intermediate and destination connections is driven end to end; progress remains monotonic.

Known closure checks were extended to estimated travel using the already modeled Willow, Uptown and Camelback geometry. Tests distinguish longitudinal closed-trail travel from mapped roads, perpendicular connections and unrelated nearby geometry. Estimated completion dates do not imply reopening.

### Nearby disconnected road fragments crowded out a usable snap

The four nearest snap candidates could all belong to one disconnected road component. A controlled regression found no route despite a connected mapped street 78 m away, within the existing 250 m limit.

Candidate selection now considers distinct existing graph components before spending remaining slots on repeated edges. The regression checks both trip directions. No crossing, graph join, snap-distance increase or path-eligibility relaxation was introduced.

This is a demonstrated algorithm defect. The exact three connections in Jesse's latest screenshot cannot be identified from the cropped text without the route coordinates/state; this pass does not claim to have reconstructed that exact route.

### Rejoining could silently lose earlier traversal history

A failed carried-history write was ignored before switching routes. Rejoin now checks it before adopting the replacement, preserves the existing ride on failure, and reports an actionable retry.

A second partial-failure case was also reproduced: carried history saved, but the active replacement failed to save. The existing v1 carry envelope now retains one fallback keyed to the actually persisted active route; restoration chooses that key. Tests verify selective carried/active quota failures, repeated replacement failures, bounded fallback retention, legacy data, malformed fallback rejection, and accumulated distance after reload.

### Supporting regressions

- Added stopped movement with small GPS jitter followed by resumed travel to trip replay.
- Updated reviewed-router admission controls to assert actual unverified geometry/gap correspondence rather than an obsolete Start prohibition. Negative controls reject copied, mismatched, absent or falsely verified geometry. Closure, identity, source approval and release gates remain enforced.
- Corrected Windows-only test assumptions: native path resolution and converting file URLs before invoking the refresh CLI.

## Validation

Core artifact: input hash prefix `7b7981b4e2f4`, output prefix `daaed477a694`; 13 emitted files. `verify-core` confirms the artifact matches the final Kotlin sources.

| Check                                                                    | Result                                                           | Local evidence                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Focused JVM instructions, timed/estimated closures and bridge            | 114 passed (48 shared, 66 bridge)                                | `final-core-regression.log`                                         |
| Access snapping, endpoint selection and access-path controls             | 12 passed; original crowded-component case failed before the fix | `access-snap-before.log`, `access-snap-after.log`                   |
| Full web unit suite                                                      | 733 passed, 5 skipped, 0 failed                                  | `webApp/output/reliability/unit-final-retry.log`                    |
| Connector, location, saved history and delayed-startup browser selection | 52 passed, 4 private-mode cases skipped in the default build     | `webApp/output/reliability/connectors-stable.log`                   |
| Synthetic trip replay, Chromium desktop + Pixel 7                        | 10 passed                                                        | `webApp/output/reliability/replay-final.log`                        |
| Packaged synthetic county saved-route/closure checks, desktop + Pixel 7  | 10 passed                                                        | `webApp/output/reliability/closures-final.log`                      |
| WebKit interruption matrix                                               | 36 passed; 12 key recovery cases also rerun on final core        | `webApp/output/reliability/interruptions.log`, `recovery-final.log` |
| Selective carried/active storage-failure browser cases                   | 4 passed across desktop + Pixel 7                                | `webApp/output/playwright/carried-history-active-final.log`         |
| Build, TypeScript, provenance and distribution audit                     | Passed; fixture artifact remains ineligible for public release   | `webApp/output/reliability/build-final.log`                         |
| Changed-file Prettier and whitespace checks                              | Passed                                                           | `webApp/output/reliability/format-touched.log`                      |

The first final unit run encountered a transient Windows `EACCES` on OS-selected port 11323 in a socket-allocation test. Its log was retained; the complete rerun passed without changing the production port/security behavior. Earlier failing browser runs and traces were also retained, including a synthetic-clock initialization correction and the final carry fixture's off-route coordinate correction.

Whole-tree `format:check` flags 328 files because unchanged files are checked out with CRLF. An unchanged `MapView.tsx` was verified identical to HEAD after line-ending normalization: HEAD/normalized formatting pass, raw CRLF formatting fails. Changed files pass; no repository-wide formatting churn was made. See `webApp/output/reliability/format-baseline.log`.

Logs, screenshots, traces, dependencies and generated build output remain local and ignored by Git. The three-connector Start-enabled screenshots are under `webApp/output/reliability/connectors-stable/`.

## Remaining limits and prior recovery work

- This pass proves browser behavior under simulated location/events, not outdoor GPS accuracy, Android/iOS permission UI, lock-screen behavior or physical-device reliability.
- Native PR 155's startup bars/map casing visual acceptance remains unverified; it was not changed or merged.
- [PR 69](https://github.com/hooware-ai/constitution-trail-mapper/pull/69) was inspected before recovery work. It is open/conflicted and owns Android planner process-death drafts. Its existing [owner-removal race review](https://github.com/hooware-ai/constitution-trail-mapper/pull/69#discussion_r4139522377) remains outside this pass. No duplicate planner-draft implementation was added.
- Source review independently identified and then re-reviewed the closure and second-rejoin issues; both were resolved. Runtime evidence is the validation above.
- No remaining access/permission dependency prevents reviewing this local change set. Publication and merge still require further user approval.
