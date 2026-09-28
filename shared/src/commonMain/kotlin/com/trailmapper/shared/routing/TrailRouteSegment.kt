/**
 * Job: Carry one drawable route polyline segment and its visual route role.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlinx.serialization.Serializable

@Serializable
data class TrailRouteSegment(
    val type: TrailRouteSegmentType,
    val points: List<MapPoint>,
    val isRouted: Boolean = true,
    val routeRoles: Set<TrailNetworkRole> = emptySet(),
    val displayStyle: TrailRouteDisplayStyle = TrailRouteDisplayStyle.Unknown,
    val name: String? = null,
)
