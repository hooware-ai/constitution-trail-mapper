/**
 * Job: Verify route-planner initialization and that asynchronous results follow current user input.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.TrailRouteLayer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class RoutePlannerViewModelTest {
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
    fun prepareRoutePrefillsSavedDestination() {
        val destination = savedDestination()
        val viewModel = RoutePlannerViewModel()

        viewModel.prepareRoute(destination)

        assertEquals(destination.address, viewModel.uiState.value.endpoints.destination)
        assertEquals(destination.point, viewModel.uiState.value.endpoints.destinationPoint)
    }

    @Test
    fun repeatedPreparationDoesNotResetUserEditsAfterRecreation() {
        val viewModel = RoutePlannerViewModel()
        viewModel.prepareRoute(null)
        viewModel.setLayerChecked(TrailRouteLayer.ProposedTrails, true)

        viewModel.prepareRoute(savedDestination())

        assertTrue(viewModel.uiState.value.routeLayers.proposedTrails)
        assertEquals("", viewModel.uiState.value.endpoints.destination)
    }

    @Test
    fun changingAnyRouteInputDiscardsAnInFlightSearch() = runTest(dispatcher) {
        val changes: List<Pair<String, (RoutePlannerViewModel) -> Unit>> = listOf(
            "start text" to { it.updateEndpointText(RouteEndpointTarget.Start, "New start", NoAddressAutocompleteProvider) },
            "destination text" to { it.updateEndpointText(RouteEndpointTarget.Destination, "New destination", NoAddressAutocompleteProvider) },
            "swap" to { it.swapEndpoints() },
            "saved destination" to { it.prefillDestination(savedDestination()) },
            "proposed trails" to { it.setLayerChecked(TrailRouteLayer.ProposedTrails, false) },
            "map selection" to { it.requestMapPoint(RouteEndpointTarget.Start, immediateMapProvider()) },
            "current location" to { it.requestCurrentLocation(RouteEndpointTarget.Start, immediateLocationProvider()) },
            "autocomplete selection" to {
                it.selectAutocompletePrediction(RouteEndpointTarget.Destination, prediction(), NoAddressAutocompleteProvider)
            },
        )
        for ((name, change) in changes) {
            val viewModel = plannerWithEndpoints()
            viewModel.setLayerChecked(TrailRouteLayer.ProposedTrails, true)
            val provider = DeferredTrailProvider()
            viewModel.findTrailRoute(provider, NoAccessNetworkProvider)
            runCurrent()
            assertTrue(viewModel.uiState.value.isFindingRoute, name)

            change(viewModel)
            runCurrent()
            assertFalse(viewModel.uiState.value.isFindingRoute, name)
            provider.result.complete(Result.success(TrailNetworkLoadResult.Unavailable))
            runCurrent()

            assertNull(viewModel.uiState.value.routeDialog, name)
            assertFalse(viewModel.uiState.value.isFindingRoute, name)
        }
    }

    @Test
    fun canceledSearchCannotClearNewerBusyStateOrReplaceNewerResult() = runTest(dispatcher) {
        for (oldFails in listOf(false, true)) {
            for (oldFinishesFirst in listOf(false, true)) {
                val viewModel = plannerWithEndpoints()
                val oldProvider = DeferredTrailProvider()
                val newProvider = DeferredTrailProvider()
                viewModel.findTrailRoute(oldProvider, NoAccessNetworkProvider)
                runCurrent()
                viewModel.findTrailRoute(newProvider, NoAccessNetworkProvider)
                runCurrent()
                val oldResult = if (oldFails) {
                    Result.failure(IllegalStateException("Stale failure"))
                } else {
                    Result.success(TrailNetworkLoadResult.Error("Stale result"))
                }
                if (oldFinishesFirst) {
                    oldProvider.result.complete(oldResult)
                    runCurrent()
                    assertTrue(viewModel.uiState.value.isFindingRoute)
                    assertNull(viewModel.uiState.value.routeDialog)
                }
                newProvider.result.complete(Result.success(TrailNetworkLoadResult.Error("Current result")))
                runCurrent()
                if (!oldFinishesFirst) {
                    oldProvider.result.complete(oldResult)
                    runCurrent()
                }
                assertEquals("Current result", viewModel.uiState.value.routeDialog?.message)
                assertFalse(viewModel.uiState.value.isFindingRoute)
            }
        }
    }

    @Test
    fun locationAndMapResultsCannotOverwriteLaterEndpointEdits() = runTest(dispatcher) {
        for (useLocation in listOf(false, true)) {
            val viewModel = plannerWithEndpoints()
            val location = CompletableDeferred<CurrentLocationAddressResult>()
            val mapPoint = CompletableDeferred<MapPointSelectionResult>()
            if (useLocation) {
                viewModel.requestCurrentLocation(RouteEndpointTarget.Start, object : CurrentLocationAddressProvider {
                    override fun shouldExplainCurrentLocationAccess() = false
                    override suspend fun getCurrentAddress() = withContext(NonCancellable) { location.await() }
                })
            } else {
                viewModel.requestMapPoint(RouteEndpointTarget.Start, object : MapPointSelectionProvider {
                    override suspend fun pickMapPoint(target: RouteEndpointTarget) =
                        withContext(NonCancellable) { mapPoint.await() }
                })
            }
            runCurrent()
            viewModel.updateEndpointText(RouteEndpointTarget.Start, "My newer start", NoAddressAutocompleteProvider)
            location.complete(CurrentLocationAddressResult.Success("Stale location", point()))
            mapPoint.complete(MapPointSelectionResult.Success(point(), "Stale map point"))
            runCurrent()

            assertEquals("My newer start", viewModel.uiState.value.endpoints.start)
            assertNull(viewModel.uiState.value.endpoints.startPoint)
            assertNull(viewModel.uiState.value.resolvingLocationTarget)
            assertNull(viewModel.uiState.value.resolvingMapPointTarget)
        }
    }

    @Test
    fun autocompleteResultCannotApplyToAnEndpointAfterSwap() = runTest(dispatcher) {
        val viewModel = plannerWithEndpoints()
        val selection = CompletableDeferred<AddressAutocompleteSelectionResult>()
        val provider = object : AddressAutocompleteProvider by NoAddressAutocompleteProvider {
            override suspend fun resolvePrediction(
                prediction: AddressAutocompletePrediction,
                target: RouteEndpointTarget,
            ) = withContext(NonCancellable) { selection.await() }
        }
        viewModel.selectAutocompletePrediction(RouteEndpointTarget.Start, prediction(), provider)
        runCurrent()
        viewModel.swapEndpoints()
        val swapped = viewModel.uiState.value.endpoints
        selection.complete(AddressAutocompleteSelectionResult.Success("Stale selection", point()))
        runCurrent()

        assertEquals(swapped, viewModel.uiState.value.endpoints)
        assertFalse(viewModel.uiState.value.isResolvingAutocomplete)
        assertNull(viewModel.uiState.value.autocompleteTarget)
    }

    @Test
    fun staleAutocompletePredictionsDoNotClearNewerLoadingState() = runTest(dispatcher) {
        val viewModel = plannerWithEndpoints()
        val oldPredictions = CompletableDeferred<List<AddressAutocompletePrediction>>()
        val newPredictions = CompletableDeferred<List<AddressAutocompletePrediction>>()
        val provider = object : AddressAutocompleteProvider by NoAddressAutocompleteProvider {
            override val isAvailable = true
            override suspend fun predictions(query: String, target: RouteEndpointTarget) =
                withContext(NonCancellable) {
                    if (query == "Old query") oldPredictions.await() else newPredictions.await()
                }
        }
        viewModel.updateEndpointText(RouteEndpointTarget.Start, "Old query", provider)
        advanceTimeBy(300)
        runCurrent()
        viewModel.updateEndpointText(RouteEndpointTarget.Start, "New query", provider)
        advanceTimeBy(300)
        runCurrent()
        oldPredictions.complete(listOf(prediction()))
        runCurrent()

        assertTrue(viewModel.uiState.value.isResolvingAutocomplete)
        assertEquals(emptyList(), viewModel.uiState.value.autocompleteSuggestions)
        newPredictions.complete(emptyList())
        runCurrent()
        assertFalse(viewModel.uiState.value.isResolvingAutocomplete)
    }

    @Test
    fun changingDestinationDoesNotCancelUnrelatedStartLocationLookup() = runTest(dispatcher) {
        val viewModel = plannerWithEndpoints()
        val location = CompletableDeferred<CurrentLocationAddressResult>()
        viewModel.requestCurrentLocation(RouteEndpointTarget.Start, object : CurrentLocationAddressProvider {
            override fun shouldExplainCurrentLocationAccess() = false
            override suspend fun getCurrentAddress() = location.await()
        })
        runCurrent()
        viewModel.updateEndpointText(RouteEndpointTarget.Destination, "New destination", NoAddressAutocompleteProvider)
        location.complete(CurrentLocationAddressResult.Success("Current start", point()))
        runCurrent()

        assertEquals("Current start", viewModel.uiState.value.endpoints.start)
        assertEquals("New destination", viewModel.uiState.value.endpoints.destination)
    }

    @Test
    fun autocompleteSelectionExceptionBecomesARecoverableError() = runTest(dispatcher) {
        val viewModel = plannerWithEndpoints()
        val provider = object : AddressAutocompleteProvider by NoAddressAutocompleteProvider {
            override suspend fun resolvePrediction(
                prediction: AddressAutocompletePrediction,
                target: RouteEndpointTarget,
            ): AddressAutocompleteSelectionResult = error("Selection failed")
        }
        viewModel.selectAutocompletePrediction(RouteEndpointTarget.Start, prediction(), provider)
        runCurrent()

        assertEquals("Selection failed", viewModel.uiState.value.autocompleteError)
        assertFalse(viewModel.uiState.value.isResolvingAutocomplete)
    }

    @Test
    fun findWaitsForPendingEndpointWorkWithoutCancelingTheRequestedUpdate() = runTest(dispatcher) {
        for (source in listOf("location", "map", "selection", "predictions")) {
            val viewModel = plannerWithEndpoints()
            val gate = CompletableDeferred<Unit>()
            val requestedPoint = MapPoint(latitude = 40.46, longitude = -88.91)
            var trailLoads = 0
            val trailProvider = object : TrailNetworkProvider {
                override suspend fun loadTrailNetwork(): TrailNetworkLoadResult {
                    trailLoads += 1
                    return TrailNetworkLoadResult.Unavailable
                }
            }
            when (source) {
                "location" -> viewModel.requestCurrentLocation(
                    RouteEndpointTarget.Start,
                    object : CurrentLocationAddressProvider {
                        override fun shouldExplainCurrentLocationAccess() = false
                        override suspend fun getCurrentAddress(): CurrentLocationAddressResult {
                            gate.await()
                            return CurrentLocationAddressResult.Success("Requested start", requestedPoint)
                        }
                    },
                )
                "map" -> viewModel.requestMapPoint(
                    RouteEndpointTarget.Start,
                    object : MapPointSelectionProvider {
                        override suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult {
                            gate.await()
                            return MapPointSelectionResult.Success(requestedPoint, "Requested start")
                        }
                    },
                )
                "selection" -> viewModel.selectAutocompletePrediction(
                    RouteEndpointTarget.Start,
                    prediction(),
                    object : AddressAutocompleteProvider by NoAddressAutocompleteProvider {
                        override suspend fun resolvePrediction(
                            prediction: AddressAutocompletePrediction,
                            target: RouteEndpointTarget,
                        ): AddressAutocompleteSelectionResult {
                            gate.await()
                            return AddressAutocompleteSelectionResult.Success("Requested start", requestedPoint)
                        }
                    },
                )
                "predictions" -> viewModel.updateEndpointText(
                    RouteEndpointTarget.Start,
                    "Requested query",
                    object : AddressAutocompleteProvider by NoAddressAutocompleteProvider {
                        override val isAvailable = true
                        override suspend fun predictions(
                            query: String,
                            target: RouteEndpointTarget,
                        ): List<AddressAutocompletePrediction> {
                            gate.await()
                            return listOf(prediction())
                        }
                    },
                )
            }
            advanceTimeBy(300)
            runCurrent()
            assertTrue(viewModel.uiState.value.hasPendingEndpointRequest, source)

            viewModel.findTrailRoute(trailProvider, NoAccessNetworkProvider)
            runCurrent()

            assertEquals(0, trailLoads, source)
            assertTrue(viewModel.uiState.value.hasPendingEndpointRequest, source)
            assertFalse(viewModel.uiState.value.isFindingRoute, source)
            assertNull(viewModel.uiState.value.routeDialog, source)
            gate.complete(Unit)
            runCurrent()
            assertFalse(viewModel.uiState.value.hasPendingEndpointRequest, source)
            if (source == "predictions") {
                assertEquals(listOf(prediction()), viewModel.uiState.value.autocompleteSuggestions)
            } else {
                assertEquals(requestedPoint, viewModel.uiState.value.endpoints.startPoint, source)
                viewModel.findTrailRoute(trailProvider, NoAccessNetworkProvider)
                runCurrent()
                assertEquals(1, trailLoads, source)
            }
        }
    }

    @Test
    fun findPreservesPendingCurrentLocationPrompt() = runTest(dispatcher) {
        val viewModel = plannerWithEndpoints()
        val provider = object : CurrentLocationAddressProvider {
            override fun shouldExplainCurrentLocationAccess() = true
            override suspend fun getCurrentAddress() = CurrentLocationAddressResult.Success("Requested start", point())
        }
        viewModel.requestCurrentLocation(RouteEndpointTarget.Start, provider)
        assertTrue(viewModel.uiState.value.hasPendingEndpointRequest)

        viewModel.findTrailRoute(
            object : TrailNetworkProvider {
                override suspend fun loadTrailNetwork(): TrailNetworkLoadResult = error("Find must wait for the prompt")
            },
            NoAccessNetworkProvider,
        )
        runCurrent()

        assertEquals(RouteEndpointTarget.Start, viewModel.uiState.value.pendingLocationTarget)
        assertNull(viewModel.uiState.value.routeDialog)
        assertFalse(viewModel.uiState.value.isFindingRoute)
        viewModel.confirmCurrentLocation(provider)
        runCurrent()
        assertEquals("Requested start", viewModel.uiState.value.endpoints.start)
        assertFalse(viewModel.uiState.value.hasPendingEndpointRequest)
    }

    private fun TestScope.plannerWithEndpoints(): RoutePlannerViewModel {
        return RoutePlannerViewModel().also { viewModel ->
            viewModel.prepareRoute(savedDestination())
            viewModel.requestMapPoint(RouteEndpointTarget.Start, immediateMapProvider())
            runCurrent()
        }
    }

    private fun immediateMapProvider() = object : MapPointSelectionProvider {
        override suspend fun pickMapPoint(target: RouteEndpointTarget) =
            MapPointSelectionResult.Success(point(), "Picked start")
    }

    private fun immediateLocationProvider() = object : CurrentLocationAddressProvider {
        override fun shouldExplainCurrentLocationAccess() = false
        override suspend fun getCurrentAddress() = CurrentLocationAddressResult.Success("Current start", point())
    }

    private fun point() = MapPoint(latitude = 40.45, longitude = -88.90)

    private fun prediction() = AddressAutocompletePrediction(
        placeId = "place-1",
        primaryText = "Place",
        secondaryText = "Bloomington",
        fullText = "Place, Bloomington",
    )

    private class DeferredTrailProvider : TrailNetworkProvider {
        val result = CompletableDeferred<Result<TrailNetworkLoadResult>>()

        override suspend fun loadTrailNetwork(): TrailNetworkLoadResult =
            withContext(NonCancellable) { result.await().getOrThrow() }
    }

    private fun savedDestination(): SavedDestination {
        return SavedDestination(
            id = "destination-1",
            title = "Home",
            address = "100 Example Street, Bloomington, IL",
            point = MapPoint(latitude = 40.454, longitude = -88.902),
        )
    }
}
