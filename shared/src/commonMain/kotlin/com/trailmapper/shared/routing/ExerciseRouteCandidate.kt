/**
 * Job: Carry and deterministically rank one bounded exercise-route candidate.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.abs

internal data class ExerciseRouteCandidate(
    val edges: List<TrailGraphEdge>,
    val traversalEdges: List<TrailRouteTraversalEdge>,
    val totalDistanceMeters: Double,
    val distanceErrorMeters: Double,
    val safetyCost: Double,
    val historyOverlapMeters: Double,
    val selfOverlapMeters: Double,
    val explorationShapePenaltyMeters: Double,
    val ordinaryAccessDistanceMeters: Double,
    val entersHazard: Boolean,
    val isWithinTargetTolerance: Boolean,
    val startCandidateIndex: Int,
) {
    fun isBetterThan(other: ExerciseRouteCandidate): Boolean {
        if (entersHazard != other.entersHazard) {
            return !entersHazard
        }
        if (isWithinTargetTolerance != other.isWithinTargetTolerance) {
            return isWithinTargetTolerance
        }
        val score = distanceErrorMeters * TargetErrorWeight +
            safetyCost * SafetyWeight +
            historyOverlapMeters * HistoryOverlapWeight +
            ExerciseRouteOverlapPenaltySijko.penaltyMeters(totalDistanceMeters, selfOverlapMeters) *
            SelfOverlapWeight +
            explorationShapePenaltyMeters * ExplorationShapeWeight
        val otherScore = other.distanceErrorMeters * TargetErrorWeight +
            other.safetyCost * SafetyWeight +
            other.historyOverlapMeters * HistoryOverlapWeight +
            ExerciseRouteOverlapPenaltySijko.penaltyMeters(other.totalDistanceMeters, other.selfOverlapMeters) *
            SelfOverlapWeight +
            other.explorationShapePenaltyMeters * ExplorationShapeWeight
        return score < otherScore - ScoreEpsilon ||
            (abs(score - otherScore) <= ScoreEpsilon && routeSignature() < other.routeSignature())
    }

    private fun routeSignature(): String {
        return "$startCandidateIndex:${ExerciseRouteKeySijko.keyFor(traversalEdges)}"
    }

    companion object {
        /** The distance-error and self-overlap part of the ranking score, for estimating a loop before it is built. */
        fun shapeScore(
            distanceErrorMeters: Double,
            totalDistanceMeters: Double,
            selfOverlapMeters: Double,
        ): Double {
            return distanceErrorMeters * TargetErrorWeight +
                ExerciseRouteOverlapPenaltySijko.penaltyMeters(totalDistanceMeters, selfOverlapMeters) *
                SelfOverlapWeight
        }

        private const val TargetErrorWeight = 6.0
        private const val SafetyWeight = 0.15
        private const val HistoryOverlapWeight = 2.5
        private const val SelfOverlapWeight = 5.0
        private const val ExplorationShapeWeight = 3.0
        private const val ScoreEpsilon = 0.000001
    }
}
