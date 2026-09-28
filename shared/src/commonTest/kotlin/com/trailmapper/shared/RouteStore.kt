/**
 * Job: Provide a controllable saved-route store for shared coroutine lifecycle tests.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import kotlinx.coroutines.CompletableDeferred

internal class RouteStore(
    var routes: List<SavedTrailRoute> = emptyList(),
    var loadFailure: Throwable? = null,
    var saveFailure: Throwable? = null,
) : SavedTrailRouteStore {
    var loadGate: CompletableDeferred<Unit>? = null

    override suspend fun savedRoutes(): List<SavedTrailRoute> {
        val snapshot = routes
        loadGate?.await()
        loadFailure?.let { throw it }
        return snapshot
    }

    override suspend fun saveRoute(
        route: TrailRoute,
        title: String,
    ): SavedTrailRoute {
        saveFailure?.let { throw it }
        val savedRoute = SavedTrailRoute(
            id = "route-${routes.size + 1}",
            title = title,
            summary = "1.0 mi trail route",
            route = route,
        )
        routes = listOf(savedRoute) + routes
        return savedRoute
    }

    override suspend fun renameRoute(
        id: String,
        title: String,
    ): SavedTrailRoute? = null

    override suspend fun replaceRoute(
        id: String,
        route: TrailRoute,
    ): SavedTrailRoute? {
        val existing = routes.firstOrNull { it.id == id } ?: return null
        val replaced = existing.copy(route = route)
        routes = routes.map { if (it.id == id) replaced else it }
        return replaced
    }

    override suspend fun deleteRoute(id: String): Boolean = false
}
