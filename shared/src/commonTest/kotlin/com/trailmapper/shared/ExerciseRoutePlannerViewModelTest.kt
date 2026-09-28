/**
 * Job: Verify exercise-route planner validation, provider coordination, and cancellation behavior.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.AccessNetworkFeature
import com.trailmapper.shared.routing.ExerciseRouteCalculationSijko
import com.trailmapper.shared.routing.TrailFacilityType
import com.trailmapper.shared.routing.TrailNetworkFeature
import com.trailmapper.shared.routing.TrailNetworkRole
import com.trailmapper.shared.routing.TrailComfortLevel
import com.trailmapper.shared.routing.TrailFeatureStatus
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class ExerciseRoutePlannerViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun validatesStartAddressPointAndTargetBeforeLoading() = runTest(dispatcher) {
        val trailProvider = FakeTrailNetworkProvider(TrailNetworkLoadResult.Unavailable)
        val accessProvider = FakeAccessNetworkProvider(AccessNetworkLoadResult.Unavailable)
        val viewModel = planner()

        viewModel.findExerciseRoute(trailProvider, accessProvider)
        assertEquals("Enter a starting address.", viewModel.uiState.value.searchError)
        assertEquals(0, trailProvider.calls)

        viewModel.updateStartAddress("Start", unavailableAutocomplete())
        viewModel.findExerciseRoute(trailProvider, accessProvider)
        assertEquals(
            "Choose a starting point from autocomplete, current location, or the map.",
            viewModel.uiState.value.searchError,
        )

        viewModel.setTargetMilesText("0.49")
        applyMapPoint(viewModel)
        viewModel.findExerciseRoute(trailProvider, accessProvider)
        assertEquals("Enter a target distance between 0.5 and 100 miles.", viewModel.uiState.value.searchError)
        assertEquals(0, trailProvider.calls)
    }

    @Test
    fun currentLocationPromptCanBeConfirmedAndApplied() = runTest(dispatcher) {
        val provider = FakeLocationProvider(
            explain = true,
            result = CurrentLocationAddressResult.Success("Current start", point()),
        )
        val viewModel = planner()

        viewModel.requestCurrentLocation(provider)
        assertTrue(viewModel.uiState.value.pendingLocationPrompt)
        assertEquals(0, provider.lookupCalls)
        viewModel.dismissCurrentLocationPrompt()
        assertFalse(viewModel.uiState.value.pendingLocationPrompt)
        assertEquals(0, provider.lookupCalls)

        viewModel.requestCurrentLocation(provider)
        viewModel.confirmCurrentLocation(provider)
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.pendingLocationPrompt)
        assertEquals("Current start", viewModel.uiState.value.startAddress)
        assertEquals(point(), viewModel.uiState.value.startPoint)
        assertEquals(1, provider.lookupCalls)
    }

    @Test
    fun mapPickerUsesStartOnlyAndDismissesErrors() = runTest(dispatcher) {
        val provider = FakeMapPointProvider(MapPointSelectionResult.Success(point(), "Picked start"))
        val viewModel = planner()

        viewModel.requestMapPoint(RouteEndpointTarget.Destination, provider)
        advanceUntilIdle()
        assertEquals(0, provider.targets.size)

        viewModel.requestMapPoint(provider)
        advanceUntilIdle()
        assertEquals(listOf(RouteEndpointTarget.Start), provider.targets)
        assertEquals("Picked start", viewModel.uiState.value.startAddress)

        provider.result = MapPointSelectionResult.Error("map failed")
        viewModel.requestMapPoint(provider)
        advanceUntilIdle()
        assertEquals("map failed", viewModel.uiState.value.mapPointError)
        viewModel.dismissMapPointError()
        assertNull(viewModel.uiState.value.mapPointError)
    }

    @Test
    fun autocompleteDebouncesAndCancelsStaleQueries() = runTest(dispatcher) {
        val provider = FakeAutocompleteProvider()
        val viewModel = planner()

        viewModel.updateStartAddress("Old address", provider)
        advanceTimeBy(299)
        runCurrent()
        assertEquals(emptyList(), provider.queries)

        advanceTimeBy(1)
        runCurrent()
        assertEquals(listOf("Old address"), provider.queries)

        viewModel.updateStartAddress("New address", provider)
        advanceTimeBy(300)
        advanceUntilIdle()

        assertTrue(provider.oldQueryCancelled)
        assertEquals(listOf("Old address", "New address"), provider.queries)
        assertEquals("New address suggestion", viewModel.uiState.value.autocompleteSuggestions.single().fullText)
    }

    @Test
    fun autocompleteSelectionAppliesAddressAndPoint() = runTest(dispatcher) {
        val provider = FakeAutocompleteProvider()
        val viewModel = planner()
        val prediction = AddressAutocompletePrediction("id", "Start", "Town", "Start, Town")

        viewModel.selectAutocompletePrediction(prediction, provider)
        advanceUntilIdle()

        assertEquals("Resolved start", viewModel.uiState.value.startAddress)
        assertEquals(point(), viewModel.uiState.value.startPoint)
        assertEquals(listOf(RouteEndpointTarget.Start), provider.selectionTargets)
    }

    @Test
    fun trailUnavailableAndErrorBecomeSearchErrors() = runTest(dispatcher) {
        val viewModel = plannerWithStart()
        val accessProvider = FakeAccessNetworkProvider(AccessNetworkLoadResult.Unavailable)

        val unavailable = FakeTrailNetworkProvider(TrailNetworkLoadResult.Unavailable)
        viewModel.findExerciseRoute(unavailable, accessProvider)
        advanceUntilIdle()
        assertEquals("Trail data is unavailable.", viewModel.uiState.value.searchError)

        val failed = FakeTrailNetworkProvider(TrailNetworkLoadResult.Error("trail read failed"))
        viewModel.findExerciseRoute(failed, accessProvider)
        advanceUntilIdle()
        assertEquals("trail read failed", viewModel.uiState.value.searchError)
        viewModel.dismissSearchError()
        assertNull(viewModel.uiState.value.searchError)
    }

    @Test
    fun successfulFindPassesHistoryTimeAndOnlyStartToAccessProvider() = runTest(dispatcher) {
        val start = point()
        val feature = existingSquareFeature(start)
        val baseline = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(feature),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = HALF_MILE_METERS,
                completedSessions = emptyList(),
                nowEpochMillis = NOW,
            ),
        )
        val store = FakeSessionStore(
            sessions = listOf(
                CompletedExerciseSession(
                    id = "completed-1",
                    routeKey = baseline.routeKey,
                    completedAtEpochMillis = NOW,
                    completedDistanceMeters = baseline.route.totalDistanceMeters,
                    traversalEdges = baseline.route.traversalEdges,
                ),
            ),
        )
        val viewModel = planner(store = store, now = NOW)
        applyMapPoint(viewModel)
        viewModel.setTargetMilesText("0.5")
        val trailProvider = FakeTrailNetworkProvider(TrailNetworkLoadResult.Success(listOf(feature)))
        val accessProvider = FakeAccessNetworkProvider(
            AccessNetworkLoadResult.Success(
                listOf(
                    AccessNetworkFeature(
                        id = "start-road",
                        paths = listOf(
                            listOf(start, MapPoint(start.latitude + 0.0001, start.longitude)),
                        ),
                    ),
                ),
            ),
        )

        viewModel.findExerciseRoute(trailProvider, accessProvider)
        awaitSearchSettled(viewModel)

        val result = assertNotNull(viewModel.uiState.value.result)
        assertTrue(result.historyOverlapMeters > 0.0)
        assertEquals(1, store.calls)
        assertEquals(listOf(start), accessProvider.endpointPoints)
        assertEquals(1, trailProvider.calls)
        assertEquals(1, nowCalls)
    }

    @Test
    fun proposedTrailsRemainOptInUntilEnabled() = runTest(dispatcher) {
        val proposed = existingSquareFeature(point(), TrailFeatureStatus.Proposed)
            .copy(routeRoles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ProposedTrails))
        val trailProvider = FakeTrailNetworkProvider(TrailNetworkLoadResult.Success(listOf(proposed)))
        val accessProvider = FakeAccessNetworkProvider(AccessNetworkLoadResult.Unavailable)
        val viewModel = plannerWithStart()

        viewModel.findExerciseRoute(trailProvider, accessProvider)
        awaitSearchSettled(viewModel)
        assertNull(viewModel.uiState.value.result)
        assertEquals("No exercise route found for this start and distance.", viewModel.uiState.value.searchError)

        viewModel.setProposedTrailsEnabled(true)
        assertTrue(viewModel.uiState.value.proposedTrailsEnabled)
        viewModel.findExerciseRoute(trailProvider, accessProvider)
        awaitSearchSettled(viewModel)
        assertNotNull(viewModel.uiState.value.result)
    }

    @Test
    fun cancellationStopsAStaleRouteAndClearsFindingState() = runTest(dispatcher) {
        val trailProvider = BlockingTrailNetworkProvider()
        val accessProvider = FakeAccessNetworkProvider(AccessNetworkLoadResult.Unavailable)
        val viewModel = plannerWithStart()

        viewModel.findExerciseRoute(trailProvider, accessProvider)
        runCurrent()
        assertTrue(viewModel.uiState.value.isFindingRoute)

        viewModel.setTargetMilesText("1")
        trailProvider.gate.complete(TrailNetworkLoadResult.Unavailable)
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isFindingRoute)
        assertNull(viewModel.uiState.value.result)
        assertEquals(1, accessProvider.endpointPoints.size)
        assertTrue(trailProvider.wasCancelled)
    }

    @Test
    fun successfulResultSurvivesRepeatSearchUntilInputChanges() = runTest(dispatcher) {
        val viewModel = plannerWithStart()
        val success = FakeTrailNetworkProvider(
            TrailNetworkLoadResult.Success(listOf(existingSquareFeature(point()))),
        )
        val accessProvider = FakeAccessNetworkProvider(AccessNetworkLoadResult.Unavailable)

        viewModel.findExerciseRoute(success, accessProvider)
        awaitSearchSettled(viewModel)
        val result = assertNotNull(viewModel.uiState.value.result)

        val failed = FakeTrailNetworkProvider(TrailNetworkLoadResult.Error("refresh failed"))
        viewModel.findExerciseRoute(failed, accessProvider)
        awaitSearchSettled(viewModel)
        assertEquals(result, viewModel.uiState.value.result)

        viewModel.setTargetMilesText("1")
        assertNull(viewModel.uiState.value.result)
    }

    @Test
    fun providerErrorsAndLocationErrorsCanBeDismissed() = runTest(dispatcher) {
        val location = FakeLocationProvider(
            explain = false,
            result = CurrentLocationAddressResult.Error("location failed"),
        )
        val autocomplete = FakeAutocompleteProvider(throwPredictions = true)
        val viewModel = planner()

        viewModel.requestCurrentLocation(location)
        advanceUntilIdle()
        assertEquals("location failed", viewModel.uiState.value.locationError)
        viewModel.dismissLocationError()
        assertNull(viewModel.uiState.value.locationError)

        viewModel.updateStartAddress("Some address", autocomplete)
        advanceTimeBy(300)
        advanceUntilIdle()
        assertEquals("autocomplete failed", viewModel.uiState.value.autocompleteError)
        viewModel.dismissAutocompleteError()
        assertNull(viewModel.uiState.value.autocompleteError)
    }

    @Test
    fun aNewLoopAwaitsItsMapOnceAndARepeatFailureDoesNotReopenIt() = runTest(dispatcher) {
        val viewModel = plannerWithStart()
        val accessProvider = FakeAccessNetworkProvider(AccessNetworkLoadResult.Unavailable)
        assertFalse(viewModel.uiState.value.resultAwaitingMap)

        viewModel.findExerciseRoute(
            FakeTrailNetworkProvider(TrailNetworkLoadResult.Success(listOf(existingSquareFeature(point())))),
            accessProvider,
        )
        awaitSearchSettled(viewModel)
        assertNotNull(viewModel.uiState.value.result)
        assertTrue(viewModel.uiState.value.resultAwaitingMap)

        viewModel.markResultShownOnMap()
        assertFalse(viewModel.uiState.value.resultAwaitingMap)

        // A failed refresh keeps the shown result without opening its map again.
        viewModel.findExerciseRoute(FakeTrailNetworkProvider(TrailNetworkLoadResult.Error("refresh failed")), accessProvider)
        awaitSearchSettled(viewModel)
        assertNotNull(viewModel.uiState.value.result)
        assertFalse(viewModel.uiState.value.resultAwaitingMap)
    }

    @Test
    fun changingTheInputDropsAResultThatWasNeverShown() = runTest(dispatcher) {
        val viewModel = plannerWithStart()
        viewModel.findExerciseRoute(
            FakeTrailNetworkProvider(TrailNetworkLoadResult.Success(listOf(existingSquareFeature(point())))),
            FakeAccessNetworkProvider(AccessNetworkLoadResult.Unavailable),
        )
        awaitSearchSettled(viewModel)
        assertTrue(viewModel.uiState.value.resultAwaitingMap)

        viewModel.setTargetMilesText("1")

        assertNull(viewModel.uiState.value.result)
        assertFalse(viewModel.uiState.value.resultAwaitingMap)
    }

    private fun planner(
        store: FakeSessionStore = FakeSessionStore(),
        now: Long = NOW,
    ): ExerciseRoutePlannerViewModel {
        return ExerciseRoutePlannerViewModel(
            completedExerciseSessionStore = store,
            nowEpochMillis = {
                nowCalls += 1
                now
            },
        )
    }

    private fun TestScope.plannerWithStart(
        store: FakeSessionStore = FakeSessionStore(),
        now: Long = NOW,
    ): ExerciseRoutePlannerViewModel {
        val viewModel = planner(store, now)
        viewModel.updateStartAddress("Start", unavailableAutocomplete())
        viewModel.setTargetMilesText("0.5")
        applyMapPoint(viewModel)
        return viewModel
    }

    private fun TestScope.applyMapPoint(viewModel: ExerciseRoutePlannerViewModel) {
        viewModel.requestMapPoint(FakeMapPointProvider(MapPointSelectionResult.Success(point(), "Start")))
        runCurrent()
    }

    private fun unavailableAutocomplete(): AddressAutocompleteProvider {
        return FakeAutocompleteProvider(available = false)
    }

    private suspend fun TestScope.awaitSearchSettled(viewModel: ExerciseRoutePlannerViewModel) {
        repeat(200) {
            advanceUntilIdle()
            if (!viewModel.uiState.value.isFindingRoute) {
                return
            }
            withContext(Dispatchers.Default) {
                delay(5)
            }
            runCurrent()
        }
        error("Exercise route search did not settle: ${viewModel.uiState.value}")
    }

    private fun existingSquareFeature(
        start: MapPoint,
        status: TrailFeatureStatus = TrailFeatureStatus.Existing,
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = "square",
            status = status,
            routeRoles = setOf(TrailNetworkRole.TrailBranches),
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            paths = listOf(
                listOf(
                    start,
                    MapPoint(start.latitude + 0.0018, start.longitude),
                    MapPoint(start.latitude + 0.0018, start.longitude + 0.0018),
                    MapPoint(start.latitude, start.longitude + 0.0018),
                    start,
                ),
            ),
        )
    }

    private fun point(): MapPoint = MapPoint(40.0, -89.0)

    private class FakeSessionStore(
        private val sessions: List<CompletedExerciseSession> = emptyList(),
    ) : CompletedExerciseSessionStore {
        var calls = 0

        override suspend fun completedSessions(): List<CompletedExerciseSession> {
            calls += 1
            return sessions
        }

        override suspend fun recordCompletedSession(session: CompletedExerciseSession): CompletedExerciseSession = session
    }

    private class FakeTrailNetworkProvider(
        private val result: TrailNetworkLoadResult,
    ) : TrailNetworkProvider {
        var calls = 0

        override suspend fun loadTrailNetwork(): TrailNetworkLoadResult {
            calls += 1
            return result
        }
    }

    private class BlockingTrailNetworkProvider : TrailNetworkProvider {
        val gate = CompletableDeferred<TrailNetworkLoadResult>()
        var wasCancelled = false

        override suspend fun loadTrailNetwork(): TrailNetworkLoadResult {
            return try {
                gate.await()
            } catch (exception: kotlinx.coroutines.CancellationException) {
                wasCancelled = true
                throw exception
            }
        }
    }

    private class FakeAccessNetworkProvider(
        private val result: AccessNetworkLoadResult,
    ) : AccessNetworkProvider {
        val endpointPoints = mutableListOf<MapPoint>()

        override suspend fun loadAccessNetwork(relevantEndpointPoints: List<MapPoint>): AccessNetworkLoadResult {
            endpointPoints += relevantEndpointPoints
            return result
        }
    }

    private class FakeLocationProvider(
        private val explain: Boolean,
        private val result: CurrentLocationAddressResult,
    ) : CurrentLocationAddressProvider {
        var lookupCalls = 0

        override fun shouldExplainCurrentLocationAccess(): Boolean = explain

        override suspend fun getCurrentAddress(): CurrentLocationAddressResult {
            lookupCalls += 1
            return result
        }
    }

    private class FakeMapPointProvider(
        var result: MapPointSelectionResult,
    ) : MapPointSelectionProvider {
        val targets = mutableListOf<RouteEndpointTarget>()

        override suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult {
            targets += target
            return result
        }
    }

    private class FakeAutocompleteProvider(
        private val available: Boolean = true,
        private val throwPredictions: Boolean = false,
    ) : AddressAutocompleteProvider {
        override val isAvailable: Boolean = available
        val queries = mutableListOf<String>()
        val selectionTargets = mutableListOf<RouteEndpointTarget>()
        var oldQueryCancelled = false

        override suspend fun predictions(
            query: String,
            target: RouteEndpointTarget,
        ): List<AddressAutocompletePrediction> {
            queries += query
            if (query == "Old address") {
                try {
                    awaitCancellation()
                } finally {
                    oldQueryCancelled = true
                }
            }
            if (throwPredictions) {
                error("autocomplete failed")
            }
            return listOf(AddressAutocompletePrediction("new", query, "Town", "$query suggestion"))
        }

        override suspend fun resolvePrediction(
            prediction: AddressAutocompletePrediction,
            target: RouteEndpointTarget,
        ): AddressAutocompleteSelectionResult {
            selectionTargets += target
            return AddressAutocompleteSelectionResult.Success("Resolved start", MapPoint(40.0, -89.0))
        }
    }

    private var nowCalls = 0

    private companion object {
        const val HALF_MILE_METERS = 804.672
        const val NOW = 1_700_000_000_000L
    }
}
