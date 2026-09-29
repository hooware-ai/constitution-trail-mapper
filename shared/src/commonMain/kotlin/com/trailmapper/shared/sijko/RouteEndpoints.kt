/**
 * Job: Carry the start and destination text values and optional map coordinates for routing.
 *
 */
package com.trailmapper.shared.sijko

import kotlinx.serialization.Serializable

@Serializable
data class RouteEndpoints(
    val start: String = "",
    val destination: String = "",
    val startPoint: MapPoint? = null,
    val destinationPoint: MapPoint? = null,
)
