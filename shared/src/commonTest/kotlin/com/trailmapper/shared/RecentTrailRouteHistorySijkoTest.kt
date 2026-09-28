/**
 * Job: Verify the recent-route history keeps one entry per route, stays small and fresh, and never holds a saved route.
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
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class RecentTrailRouteHistorySijkoTest {
    @Test
    fun replanningARouteEitherWayMovesItsEntryUpInsteadOfAddingOne() {
        var ids = 0
        val newId = { "recent-${++ids}" }
        val library = route(1.0)
        val tipton = route(2.0)
        var entries = RecentTrailRouteHistorySijko.recorded(emptyList(), library, "To Library", emptyList(), NOW, newId)
        entries = RecentTrailRouteHistorySijko.recorded(entries, tipton, "To Tipton Park", emptyList(), NOW + 1, newId)

        val reversed = TrailRouteReverseSijko.reversed(library)
        assertNotEquals(library, reversed)
        entries = RecentTrailRouteHistorySijko.recorded(entries, reversed, null, emptyList(), NOW + 2, newId)

        assertEquals(listOf("To Library", "To Tipton Park"), entries.map { it.title })
        assertEquals("recent-1", entries.first().id)
        assertEquals(NOW + 2, entries.first().lastUsedEpochMillis)
    }

    @Test
    fun theHistoryKeepsTheTwentyNewestEntries() {
        var entries = emptyList<RecentTrailRoute>()
        repeat(25) { index ->
            entries = RecentTrailRouteHistorySijko.recorded(entries, route(index + 1.0), null, emptyList(), NOW + index)
        }

        assertEquals(RecentTrailRouteHistorySijko.MAXIMUM_ENTRIES, entries.size)
        assertEquals(NOW + 24, entries.first().lastUsedEpochMillis)
        assertEquals(NOW + 5, entries.last().lastUsedEpochMillis)
    }

    @Test
    fun entriesExpireThirtyDaysAfterTheirLastUse() {
        val old = entry("old", route(1.0), NOW - RecentTrailRouteHistorySijko.RETENTION_MILLIS - 1)
        val fresh = entry("fresh", route(2.0), NOW - RecentTrailRouteHistorySijko.RETENTION_MILLIS)

        assertEquals(listOf(fresh), RecentTrailRouteHistorySijko.visible(listOf(old, fresh), emptyList(), NOW))
    }

    @Test
    fun aSavedRouteIsNeverRecent() {
        val saved = SavedTrailRoute(id = "route-1", title = "Commute", summary = "", route = route(1.0))
        val entries = RecentTrailRouteHistorySijko.recorded(
            listOf(entry("recent-1", route(1.0), NOW - 10)),
            route(1.0),
            "To Library",
            listOf(saved),
            NOW,
        )

        assertTrue(entries.isEmpty())
    }

    @Test
    fun loadingDropsExpiredAndSavedEntriesFromStorageToo() = runTest {
        val store = MemoryRecentStore(
            mutableListOf(
                entry("expired", route(1.0), NOW - RecentTrailRouteHistorySijko.RETENTION_MILLIS - 1),
                entry("saved", route(2.0), NOW - 10),
                entry("kept", route(3.0), NOW - 20),
            ),
        )
        val savedStore = RouteStore(routes = listOf(SavedTrailRoute("route-1", "Saved", "", route(2.0))))

        val loaded = RecentTrailRouteHistorySijko.load(store, savedStore, NOW)

        assertEquals(listOf("kept"), loaded.map { it.id })
        assertEquals(listOf("kept"), store.routes.map { it.id })
    }

    @Test
    fun savingForgetsTheRouteAndClearingLeavesSavedRoutesAlone() = runTest {
        val store = MemoryRecentStore(mutableListOf(entry("a", route(1.0), NOW), entry("b", route(2.0), NOW - 1)))
        val savedStore = RouteStore(routes = listOf(SavedTrailRoute("route-1", "Saved", "", route(9.0))))

        RecentTrailRouteHistorySijko.forget(store, route(1.0))
        assertEquals(listOf("b"), store.routes.map { it.id })

        RecentTrailRouteHistorySijko.clear(store)
        assertTrue(store.routes.isEmpty())
        assertEquals(1, savedStore.routes.size)
    }

    @Test
    fun aRemovedEntryCanBeRestored() = runTest {
        val kept = entry("a", route(1.0), NOW)
        val removed = entry("b", route(2.0), NOW - 1)
        val store = MemoryRecentStore(mutableListOf(kept, removed))

        assertEquals(removed, RecentTrailRouteHistorySijko.remove(store, "b"))
        assertEquals(listOf(kept), store.routes)

        RecentTrailRouteHistorySijko.restore(store, RouteStore(), removed, NOW)
        assertEquals(listOf(kept, removed), store.routes)
    }

    @Test
    fun titlesAndDetailsDescribeTheRoute() {
        val loop = route(3.0).copy(kind = TrailRouteKind.ExerciseLoop)
        assertEquals("3.0 mi loop", RecentTrailRouteHistorySijko.titleFor(loop, "ignored"))
        assertEquals("To Normal Public Library", RecentTrailRouteHistorySijko.titleFor(route(2.5), "Normal Public Library, Normal, IL"))
        assertEquals("2.5 mi trail route", RecentTrailRouteHistorySijko.titleFor(route(2.5), null))

        val used = entry("a", route(2.5), NOW)
        assertEquals("2.5 mi · Just now", RecentTrailRouteHistorySijko.detailFor(used, NOW + 30_000))
        assertEquals("2.5 mi · 5 min ago", RecentTrailRouteHistorySijko.detailFor(used, NOW + 5 * 60_000))
        assertEquals("2.5 mi · 3 hr ago", RecentTrailRouteHistorySijko.detailFor(used, NOW + 3 * 3_600_000))
        assertEquals("2.5 mi · 1 day ago", RecentTrailRouteHistorySijko.detailFor(used, NOW + 30 * 3_600_000))
        assertEquals("2.5 mi · 4 days ago", RecentTrailRouteHistorySijko.detailFor(used, NOW + 4 * 86_400_000L))
    }

    private class MemoryRecentStore(
        var routes: MutableList<RecentTrailRoute> = mutableListOf(),
    ) : RecentTrailRouteStore {
        override suspend fun recentRoutes(): List<RecentTrailRoute> = routes.toList()

        override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) {
            this.routes = routes.toMutableList()
        }
    }

    private companion object {
        const val NOW = 1_790_000_000_000L

        /** A two-point route [miles] long, so each distance is a different route and reversal changes it. */
        fun route(miles: Double) = TrailRoute(
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(MapPoint(40.5, -88.98), MapPoint(40.5 + miles / 69.0, -88.98)),
                ),
            ),
            totalDistanceMeters = miles * 1609.344,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = miles * 1609.344,
        )

        fun entry(id: String, route: TrailRoute, lastUsed: Long) =
            RecentTrailRoute(id = id, title = id, route = route, lastUsedEpochMillis = lastUsed)
    }
}
