/**
 * Job: Provide an empty saved-route store for platforms without persistence wired yet.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute

object NoSavedTrailRouteStore : SavedTrailRouteStore {
    override suspend fun savedRoutes(): List<SavedTrailRoute> = emptyList()

    override suspend fun saveRoute(
        route: TrailRoute,
        title: String,
    ): SavedTrailRoute {
        return SavedTrailRoute(
            id = title,
            title = title,
            summary = "",
            route = route,
        )
    }

    override suspend fun renameRoute(
        id: String,
        title: String,
    ): SavedTrailRoute? = null

    override suspend fun deleteRoute(id: String): Boolean = false
}
