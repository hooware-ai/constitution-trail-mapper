/**
 * Job: Verify a route preview saves what is on screen, once, and never before it knows whether it is saved.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

@OptIn(ExperimentalCoroutinesApi::class)
class TrailRoutePreviewSaveControllerTest {
    @Test
    fun saveWaitsForTheSavedStateLookup() = runTest {
        val store = RouteStore()
        val gate = CompletableDeferred<Unit>()
        store.loadGate = gate
        val controller = TrailRoutePreviewSaveController(store, DestinationStore(), backgroundScope)

        controller.show(planned)
        runCurrent()
        assertFalse(controller.state.value.canSaveRoute)
        assertIs<TrailRoutePreviewSaveOutcome.Ignored>(controller.saveShownRoute())
        assertTrue(store.routes.isEmpty())

        gate.complete(Unit)
        runCurrent()
        assertTrue(controller.state.value.canSaveRoute)
    }

    @Test
    fun rapidRepeatSavesStoreTheRouteOnce() = runTest {
        val store = RouteStore()
        val controller = TrailRoutePreviewSaveController(store, DestinationStore(), backgroundScope)
        controller.show(planned)
        runCurrent()

        val first = async { controller.saveShownRoute() }
        val second = async { controller.saveShownRoute() }
        val outcomes = listOf(first.await(), second.await())

        assertEquals(1, store.routes.size)
        assertEquals(1, outcomes.count { it is TrailRoutePreviewSaveOutcome.Done })
        assertEquals(1, outcomes.count { it is TrailRoutePreviewSaveOutcome.Ignored })
        assertFalse(controller.state.value.canSaveRoute)
        assertEquals(store.routes.single(), controller.state.value.savedRoute)
    }

    @Test
    fun aRouteAlreadySavedEitherWayRoundCannotBeSavedAgain() = runTest {
        val existing = SavedTrailRoute(id = "route-1", title = "Commute", summary = "", route = planned)
        val store = RouteStore(routes = listOf(existing))
        val controller = TrailRoutePreviewSaveController(store, DestinationStore(), backgroundScope)

        controller.show(planned)
        runCurrent()

        assertEquals(existing, controller.state.value.savedRoute)
        assertIs<TrailRoutePreviewSaveOutcome.Ignored>(controller.saveShownRoute())
        // Even a direct save of the same route finds the existing entry instead of adding one.
        val direct = TrailRoutePreviewSavingSijko.saveRoute(store, planned)
        assertFalse(direct.isNew)
        assertEquals(listOf(existing), store.routes)
    }

    @Test
    fun afterARerouteAndStopSaveStoresTheReplacementOnScreen() = runTest {
        val store = RouteStore()
        val controller = TrailRoutePreviewSaveController(store, DestinationStore(), backgroundScope)
        controller.show(planned)
        runCurrent()

        // Navigation adopts a replacement; Stop leaves it on screen, so the preview now shows it.
        controller.show(replacement)
        runCurrent()
        assertNull(controller.state.value.savedRoute)
        val outcome = assertIs<TrailRoutePreviewSaveOutcome.Done<SavedTrailRoute>>(controller.saveShownRoute())

        assertEquals(replacement, outcome.item.route)
        assertEquals(listOf(replacement), store.routes.map { it.route })
    }

    @Test
    fun switchingRoutesReportsEachRoutesOwnSavedState() = runTest {
        val store = RouteStore()
        val controller = TrailRoutePreviewSaveController(store, DestinationStore(), backgroundScope)
        controller.show(planned)
        runCurrent()
        controller.saveShownRoute()

        controller.show(replacement)
        runCurrent()
        assertNull(controller.state.value.savedRoute)
        assertTrue(controller.state.value.canSaveRoute)

        controller.show(planned)
        runCurrent()
        assertEquals(planned, controller.state.value.savedRoute?.route)
        assertFalse(controller.state.value.canSaveRoute)
    }

    @Test
    fun aDestinationSavesOnceAndNotBeforeItsLookup() = runTest {
        val destinations = DestinationStore()
        val gate = CompletableDeferred<Unit>()
        destinations.loadGate = gate
        val controller = TrailRoutePreviewSaveController(RouteStore(), destinations, backgroundScope)

        controller.offerDestination(TrailRoutePreviewDestination("Normal Public Library, Normal, IL", libraryPoint))
        runCurrent()
        assertFalse(controller.state.value.canSaveDestination)
        assertIs<TrailRoutePreviewSaveOutcome.Ignored>(controller.saveDestination())

        gate.complete(Unit)
        runCurrent()
        val first = async { controller.saveDestination() }
        val second = async { controller.saveDestination() }
        listOf(first.await(), second.await())

        assertEquals(1, destinations.destinations.size)
        assertFalse(controller.state.value.canSaveDestination)
    }

    @Test
    fun aPlaceAlreadySavedIsRecognizedOnOpen() = runTest {
        val existing = SavedDestination(id = "destination-1", title = "Library", address = "Library", point = libraryPoint)
        val destinations = DestinationStore(destinations = listOf(existing))
        val controller = TrailRoutePreviewSaveController(RouteStore(), destinations, backgroundScope)

        controller.offerDestination(TrailRoutePreviewDestination("Normal Public Library", libraryPoint))
        runCurrent()

        assertEquals(existing, controller.state.value.savedDestination)
        assertIs<TrailRoutePreviewSaveOutcome.Ignored>(controller.saveDestination())
        assertEquals(listOf(existing), destinations.destinations)
    }

    private companion object {
        val planned = TrailRoute(
            edges = emptyList(),
            totalDistanceMeters = 1609.34,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1609.34,
            kind = TrailRouteKind.Navigation,
        )
        val replacement = planned.copy(totalDistanceMeters = 2012.0, totalCost = 2012.0)
        val libraryPoint = MapPoint(latitude = 40.5105, longitude = -88.9819)
    }
}
