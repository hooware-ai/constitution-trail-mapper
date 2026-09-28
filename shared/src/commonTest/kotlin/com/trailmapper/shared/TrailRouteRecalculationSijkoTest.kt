/**
 * Job: Verify a recalculated route takes the old one's place in Saved and Recent, names kept, and Undo puts it back.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest

class TrailRouteRecalculationSijkoTest {
    @Test
    fun aSavedRouteKeepsItsNameWithTheRecalculatedRouteInsideAndUndoRestoresIt() = runTest {
        val saved = SavedTrailRoute(id = "route-1", title = "Commute", summary = "", route = stale)
        val savedStore = RouteStore(routes = listOf(saved))
        val recentStore = MemoryRecentStore()

        val applied = TrailRouteRecalculationSijko.apply(savedStore, recentStore, stale, recalculated, "To Library", NOW)

        assertEquals("route-1", applied.savedRouteId)
        assertEquals(listOf(saved.copy(route = recalculated)), savedStore.routes)
        // A saved route stays out of Recent.
        assertEquals(emptyList(), recentStore.routes)

        TrailRouteRecalculationSijko.undo(savedStore, recentStore, applied, NOW + 1)
        assertEquals(listOf(saved), savedStore.routes)
    }

    @Test
    fun aRecentEntryIsReplacedUnderItsOwnTitleAndUndoRestoresIt() = runTest {
        val entry = RecentTrailRoute(id = "recent-1", title = "To Tipton Park", route = stale, lastUsedEpochMillis = NOW - 60_000)
        val recentStore = MemoryRecentStore(listOf(entry))
        val savedStore = RouteStore()

        val applied = TrailRouteRecalculationSijko.apply(savedStore, recentStore, stale, recalculated, "Ignored title", NOW)

        assertNull(applied.savedRouteId)
        assertEquals(entry, applied.replacedRecent)
        assertEquals(listOf("To Tipton Park"), recentStore.routes.map { it.title })
        assertEquals(listOf(recalculated), recentStore.routes.map { it.route })

        TrailRouteRecalculationSijko.undo(savedStore, recentStore, applied, NOW + 1)
        assertEquals(listOf(entry), recentStore.routes)
    }

    @Test
    fun anUnsavedRouteWithoutARecentEntryIsRecordedUnderTheGivenTitle() = runTest {
        val recentStore = MemoryRecentStore()

        val applied = TrailRouteRecalculationSijko.apply(RouteStore(), recentStore, stale, recalculated, "To Library", NOW)

        assertNull(applied.replacedRecent)
        assertEquals(listOf("To Library"), recentStore.routes.map { it.title })
        assertEquals(listOf(recalculated), recentStore.routes.map { it.route })
    }

    private class MemoryRecentStore(
        var routes: List<RecentTrailRoute> = emptyList(),
    ) : RecentTrailRouteStore {
        override suspend fun recentRoutes(): List<RecentTrailRoute> = routes

        override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) {
            this.routes = routes
        }
    }

    private companion object {
        const val NOW = 1_790_000_000_000L

        fun route(northMeters: Double) = TrailRoute(
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(MapPoint(40.5, -88.98), MapPoint(40.5 + northMeters / 111_195.0, -88.98)),
                ),
            ),
            totalDistanceMeters = northMeters,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = northMeters,
        )

        val stale = route(1000.0)
        val recalculated = route(1300.0)
    }
}
