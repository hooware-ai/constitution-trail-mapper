# Route-generation reliability audit — September 7, 2026

The focused follow-up found cases where mapped, usable routes existed but the app's candidate selection missed them. Six focused fixes are in the working tree. A separate distance-constrained exercise-search defect remains open: a failed search still does not prove that no feasible route exists.

This extends [the app walkthrough](defect-walkthrough-2026-09-07.md), which fixed an Android heap exhaustion crash during route creation. The two navigation-progress defects recorded there remain open.

## Confirmed generation defects and changes

| Defect | Executed reproduction | Change |
| --- | --- | --- |
| Empty road data suppresses a valid on-trail route. | Two endpoints on the same 1,000 m trail route successfully without an access graph, but fail when an empty graph is supplied. | Keep direct on-trail candidates even when the road graph has no edges. The existing 8 m direct-access limit is unchanged. |
| Duplicate junction candidates hide the only connected trail entrance. | Four nearby spurs fill the eight candidate slots with duplicate direct/routed entries, excluding an entrance reached by a mapped 200 m road. | Deduplicate identical access candidates before ranking and truncation. Distinct access geometry is retained. |
| Nearby disconnected trails prevent the broader access retry. | An isolated spur at the start prevents consideration of a connected trail reached by a mapped 2 km road, even though it meets the existing extended-access policy. | Retry the existing extended search after the normal route search fails. Successful normal routes return immediately. |
| Ineligible nearby paths crowd out an eligible access road. | Thirty-two disallowed path snaps hide an eligible road 70 m away, inside the existing 250 m endpoint limit. | Apply eligibility before truncating to four road snaps. |
| A nearby disconnected spur hides an available exercise loop. | A 33 m spur takes both primary entry slots and obscures an approximately 1,023 m loop for a 1,000 m request. | Retain the primary entries, then search bounded additional entries on previously unrepresented connected components when needed. |
| Pressing Create while an endpoint is still resolving cancels that selection and searches prematurely. | Deferred GPS, map, autocomplete, location-explanation, and prediction-selection tests exercise the pending states. | Disable Create and guard the ViewModel until endpoint selection completes. |

The four ordinary-routing reproductions and the disconnected-spur exercise reproduction failed before their production fixes. A sixth baseline failure established the still-open constrained-search defect below. Baseline evidence is retained in `artifacts/route-generation-audit/baseline.log`.

Integration testing caught and corrected an overly broad version of exercise fallback: using farther entries on the same connected trail replaced actual trail travel with estimated access and made an acyclic out-and-back appear to be an exact loop. Existing loop-quality tests were preserved, and a dedicated regression now checks that starting on a trail does not manufacture estimated access. The intermediate failure is retained in `component-recovery-before.xml`.

## Remaining limitations

1. **Confirmed algorithm defect: distance limits can discard a feasible exercise path.** The search keeps one preferred-cost path per junction. In the executed fixture it retains a cheaper 600 m path, discards a costlier 300 m alternative, then cannot fit the remaining 500 m leg under a 1,000 m cap. An 800 m path exists but is missed. This can deprive the loop generator of usable candidates; it does not establish the rate of whole-request failures in real data. Correct repair requires preserving alternatives with different cost/distance tradeoffs and their own path history, or a separate distance-based recovery search. **Fixed on 2026-09-27 (earlier issue 5):** the search now keeps two labels per junction, the cheapest and the physically shortest, each with its own predecessor. Any junction whose shortest distance fits the cap is therefore reached. Intermediate cost/distance tradeoffs are still not kept. Keeping every nondominated label was measured at up to 15.8 s on the shipped network, against 1.1 s before the change. `ExerciseRouteGenerationAuditTest.boundedSearchRetainsAShorterCostlierPathNeededToReachAnExistingDestination` is enabled and passes.
2. **Search caps still limit completeness.** Four eligible road snaps and finite trail-entry pools can exclude a more distant connected component in dense data. Exercise recovery now checks additional components, but remains bounded. These are deliberate performance bounds, not a mathematical guarantee that every feasible route will be discovered.
3. **Available network geometry limits what can be generated.** The routing graph uses packaged data; missing links, separated components, unsuitable loop geometry, and disabled proposed trails can legitimately prevent a requested route. Proposed trails remain opt-in. Wider searches do not create connections absent from the map.
4. **Endpoint and history dependencies need resilience work.** Source inspection identifies Android reverse-geocoding and completed-exercise-history failure paths that can prevent creation despite usable route data. These have not been reproduced on a device. See the source-specific notes below.

Normal access limits remain 1,500 m straight-line trail search, 4,000 m routed access, and 250 m endpoint snap. Existing extended limits remain 6,500 m, 12,000 m, and 1,000 m respectively. The fixes do not enable proposed trails, change those limits, or certify estimated endpoint segments as mapped infrastructure.

Source-specific dependency risks:

- `androidApp/src/main/kotlin/com/trailmapper/android/location/AndroidCurrentLocationAddressProvider.kt:73` reverse-geocodes after obtaining valid GPS coordinates, outside the location timeout/error handler. A thrown geocoder exception prevents returning those coordinates; the pre-Android-13 call at line 182 has no exception fallback. Android 13+ callback `onError` does fall back correctly. A missing callback could leave the request pending, but that platform failure was not reproduced.
- `androidApp/src/main/kotlin/com/trailmapper/android/AndroidCompletedExerciseSessionStore.kt:48` throws for malformed history. `ExerciseRoutePlannerViewModel.kt:316` requires the history read before calculation, so such a failure aborts every exercise request. Decoder rejection has test coverage; the full failing planner path was identified by source inspection. A future recovery should preserve the original data and distinguish unavailable history from an empty history.

## Packaged-data sweep

The host audit uses the packaged approved trail and road assets, default layers with proposed trails disabled, and endpoint-local road filtering. The approved graph has 6,853 nodes and 26,907 edges; its largest connected component contains 4,950 nodes.

- Four representative point-to-point routes around that connected component were generated, covering its regional north/south extent and central/southeast Bloomington positions. This confirms these fixtures, not arbitrary addresses or all disconnected components.
- Eighteen exercise requests cover three starting areas and targets of 0.5, 1, 3, 5, 10, and 20 miles. All returned a route: twelve returned `Exact` (central and southeast), and six returned `Closest` alternatives on the northern regional corridor. An earlier intermediate sweep reported fifteen `Exact`; three of those were misleading classifications from the overly broad fallback caught by integration tests. The final results retain the correct out-and-back classification.
- `Exact` is the app's distance-and-loop quality classification. Distance tolerance is the larger of 160 m and 10% of the request; it does not mean identical mileage. A `Closest` route can be within the distance tolerance but fail the preferred loop/overlap quality requirement.
- These are host-JVM calculations. Measured host execution times are not phone latency guarantees. The sweep records exercise outcomes and checks proposed-trail exclusion; it does not assert that every request must have an exact loop.

| Requested miles | Central result, miles (`Exact`) | Southeast result, miles (`Exact`) | Northern corridor result, miles (`Closest`) |
| ---: | ---: | ---: | ---: |
| 0.5 | 0.472 | 0.502 | 0.413 |
| 1 | 0.995 | 0.933 | 1.007 |
| 3 | 3.000 | 3.007 | 2.946 |
| 5 | 5.004 | 4.973 | 4.658 |
| 10 | 9.786 | 10.381 | 9.583 |
| 20 | 20.001 | 21.596 | 20.303 |

Starts: central 40.49000, -88.98750; southeast 40.467065, -88.934114; northern regional network endpoint 40.756228, -88.714595. The last is a regional corridor endpoint, not central Normal.

The final integrated run passed **273 tests** (266 shared and 7 Android), with **3 explicitly skipped known-defect targets** and zero failures. The skipped targets cover the constrained exercise-search defect above and the two earlier navigation defects. Android debug assembly, Android lint, and shared-code compilation for both iOS device and simulator targets passed. Native iOS runtime was not tested. `validation-final.log`, `test-totals-final.json`, and `matrix-final.txt` preserve the results.

The final APK was installed on the `medium_phone` Android 16 emulator. Repeating the original map-picked endpoints with a Start-picker rotation produced the same **1.83-mile ordinary route**. Creating a **5-mile exercise route** from the first test point succeeded and displayed a 5.0 mi loop with 0.81 mi retraced; the screen was visually inspected. Proposed trails stayed disabled. UI trees, the ordinary-route execution log, and the exercise-result screenshot are retained under `artifacts/route-generation-audit/`. No route was saved or shared during this follow-up. The test emulator was shut down after verification.

## Changed code and regression coverage

- `shared/src/commonMain/kotlin/com/trailmapper/shared/routing/TrailRouteEndpointAccessSelectorSijko.kt`
- `shared/src/commonMain/kotlin/com/trailmapper/shared/routing/TrailRouteWithAccessFinderSijko.kt`
- `shared/src/commonMain/kotlin/com/trailmapper/shared/routing/TrailRouteAccessPathFinderSijko.kt`
- `shared/src/commonMain/kotlin/com/trailmapper/shared/routing/ExerciseRouteCalculationSijko.kt`
- `shared/src/commonMain/kotlin/com/trailmapper/shared/ExerciseRoutePlannerViewModel.kt`, `ExerciseRoutePlannerUiState.kt`, and `App.kt`
- New tests: `TrailRouteAvailabilityAuditTest.kt`, `ExerciseRouteGenerationAuditTest.kt`, `ExerciseRoutePlannerPendingEndpointTest.kt`, and host-side `RouteGenerationRealDataAuditTest.kt`.

Evidence remains in ignored `artifacts/route-generation-audit/`. No physical phone installation or real GPS travel is claimed. Native iOS runtime remains outside this Windows audit.

## Authorized phone deployment — September 7, 2026, 8:26 PM Central

After the audit, the latest debug build was installed over an existing app installation. A fresh Gradle assembly confirmed the APK was current, and the installed base APK's SHA-256 matched the local artifact. Installation retained app data. The app opened on a saved route map with route summary, Start navigation, and Directions controls available. Navigation was not started. This supersedes the earlier statement that deployment had only reached the emulator; it does not add real GPS travel validation.

Deployment evidence: `phone-build.log`, `phone-install.log`, `phone-install-receipt.json`, and `phone-launch-check.json` in `artifacts/route-generation-audit/`. The version label remains `0.1.0` (code 1); the exact installed artifact is identified by hash `91659013a1c1e40bd02146ac11a421753a5f3cb67c606a7c44e24739326701e2`.
