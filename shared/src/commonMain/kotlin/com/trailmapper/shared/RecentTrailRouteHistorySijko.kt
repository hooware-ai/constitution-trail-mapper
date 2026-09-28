/**
 * Job: Keep a small on-device history of routes the rider planned but did not save, one entry per route.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteIdentitySijko
import com.trailmapper.shared.routing.TrailRouteKind
import kotlin.math.roundToInt
import kotlin.random.Random
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object RecentTrailRouteHistorySijko {
    const val MAXIMUM_ENTRIES = 20
    const val RETENTION_MILLIS = 30L * 24 * 60 * 60 * 1000

    private const val METERS_PER_MILE = 1609.344
    private const val MINUTE_MILLIS = 60_000L
    private const val HOUR_MILLIS = 60 * MINUTE_MILLIS
    private const val DAY_MILLIS = 24 * HOUR_MILLIS

    // Load, change and write back one operation at a time so concurrent screens do not drop entries.
    private val historyMutex = Mutex()

    /**
     * The entries to show: used within the retention window, newest first, capped, and never a route
     * that is saved, since Saved is its home.
     */
    fun visible(
        entries: List<RecentTrailRoute>,
        savedRoutes: List<SavedTrailRoute>,
        nowEpochMillis: Long,
    ): List<RecentTrailRoute> {
        return entries
            .filter { entry -> nowEpochMillis - entry.lastUsedEpochMillis <= RETENTION_MILLIS }
            .filter { entry -> savedRoutes.none { saved -> TrailRouteIdentitySijko.isSameRoute(saved.route, entry.route) } }
            .sortedByDescending { entry -> entry.lastUsedEpochMillis }
            .take(MAXIMUM_ENTRIES)
    }

    /**
     * Moves [route] to the top, reusing its entry if it is already recent. A saved route is not
     * recorded. [title] replaces the entry's title only when given.
     */
    fun recorded(
        entries: List<RecentTrailRoute>,
        route: TrailRoute,
        title: String?,
        savedRoutes: List<SavedTrailRoute>,
        nowEpochMillis: Long,
        newId: () -> String = ::randomId,
    ): List<RecentTrailRoute> {
        val existing = entries.firstOrNull { entry -> TrailRouteIdentitySijko.isSameRoute(entry.route, route) }
        val others = entries.filterNot { entry -> TrailRouteIdentitySijko.isSameRoute(entry.route, route) }
        val entry = RecentTrailRoute(
            id = existing?.id ?: newId(),
            title = title ?: existing?.title ?: titleFor(route, destinationAddress = null),
            route = route,
            lastUsedEpochMillis = nowEpochMillis,
        )
        return visible(listOf(entry) + others, savedRoutes, nowEpochMillis)
    }

    /** "To <place>" for a point-to-point route with a known destination, else a distance description. */
    fun titleFor(
        route: TrailRoute,
        destinationAddress: String?,
    ): String {
        if (route.kind == TrailRouteKind.ExerciseLoop) {
            return "${milesText(route.totalDistanceMeters)} mi loop"
        }
        val place = destinationAddress?.split(',')?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        return if (place != null) "To $place" else "${milesText(route.totalDistanceMeters)} mi trail route"
    }

    /** Distance and how long ago it was used, for example "2.5 mi · 3 hr ago". */
    fun detailFor(
        entry: RecentTrailRoute,
        nowEpochMillis: Long,
    ): String {
        val elapsed = (nowEpochMillis - entry.lastUsedEpochMillis).coerceAtLeast(0L)
        val ago = when {
            elapsed < MINUTE_MILLIS -> "Just now"
            elapsed < HOUR_MILLIS -> "${elapsed / MINUTE_MILLIS} min ago"
            elapsed < DAY_MILLIS -> "${elapsed / HOUR_MILLIS} hr ago"
            elapsed < 2 * DAY_MILLIS -> "1 day ago"
            else -> "${elapsed / DAY_MILLIS} days ago"
        }
        return "${milesText(entry.route.totalDistanceMeters)} mi · $ago"
    }

    suspend fun load(
        store: RecentTrailRouteStore,
        savedStore: SavedTrailRouteStore,
        nowEpochMillis: Long,
    ): List<RecentTrailRoute> = historyMutex.withLock {
        val stored = store.recentRoutes()
        val kept = visible(stored, savedStore.savedRoutes(), nowEpochMillis)
        // Expired and saved entries are dropped from storage too, not just hidden.
        if (kept != stored) store.replaceRecentRoutes(kept)
        kept
    }

    suspend fun record(
        store: RecentTrailRouteStore,
        savedStore: SavedTrailRouteStore,
        route: TrailRoute,
        title: String?,
        nowEpochMillis: Long,
    ) = historyMutex.withLock {
        store.replaceRecentRoutes(
            recorded(store.recentRoutes(), route, title, savedStore.savedRoutes(), nowEpochMillis),
        )
    }

    /** Called once a route is saved: it now lives in Saved, so it leaves Recent. */
    suspend fun forget(
        store: RecentTrailRouteStore,
        route: TrailRoute,
    ) = historyMutex.withLock {
        val stored = store.recentRoutes()
        val kept = stored.filterNot { entry -> TrailRouteIdentitySijko.isSameRoute(entry.route, route) }
        if (kept != stored) store.replaceRecentRoutes(kept)
    }

    /** Removes one entry and returns it, so the caller can offer Undo. */
    suspend fun remove(
        store: RecentTrailRouteStore,
        id: String,
    ): RecentTrailRoute? = historyMutex.withLock {
        val stored = store.recentRoutes()
        val removed = stored.firstOrNull { entry -> entry.id == id } ?: return@withLock null
        store.replaceRecentRoutes(stored - removed)
        removed
    }

    suspend fun restore(
        store: RecentTrailRouteStore,
        savedStore: SavedTrailRouteStore,
        entry: RecentTrailRoute,
        nowEpochMillis: Long,
    ) = historyMutex.withLock {
        val stored = store.recentRoutes().filterNot { it.id == entry.id }
        store.replaceRecentRoutes(visible(stored + entry, savedStore.savedRoutes(), nowEpochMillis))
    }

    /** Clears Recent only; saved routes and places live in their own stores and are untouched. */
    suspend fun clear(store: RecentTrailRouteStore) = historyMutex.withLock {
        store.replaceRecentRoutes(emptyList())
    }

    private fun milesText(meters: Double): String {
        val tenths = (meters / METERS_PER_MILE * 10).roundToInt()
        return "${tenths / 10}.${tenths % 10}"
    }

    private fun randomId(): String = "recent-" + Random.nextLong().toULong().toString(16)
}
