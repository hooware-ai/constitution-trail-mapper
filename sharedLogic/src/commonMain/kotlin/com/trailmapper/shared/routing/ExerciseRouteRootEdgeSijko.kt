/**
 * Job: Build the start-root edges for one exercise start candidate without colliding with graph edge ids.
 *
 */
package com.trailmapper.shared.routing

internal object ExerciseRouteRootEdgeSijko {
    /** Root edge ids start at [firstRootEdgeId], which must be above every graph edge id. */
    fun edgesFor(
        rootNodeId: Int,
        firstRootEdgeId: Int,
        access: TrailRouteEndpointAccess,
        nodesById: Map<Int, TrailGraphNode>,
        historyEdgeCosts: Map<Int, Double>,
    ): ExerciseRouteRootEdges {
        val snap = access.snap
        val snappedHistoryCost = historyEdgeCosts[snap.edge.id] ?: 0.0
        // The two halves split the snap's own measure of the edge, so their shares always sum to one.
        val snappedTrailMeters = snap.distanceFromStartMeters + snap.distanceToEndMeters
        val historyCosts = mutableMapOf<Int, Double>()
        val connections = listOf(
            Triple(snap.edge.fromNodeId, snap.distanceFromStartMeters, false),
            Triple(snap.edge.toNodeId, snap.distanceToEndMeters, true),
        ).mapIndexedNotNull { index, (nodeId, trailDistance, towardEdgeEnd) ->
            val node = nodesById[nodeId] ?: return@mapIndexedNotNull null
            val trailSegment = TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = snap.trailPointsToward(node.point, towardEdgeEnd),
                routeRoles = snap.edge.routeRoles,
                displayStyle = snap.edge.routeSegments.firstOrNull()?.displayStyle ?: TrailRouteDisplayStyle.Unknown,
                name = snap.edge.routeSegments.firstOrNull()?.name,
            )
            val edge = snap.edge.copy(
                id = firstRootEdgeId + index,
                fromNodeId = rootNodeId,
                toNodeId = nodeId,
                distanceMeters = access.accessDistanceMeters + trailDistance,
                ordinaryAccessDistanceMeters = access.accessDistanceMeters,
                routeSegments = TrailRouteSegmentMergeSijko.merge(access.accessSegments + trailSegment),
            )
            if (snappedHistoryCost > 0.0 && snappedTrailMeters > 0.0) {
                historyCosts[edge.id] = snappedHistoryCost * trailDistance / snappedTrailMeters
            }
            ExerciseRouteSearchEdge(nodeId, edge)
        }
        val reverse = connections.map { connection ->
            val edge = connection.edge.copy(
                fromNodeId = connection.toNodeId,
                toNodeId = rootNodeId,
                routeSegments = connection.edge.routeSegments.asReversed().map { segment ->
                    segment.copy(points = segment.points.asReversed())
                },
            )
            ExerciseRouteSearchEdge(rootNodeId, edge)
        }
        // Only the trail portion of a root half lies on the snapped edge, so each overlap is shared in
        // proportion to that length. A snap at a node leaves one zero-length half with no overlap.
        val trailHalves = connections
            .map { it.edge to it.edge.distanceMeters - it.edge.ordinaryAccessDistanceMeters }
            .filter { (_, trailMeters) -> trailMeters > 0.0 }
        val rootShares = trailHalves.associate { (edge, trailMeters) ->
            edge.id to mapOf(snap.edge.id to trailMeters / edge.distanceMeters)
        }
        val snappedShares = if (snap.edge.distanceMeters > 0.0) {
            mapOf(snap.edge.id to trailHalves.associate { (edge, trailMeters) -> edge.id to trailMeters / snap.edge.distanceMeters })
        } else {
            emptyMap()
        }
        return ExerciseRouteRootEdges(
            adjacency = mapOf(rootNodeId to connections, *reverse.groupBy { it.edge.fromNodeId }.toList().toTypedArray()),
            historyCostsByEdgeId = historyCosts,
            overlapSharesByEdgeId = rootShares + snappedShares,
        )
    }
}
