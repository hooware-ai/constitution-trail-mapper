/**
 * Job: Persist a stable, direction-independent network traversal for exercise-history scoring.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
data class TrailRouteTraversalEdge(
    val key: String,
    val distanceMeters: Double,
    val ordinaryAccessDistanceMeters: Double = 0.0,
    /**
     * Rounded coordinates (as in traversal keys) of this edge's verified choice points, recorded when the
     * route is built. Empty for older saved routes, which then keep their earlier guidance.
     */
    val junctionCoordinates: List<String> = emptyList(),
    /**
     * Length of the edge's own geometry, which the route's segments are made of. It can differ from
     * [distanceMeters] (snap connectors include the hop to their node only in geometry). Null on records
     * made before it was kept; those are measured by [distanceMeters].
     */
    val geometryMeters: Double? = null,
)
