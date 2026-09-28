/**
 * Job: Carry what a rider has already ridden of an exercise loop across a rejoin onto a replacement route.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.ExerciseRouteTraversalSijko
import com.trailmapper.shared.routing.TrailRouteDistanceBasisSijko
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteTraversalEdge
import kotlinx.serialization.Serializable

@Serializable
data class CarriedExerciseRide(
    val distanceMeters: Double = 0.0,
    val traversalEdges: List<TrailRouteTraversalEdge> = emptyList(),
) {
    /** Adds the part of [route] ridden before the rider left it at [progressMeters] of navigation. */
    fun plusRiddenPart(route: TrailRoute, progressMeters: Double): CarriedExerciseRide {
        // Navigation distance includes bridged gaps the traversal does not; cut the traversal on its own basis.
        val ridden = TrailRouteDistanceBasisSijko.traversalMetersAt(route, progressMeters)
            .coerceIn(0.0, route.totalDistanceMeters)
        return CarriedExerciseRide(
            distanceMeters = distanceMeters + ridden,
            traversalEdges = traversalEdges + ExerciseRouteTraversalSijko.slice(route.traversalEdges, 0.0, ridden),
        )
    }
}
