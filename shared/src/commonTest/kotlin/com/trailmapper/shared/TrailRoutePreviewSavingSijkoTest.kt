/**
 * Job: Verify a route saved from its preview is named like any other saved route, and a place saves cleanly.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class TrailRoutePreviewSavingSijkoTest {
    @Test
    fun defaultTitlesCountOnlySavedRoutesOfTheSameKind() {
        val saved = listOf(
            savedRoute("a", TrailRouteKind.Navigation),
            savedRoute("b", TrailRouteKind.ExerciseLoop),
            savedRoute("c", TrailRouteKind.ExerciseLoop),
        )

        assertEquals("Saved route 2", TrailRoutePreviewSavingSijko.defaultTitleFor(route(TrailRouteKind.Navigation), saved))
        assertEquals("Exercise route 3", TrailRoutePreviewSavingSijko.defaultTitleFor(route(TrailRouteKind.ExerciseLoop), saved))
    }

    @Test
    fun savingReadsTheStoreSoTheTitleFollowsWhatIsAlreadySaved() = runTest {
        val store = RouteStore(routes = listOf(savedRoute("a", TrailRouteKind.ExerciseLoop)))

        val saved = TrailRoutePreviewSavingSijko.saveRoute(store, route(TrailRouteKind.ExerciseLoop))

        assertEquals("Exercise route 2", saved.title)
        assertEquals(saved, store.routes.first())
    }

    @Test
    fun renamingTrimsTheNameAndIgnoresABlankOne() = runTest {
        val store = RenamingStore()

        assertNull(TrailRoutePreviewSavingSijko.renameRoute(store, "route-1", "   "))
        assertTrue(store.renames.isEmpty())

        val renamed = TrailRoutePreviewSavingSijko.renameRoute(store, "route-1", "  Library run ")
        assertEquals("Library run", renamed?.title)
        assertEquals(listOf("route-1" to "Library run"), store.renames)
    }

    @Test
    fun aDestinationSavesUnderItsAddressOrItsPointWhenTheAddressIsBlank() = runTest {
        val store = DestinationStore()
        val point = MapPoint(latitude = 40.5105, longitude = -88.9819)

        val named = TrailRoutePreviewSavingSijko.saveDestination(
            store,
            TrailRoutePreviewDestination(address = "Normal Public Library, Normal, IL", point = point),
        )
        assertEquals("Normal Public Library", named.title)
        assertEquals("Normal Public Library, Normal, IL", named.address)
        assertEquals(point, named.point)

        val unnamed = TrailRoutePreviewSavingSijko.saveDestination(
            store,
            TrailRoutePreviewDestination(address = " ", point = point),
        )
        assertTrue(unnamed.address.isNotBlank())
    }

    private class RenamingStore : SavedTrailRouteStore {
        val renames = mutableListOf<Pair<String, String>>()

        override suspend fun savedRoutes(): List<SavedTrailRoute> = emptyList()

        override suspend fun saveRoute(route: TrailRoute, title: String): SavedTrailRoute = error("Not used")

        override suspend fun renameRoute(id: String, title: String): SavedTrailRoute {
            renames += id to title
            return SavedTrailRoute(id = id, title = title, summary = "", route = route(TrailRouteKind.Navigation))
        }

        override suspend fun deleteRoute(id: String): Boolean = false
    }

    private companion object {
        fun route(kind: TrailRouteKind) = TrailRoute(
            edges = emptyList(),
            totalDistanceMeters = 1609.34,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1609.34,
            kind = kind,
        )

        fun savedRoute(id: String, kind: TrailRouteKind) = SavedTrailRoute(
            id = id,
            title = id,
            summary = "",
            route = route(kind),
        )
    }
}
