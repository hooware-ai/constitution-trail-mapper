/**
 * Job: Carry the nearest approved trail-network edge for a start or destination point.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailNetworkSnap(
    val edge: TrailGraphEdge,
    val projectedPoint: MapPoint,
    val accessDistanceMeters: Double,
    val distanceFromStartMeters: Double,
    val distanceToEndMeters: Double,
    /** The snapped edge's geometry from its from-node to its to-node; empty means a straight edge. */
    val edgePoints: List<MapPoint> = emptyList(),
) {
    /** Trail geometry from the projected point along the edge to [nodePoint] at its start or end. */
    fun trailPointsToward(nodePoint: MapPoint, towardEdgeEnd: Boolean): List<MapPoint> {
        return listOf(projectedPoint) +
            TrailDistanceSijko.verticesBetween(
                points = edgePoints,
                fromFraction = positionFraction(),
                toFraction = if (towardEdgeEnd) 1.0 else 0.0,
            ) +
            nodePoint
    }

    /** Trail geometry along the shared edge from this snap to [other]. */
    fun trailPointsTo(other: TrailNetworkSnap): List<MapPoint> {
        return listOf(projectedPoint) +
            TrailDistanceSijko.verticesBetween(
                points = edgePoints,
                fromFraction = positionFraction(),
                toFraction = other.positionFraction(),
            ) +
            other.projectedPoint
    }

    private fun positionFraction(): Double {
        val totalMeters = distanceFromStartMeters + distanceToEndMeters
        return if (totalMeters > 0.0) distanceFromStartMeters / totalMeters else 0.0
    }
}
