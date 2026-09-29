# Web implementation acceptance record

Verified September 28, 2026 on Windows 11 in the isolated `codex/web-app` worktree. The historical Trail Mapper checkout was not used for development. This is a local review build; no public deployment or merge is authorized by these checks.

## Delivered

- Separate React/Leaflet web entry point backed by the existing Kotlin routing/domain logic through an ES-module worker bridge.
- Plan, Saved, Explore and Updates; resolved endpoint selection, map selection, current location, swap, public-place proximity ranking, point rides and exercise loops.
- Full-route preview, directions, category styling, closure/advisory checks, proposed opt-in, saved places/routes, 20-item/30-day recents, rename/delete/undo, and private sharing/file export.
- Foreground guidance with Kotlin route matching and deviation confirmation; reroute, rejoin and return-to-start; fresh-fix recovery after visibility changes, reload and location loss; optional wake lock.
- Worker cancellation terminates computation and rejects abandoned requests. Missing local data fails visibly; production cannot silently substitute fixtures for a requested local dataset.

## Passing verification

| Check | Result |
|---|---|
| `sharedLogic:jvmTest` | 349 passed, including 16 real-data tests |
| `sharedLogic:jsNodeTest` | 333 passed |
| `webBridge:jvmTest` | 16 passed |
| `webBridge:jsNodeTest` | 16 passed |
| `shared:testAndroidHostTest` | 172 passed |
| Android Kotlin compile and debug assembly | Passed |
| Android lint | 0 errors, 36 warnings, 4 hints |
| Web TypeScript and production build | Passed |
| Web platform/search/worker unit tests | 37 passed |
| Playwright desktop Chromium + Pixel 7 emulation | 24 passed |
| Licensed extractor safeguards | 10 passed |
| Formatter check and distribution content audit | Passed |

The Kotlin totals are test executions across runtimes, not unique test cases. All 110 original common test/helper files were accounted for unchanged apart from newlines: 63 moved with routing logic and 47 stayed with native shared code. All three original real-data Android-host files moved unchanged to JVM tests. Native UI entry points remain intact.

Browser coverage includes issue #29 ordering from east/west starts, unresolved text, current location, endpoint swap, zero-length-route errors, route preview/directions, saved and recent disjointness, reload recovery, local-data failure, exercise validation, proposed defaults, map-point selection, stale/inaccurate fixes, visibility loss, reload, network loss, sustained native off-route confirmation, loop rejoin and return. GPS and visibility are simulated; the worker and Kotlin router are real.

Axe WCAG 2 A/AA and 2.1 AA reported no violations on the planner and route preview in either browser profile. Keyboard dismissal and large-text overflow checks passed. Manual screenshot review caught and fixed a map-picker CSS collision; a geometry regression checks that both the map and app retain usable dimensions.

Bridge regressions also prevent drawing estimated access gaps, joining geometry across omitted gaps, bypassing closure gates, navigating proposed/estimated access, and moving an arbitrary distant map selection onto a trail. GeoJSON preserves disconnected segments without inventing chords.

## Actual local data review

The local development server loaded county trails, the reviewed supplement and access roads from ignored assets. Public place coordinates were checked against official sources; see [place-catalog.md](place-catalog.md).

The corrected Tipton Park North entrance to Culver's Hershey Road calculation produced approximately 3.17 miles (1.54 trail/connector, 1.00 shared roadway and 0.63 access). The UI ranks Hershey first from Tipton, renders the mapped geometry, and blocks navigation because some endpoint access crosses unmapped ground. This is an access-data limitation and must not be hidden by snapping a place marker to a nearby trail.

A second manual browser route used an explicit mapped start on Route 66 & Illinois Central. Its 3-mile exercise request returned a 2.95-mile loop with 0.36 miles retraced, no street access, and navigation enabled after the catalog check. This verifies the actual local graph as well as the synthetic end-to-end flows.

The separate licensed extractor verified all 254 approved existing county features against a source explicitly licensed CC BY 4.0. Geometry is not committed or included in the default static build. Six proposed features and the combined OSM-derived graph retain the release gates in [data-rights.md](data-rights.md).

## Remaining acceptance boundaries

- No physical Android device was connected; no iPhone, Safari device or macOS/Xcode was available. Native iOS compilation and physical Android Chrome/iPhone Safari lock/unlock, OS eviction, wake-lock, permission and GPS behavior remain unverified.
- Chromium mobile emulation is not Safari or hardware acceptance. VoiceOver/TalkBack and screen-reader usability still need physical assistive-technology review.
- Search is a small verified local catalog plus saved places/map selection, not a general address or business geocoder.
- Closure/advisory checks use the shared published catalog, not a live feed. Official notices and actual access must be reviewed before a ride/release.
- No offline area download, background navigation, account synchronization, public hosting or browser credential setup is implemented or claimed.
- Real-data public release requires completion of the documented license/provider obligations, physical-device acceptance and the owner's explicit deployment approval.

## Review locations

- `webApp/`: browser entry point, worker client, map, platform adapters, tests and build tools.
- `sharedLogic/`: extracted pure Kotlin domain/routing core and its tests.
- `webBridge/`: tested JSON interface to the same core.
- `shared/build.gradle.kts`: native dependency/framework export.
- `tools/fetch-web-review-data.py` and `data/web-reviewed-trails.manifest.json`: separately licensed source verification.
- `docs/web/`: architecture, run instructions, source provenance, rights and acceptance.

Local screenshots and browser traces are intentionally ignored under `webApp/output/` and `webApp/test-results/`.

## September 29: closure presentation

Closure geometry now uses a thin dashed line beneath the selected route and a permanent, keyboard-accessible "Trail closed" marker. The marker opens the reported notice and official source; the legend uses matching wording and dashes. This changes presentation only, not closure data, route selection or safety gates.

The production build (including TypeScript and asset audit) passed. A focused local-data visual check on desktop Chromium and Pixel 7 emulation verified the Culver's Hershey Road to Tipton Park route, closure-label bounds, keyboard popup opening/closing and source link. The street-basemap presentation was also inspected in the local app. Screenshots remain ignored under webApp/output/closure-context-*.png.

## September 29: current-location recovery

The planner now watches for an accurate reading instead of rejecting the first coarse result. It preserves the shared 35 m / 15 second accuracy and freshness limits and adds an independent 20 second watchdog, including when a browser permission prompt never produces a callback. Denial, provider unavailability, timeout, low accuracy, insecure context, unsupported APIs and synchronous startup failure have distinct messages. Retry, cancel, place selection and map selection remain available. Choosing or swapping endpoints cancels acquisition, so late callbacks cannot overwrite a manual choice.

Validation: production build and fixture-only distribution audit passed; all 55 web unit tests passed (including 18 new acquisition tests); 12 focused desktop/Pixel 7 browser checks and both existing current-location route checks passed. Browser regression checks simulate location adapter outcomes while retaining the real app and routing worker. Recovery screenshots remain ignored under `webApp/output/playwright/location-recovery-*.png`.

A separate live check in the Codex embedded browser at the loopback local-data URL confirmed a secure context and an available geolocation API, with permission reported as `prompt`. The browser returned no position before the app watchdog expired. This is evidence of a live acquisition failure, not proof of a particular operating-system or browser-provider cause. Actual hardware location acquisition remains unverified; no device privacy or site-permission settings were changed. Users can retry, check permissions, open the site in a regular browser, or select a map point.

## September 29: measured connection notice

The route preview replaces the broad orange "unmapped ground" warning with a neutral connections panel. The shared Kotlin web bridge reports each unverified segment's exact distance, endpoints and route-order identifier; the panel shows the combined estimate, individual lengths and adjacent street labels. Matching numbered markers locate the connections without drawing an invented path. Selecting a row zooms to its connection and opens a keyboard-accessible explanation; mobile selection brings the map into view. Route fitting includes the gap endpoints. Recalculation/opening clears old connection focus.

The navigation gate is unchanged: any previously blocking unverified segment still blocks navigation. Closures and proposed-trail notices retain their separate presentation. Estimated portions remain excluded from drawable routes, and the total route length still includes their estimates. Distances below one foot are shown as "<1 ft", never rounded down to zero.

Validation: 20 bridge JVM tests and 20 bridge JS tests passed; the browser bridge and production web build passed, including TypeScript and the fixture-only asset audit. Six focused desktop/Pixel 7 checks passed, including measured notices, tiny gaps, fully mapped routes, repeated map focus, recalculation, and accessibility analysis. Separate local-data desktop/mobile checks reproduced the user's exact 2.72-mile route: four connections totaling approximately 143 feet, labeled 79 ft, 16 ft, <1 ft and 47 ft. Private route inputs and review screenshots stay ignored in `webApp/output/`.
