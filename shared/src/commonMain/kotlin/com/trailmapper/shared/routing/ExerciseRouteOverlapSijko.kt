/**
 * Job: Score overlap across every traveled edge while discounting unavoidable start/end stems.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import kotlin.math.max
import kotlin.math.min

object ExerciseRouteOverlapSijko {
    fun historyOverlapMeters(
        traversalEdges: List<TrailRouteTraversalEdge>,
        completedSessions: List<CompletedExerciseSession>,
        nowEpochMillis: Long,
    ): Double {
        return ExerciseRouteHistoryIndex.build(completedSessions, nowEpochMillis).overlapMeters(traversalEdges)
    }

    fun selfOverlapMeters(traversalEdges: List<TrailRouteTraversalEdge>): Double {
        val effective = effectiveTraversal(traversalEdges)
        return effective
            .groupBy { it.key }
            .values
            .sumOf { edges ->
                max(0.0, edges.sumOf { it.distanceMeters } - (edges.maxOfOrNull { it.distanceMeters } ?: 0.0))
            }
    }

    internal fun effectiveTraversal(
        traversalEdges: List<TrailRouteTraversalEdge>,
    ): List<TrailRouteTraversalEdge> {
        val adjusted = traversalEdges.toMutableList()
        val totalDistanceMeters = adjusted.sumOf { edge -> edge.distanceMeters }
        val stemDiscountMeters = min(StemDiscountMeters, totalDistanceMeters * MaximumStemDiscountRatio)
        discountStem(adjusted, adjusted.indices, stemDiscountMeters)
        discountStem(adjusted, adjusted.indices.reversed(), stemDiscountMeters)
        return adjusted.filter { it.distanceMeters > 0.0 }
    }

    private fun discountStem(
        edges: MutableList<TrailRouteTraversalEdge>,
        indices: Iterable<Int>,
        discountMeters: Double,
    ) {
        var remaining = discountMeters
        indices.forEach { index ->
            if (remaining <= 0.0) {
                return
            }
            val edge = edges[index]
            val discounted = min(edge.distanceMeters, remaining)
            edges[index] = edge.copy(distanceMeters = edge.distanceMeters - discounted)
            remaining -= discounted
        }
    }

    private const val StemDiscountMeters = 150.0
    private const val MaximumStemDiscountRatio = 0.025
}
