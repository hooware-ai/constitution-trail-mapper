/**
 * Job: Define the shared platform boundary for creating, renaming, deleting, and loading local trail routes.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute

interface SavedTrailRouteStore {
    suspend fun savedRoutes(): List<SavedTrailRoute>

    suspend fun saveRoute(
        route: TrailRoute,
        title: String,
    ): SavedTrailRoute

    suspend fun renameRoute(
        id: String,
        title: String,
    ): SavedTrailRoute?

    /** Swaps in a new route for the saved entry [id], keeping its id and title; null when it is gone. */
    suspend fun replaceRoute(
        id: String,
        route: TrailRoute,
    ): SavedTrailRoute?

    suspend fun deleteRoute(id: String): Boolean
}
