/**
 * Job: Penalize compact or multi-arm exercise routes instead of one coherent outward exploration.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.max
import kotlin.math.min

object ExerciseRouteExplorationShapeSijko {
    fun penaltyMeters(
        edges: List<TrailGraphEdge>,
        startPoint: MapPoint,
        targetDistanceMeters: Double,
    ): Double {
        if (targetDistanceMeters <= 0.0 || !targetDistanceMeters.isFinite()) {
            return 0.0
        }
        val distancesFromStart = routePoints(edges).map { point ->
            TrailDistanceSijko.metersBetween(startPoint, point)
        }
        if (distancesFromStart.isEmpty()) {
            return targetDistanceMeters
        }
        val desiredReachMeters = targetDistanceMeters * DesiredReachRatio
        val reachShortfallMeters = max(0.0, desiredReachMeters - distancesFromStart.max())
        val additionalExcursions = max(
            0,
            excursionCount(distancesFromStart, targetDistanceMeters) - 1,
        )
        val additionalTurnarounds = max(0, ExerciseRouteTurnaroundSijko.count(edges) - AllowedTurnaroundCount)
        return reachShortfallMeters * ReachShortfallMultiplier +
            additionalExcursions * targetDistanceMeters * AdditionalExcursionPenaltyRatio +
            additionalTurnarounds * targetDistanceMeters * AdditionalTurnaroundPenaltyRatio
    }

    fun excursionCount(
        distancesFromStartMeters: List<Double>,
        targetDistanceMeters: Double,
    ): Int {
        if (distancesFromStartMeters.isEmpty() || targetDistanceMeters <= 0.0) {
            return 0
        }
        val innerRadiusMeters = min(MaximumInnerRadiusMeters, max(MinimumInnerRadiusMeters, targetDistanceMeters * InnerRadiusRatio))
        val outerRadiusMeters = max(innerRadiusMeters * 1.5, targetDistanceMeters * OuterRadiusRatio)
        var canStartExcursion = true
        var excursions = 0
        distancesFromStartMeters.forEach { distanceMeters ->
            if (canStartExcursion && distanceMeters >= outerRadiusMeters) {
                excursions += 1
                canStartExcursion = false
            } else if (!canStartExcursion && distanceMeters <= innerRadiusMeters) {
                canStartExcursion = true
            }
        }
        return excursions
    }

    private fun routePoints(edges: List<TrailGraphEdge>): List<MapPoint> {
        return edges.flatMap { edge -> edge.routeSegments.flatMap { segment -> segment.points } }
    }

    private const val DesiredReachRatio = 0.20
    private const val ReachShortfallMultiplier = 2.0
    private const val InnerRadiusRatio = 0.05
    private const val OuterRadiusRatio = 0.12
    private const val MinimumInnerRadiusMeters = 75.0
    private const val MaximumInnerRadiusMeters = 400.0
    private const val AdditionalExcursionPenaltyRatio = 0.30
    private const val AllowedTurnaroundCount = 1
    private const val AdditionalTurnaroundPenaltyRatio = 0.75
}
