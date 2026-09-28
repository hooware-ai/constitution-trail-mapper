/**
 * Job: Carry one normalized GIS trail feature before it is converted into graph edges.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailNetworkFeature(
    val id: String,
    val name: String? = null,
    val status: TrailFeatureStatus,
    val routeRoles: Set<TrailNetworkRole>,
    val facilityType: TrailFacilityType = TrailFacilityType.Unknown,
    val comfortLevel: TrailComfortLevel = TrailComfortLevel.Unknown,
    val paths: List<List<MapPoint>>,
)
