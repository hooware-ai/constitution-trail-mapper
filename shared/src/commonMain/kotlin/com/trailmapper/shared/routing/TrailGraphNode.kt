/**
 * Job: Carry one snapped coordinate node in the trail-network graph.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailGraphNode(
    val id: Int,
    val point: MapPoint,
)
