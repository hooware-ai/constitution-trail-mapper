/**
 * Job: Separate saved point-to-point navigation routes from saved exercise loops.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.routing.TrailRouteKind

object SavedTrailRouteFilterSijko {
    fun navigationRoutes(routes: List<SavedTrailRoute>): List<SavedTrailRoute> {
        return routes.filter { savedRoute -> savedRoute.route.kind == TrailRouteKind.Navigation }
    }

    fun exerciseRoutes(routes: List<SavedTrailRoute>): List<SavedTrailRoute> {
        return routes.filter { savedRoute -> savedRoute.route.kind == TrailRouteKind.ExerciseLoop }
    }
}
