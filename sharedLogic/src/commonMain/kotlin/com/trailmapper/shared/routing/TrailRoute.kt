/**
 * Job: Carry the constrained route found over the approved trail-network graph.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.RouteLayerSelection
import kotlinx.serialization.Serializable

@Serializable
data class TrailRoute(
    val edges: List<TrailGraphEdge> = emptyList(),
    val segments: List<TrailRouteSegment> = emptyList(),
    val totalDistanceMeters: Double,
    val ordinaryAccessDistanceMeters: Double,
    val sharedRoadwayDistanceMeters: Double = 0.0,
    val totalCost: Double,
    val kind: TrailRouteKind = TrailRouteKind.Navigation,
    val requestedDistanceMeters: Double? = null,
    val traversalEdges: List<TrailRouteTraversalEdge> = emptyList(),
    /** The layers the route was planned with; null on routes saved before they were recorded. */
    val routeLayers: RouteLayerSelection? = null,
)
