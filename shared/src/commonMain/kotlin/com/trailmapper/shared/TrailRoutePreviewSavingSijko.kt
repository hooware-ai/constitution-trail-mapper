/**
 * Job: Save a previewed route or its destination with the same default names wherever the rider saves it.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.sijko.MapPointLabelSijko
import com.trailmapper.shared.sijko.SavedDestinationTitleSijko
import com.trailmapper.shared.sijko.SavedExerciseRouteTitleSijko
import com.trailmapper.shared.sijko.SavedItemTitleEditSijko
import com.trailmapper.shared.sijko.SavedTrailRouteTitleSijko

object TrailRoutePreviewSavingSijko {
    /** Numbers a new route after the saved routes of its own kind. */
    fun defaultTitleFor(
        route: TrailRoute,
        savedRoutes: List<SavedTrailRoute>,
    ): String {
        val sameKindCount = savedRoutes.count { savedRoute -> savedRoute.route.kind == route.kind }
        return if (route.kind == TrailRouteKind.ExerciseLoop) {
            SavedExerciseRouteTitleSijko.titleFor(sameKindCount)
        } else {
            SavedTrailRouteTitleSijko.titleFor(sameKindCount)
        }
    }

    suspend fun saveRoute(
        store: SavedTrailRouteStore,
        route: TrailRoute,
    ): SavedTrailRoute {
        return store.saveRoute(route, defaultTitleFor(route, store.savedRoutes()))
    }

    /** Null when the title is blank or the route is no longer saved. */
    suspend fun renameRoute(
        store: SavedTrailRouteStore,
        id: String,
        title: String,
    ): SavedTrailRoute? {
        val normalizedTitle = SavedItemTitleEditSijko.normalizedTitle(title) ?: return null
        return store.renameRoute(id, normalizedTitle)
    }

    suspend fun saveDestination(
        store: SavedDestinationStore,
        destination: TrailRoutePreviewDestination,
    ): SavedDestination {
        val address = destination.address.takeIf { it.isNotBlank() }
            ?: MapPointLabelSijko.labelFor(destination.point)
        return store.saveDestination(
            title = SavedDestinationTitleSijko.titleFor(
                address = address,
                savedDestinationCount = store.savedDestinations().size,
            ),
            address = address,
            point = destination.point,
        )
    }
}
