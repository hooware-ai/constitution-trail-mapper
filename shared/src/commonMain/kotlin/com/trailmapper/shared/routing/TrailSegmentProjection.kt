/**
 * Job: Carry the closest point and distances for projecting a point onto a trail segment.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailSegmentProjection(
    val projectedPoint: MapPoint,
    val distanceMeters: Double,
    val distanceFromStartMeters: Double,
    val distanceToEndMeters: Double,
)
