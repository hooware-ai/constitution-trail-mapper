# Dated closure and advisory readiness (October 2026)

Recorded October 2–3, 2026 for `TM-RELEASE-NEXT-ADVISORIES-20261002-01`. This changes **what the shared catalog says and when it applies**; it does not approve a dataset, a release or a rights position. All times are America/Chicago (CDT, UTC−5) and are exact instants; an **estimated** end is information, never a confirmed reopening, and nothing in the app reopens a closure because a date passed.

Three things are kept apart everywhere:

1. **The official notice**: what the Town or City said, with its link, its schedule and when it was checked.
2. **An approximate display corridor**: a line drawn so a rider can see roughly where (labeled approximate).
3. **A verified route exclusion**: a section the router cuts out and the Start gate refuses. Only a mapping that is supported by the notice and the actual source line earns this.

## Sources re-fetched

Retrieved October 3, 2026 (UTC) with plain HTTP requests, no accounts or keys. Hashes are of the bodies as received, for later comparison, not a claim they will be reproducible byte for byte.

| Source | Result | SHA-256 (first 16) |
| --- | --- | --- |
| [City GIS road closures](https://services3.arcgis.com/ZntpsilxOye7y1YF/arcgis/rest/services/RoadClosures_public_7e10ca6b3d3a4e6fa88caf9918ade300/FeatureServer/1/query?objectIds=841%2C916%2C919%2C922%2C923&outFields=*&outSR=4326&f=json) objects 841, 916, 919, 922, 923 | HTTP 200 | `e4cd309c906e4958` |
| [Normal 3356](https://www.normalil.gov/m/newsflash/home/detail/3356) (posted Oct 2) | HTTP 200 | `811a62757f19b4a8` |
| [Normal 3353](https://www.normalil.gov/m/newsflash/Home/Detail/3353) (posted Sep 30) | HTTP 200 | `1b97a1998517d724` |
| [Normal 3357](https://www.normalil.gov/m/newsflash/Home/Detail/3357) (posted Oct 2) | HTTP 200 | `a7130f473800bafd` |
| Normal 3345 and 3337 | **HTTP 429 (rate limited), not re-fetched**; their existing catalog text is retained unchanged except where 3357 supersedes an estimate | n/a |
| Bloomington notice 10909 | not re-fetched in this task; the official GIS object 841 is the current source for the Hamilton estimate | n/a |

The GIS values used (UTC): object 919 (Constitution Trail) 2026-10-05T11:00:00Z to 2026-10-19T22:00:00Z, edited 2026-10-02T15:18Z; object 916 (Virginia Avenue, a **road** line) 2026-10-05T13:00:00Z to 2026-10-06T22:00:00Z; object 841 (Hamilton Road / Rhodes Lane) 2026-08-17T12:00:00Z to 2026-10-31T23:00:00Z, last edited 2026-09-25T20:14Z (the older Bloomington notice said September 30); objects 922/923 (Raab Road lanes) 2026-10-03T11:00Z–21:00Z and 2026-10-05T11:00Z–2026-10-06T21:00Z.

## What the catalog now does

| Notice | Instants (CDT) | Kind | Behavior |
| --- | --- | --- | --- |
| Normal 3356, **Willow Street trail crossing**, Illinois Central Branch, Locust Street to Cypress Avenue | starts Mon Oct 5 06:00 (11:00Z); estimated Mon Oct 19 17:00 (22:00Z) | **Mapped exclusion** (blocking) | Before the start: a route that rides the section carries a notice that says **"Scheduled, not closed yet"**; nothing blocks. From the start: new plans and loops cut the section out, a saved route through it cannot start, a ride cannot be started on it, recalculation either avoids it or says no route avoids it. After the estimate: unchanged, with the message that the estimate has passed and reopening has not been confirmed. |
| Normal 3353, **Virginia Avenue (Camelback Bridge) trail crossing** | starts Mon Oct 5 08:00 (13:00Z); estimated Tue Oct 6 17:00 (22:00Z) | **Advisory only** | Scheduled notice before, a closed-per-the-Town notice after, a passed-estimate notice after the estimate; **never blocks and never reroutes**, and says the notice gives no trail limits. |
| Normal 3357, **Constitution Trail paving**, Raab Road lanes | paving begins Sat Oct 3 06:00 (11:00Z) | **Guide notice only** | Scheduled, then "Paving under way"; says the notice does not give which trail sections close or when the work ends; no trail barrier is drawn. |
| Normal 3345, Collegiate Branch repaving | estimate October 2 has passed | Guide notice | Text says the estimate passed and completion was not confirmed, and points to 3357. Status becomes "Recheck needed". |
| Normal 3337, Uptown detour | unchanged (since Sep 21) | Mapped exclusion (existing) | Unchanged; no all-clear is invented, and the initial closure north of Vernon is still described as such. |
| Hamilton Road / Rhodes Lane | official map estimate Oct 31 18:00 (23:00Z) | **Informational, nonblocking** (unchanged) | Now cites object 841 (edited Sep 25) and the Oct 31 estimate next to the older Sep 30 date; the broad road corridor is not promoted into a trail closure; "Recheck needed" after the estimate. |

## Mapping evidence (Willow)

Both the Willow and Camelback notices lie on county trail feature `54:1305`. The check used the unchanged native asset (SHA-256 `310f1d50326a207e…`, the same 254 retained paths as the licensed extract; input-file identity, not a packaged-network identity).

- Feature `54:1305`, path 0 has 99 vertices. **Leg 97→98** runs from vertex 97 (lat 40.5096012799, lon −88.9843690241) to vertex 98 (lat 40.5166840740, lon −88.9849653323), about **790.1 m**.
- The official line of object 919 ends at lon,lat (−88.9848592462, 40.5149221609) north and (−88.9846634737, 40.5131086608) south. Projected onto that leg they are the closure's two bounds: **north** (lat 40.5149242085, lon −88.9848171673), 3.6 m from the official endpoint, and **south** (lat 40.5131086201, lon −88.9846643109), 0.1 m. They are **202.5 m** apart, strictly **inside** the leg (about 388 m of it remains south of the section and about 200 m north).
- The bounds are neither source vertices nor surveyed barricades. A cutter that only matched existing vertices could not represent them, and removing the whole leg would suppress about 587.5 m the notice does not cover. The router therefore cuts at run time at the two stored positions (`TrailRouteClosureSijko.cutAtProjectedBounds`), from the **unchanged** source path: nothing is inserted into or edited in the licensed/native geometry.
- Unaffected controls, all tested: the Cypress crossing `16:188` (a shared lane meeting the trail at the south bound), the northern junction `54:2578` / `54:4349` at vertex 98, `16:1348` (Hidden Creek) farther north, the east/west feature `16:297` and its neighbor `16:1297`. "Access to private walks north of Locust Street will be maintained" is the Town's statement; private walks are not identifiable in these assets.
- Uncertainty that remains: the notice names the boundary "Cypress Avenue" and the detour "Cypress Street"; the app repeats both rather than choosing. Which physical barricades the Town sets is not published.

### Camelback: the unresolved extent (a publication gate)

Object 916 is a **road** line (Virginia Avenue between South Linden and Hillcrest Streets), and notice 3353 gives no trail detour and no north/south limits for the trail closure. The county trail crosses near lon,lat (−88.9834162490, 40.4982689784), on leg 6→7 of path 0 of `54:1305`, but bracketing vertices 6 and 8 identify only the vicinity. No interval was invented, the whole of `16:297` (which extends well beyond the road interval) was not removed, and the neighbor `16:1297` has no closure basis. **Until the Town publishes the trail closure limits (or the owner accepts an advisory-only treatment for launch), routes through this crossing get a visible advisory and are not blocked.** This is recorded as an open publication gate, not as an all-clear.

### Raab paving: no subsegments

3357 announces temporary trail and lane closures but no trail subsegments or overall end. Only the guide notice is published; no barrier is drawn and no estimate is assumed.

## Evidence in the tests

| Evidence | File |
| --- | --- |
| Real core, distinct instants, both active together, after each estimate, Start/new plan/recalculate gates, residual portions, neighbor and crossing controls, on the actual raw leg (two unchanged source vertices) | `webApp/tests/unit/bridge-timed-closures.test.ts` |
| The same on the actual 99-vertex path from the native asset (skips only when that private ignored file is absent) | same file; `sharedLogic/src/jvmTest/.../TimedClosureRealDataTest.kt` (fails rather than skips when the asset is absent) |
| Shared logic JVM and JS, instants to the millisecond | `sharedLogic/src/commonTest/.../TrailRouteTimedClosureSijkoTest.kt` |
| Bridge (JVM and JS): saved-route Start refusal, new plan, recalculation, drawn section, guide status switching | `webBridge/src/commonTest/.../WebRoutingBridgeTest.kt` |
| Browser: how the page draws and words the core's report at the instant and one second earlier; official link opens in a new tab with `noopener`; source and check date shown | `webApp/tests/county/access-tiles.spec.ts`, `webApp/tests/e2e/help.spec.ts` |
| A rendering fixture is **not** evidence of gating; the gate evidence is the real-core row above | n/a |

The browser tests hand the page the closures the real core reports for a chosen instant (a page cannot move its worker's clock); the instants, Start, plans and recalculation are proved against the core.

## Native impact

The shared catalog is common code: `TrailRouteClosureSijko`, `TrailRouteAdvisorySijko` and `LocalTrailGuide` change for native too. After October 5 06:00 CDT native new routes also avoid the Willow section and saved routes through it show the closure advisory. Two native tests encoded the old Hamilton estimate and were updated to the official map's estimate (`LocalTrailGuideTest`, `SavedTrailRouteShareTextSijkoTest`), and one new native test covers the guide's dated notices. No native UI was changed. The Gradle runs and counts are in the pull request.

## Help and Data copy corrected (no network change)

- Help no longer says the county data has no street or shared-roadway information or that the app has no road network: it counts existing features only (proposed ones are said apart), says how many are shared roadways, and when the loaded record has road access it describes it and says routing also uses it.
- The absolute "position is not sent anywhere" is replaced: exact GPS fixes, typed text and saved records are never uploaded, **but** in a build with road data the app fetches hash-named `access-tile.<lat>_<lon>.<hash>.json` files for the map squares (about 1 km, three by three) around a trip's start and destination, your position while you ride or reroute, and a saved route's first and last points. Those same-origin URLs let this site's host see roughly which areas were requested. Optional OpenStreetMap map tiles still reveal the viewed area to that host. This is a description of implemented behavior, not a privacy policy or legal certification.
- The Data section's service-road sentence now names every position that triggers tile requests, and its count says "existing trail features, plus N proposed segments" instead of printing the combined total as existing.
- Tests: fixture, no-access county and access county Help, with stubbed OpenStreetMap requests and the real request URLs asserted.

## Open items (nothing here approves publication)

1. **Willow bounds are an approximate projection** of the official line, not barricade observations; the section is labeled approximate everywhere it is shown. Exact barricade limits from the Town would replace them.
2. **Camelback** extent unresolved (above): advisory only.
3. **Raab** trail subsegments and end unpublished.
4. The map's closure overlay is read when the app opens; a tab left open across 06:00 on October 5 keeps its old overlay until reload, while every plan, saved-route check and Start uses the current instant.
5. The real-asset tests need the private ignored native asset; hosted CI runs the actual-leg tests without it.
6. Normal 3345/3337 and Bloomington 10909 were not re-fetched (429 or out of scope); their text is as previously reviewed.
7. `webApp/release/dataset.county.json` still lists "Hosting, basemap and sign-in decisions are open" among its blockers. Sign-in is deferred by decision (the first launch is guest-first); that wording is a release-record blocker and was **not** edited here.
8. Every data, rights, device, hosting and publication gate stays open; county-only records remain review candidates, not accepted public coverage; phone and outdoor checks are NOT RUN.
