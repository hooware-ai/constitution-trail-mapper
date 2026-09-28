# Trail Mapper defect walkthrough — September 7, 2026

The exploratory review found seven user-visible defect groups. Five have focused fixes in the working tree. Two exercise-navigation correctness defects remained open, with executed reproductions and explicitly ignored regression targets. Both were fixed on September 27, 2026: the repeated-junction defect (#4) and the early-turnaround completion defect (#3). This is an exploratory pass, not a release certification.

## Confirmed findings

| Priority | Defect and trigger | Evidence | Status |
| --- | --- | --- | --- |
| P1 | Ordinary route search exhausts the Android heap after selecting start/destination on the map. | Android 16 emulator crashed searching 1212 N Evans St (40.49000, -88.98750) to 101 N Fell Ave (40.51041, -88.98750). `OutOfMemoryError`, 201,326,592-byte heap limit. | Fixed and verified on the same emulator. The same endpoints now return a 1.83-mile route; saving, reopening, and navigation succeed. Road assets stream and the index retains only cells with nodes. |
| P1 | An old search can replace the result after the endpoint or proposed-trails setting changes. Late location/map/autocomplete results can also overwrite newer input. | Deferred-provider coroutine tests exercise eight input mutations and old/new completion orders. | Fixed. Invalidated jobs cannot publish stale results, errors, or loading state. Find waits for pending endpoint selection. |
| P1 | An exercise loop can be falsely marked complete after an early turnaround. | A 3,927.384 m planned loop, with only 511.082 m traveled out and back, projected to full progress and returned `shouldComplete=true`. The emulator also showed premature completion during mock-location testing. | Fixed on 2026-09-27 (#3). On a loop, a far progress jump is rejected when a position reachable by continuous travel matches about as well, and completion also requires at least 75% of the loop as continuous forward steps. Simulated rides in `ExerciseRouteNavigationRideTest` cover the early return, jitter at the start, a genuine lap, a reversed ride, and a GPS gap. |
| P1 | A return turn at a repeated junction is skipped. | While approaching a junction for the second time, expected “Slight right onto Access road” in 70.036 m; actual “Return to start” in 155.216 m. | Fixed on 2026-09-27 (#4). Instructions resolve in route order, each no earlier than the previous one, so a repeated junction maps to its own occurrence. The regression now runs in `TrailRouteNavigationSnapshotSijkoTest`. |
| P2 | Rotating while the map picker is open loses its result and leaves a permanent spinner. | Reproduced before the fix: rotate, Set point, blank Start and disabled picker/spinner. After the fix: the same flow fills Start and restores the picker control. | Fixed and verified on emulator. The retained Android result bridge also covers location permission/settings results. |
| P2 | Rotating during Add destination closes the dialog; reopening resets the draft. | Before: entered QA_Rotation_Draft, rotated, returned to Home. After: dialog and exact draft remain. | Fixed and verified on emulator. |
| P2 | Rotation resets active navigation and closes the directions sheet. Restarting navigation resets exercise progress. | Source confirmed: both mode flags used non-saveable Compose state. | Fixed and verified: Navigate, the next instruction, remaining distance, and Stop survive rotation. The directions sheet also stays open. This does not resolve the open loop-progress defects. |

## Changed files

- `shared/src/commonMain/kotlin/com/trailmapper/shared/RoutePlannerViewModel.kt`: cancellation, stale-result protection, recoverable autocomplete errors, pending-endpoint search guard.
- `shared/src/commonMain/kotlin/com/trailmapper/shared/RoutePlannerUiState.kt`: one shared pending-endpoint condition for UI and ViewModel.
- `shared/src/commonMain/kotlin/com/trailmapper/shared/App.kt`: preserve Add destination dialog and disable Find during pending selection.
- `androidApp/src/main/kotlin/com/trailmapper/android/MainActivity.kt` and `AndroidActivityResultViewModel.kt`: retained result delivery, current Activity binding for account UI, application context for long-lived services.
- `androidApp/src/main/kotlin/com/trailmapper/android/map/TrailRouteMapActivity.kt`: preserve navigation/directions mode through recreation.
- `androidApp/src/main/kotlin/com/trailmapper/android/routing/AndroidAccessNetworkProvider.kt` and `AndroidAccessNetworkJsonReader.kt`: bounded streaming asset load.
- `shared/src/commonMain/kotlin/com/trailmapper/shared/routing/AccessGraphBuilderSijko.kt`: discard spatial-index cells that no node will query; preserve candidate order and topology.
- `androidApp/build.gradle.kts`: Android unit-test dependencies.
- Focused planner, Android result-bridge, sparse-road intersection, and known-navigation-defect tests.

## Validation and evidence

Baseline: 242 shared tests passed; Android debug build and lint passed. This missed the defects above.

Final validation: **259 passed, 2 explicitly skipped known-defect tests, zero failures** (252 shared plus 7 Android tests). Android debug assembly and lint passed; lint retains dependency/target-SDK warnings. Both `compileKotlinIosArm64` and `compileKotlinIosSimulatorArm64` passed using JDK 21. No native iOS runtime claim is made.

The final APK was installed on the emulator. Repeated the original failing route with the same endpoint coordinates and a rotation during Start picking: it succeeded, saved, reopened, and started navigation. Navigation and directions survived rotation. Map tiles and route overlays were visually checked after loading. Menu/About and Back worked; the saved route survived an app-process restart. Android exit history showed no new crash after the memory fix. The physical phone still has its previous installation.

The exact route reproduction is `artifacts/defect-walkthrough/Reproduce-Search.ps1`, run from Home after a cold boot and installation of the final APK; it checks actual UI labels and map viewport, stops on unexpected state, and only targets `emulator-5554`. The test emulator was shut down at the end of this pass.

Local evidence is in ignored `artifacts/defect-walkthrough/`: before/after UI trees, picker screenshot, route-search crash log, preserved baseline APK, and the build log. The saved five-mile exercise loop survived APK replacement. Test data and mock GPS were confined to the `medium_phone` Android 16 emulator; no physical device or watch was modified.

Both desired-behavior regressions are now enabled and pass. The repeated-junction regression moved to `TrailRouteNavigationSnapshotSijkoTest.kt` with its fix (#4). The early-turnaround regression moved to `ExerciseRouteNavigationRideTest.kt` with its fix (#3), and `TrailRouteNavigationKnownDefectsTest.kt` was removed.

Remaining coverage limits: real GPS travel, full exercise completion, native iOS runtime, authenticated sign-in, sharing delivery, TalkBack, and process-death restoration were not certified in this pass. iOS shared-code compilation is distinct from an Xcode/device run.
