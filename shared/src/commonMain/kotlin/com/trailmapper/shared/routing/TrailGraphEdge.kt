/**
 * Job: Carry one routeable edge in the approved trail-network graph.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
data class TrailGraphEdge(
    val id: Int,
    val fromNodeId: Int,
    val toNodeId: Int,
    val distanceMeters: Double,
    val ordinaryAccessDistanceMeters: Double = 0.0,
    val accessRoadClass: String? = null,
    val sourceFeatureId: String? = null,
    val routeRoles: Set<TrailNetworkRole> = emptySet(),
    val facilityType: TrailFacilityType = TrailFacilityType.Unknown,
    val comfortLevel: TrailComfortLevel = TrailComfortLevel.Unknown,
    val status: TrailFeatureStatus = TrailFeatureStatus.Existing,
    val routeSegments: List<TrailRouteSegment> = emptyList(),
    /** Set on a snap-connector copy: the id of the original edge it runs along. */
    val connectorOfEdgeId: Int? = null,
)
