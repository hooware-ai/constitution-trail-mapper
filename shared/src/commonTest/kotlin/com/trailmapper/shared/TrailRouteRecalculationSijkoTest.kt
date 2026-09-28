/**
 * Job: Verify a recalculated route takes the old one's place in Saved or Recent in one write, and Undo restores it exactly.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteReverseSijko
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest

class TrailRouteRecalculationSijkoTest {
    @Test
    fun aSavedRouteKeepsItsNameWithTheRecalculatedRouteInsideAndUndoRestoresIt() = runTest {
        val saved = SavedTrailRoute(id = "route-1", title = "Commute", summary = "", route = stale)
        val savedStore = RouteStore(routes = listOf(saved))
        val recentStore = MemoryRecentStore()

        val applied = TrailRouteRecalculationSijko.apply(savedStore, recentStore, stale, recalculated, "To Library", NOW)

        assertEquals(saved, applied.originalSaved)
        assertEquals(listOf(saved.copy(route = recalculated)), savedStore.routes)
        assertEquals(emptyList(), recentStore.routes)

        TrailRouteRecalculationSijko.undo(savedStore, recentStore, applied, NOW + 1)
        assertEquals(listOf(saved), savedStore.routes)
    }

    @Test
    fun aSavedRouteIsUpdatedEvenWhenTheRecentStoreIsFailing() = runTest {
        val saved = SavedTrailRoute(id = "route-1", title = "Commute", summary = "", route = stale)
        val savedStore = RouteStore(routes = listOf(saved))

        // Saved is the route's only home, so a broken Recent store cannot make its update look failed.
        TrailRouteRecalculationSijko.apply(savedStore, FailingRecentStore(), stale, recalculated, null, NOW)

        assertEquals(listOf(saved.copy(route = recalculated)), savedStore.routes)
    }

    @Test
    fun aFailedRecentWriteLeavesTheHistoryAsItWas() = runTest {
        val entry = RecentTrailRoute(id = "recent-1", title = "To Tipton Park", route = stale, lastUsedEpochMillis = NOW - 60_000)
        val recentStore = MemoryRecentStore(listOf(entry), failWrites = true)

        assertFailsWith<IllegalStateException> {
            TrailRouteRecalculationSijko.apply(RouteStore(), recentStore, stale, recalculated, null, NOW)
        }

        assertEquals(listOf(entry), recentStore.routes)
    }

    @Test
    fun undoAfterReversingASavedLoopRestoresItsStoredDirection() = runTest {
        val loop = loopRoute()
        val saved = SavedTrailRoute(id = "route-1", title = "Saturday loop", summary = "", route = loop)
        val savedStore = RouteStore(routes = listOf(saved))
        val shownReversed = TrailRouteReverseSijko.reversed(loop)
        assertNotEquals(loop, shownReversed)

        val applied = TrailRouteRecalculationSijko.apply(savedStore, MemoryRecentStore(), shownReversed, recalculated, null, NOW)
        TrailRouteRecalculationSijko.undo(savedStore, MemoryRecentStore(), applied, NOW + 1)

        assertEquals(listOf(saved), savedStore.routes)
    }

    @Test
    fun aRecentEntryIsReplacedUnderItsOwnTitleAndUndoRestoresIt() = runTest {
        val entry = RecentTrailRoute(id = "recent-1", title = "To Tipton Park", route = stale, lastUsedEpochMillis = NOW - 60_000)
        val recentStore = MemoryRecentStore(listOf(entry))
        val savedStore = RouteStore()

        val applied = TrailRouteRecalculationSijko.apply(savedStore, recentStore, stale, recalculated, "Ignored title", NOW)

        assertNull(applied.originalSaved)
        assertEquals(entry, applied.originalRecent)
        assertEquals(listOf("To Tipton Park"), recentStore.routes.map { it.title })
        assertEquals(listOf(recalculated), recentStore.routes.map { it.route })
        assertEquals(1, recentStore.writes)

        TrailRouteRecalculationSijko.undo(savedStore, recentStore, applied, NOW + 1)
        assertEquals(listOf(entry), recentStore.routes)
    }

    @Test
    fun undoKeepsAnEntryTheRecalculatedRouteAlreadyHad() = runTest {
        val staleEntry = RecentTrailRoute(id = "recent-a", title = "To Tipton Park", route = stale, lastUsedEpochMillis = NOW - 60_000)
        val safeEntry = RecentTrailRoute(id = "recent-b", title = "Park loop", route = recalculated, lastUsedEpochMillis = NOW - 120_000)
        val recentStore = MemoryRecentStore(listOf(staleEntry, safeEntry))

        val applied = TrailRouteRecalculationSijko.apply(RouteStore(), recentStore, stale, recalculated, null, NOW)

        // One entry per route: the recalculation takes the stale entry's place, and B's own entry makes way.
        assertEquals(listOf("To Tipton Park"), recentStore.routes.map { it.title })
        assertEquals(safeEntry, applied.displacedRecent)

        TrailRouteRecalculationSijko.undo(RouteStore(), recentStore, applied, NOW + 1)
        assertEquals(listOf(staleEntry, safeEntry), recentStore.routes)
    }

    @Test
    fun whenOnlyTheRecalculatedRouteWasRecentItsEntryKeepsItsNameAndUndoRestoresIt() = runTest {
        val safeEntry = RecentTrailRoute(id = "recent-b", title = "Park loop", route = recalculated, lastUsedEpochMillis = NOW - 120_000)
        val recentStore = MemoryRecentStore(listOf(safeEntry))

        val applied = TrailRouteRecalculationSijko.apply(RouteStore(), recentStore, stale, recalculated, "To Library", NOW)

        assertEquals(listOf("recent-b" to "Park loop"), recentStore.routes.map { it.id to it.title })

        TrailRouteRecalculationSijko.undo(RouteStore(), recentStore, applied, NOW + 1)
        assertEquals(listOf(safeEntry), recentStore.routes)
    }

    @Test
    fun anUnsavedRouteWithoutARecentEntryIsRecordedUnderTheGivenTitle() = runTest {
        val recentStore = MemoryRecentStore()

        val applied = TrailRouteRecalculationSijko.apply(RouteStore(), recentStore, stale, recalculated, "To Library", NOW)

        assertNull(applied.originalRecent)
        assertEquals(listOf("To Library"), recentStore.routes.map { it.title })
        assertEquals(listOf(recalculated), recentStore.routes.map { it.route })

        TrailRouteRecalculationSijko.undo(RouteStore(), recentStore, applied, NOW + 1)
        assertEquals(emptyList(), recentStore.routes)
    }

    private class MemoryRecentStore(
        var routes: List<RecentTrailRoute> = emptyList(),
        private val failWrites: Boolean = false,
    ) : RecentTrailRouteStore {
        var writes = 0

        override suspend fun recentRoutes(): List<RecentTrailRoute> = routes

        override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) {
            check(!failWrites) { "Unable to persist recent routes." }
            writes += 1
            this.routes = routes
        }
    }

    private class FailingRecentStore : RecentTrailRouteStore {
        override suspend fun recentRoutes(): List<RecentTrailRoute> = error("Recent routes are unreadable.")

        override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) = error("Unable to persist recent routes.")
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

        fun loopRoute() = TrailRoute(
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(
                        MapPoint(40.5, -88.98),
                        MapPoint(40.505, -88.98),
                        MapPoint(40.505, -88.975),
                        MapPoint(40.5, -88.98),
                    ),
                ),
            ),
            totalDistanceMeters = 1600.0,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1600.0,
            kind = TrailRouteKind.ExerciseLoop,
            requestedDistanceMeters = 1609.344,
        )

        val stale = route(1000.0)
        val recalculated = route(1300.0)
    }
}
