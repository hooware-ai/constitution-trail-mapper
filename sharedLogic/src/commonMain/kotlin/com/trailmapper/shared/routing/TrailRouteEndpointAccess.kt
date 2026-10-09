/**
 * Job: Carry a route endpoint's chosen trail snap plus the access geometry to reach it.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailRouteEndpointAccess(
    val endpointPoint: MapPoint,
    val snap: TrailNetworkSnap,
    val accessSegments: List<TrailRouteSegment>,
    val accessDistanceMeters: Double,
)
