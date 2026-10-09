/**
 * Job: Carry an oriented graph edge used by the bounded exercise-loop searches.
 *
 */
package com.trailmapper.shared.routing

internal data class ExerciseRouteSearchEdge(
    val toNodeId: Int,
    val edge: TrailGraphEdge,
)
