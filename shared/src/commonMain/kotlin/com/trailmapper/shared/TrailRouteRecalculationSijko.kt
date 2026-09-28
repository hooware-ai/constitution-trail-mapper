/**
 * Job: Put a route recalculated around a closure in place of the old one in Saved and Recent, and undo that.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteIdentitySijko

object TrailRouteRecalculationSijko {
    /** What [apply] changed, so [undo] can put it back. */
    data class Applied(
        val oldRoute: TrailRoute,
        val newRoute: TrailRoute,
        /** The saved entry that now holds [newRoute], keeping its name; null when the route was not saved. */
        val savedRouteId: String?,
        /** The Recent entry [newRoute] replaced, with its name; null when there was none. */
        val replacedRecent: RecentTrailRoute?,
    )

    /**
     * The saved entry for [oldRoute], if any, keeps its id and name with [newRoute] inside. A Recent entry
     * for it is replaced by one for [newRoute] under the same title; an unsaved route with no entry gets
     * one titled [title].
     */
    suspend fun apply(
        savedStore: SavedTrailRouteStore,
        recentStore: RecentTrailRouteStore,
        oldRoute: TrailRoute,
        newRoute: TrailRoute,
        title: String?,
        nowEpochMillis: Long,
    ): Applied {
        val saved = TrailRoutePreviewSavingSijko.savedMatch(savedStore, oldRoute)
        val savedRouteId = saved?.let { savedStore.replaceRoute(it.id, newRoute)?.id }
        val replacedRecent = recentStore.recentRoutes()
            .firstOrNull { entry -> TrailRouteIdentitySijko.isSameRoute(entry.route, oldRoute) }
        RecentTrailRouteHistorySijko.forget(recentStore, oldRoute)
        RecentTrailRouteHistorySijko.record(
            store = recentStore,
            savedStore = savedStore,
            route = newRoute,
            title = replacedRecent?.title ?: title,
            nowEpochMillis = nowEpochMillis,
        )
        return Applied(oldRoute, newRoute, savedRouteId, replacedRecent)
    }

    suspend fun undo(
        savedStore: SavedTrailRouteStore,
        recentStore: RecentTrailRouteStore,
        applied: Applied,
        nowEpochMillis: Long,
    ) {
        applied.savedRouteId?.let { id -> savedStore.replaceRoute(id, applied.oldRoute) }
        RecentTrailRouteHistorySijko.forget(recentStore, applied.newRoute)
        applied.replacedRecent?.let { entry ->
            RecentTrailRouteHistorySijko.restore(recentStore, savedStore, entry, nowEpochMillis)
        }
    }
}
