/**
 * Job: Carry one reconstructed bounded exercise-route shortest-path result.
 *
 */
package com.trailmapper.shared.routing

internal data class ExerciseRouteSearchPath(
    val edges: List<TrailGraphEdge>,
    val totalCost: Double,
    val totalDistanceMeters: Double,
)
