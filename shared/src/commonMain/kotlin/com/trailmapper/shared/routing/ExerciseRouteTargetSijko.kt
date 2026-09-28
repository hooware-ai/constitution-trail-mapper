/**
 * Job: Validate exercise-route distance targets and determine practical exact-match tolerance.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max

object ExerciseRouteTargetSijko {
    fun isValid(targetDistanceMeters: Double): Boolean {
        return targetDistanceMeters.isFinite() &&
            targetDistanceMeters >= MinimumDistanceMeters &&
            targetDistanceMeters <= MaximumDistanceMeters
    }

    fun toleranceMeters(targetDistanceMeters: Double): Double {
        return max(MinimumToleranceMeters, targetDistanceMeters * RelativeTolerance)
    }

    private const val MetersPerMile = 1_609.344
    private const val MinimumDistanceMeters = 0.5 * MetersPerMile
    private const val MaximumDistanceMeters = 100.0 * MetersPerMile
    private const val MinimumToleranceMeters = 160.0
    private const val RelativeTolerance = 0.10
}
