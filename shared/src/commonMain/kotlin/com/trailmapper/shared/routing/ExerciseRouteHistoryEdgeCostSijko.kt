/**
 * Job: Precompute recent-traversal costs that steer exercise-route searches toward unexplored edges.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession

object ExerciseRouteHistoryEdgeCostSijko {
    fun costsByEdgeId(
        edges: List<TrailGraphEdge>,
        completedSessions: List<CompletedExerciseSession>,
        nowEpochMillis: Long,
    ): Map<Int, Double> {
        return costsByEdgeId(edges, ExerciseRouteHistoryIndex.build(completedSessions, nowEpochMillis))
    }

    internal fun costsByEdgeId(
        edges: List<TrailGraphEdge>,
        history: ExerciseRouteHistoryIndex,
    ): Map<Int, Double> {
        if (edges.isEmpty() || history.isEmpty) {
            return emptyMap()
        }
        return edges.mapNotNull { edge ->
            val weight = history.weightFor(ExerciseRouteTraversalSijko.keyFor(edge))
            if (weight <= 0.0) {
                return@mapNotNull null
            }
            edge.id to edge.distanceMeters * weight
        }.toMap()
    }
}
