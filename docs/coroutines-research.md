<!--
Job: Capture official coroutine and lifecycle guidance that drives Trail Mapper concurrency decisions.

-->

# Kotlin Coroutines Research

This app should use coroutines for every operation that might block UI rendering: location lookup, map-point selection, trail-data loading, graph building, route search, and any future geocoding/network calls.

## Official Guidance

- Kotlin structured concurrency: coroutines should run inside a `CoroutineScope` that owns their lifecycle. Parent cancellation should cancel children, and parents wait for children before completing.
- Dispatchers: coroutine builders inherit their parent dispatcher unless one is supplied. CPU work belongs on `Dispatchers.Default`; blocking file/network I/O belongs on an I/O dispatcher.
- Cancellation: coroutine cancellation is cooperative. Long CPU loops need suspension points or explicit checks such as `ensureActive`.
- Android lifecycle: `viewModelScope` is canceled when the `ViewModel` is cleared and is recommended for work that should live with screen state.
- Compose: `rememberCoroutineScope` is composition-scoped and acceptable for small UI side effects, but route-planner business work belongs in a ViewModel so it survives recomposition and is canceled with the screen owner.
- KMP ViewModel: Compose Multiplatform supports ViewModels in common code. Common code must provide an initializer when calling `viewModel()`.
- Lifecycle-aware state collection: Android recommends `collectAsStateWithLifecycle` for Flow-backed Compose state, and Compose Multiplatform provides a common lifecycle runtime through `org.jetbrains.androidx.lifecycle:lifecycle-runtime-compose`.

## Working Rules

- UI composables should render state and forward events. They should not own route-search jobs, graph-building jobs, provider calls, or long-lived mutable route state.
- Screen-level async work belongs in `RoutePlannerViewModel` and should launch from `viewModelScope`.
- A new route search should cancel the previous route-search job before starting replacement work.
- CPU-bound trail filtering, graph construction, nearest-edge snapping, and shortest-path search should run under `Dispatchers.Default`.
- Blocking or platform I/O should run under `Dispatchers.IO`; Android asset reads and `Geocoder` calls follow this rule.
- Pure Sijkos should stay coroutine-free where possible. If they can do long CPU loops, accept a `cancellationCheckpoint` lambda so callers can connect them to their lifecycle scope.
- Catch `CancellationException` separately and rethrow it. Treating cancellation as an ordinary error can leave stale dialogs or hide lifecycle behavior.
- Do not use `GlobalScope` or create ad hoc app-wide scopes for route-planner work.
- Keep `rememberCoroutineScope` limited to short composition-owned UI event work. If the work owns screen state or should survive recomposition, move it into a ViewModel.
- For flow-backed ViewModel state, expose read-only `StateFlow` and mutate through narrow event methods.
- Collect `StateFlow` in Compose with `collectAsStateWithLifecycle` when the shared lifecycle runtime is available.

## Trail Mapper Decisions

- Route planner state and UI-triggered async work live in `RoutePlannerViewModel`.
- UI calls ViewModel methods; the ViewModel launches work in `viewModelScope`.
- UI collects `RoutePlannerViewModel.uiState` with `collectAsStateWithLifecycle`.
- File/asset loading stays in platform providers and uses I/O dispatching.
- Route filtering, graph construction, and search run under `Dispatchers.Default`.
- Route graph/search Sijkos accept a cancellation checkpoint so ViewModel-owned jobs can stop quickly if the user leaves the screen or starts a replacement route search.
- No `GlobalScope`; no manually created unbounded app-wide scopes.
- Manual text edits clear stale endpoint coordinates before route search.

## Applied Flow

1. The user taps `Find Trail Route`.
2. `App.kt` forwards the event to `RoutePlannerViewModel.findTrailRoute`.
3. The ViewModel cancels any previous route-search `Job` and launches a replacement in `viewModelScope`.
4. Android trail-network loading happens through `AndroidTrailNetworkProvider`, which uses `Dispatchers.IO`.
5. Filtering, graph building, and route search run inside `withContext(Dispatchers.Default)`.
6. The ViewModel passes `ensureActive` checkpoints into the graph/search Sijkos.
7. Success, no-route, data-error, and unexpected-error states update `StateFlow`; Compose renders the dialog from state.

## Remaining Watch Points

- Typed-address geocoding should follow the same pattern: ViewModel-owned job, platform provider using `Dispatchers.IO`, and cancellation rethrown.
- When iOS receives native map picking, keep the shared event/state flow unchanged and isolate platform permission/geocoder details inside the iOS provider.
- If route search grows beyond in-memory prototype data, keep parsing/loading and CPU graph work separate so each can use the appropriate dispatcher.

## Sources

- Kotlin coroutines basics: `https://kotlinlang.org/docs/coroutines-basics.html`
- Kotlin coroutine context and dispatchers: `https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html`
- Kotlin cancellation and timeouts: `https://kotlinlang.org/docs/cancellation-and-timeouts.html`
- `ensureActive` API: `https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/ensure-active.html`
- Android lifecycle-aware coroutine scopes: `https://developer.android.com/topic/libraries/architecture/coroutines`
- Android coroutine best practices: `https://developer.android.com/kotlin/coroutines/coroutines-best-practices`
- Compose side effects: `https://developer.android.com/develop/ui/compose/side-effects`
- Compose Multiplatform ViewModel: `https://kotlinlang.org/docs/multiplatform/compose-viewmodel.html`
- Android KMP ViewModel setup: `https://developer.android.com/kotlin/multiplatform/viewmodel`
