/**
 * Job: Decide whether mapped endpoint access meaningfully closes the direct gap to the approved network.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max

object TrailRouteEndpointAccessClosureSijko {
    fun isMeaningful(
        directDistanceMeters: Double,
        mappedDistanceMeters: Double,
        estimatedDistanceMeters: Double,
        maxDirectEstimatedMeters: Double,
        minimumMappedDistanceMeters: Double,
        minimumClosureRatio: Double,
    ): Boolean {
        if (!directDistanceMeters.isFinite() ||
            !mappedDistanceMeters.isFinite() ||
            !estimatedDistanceMeters.isFinite() ||
            directDistanceMeters < 0.0 ||
            mappedDistanceMeters < 0.0 ||
            estimatedDistanceMeters < 0.0
        ) {
            return false
        }
        if (estimatedDistanceMeters <= maxDirectEstimatedMeters) {
            return true
        }
        if (mappedDistanceMeters < minimumMappedDistanceMeters) {
            return false
        }

        val closedDistanceMeters = max(
            0.0,
            directDistanceMeters - estimatedDistanceMeters,
        )
        return closedDistanceMeters / mappedDistanceMeters >= minimumClosureRatio
    }
}
