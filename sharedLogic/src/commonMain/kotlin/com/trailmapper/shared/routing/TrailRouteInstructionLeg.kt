/**
 * Job: Carry one route polyline leg with enough style metadata to generate navigation instructions.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

internal data class TrailRouteInstructionLeg(
    val start: MapPoint,
    val end: MapPoint,
    val distanceMeters: Double,
    val entryBearingDegrees: Double,
    val exitBearingDegrees: Double,
    val segmentType: TrailRouteSegmentType,
    val routeRoles: Set<TrailNetworkRole>,
    val displayStyle: TrailRouteDisplayStyle,
    val name: String?,
    /** The rider reaches this leg by turning back along the line just ridden. */
    val startsWithReversal: Boolean = false,
    /** This leg starts at a verified choice point where the route turns within the same trail. */
    val startsAtJunctionTurn: Boolean = false,
)
