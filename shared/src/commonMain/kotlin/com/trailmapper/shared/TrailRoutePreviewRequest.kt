/**
 * Job: Carry what a route preview needs besides the route: the place it can offer to save.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

data class TrailRoutePreviewRequest(
    /** The point-to-point destination the rider chose, offered as a place to save; null for a loop. */
    val destination: TrailRoutePreviewDestination? = null,
)

data class TrailRoutePreviewDestination(
    val address: String,
    val point: MapPoint,
)
