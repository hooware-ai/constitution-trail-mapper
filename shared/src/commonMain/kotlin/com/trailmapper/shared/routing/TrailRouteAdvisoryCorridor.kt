/**
 * Job: Carry an official approximate work corridor for a labeled advisory map overlay.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailRouteAdvisoryCorridor(
    val advisoryId: String,
    val label: String,
    val points: List<MapPoint>,
    val sourceUrl: String,
)
