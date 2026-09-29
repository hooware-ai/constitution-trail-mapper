/**
 * Job: Carry the enabled/disabled state for each route-layer option in the planner.
 *
 */
package com.trailmapper.shared.sijko

import kotlinx.serialization.Serializable

@Serializable
data class RouteLayerSelection(
    val trailBranches: Boolean,
    val parkConnectors: Boolean,
    val sharedRoadways: Boolean,
    val proposedTrails: Boolean,
)
