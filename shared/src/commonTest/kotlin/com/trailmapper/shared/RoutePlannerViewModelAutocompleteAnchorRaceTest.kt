/**
 * Job: Verify Destination suggestions never outlive the Start they were measured from, and chosen destinations survive.
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
class RoutePlannerViewModelAutocompleteAnchorRaceTest {
    private val dispatcher = StandardTestDispatcher()
    private val pointA = MapPoint(40.5, -89.0)
    private val pointB = MapPoint(40.5, -88.9)
    private val fromA = AddressAutocompletePrediction("from-A", "Coffee", "Branch A", "Coffee A", 100)
    private val fromB = AddressAutocompletePrediction("from-B", "Coffee", "Branch B", "Coffee B", 100)

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun aResultStillInFlightForTheOldStartIsRejectedAndTheNewStartIsSearched() = runTest(dispatcher) {
        val fixture = fixtureWithDestinationSearchAnchoredAtA()

        fixture.location.complete(CurrentLocationAddressResult.Success("Start B", pointB))
        runCurrent()
        fixture.aPredictions.complete(listOf(fromA))
        advanceTimeBy(400)
        runCurrent()

        assertEquals(pointB, fixture.viewModel.uiState.value.endpoints.startPoint)
        assertEquals(listOf<MapPoint?>(pointA, pointB), fixture.origins)
        assertEquals(listOf(fromB), fixture.viewModel.uiState.value.autocompleteSuggestions)
        assertEquals(pointB, fixture.viewModel.uiState.value.autocompleteAnchor)
        assertFalse(fixture.viewModel.uiState.value.isResolvingAutocomplete)
    }

    @Test
    fun suggestionsAlreadyShownForTheOldStartAreReplacedWhenStartChanges() = runTest(dispatcher) {
        val fixture = fixtureWithDestinationSearchAnchoredAtA()
        fixture.aPredictions.complete(listOf(fromA))
        runCurrent()
        assertEquals(listOf(fromA), fixture.viewModel.uiState.value.autocompleteSuggestions)

        fixture.location.complete(CurrentLocationAddressResult.Success("Start B", pointB))
        runCurrent()
        assertEquals(emptyList(), fixture.viewModel.uiState.value.autocompleteSuggestions)
        advanceTimeBy(400)
        runCurrent()

        assertEquals(listOf<MapPoint?>(pointA, pointB), fixture.origins)
        assertEquals(listOf(fromB), fixture.viewModel.uiState.value.autocompleteSuggestions)
    }

    @Test
    fun aDestinationTheRiderAlreadyChoseIsKeptWhenStartChanges() = runTest(dispatcher) {
        val fixture = fixtureWithDestinationSearchAnchoredAtA()
        val chosen = MapPoint(40.4, -88.8)
        fixture.destinationSelection = AddressAutocompleteSelectionResult.Success("Coffee A", chosen)
        fixture.aPredictions.complete(listOf(fromA))
        runCurrent()
        fixture.viewModel.selectAutocompletePrediction(RouteEndpointTarget.Destination, fromA, fixture.provider)
        runCurrent()

        fixture.location.complete(CurrentLocationAddressResult.Success("Start B", pointB))
        advanceTimeBy(400)
        runCurrent()

        val state = fixture.viewModel.uiState.value
        assertEquals("Coffee A", state.endpoints.destination)
        assertEquals(chosen, state.endpoints.destinationPoint)
        assertEquals(emptyList(), state.autocompleteSuggestions)
        assertEquals(listOf<MapPoint?>(pointA), fixture.origins)
    }

    @Test
    fun startChangesWithNoDestinationSearchDoNothing() = runTest(dispatcher) {
        val fixture = Fixture()
        fixture.provider.let { provider ->
            fixture.viewModel.selectAutocompletePrediction(RouteEndpointTarget.Start, startPrediction(), provider)
        }
        runCurrent()

        assertEquals(emptyList(), fixture.origins)
        assertEquals(emptyList(), fixture.viewModel.uiState.value.autocompleteSuggestions)
    }

    private fun TestScope.fixtureWithDestinationSearchAnchoredAtA(): Fixture {
        val fixture = Fixture()
        fixture.viewModel.selectAutocompletePrediction(RouteEndpointTarget.Start, startPrediction(), fixture.provider)
        runCurrent()
        fixture.viewModel.requestCurrentLocation(
            RouteEndpointTarget.Start,
            object : CurrentLocationAddressProvider {
                override fun shouldExplainCurrentLocationAccess() = false

                override suspend fun getCurrentAddress() = fixture.location.await()
            },
        )
        runCurrent()
        fixture.viewModel.updateEndpointText(RouteEndpointTarget.Destination, "Coffee", fixture.provider)
        advanceTimeBy(400)
        runCurrent()
        assertEquals(listOf<MapPoint?>(pointA), fixture.origins)
        return fixture
    }

    private fun startPrediction() = AddressAutocompletePrediction("start", "Start A", "", "Start A")

    private inner class Fixture {
        val viewModel = RoutePlannerViewModel()
        val location = CompletableDeferred<CurrentLocationAddressResult>()
        val aPredictions = CompletableDeferred<List<AddressAutocompletePrediction>>()
        val origins = mutableListOf<MapPoint?>()
        var destinationSelection: AddressAutocompleteSelectionResult = AddressAutocompleteSelectionResult.Success("Start A", pointA)

        val provider = object : AddressAutocompleteProvider {
            override val isAvailable = true

            override suspend fun predictions(
                query: String,
                target: RouteEndpointTarget,
                proximity: MapPoint?,
            ): List<AddressAutocompletePrediction> {
                origins += proximity
                return if (proximity == pointA) aPredictions.await() else listOf(fromB)
            }

            override suspend fun resolvePrediction(
                prediction: AddressAutocompletePrediction,
                target: RouteEndpointTarget,
            ): AddressAutocompleteSelectionResult =
                if (target == RouteEndpointTarget.Start) {
                    AddressAutocompleteSelectionResult.Success("Start A", pointA)
                } else {
                    destinationSelection
                }
        }
    }
}
