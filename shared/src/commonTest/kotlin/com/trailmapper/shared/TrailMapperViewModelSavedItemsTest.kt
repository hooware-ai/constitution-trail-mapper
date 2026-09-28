/**
 * Job: Verify saved-route and saved-destination persistence operations remain ordered and visible.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.sijko.MapPoint
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
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class TrailMapperViewModelSavedItemsTest {
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
    fun routeRefreshCannotOverwriteQueuedSave() = runTest(dispatcher) {
        val existingRoute = savedRoute(id = "route-1", title = "Saved Route 1")
        val routeStore = RouteStore(routes = listOf(existingRoute))
        val viewModel = viewModel(routeStore = routeStore)
        runCurrent()

        routeStore.loadGate = CompletableDeferred()
        viewModel.refreshSavedRoutes()
        runCurrent()
        viewModel.saveRoute(trailRoute())
        runCurrent()

        routeStore.loadGate?.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf("route-2", "route-1"), viewModel.uiState.value.savedRoutes.map(SavedTrailRoute::id))
        assertEquals("Saved route 2", viewModel.uiState.value.savedRoutes.first().title)
    }

    @Test
    fun exerciseRouteTitlesUseTheirOwnSequence() = runTest(dispatcher) {
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.saveRoute(trailRoute())
        viewModel.saveRoute(trailRoute(kind = TrailRouteKind.ExerciseLoop))
        viewModel.saveRoute(trailRoute(kind = TrailRouteKind.ExerciseLoop))
        advanceUntilIdle()

        assertEquals(
            listOf("Exercise route 2", "Exercise route 1", "Saved route 1"),
            viewModel.uiState.value.savedRoutes.map(SavedTrailRoute::title),
        )
    }

    @Test
    fun destinationRefreshCannotOverwriteQueuedSave() = runTest(dispatcher) {
        val existingDestination = savedDestination(id = "destination-1", title = "Home")
        val destinationStore = DestinationStore(destinations = listOf(existingDestination))
        val viewModel = viewModel(destinationStore = destinationStore)
        runCurrent()

        destinationStore.loadGate = CompletableDeferred()
        viewModel.refreshSavedDestinations()
        runCurrent()
        viewModel.saveDestination(
            address = "900 Example Street",
            point = MapPoint(latitude = 40.49, longitude = -88.99),
            customName = "Work",
        )
        runCurrent()

        destinationStore.loadGate?.complete(Unit)
        advanceUntilIdle()

        assertEquals(
            listOf("destination-2", "destination-1"),
            viewModel.uiState.value.savedDestinations.map(SavedDestination::id),
        )
        assertEquals("Work", viewModel.uiState.value.savedDestinations.first().title)
    }

    @Test
    fun loadFailuresClearLoadingFlagsAndPublishFeedback() = runTest(dispatcher) {
        val routeStore = RouteStore(loadFailure = IllegalStateException("route storage unavailable"))
        val destinationStore = DestinationStore(loadFailure = IllegalStateException("destination storage unavailable"))
        val viewModel = viewModel(
            routeStore = routeStore,
            destinationStore = destinationStore,
        )

        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isLoadingSavedRoutes)
        assertFalse(viewModel.uiState.value.isLoadingSavedDestinations)
        assertEquals("Unable to load saved routes.", viewModel.uiState.value.saveMessage)
        assertEquals("Unable to load saved destinations.", viewModel.uiState.value.destinationMessage)
    }

    @Test
    fun routeMutationFailuresRemainVisible() = runTest(dispatcher) {
        val existingRoute = savedRoute(id = "route-1", title = "Saved Route 1")
        val routeStore = RouteStore(
            routes = listOf(existingRoute),
            saveFailure = IllegalStateException("write failed"),
        )
        val viewModel = viewModel(routeStore = routeStore)
        runCurrent()

        viewModel.saveRoute(trailRoute())
        advanceUntilIdle()
        assertEquals("Unable to save route.", viewModel.uiState.value.saveMessage)
        assertEquals(listOf(existingRoute), viewModel.uiState.value.savedRoutes)

        viewModel.renameSavedRoute(existingRoute.id, "Renamed route")
        advanceUntilIdle()
        assertEquals("Saved route was not found.", viewModel.uiState.value.saveMessage)

        viewModel.deleteSavedRoute(existingRoute.id)
        advanceUntilIdle()
        assertEquals("Saved route was not found.", viewModel.uiState.value.saveMessage)
        assertEquals(listOf(existingRoute), viewModel.uiState.value.savedRoutes)
    }

    @Test
    fun destinationMutationFailuresPreservePendingNavigation() = runTest(dispatcher) {
        val destination = savedDestination(id = "destination-1", title = "Home")
        val destinationStore = DestinationStore(
            destinations = listOf(destination),
            saveFailure = IllegalStateException("write failed"),
        )
        val viewModel = viewModel(destinationStore = destinationStore)
        runCurrent()

        viewModel.saveDestination(
            address = "900 Example Street",
            point = MapPoint(latitude = 40.49, longitude = -88.99),
        )
        advanceUntilIdle()
        assertEquals("Unable to save destination.", viewModel.uiState.value.destinationMessage)

        viewModel.requestNavigateToDestination(
            destination = destination,
            currentLocationAddressProvider = object : CurrentLocationAddressProvider {
                override fun shouldExplainCurrentLocationAccess(): Boolean = true

                override suspend fun getCurrentAddress(): CurrentLocationAddressResult {
                    error("Current location should not be requested before confirmation.")
                }
            },
            trailNetworkProvider = object : TrailNetworkProvider {
                override suspend fun loadTrailNetwork(): TrailNetworkLoadResult {
                    error("Trail data should not be requested before confirmation.")
                }
            },
            accessNetworkProvider = object : AccessNetworkProvider {
                override suspend fun loadAccessNetwork(
                    relevantEndpointPoints: List<MapPoint>,
                ): AccessNetworkLoadResult {
                    error("Access data should not be requested before confirmation.")
                }
            },
            onRouteFound = {},
        )
        assertEquals(destination, viewModel.uiState.value.pendingNavigationDestination)

        viewModel.renameSavedDestination(destination.id, "Renamed destination")
        advanceUntilIdle()
        assertEquals("Saved destination was not found.", viewModel.uiState.value.destinationMessage)
        assertEquals(destination, viewModel.uiState.value.pendingNavigationDestination)

        viewModel.deleteSavedDestination(destination.id)
        advanceUntilIdle()
        assertEquals("Saved destination was not found.", viewModel.uiState.value.destinationMessage)
        assertEquals(destination, viewModel.uiState.value.pendingNavigationDestination)
        assertEquals(listOf(destination), viewModel.uiState.value.savedDestinations)
    }

    @Test
    fun recentRoutesHideSavedOnesAndClearingKeepsSavedRoutes() = runTest(dispatcher) {
        val now = 1_790_000_000_000L
        val savedRoute = savedRoute(id = "route-1", title = "Commute")
        val routeStore = RouteStore(routes = listOf(savedRoute))
        val unsaved = trailRoute().copy(totalDistanceMeters = 4000.0, totalCost = 4000.0)
        val recentStore = object : RecentTrailRouteStore {
            var routes = listOf(
                RecentTrailRoute("recent-1", "To Library", unsaved, now - 60_000),
                RecentTrailRoute("recent-2", "Commute again", savedRoute.route, now - 120_000),
            )

            override suspend fun recentRoutes() = routes

            override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) {
                this.routes = routes
            }
        }
        val viewModel = TrailMapperViewModel(
            savedTrailRouteStore = routeStore,
            savedDestinationStore = DestinationStore(),
            trailAccountProvider = NoTrailAccountProvider,
            recentTrailRouteStore = recentStore,
            nowEpochMillis = { now },
        )
        advanceUntilIdle()

        assertEquals(listOf("recent-1"), viewModel.uiState.value.recentRoutes.map { it.id })
        assertEquals(listOf(savedRoute), viewModel.uiState.value.savedRoutes)

        viewModel.clearRecentRoutes()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.recentRoutes.isEmpty())
        assertTrue(recentStore.routes.isEmpty())
        assertEquals(listOf(savedRoute), viewModel.uiState.value.savedRoutes)
    }

    @Test
    fun anUndoLeftOverFromBeforeClearDoesNotBringTheEntryBack() = runTest(dispatcher) {
        val now = 1_790_000_000_000L
        val entry = RecentTrailRoute("recent-1", "To Library", trailRoute().copy(totalDistanceMeters = 4000.0), now - 60_000)
        val recentStore = object : RecentTrailRouteStore {
            var routes = listOf(entry)

            override suspend fun recentRoutes() = routes

            override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) {
                this.routes = routes
            }
        }
        val viewModel = TrailMapperViewModel(
            savedTrailRouteStore = RouteStore(),
            savedDestinationStore = DestinationStore(),
            trailAccountProvider = NoTrailAccountProvider,
            recentTrailRouteStore = recentStore,
            nowEpochMillis = { now },
        )
        advanceUntilIdle()

        viewModel.removeRecentRoute(entry)
        advanceUntilIdle()
        viewModel.clearRecentRoutes()
        advanceUntilIdle()
        viewModel.restoreRecentRoute(entry)
        advanceUntilIdle()

        assertTrue(recentStore.routes.isEmpty())
        assertTrue(viewModel.uiState.value.recentRoutes.isEmpty())
    }

    @Test
    fun undoRestoresARemovedEntryOnce() = runTest(dispatcher) {
        val now = 1_790_000_000_000L
        val entry = RecentTrailRoute("recent-1", "To Library", trailRoute().copy(totalDistanceMeters = 4000.0), now - 60_000)
        val recentStore = object : RecentTrailRouteStore {
            var routes = listOf(entry)

            override suspend fun recentRoutes() = routes

            override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) {
                this.routes = routes
            }
        }
        val viewModel = TrailMapperViewModel(
            savedTrailRouteStore = RouteStore(),
            savedDestinationStore = DestinationStore(),
            trailAccountProvider = NoTrailAccountProvider,
            recentTrailRouteStore = recentStore,
            nowEpochMillis = { now },
        )
        advanceUntilIdle()

        viewModel.removeRecentRoute(entry)
        advanceUntilIdle()
        viewModel.restoreRecentRoute(entry)
        viewModel.restoreRecentRoute(entry)
        advanceUntilIdle()

        assertEquals(listOf(entry), recentStore.routes)
        assertEquals(listOf("recent-1"), viewModel.uiState.value.recentRoutes.map { it.id })
    }

    private fun viewModel(
        routeStore: RouteStore = RouteStore(),
        destinationStore: DestinationStore = DestinationStore(),
    ): TrailMapperViewModel {
        return TrailMapperViewModel(
            savedTrailRouteStore = routeStore,
            savedDestinationStore = destinationStore,
            trailAccountProvider = NoTrailAccountProvider,
        )
    }

    private fun savedRoute(
        id: String,
        title: String,
    ): SavedTrailRoute {
        return SavedTrailRoute(
            id = id,
            title = title,
            summary = "1.0 mi trail route",
            route = trailRoute(),
        )
    }

    private fun savedDestination(
        id: String,
        title: String,
    ): SavedDestination {
        return SavedDestination(
            id = id,
            title = title,
            address = "100 Example Street, Bloomington, IL",
            point = MapPoint(latitude = 40.454, longitude = -88.902),
        )
    }

    private fun trailRoute(
        kind: TrailRouteKind = TrailRouteKind.Navigation,
    ): TrailRoute {
        return TrailRoute(
            edges = emptyList(),
            totalDistanceMeters = 1609.34,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1609.34,
            kind = kind,
        )
    }

}
