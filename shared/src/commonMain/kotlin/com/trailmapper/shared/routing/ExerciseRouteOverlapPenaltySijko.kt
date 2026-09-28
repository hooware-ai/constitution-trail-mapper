/**
 * Job: Apply a progressive preference against retracing without rejecting useful shared stems.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max
import kotlin.math.min

object ExerciseRouteOverlapPenaltySijko {
    fun penaltyMeters(
        totalDistanceMeters: Double,
        selfOverlapMeters: Double,
    ): Double {
        if (
            !totalDistanceMeters.isFinite() || totalDistanceMeters <= 0.0 ||
            !selfOverlapMeters.isFinite() || selfOverlapMeters <= 0.0
        ) {
            return 0.0
        }
        val overlapMeters = min(selfOverlapMeters, totalDistanceMeters)
        val preferredBoundary = totalDistanceMeters * PreferredOverlapRatio
        val toleratedBoundary = totalDistanceMeters * ToleratedOverlapRatio
        val preferredMeters = min(overlapMeters, preferredBoundary)
        val toleratedMeters = min(
            max(0.0, overlapMeters - preferredBoundary),
            toleratedBoundary - preferredBoundary,
        )
        val excessiveMeters = max(0.0, overlapMeters - toleratedBoundary)
        return preferredMeters * PreferredOverlapMultiplier +
            toleratedMeters * ToleratedOverlapMultiplier +
            excessiveMeters * ExcessiveOverlapMultiplier
    }

    private const val PreferredOverlapRatio = 0.10
    private const val ToleratedOverlapRatio = 0.25
    private const val PreferredOverlapMultiplier = 0.25
    private const val ToleratedOverlapMultiplier = 1.0
    private const val ExcessiveOverlapMultiplier = 3.0
}
