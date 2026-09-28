/**
 * Job: Distinguish a useful closed circuit from a route that substantially retraces itself.
 *
 */
package com.trailmapper.shared.routing

object ExerciseRouteLoopQualitySijko {
    fun isCircuit(
        totalDistanceMeters: Double,
        selfOverlapMeters: Double,
    ): Boolean {
        if (!totalDistanceMeters.isFinite() || totalDistanceMeters <= 0.0 || !selfOverlapMeters.isFinite()) {
            return false
        }
        return selfOverlapMeters / totalDistanceMeters < MaximumOverlapRatio
    }

    fun maximumSelfOverlapMeters(totalDistanceMeters: Double): Double {
        return totalDistanceMeters * MaximumOverlapRatio
    }

    private const val MaximumOverlapRatio = 0.40
}
