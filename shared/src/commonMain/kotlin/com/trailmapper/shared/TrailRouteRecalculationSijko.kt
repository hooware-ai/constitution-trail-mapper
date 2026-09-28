/**
 * Job: Put a route recalculated around a closure in place of the old one in Saved or Recent, and undo that exactly.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute

object TrailRouteRecalculationSijko {
    /** What [apply] changed, holding the originals exactly as stored so [undo] restores them. */
    data class Applied(
        val newRoute: TrailRoute,
        /** The saved entry before it took [newRoute], in its stored direction; null when the route was not saved. */
        val originalSaved: SavedTrailRoute?,
        /** The Recent entry [newRoute] replaced; null when it was saved or had no entry. */
        val originalRecent: RecentTrailRoute?,
        /** An entry [newRoute] already had in Recent, which made way for the replacement; restored by undo. */
        val displacedRecent: RecentTrailRoute? = null,
    )

    /**
     * A saved route keeps its entry, id and name with [newRoute] inside; Saved is its only home, so Recent is
     * not touched. An unsaved route's Recent entry is replaced under its title (else [title]) in one write.
     * Either way a single store write makes the change, so a failure leaves everything as it was.
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
        if (saved != null && savedStore.replaceRoute(saved.id, newRoute) != null) {
            return Applied(newRoute, originalSaved = saved, originalRecent = null)
        }
        val replacement = RecentTrailRouteHistorySijko.replace(
            store = recentStore,
            savedStore = savedStore,
            oldRoute = oldRoute,
            newRoute = newRoute,
            title = title,
            nowEpochMillis = nowEpochMillis,
        )
        return Applied(
            newRoute = newRoute,
            originalSaved = null,
            originalRecent = replacement.replaced,
            displacedRecent = replacement.displaced,
        )
    }

    suspend fun undo(
        savedStore: SavedTrailRouteStore,
        recentStore: RecentTrailRouteStore,
        applied: Applied,
        nowEpochMillis: Long,
    ) {
        val saved = applied.originalSaved
        if (saved != null) {
            savedStore.replaceRoute(saved.id, saved.route)
        } else {
            RecentTrailRouteHistorySijko.revert(
                store = recentStore,
                savedStore = savedStore,
                newRoute = applied.newRoute,
                originals = listOfNotNull(applied.originalRecent, applied.displacedRecent),
                nowEpochMillis = nowEpochMillis,
            )
        }
    }
}
