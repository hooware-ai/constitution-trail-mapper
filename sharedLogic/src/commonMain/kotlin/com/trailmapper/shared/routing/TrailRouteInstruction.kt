/**
 * Job: Carry one generated navigation instruction for a constrained trail route.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailRouteInstruction(
    val maneuver: TrailRouteInstructionManeuver,
    val text: String,
    val distanceMeters: Double,
    val point: MapPoint,
)
