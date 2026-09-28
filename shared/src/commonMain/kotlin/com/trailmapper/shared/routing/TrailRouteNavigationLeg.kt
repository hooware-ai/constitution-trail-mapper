/**
 * Job: Carry one measured route leg used to calculate active navigation progress.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

internal data class TrailRouteNavigationLeg(
    val start: MapPoint,
    val end: MapPoint,
    val distanceMeters: Double,
    val cumulativeStartMeters: Double,
    val bearingDegrees: Double,
)
