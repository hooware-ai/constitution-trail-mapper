/**
 * Job: Carry what a route preview needs besides the route: its name for Recent and a place it can save.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

data class TrailRoutePreviewRequest(
    /** How the route is named in Recent, such as a recent entry's own title; null derives one. */
    val title: String? = null,
    /** The point-to-point destination the rider chose, offered as a place to save; null for a loop. */
    val destination: TrailRoutePreviewDestination? = null,
)

data class TrailRoutePreviewDestination(
    val address: String,
    val point: MapPoint,
)
