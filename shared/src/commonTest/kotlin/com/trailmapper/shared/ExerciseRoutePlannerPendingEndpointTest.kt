/**
 * Job: Keep exercise searches from cancelling unfinished start-point selection.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class ExerciseRoutePlannerPendingEndpointTest {
    private val dispatcher = StandardTestDispatcher()
    private val originalPoint = MapPoint(40.0, -89.0)
    private val selectedPoint = MapPoint(40.01, -89.01)
    private val prediction = AddressAutocompletePrediction("new", "New start", "Town", "New start, Town")

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun createWaitsForCurrentLocationAndUsesTheCompletedFix() = runTest(dispatcher) {
        val fixture = plannerWithStart()
        val result = CompletableDeferred<CurrentLocationAddressResult>()
        val provider = object : CurrentLocationAddressProvider {
            override fun shouldExplainCurrentLocationAccess(): Boolean = false
            override suspend fun getCurrentAddress(): CurrentLocationAddressResult = result.await()
        }

        fixture.viewModel.requestCurrentLocation(provider)
        runCurrent()
        assertTrue(fixture.viewModel.uiState.value.isResolvingLocation)
        assertSearchWaits(fixture)

        result.complete(CurrentLocationAddressResult.Success("New start", selectedPoint))
        runCurrent()
        assertRoutesFromCompletedSelection(fixture)
    }

    @Test
    fun createWaitsForMapSelectionAndUsesTheCompletedPoint() = runTest(dispatcher) {
        val fixture = plannerWithStart()
        val result = CompletableDeferred<MapPointSelectionResult>()
        val provider = object : MapPointSelectionProvider {
            override suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult {
                assertEquals(RouteEndpointTarget.Start, target)
                return result.await()
            }
        }

        fixture.viewModel.requestMapPoint(provider)
        runCurrent()
        assertTrue(fixture.viewModel.uiState.value.isResolvingMapPoint)
        assertSearchWaits(fixture)

        result.complete(MapPointSelectionResult.Success(selectedPoint, "New start"))
        runCurrent()
        assertRoutesFromCompletedSelection(fixture)
    }

    @Test
    fun createWaitsForAutocompleteSelectionAndUsesTheResolvedPoint() = runTest(dispatcher) {
        val fixture = plannerWithStart()
        val result = CompletableDeferred<AddressAutocompleteSelectionResult>()
        val provider = autocompleteProvider(selection = result)

        fixture.viewModel.selectAutocompletePrediction(prediction, provider)
        runCurrent()
        assertTrue(fixture.viewModel.uiState.value.isResolvingAutocomplete)
        assertSearchWaits(fixture)

        result.complete(AddressAutocompleteSelectionResult.Success("New start", selectedPoint))
        runCurrent()
        assertRoutesFromCompletedSelection(fixture)
    }

    @Test
    fun createPreservesTheLocationPromptAndConfirmedLookup() = runTest(dispatcher) {
        val fixture = plannerWithStart()
        val result = CompletableDeferred<CurrentLocationAddressResult>()
        var locationCalls = 0
        val provider = object : CurrentLocationAddressProvider {
            override fun shouldExplainCurrentLocationAccess(): Boolean = true
            override suspend fun getCurrentAddress(): CurrentLocationAddressResult {
                locationCalls += 1
                return result.await()
            }
        }

        fixture.viewModel.requestCurrentLocation(provider)
        assertTrue(fixture.viewModel.uiState.value.pendingLocationPrompt)
        assertSearchWaits(fixture)
        assertEquals(0, locationCalls)

        fixture.viewModel.confirmCurrentLocation(provider)
        runCurrent()
        assertFalse(fixture.viewModel.uiState.value.pendingLocationPrompt)
        assertEquals(1, locationCalls)
        assertSearchWaits(fixture)

        result.complete(CurrentLocationAddressResult.Success("New start", selectedPoint))
        runCurrent()
        assertRoutesFromCompletedSelection(fixture)
    }

    @Test
    fun createPreservesPendingAutocompletePredictionsUntilSelection() = runTest(dispatcher) {
        val fixture = plannerWithStart()
        val predictions = CompletableDeferred<List<AddressAutocompletePrediction>>()
        val selection = CompletableDeferred<AddressAutocompleteSelectionResult>()
        val provider = autocompleteProvider(predictions, selection)

        fixture.viewModel.updateStartAddress("New start", provider)
        advanceTimeBy(300)
        runCurrent()
        assertTrue(fixture.viewModel.uiState.value.isResolvingAutocomplete)
        assertSearchWaits(fixture)

        predictions.complete(listOf(prediction))
        runCurrent()
        assertFalse(fixture.viewModel.uiState.value.hasPendingEndpointRequest)
        assertEquals(listOf(prediction), fixture.viewModel.uiState.value.autocompleteSuggestions)

        fixture.viewModel.selectAutocompletePrediction(prediction, provider)
        runCurrent()
        assertSearchWaits(fixture)
        selection.complete(AddressAutocompleteSelectionResult.Success("New start", selectedPoint))
        runCurrent()
        assertRoutesFromCompletedSelection(fixture)
    }

    private fun TestScope.plannerWithStart(): Fixture {
        val fixture = Fixture()
        fixture.viewModel.requestMapPoint(object : MapPointSelectionProvider {
            override suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult {
                return MapPointSelectionResult.Success(originalPoint, "Original start")
            }
        })
        fixture.viewModel.setTargetMilesText("1")
        runCurrent()
        assertEquals(originalPoint, fixture.viewModel.uiState.value.startPoint)
        return fixture
    }

    private fun TestScope.assertSearchWaits(fixture: Fixture) {
        val stateBeforeSearch = fixture.viewModel.uiState.value
        assertTrue(stateBeforeSearch.hasPendingEndpointRequest)

        fixture.findRoute()
        runCurrent()

        assertEquals(stateBeforeSearch, fixture.viewModel.uiState.value)
        assertFalse(fixture.viewModel.uiState.value.isFindingRoute)
        assertEquals(0, fixture.trailCalls)
        assertEquals(0, fixture.historyCalls)
        assertTrue(fixture.accessRequests.isEmpty())
    }

    private fun TestScope.assertRoutesFromCompletedSelection(fixture: Fixture) {
        assertFalse(fixture.viewModel.uiState.value.hasPendingEndpointRequest)
        assertEquals(selectedPoint, fixture.viewModel.uiState.value.startPoint)
        assertEquals("New start", fixture.viewModel.uiState.value.startAddress)
        assertEquals(0, fixture.trailCalls)

        fixture.findRoute()
        runCurrent()

        assertEquals(1, fixture.trailCalls)
        assertEquals(1, fixture.historyCalls)
        assertEquals(listOf(listOf(selectedPoint)), fixture.accessRequests)
        assertFalse(fixture.viewModel.uiState.value.isFindingRoute)
    }

    private fun autocompleteProvider(
        predictions: CompletableDeferred<List<AddressAutocompletePrediction>> = CompletableDeferred(emptyList()),
        selection: CompletableDeferred<AddressAutocompleteSelectionResult>,
    ): AddressAutocompleteProvider = object : AddressAutocompleteProvider {
        override val isAvailable: Boolean = true

        override suspend fun predictions(
            query: String,
            target: RouteEndpointTarget,
        ): List<AddressAutocompletePrediction> = predictions.await()

        override suspend fun resolvePrediction(
            prediction: AddressAutocompletePrediction,
            target: RouteEndpointTarget,
        ): AddressAutocompleteSelectionResult = selection.await()
    }

    private class Fixture {
        var trailCalls = 0
        var historyCalls = 0
        val accessRequests = mutableListOf<List<MapPoint>>()
        val viewModel = ExerciseRoutePlannerViewModel(object : CompletedExerciseSessionStore {
            override suspend fun completedSessions(): List<CompletedExerciseSession> {
                historyCalls += 1
                return emptyList()
            }

            override suspend fun recordCompletedSession(session: CompletedExerciseSession): CompletedExerciseSession = session
        })
        private val trailProvider = object : TrailNetworkProvider {
            override suspend fun loadTrailNetwork(): TrailNetworkLoadResult {
                trailCalls += 1
                return TrailNetworkLoadResult.Unavailable
            }
        }
        private val accessProvider = object : AccessNetworkProvider {
            override suspend fun loadAccessNetwork(relevantEndpointPoints: List<MapPoint>): AccessNetworkLoadResult {
                accessRequests += relevantEndpointPoints.toList()
                return AccessNetworkLoadResult.Unavailable
            }
        }

        fun findRoute() {
            viewModel.findExerciseRoute(trailProvider, accessProvider)
        }
    }
}
