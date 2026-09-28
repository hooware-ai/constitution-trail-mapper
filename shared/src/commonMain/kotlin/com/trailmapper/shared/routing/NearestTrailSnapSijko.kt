/**
 * Job: Find the nearest approved trail-network graph edge for a user-selected point.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object NearestTrailSnapSijko {
    fun nearestSnap(
        graph: TrailGraph,
        point: MapPoint,
        cancellationCheckpoint: () -> Unit = {},
    ): TrailNetworkSnap? {
        return nearestSnaps(
            graph = graph,
            point = point,
            limit = 1,
            cancellationCheckpoint = cancellationCheckpoint,
        ).firstOrNull()
    }

    fun nearestSnaps(
        graph: TrailGraph,
        point: MapPoint,
        limit: Int,
        maxAccessDistanceMeters: Double = Double.POSITIVE_INFINITY,
        includeNodeSnaps: Boolean = false,
        cancellationCheckpoint: () -> Unit = {},
    ): List<TrailNetworkSnap> {
        val nodesById = graph.nodes.associateBy { it.id }
        val snaps = mutableListOf<TrailNetworkSnap>()
        val nodeSnapsByNodeId = mutableMapOf<Int, TrailNetworkSnap>()
        graph.edges.forEachIndexed { index, edge ->
            if (index % CHECKPOINT_EDGE_INTERVAL == 0) {
                cancellationCheckpoint()
            }

            val fromNode = nodesById[edge.fromNodeId] ?: return@forEachIndexed
            val toNode = nodesById[edge.toNodeId] ?: return@forEachIndexed
            val edgePoints = edge.nodeAnchoredPoints(fromNode, toNode)
            val projection = TrailDistanceSijko.projectToPolyline(
                point = point,
                points = edgePoints,
            )
            val snap = TrailNetworkSnap(
                edge = edge,
                projectedPoint = projection.projectedPoint,
                accessDistanceMeters = projection.distanceMeters,
                distanceFromStartMeters = projection.distanceFromStartMeters,
                distanceToEndMeters = projection.distanceToEndMeters,
                edgePoints = edgePoints,
            )
            if (snap.accessDistanceMeters <= maxAccessDistanceMeters) {
                snaps += snap
            }

            if (includeNodeSnaps) {
                // Node snaps measure the same node-anchored polyline their geometry follows, as projections
                // do. The edge's own distance runs between its raw end vertices, which may sit off the nodes.
                val anchoredMeters = projection.distanceFromStartMeters + projection.distanceToEndMeters
                if (edge.fromNodeId !in nodeSnapsByNodeId) {
                    val fromSnap = TrailNetworkSnap(
                        edge = edge,
                        projectedPoint = fromNode.point,
                        accessDistanceMeters = TrailDistanceSijko.metersBetween(point, fromNode.point),
                        distanceFromStartMeters = 0.0,
                        distanceToEndMeters = anchoredMeters,
                        edgePoints = edgePoints,
                    )
                    if (fromSnap.accessDistanceMeters <= maxAccessDistanceMeters) {
                        nodeSnapsByNodeId[edge.fromNodeId] = fromSnap
                    }
                }
                if (edge.toNodeId !in nodeSnapsByNodeId) {
                    val toSnap = TrailNetworkSnap(
                        edge = edge,
                        projectedPoint = toNode.point,
                        accessDistanceMeters = TrailDistanceSijko.metersBetween(point, toNode.point),
                        distanceFromStartMeters = anchoredMeters,
                        distanceToEndMeters = 0.0,
                        edgePoints = edgePoints,
                    )
                    if (toSnap.accessDistanceMeters <= maxAccessDistanceMeters) {
                        nodeSnapsByNodeId[edge.toNodeId] = toSnap
                    }
                }
            }
        }

        return (snaps + nodeSnapsByNodeId.values)
            .sortedBy { it.accessDistanceMeters }
            .take(limit)
    }

    /** The edge's drawn interior vertices between its actual graph node points. */
    private fun TrailGraphEdge.nodeAnchoredPoints(
        fromNode: TrailGraphNode,
        toNode: TrailGraphNode,
    ): List<MapPoint> {
        val interior = routeSegments.flatMap { segment -> segment.points }.drop(1).dropLast(1)
        return listOf(fromNode.point) + interior + toNode.point
    }

    private const val CHECKPOINT_EDGE_INTERVAL = 256
}
