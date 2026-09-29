/**
 * Job: Describe a saved route in its list row by what kind of ride it is and how far it goes.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind

object SavedTrailRouteDetailSijko {
    /** For example "Route · 2.5 mi" or "Exercise loop · 6.0 mi". */
    fun detailFor(route: TrailRoute): String {
        val kind = when (route.kind) {
            TrailRouteKind.Navigation -> "Route"
            TrailRouteKind.ExerciseLoop -> "Exercise loop"
        }
        return "$kind · ${TrailMilesTextSijko.milesText(route.totalDistanceMeters)} mi"
    }
}
