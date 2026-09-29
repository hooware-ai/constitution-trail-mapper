/**
 * Job: Describe one mapped location where route traversal should carry an explicit safety penalty.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailRoutingHazard(
    val id: String,
    val center: MapPoint,
    val radiusMeters: Double,
    val fixedPenalty: Double,
)
