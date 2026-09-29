/**
 * Job: Identify tiny unnamed connector legs that should contribute distance without creating their own direction.
 *
 */
package com.trailmapper.shared.routing

internal object TrailRouteInstructionTransientLegSijko {
    fun shouldDeferTransition(
        current: TrailRouteInstructionLeg,
        next: TrailRouteInstructionLeg?,
    ): Boolean {
        return current.name == null &&
            current.distanceMeters <= MAX_TRANSIENT_CONNECTOR_METERS &&
            next != null &&
            current.segmentType == next.segmentType &&
            next.name != null
    }

    private const val MAX_TRANSIENT_CONNECTOR_METERS = 20.0
}
