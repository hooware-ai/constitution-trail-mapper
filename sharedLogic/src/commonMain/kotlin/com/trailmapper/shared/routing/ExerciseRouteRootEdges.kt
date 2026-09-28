/**
 * Job: Carry the synthetic start-root edges that join an exercise start to its snapped trail edge.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.min

internal data class ExerciseRouteRootEdges(
    val adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
    /** Search history cost for each root edge, pro-rated by its share of the snapped edge. */
    val historyCostsByEdgeId: Map<Int, Double>,
    /**
     * For each root edge and the snapped edge: the share of that edge lying on each edge it overlaps.
     * Root halves cover disjoint parts of the snapped edge, so they never overlap each other.
     */
    val overlapSharesByEdgeId: Map<Int, Map<Int, Double>>,
) {
    /** Share of [edge] already ridden by the outbound path's edges in [outboundEdgeIds]. */
    fun reusedShare(edge: TrailGraphEdge, outboundEdgeIds: Set<Int>): Double {
        if (edge.id in outboundEdgeIds) {
            return 1.0
        }
        val overlapShares = overlapSharesByEdgeId[edge.id] ?: return 0.0
        return min(1.0, overlapShares.entries.sumOf { (edgeId, share) -> if (edgeId in outboundEdgeIds) share else 0.0 })
    }
}
