/**
 * Job: Produce the same exercise loop ridden in the opposite direction for navigation.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteReverseSijko {
    /**
     * Reverses the traversal order and the geometry of every segment and edge. Distances, costs
     * and direction-independent traversal keys are unchanged, so history and novelty scoring match
     * either direction. Instructions and navigation progress must be recomputed for the result.
     */
    fun reversed(route: TrailRoute): TrailRoute {
        return route.copy(
            edges = route.edges.reversed().map { edge -> edge.reversed() },
            segments = route.segments.reversed().map { segment -> segment.reversed() },
            traversalEdges = route.traversalEdges.reversed(),
        )
    }

    private fun TrailGraphEdge.reversed(): TrailGraphEdge {
        return copy(
            fromNodeId = toNodeId,
            toNodeId = fromNodeId,
            routeSegments = routeSegments.reversed().map { segment -> segment.reversed() },
        )
    }

    private fun TrailRouteSegment.reversed(): TrailRouteSegment = copy(points = points.reversed())
}
