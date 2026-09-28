/**
 * Job: Create a durable history record only from a route that can support exercise-overlap scoring.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.ExerciseRouteKeySijko
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind

object CompletedExerciseSessionFactorySijko {
    /** [carriedRide] is what was ridden of earlier routes before the rider rejoined onto [route]. */
    fun create(
        route: TrailRoute,
        completedAtEpochMillis: Long,
        carriedRide: CarriedExerciseRide = CarriedExerciseRide(),
    ): CompletedExerciseSession? {
        if (route.kind != TrailRouteKind.ExerciseLoop ||
            route.traversalEdges.isEmpty() ||
            completedAtEpochMillis < 0L
        ) {
            return null
        }
        val traversalEdges = carriedRide.traversalEdges + route.traversalEdges
        val routeKey = ExerciseRouteKeySijko.keyFor(traversalEdges)
        return CompletedExerciseSession(
            id = "$completedAtEpochMillis:$routeKey",
            routeKey = routeKey,
            completedAtEpochMillis = completedAtEpochMillis,
            completedDistanceMeters = carriedRide.distanceMeters + route.totalDistanceMeters,
            traversalEdges = traversalEdges,
        )
    }
}
