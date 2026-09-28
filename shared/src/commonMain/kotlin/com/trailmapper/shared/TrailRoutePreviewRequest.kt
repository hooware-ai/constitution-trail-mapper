/**
 * Job: Carry what a route preview needs besides the route: whether it is already saved, and a place it can save.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

data class TrailRoutePreviewRequest(
    /** The saved route being shown, so the preview reads as saved; null for a new, unsaved route. */
    val savedRouteId: String? = null,
    /** The point-to-point destination the rider chose, offered as a place to save; null for a loop. */
    val destination: TrailRoutePreviewDestination? = null,
)

data class TrailRoutePreviewDestination(
    val address: String,
    val point: MapPoint,
)
