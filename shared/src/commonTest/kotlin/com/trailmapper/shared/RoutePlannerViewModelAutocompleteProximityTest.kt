/**
 * Job: Verify Destination autocomplete is measured from a resolved Start and falls back when Start is only typed.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class RoutePlannerViewModelAutocompleteProximityTest {
    private val dispatcher = StandardTestDispatcher()
    private val hersheyStart = MapPoint(latitude = 40.505, longitude = -88.945)
    private val westSideStart = MapPoint(latitude = 40.470, longitude = -89.050)

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun destinationSearchIsMeasuredFromTheResolvedStartAndNearestBranchIsFirst() = runTest(dispatcher) {
        val provider = FakeProvider()
        val viewModel = RoutePlannerViewModel()
        selectStart(viewModel, provider, hersheyStart)

        search(viewModel, provider, RouteEndpointTarget.Destination, "Culver's")

        assertEquals(listOf<MapPoint?>(hersheyStart), provider.proximities)
        assertEquals(
            listOf("hershey", "west"),
            viewModel.uiState.value.autocompleteSuggestions.map(AddressAutocompletePrediction::placeId),
        )
    }

    @Test
    fun aTypedButUnresolvedStartGivesNoAnchor() = runTest(dispatcher) {
        val provider = FakeProvider()
        val viewModel = RoutePlannerViewModel()
        selectStart(viewModel, provider, hersheyStart)
        viewModel.updateEndpointText(RouteEndpointTarget.Start, "Hershey", NoAddressAutocompleteProvider)

        search(viewModel, provider, RouteEndpointTarget.Destination, "Culver's")

        assertEquals(listOf<MapPoint?>(null), provider.proximities)
    }

    @Test
    fun startSearchesUseTheLocalFallbackAndNoStartMeansNoAnchor() = runTest(dispatcher) {
        val provider = FakeProvider()
        val viewModel = RoutePlannerViewModel()

        search(viewModel, provider, RouteEndpointTarget.Start, "Culver's")
        search(viewModel, provider, RouteEndpointTarget.Destination, "Culver's")

        assertEquals(listOf<MapPoint?>(null, null), provider.proximities)
    }

    @Test
    fun changingStartChangesTheReferenceForTheNextDestinationSearch() = runTest(dispatcher) {
        val provider = FakeProvider()
        val viewModel = RoutePlannerViewModel()
        selectStart(viewModel, provider, hersheyStart)
        search(viewModel, provider, RouteEndpointTarget.Destination, "Culver's")

        selectStart(viewModel, provider, westSideStart)
        search(viewModel, provider, RouteEndpointTarget.Destination, "Culver's")

        assertEquals(listOf<MapPoint?>(hersheyStart, westSideStart), provider.proximities)
    }

    private fun kotlinx.coroutines.test.TestScope.selectStart(
        viewModel: RoutePlannerViewModel,
        provider: FakeProvider,
        point: MapPoint,
    ) {
        provider.selectionPoint = point
        viewModel.selectAutocompletePrediction(
            target = RouteEndpointTarget.Start,
            prediction = AddressAutocompletePrediction("start", "Start", "", "Start"),
            provider = provider,
        )
        runCurrent()
        assertEquals(point, viewModel.uiState.value.endpoints.startPoint)
    }

    private fun kotlinx.coroutines.test.TestScope.search(
        viewModel: RoutePlannerViewModel,
        provider: FakeProvider,
        target: RouteEndpointTarget,
        query: String,
    ) {
        viewModel.updateEndpointText(target, query, provider)
        advanceTimeBy(400)
        runCurrent()
        assertNull(viewModel.uiState.value.autocompleteError)
    }

    private class FakeProvider : AddressAutocompleteProvider {
        override val isAvailable: Boolean = true
        val proximities = mutableListOf<MapPoint?>()
        var selectionPoint: MapPoint? = null

        // The far branch comes back first, as the provider ranks it; distances are from the given anchor.
        override suspend fun predictions(
            query: String,
            target: RouteEndpointTarget,
            proximity: MapPoint?,
        ): List<AddressAutocompletePrediction> {
            proximities += proximity
            return listOf(
                AddressAutocompletePrediction("west", "Culver's", "Rte 9, Bloomington", "Culver's", distanceMeters = 14_000),
                AddressAutocompletePrediction("hershey", "Culver's", "Hershey Rd, Bloomington", "Culver's", distanceMeters = 1_200),
            )
        }

        override suspend fun resolvePrediction(
            prediction: AddressAutocompletePrediction,
            target: RouteEndpointTarget,
        ): AddressAutocompleteSelectionResult {
            return AddressAutocompleteSelectionResult.Success(prediction.fullText, checkNotNull(selectionPoint))
        }
    }
}
