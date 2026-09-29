/**
 * Job: Find a constrained route using only approved graph edges plus short endpoint access legs.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.abs

object TrailRouteFinderSijko {
    fun findRoute(
        graph: TrailGraph,
        start: MapPoint,
        destination: MapPoint,
        maxAccessMeters: Double = 800.0,
        graphSegmentType: TrailRouteSegmentType = TrailRouteSegmentType.Trail,
        cancellationCheckpoint: () -> Unit = {},
    ): TrailRoute? {
        cancellationCheckpoint()
        if (graph.edges.isEmpty() || graph.nodes.isEmpty()) {
            return null
        }

        val startSnap = NearestTrailSnapSijko.nearestSnap(
            graph = graph,
            point = start,
            cancellationCheckpoint = cancellationCheckpoint,
        ) ?: return null
        val destinationSnap = NearestTrailSnapSijko.nearestSnap(
            graph = graph,
            point = destination,
            cancellationCheckpoint = cancellationCheckpoint,
        ) ?: return null
        cancellationCheckpoint()
        if (startSnap.accessDistanceMeters > maxAccessMeters ||
            destinationSnap.accessDistanceMeters > maxAccessMeters
        ) {
            return null
        }

        return findRoute(
            graph = graph,
            startAccess = TrailRouteEndpointAccessSijko.estimated(
                endpointPoint = start,
                snap = startSnap,
            ),
            destinationAccess = TrailRouteEndpointAccessSijko.estimated(
                endpointPoint = destination,
                snap = destinationSnap,
            ),
            graphSegmentType = graphSegmentType,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }

    fun findRoute(
        graph: TrailGraph,
        startAccess: TrailRouteEndpointAccess,
        destinationAccess: TrailRouteEndpointAccess,
        graphSegmentType: TrailRouteSegmentType = TrailRouteSegmentType.Trail,
        cancellationCheckpoint: () -> Unit = {},
    ): TrailRoute? {
        return findRoute(
            graph = graph,
            startAccesses = listOf(startAccess),
            destinationAccesses = listOf(destinationAccess),
            graphSegmentType = graphSegmentType,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }

    fun findRouteAlternatives(
        graph: TrailGraph,
        startAccess: TrailRouteEndpointAccess,
        destinationAccess: TrailRouteEndpointAccess,
        graphSegmentType: TrailRouteSegmentType = TrailRouteSegmentType.Trail,
        cancellationCheckpoint: () -> Unit = {},
    ): List<TrailRoute> {
        return findRouteAlternatives(
            graph = graph,
            startAccess = startAccess,
            destinationAccesses = listOf(destinationAccess),
            graphSegmentType = graphSegmentType,
            cancellationCheckpoint = cancellationCheckpoint,
        ).singleOrNull().orEmpty()
    }

    fun findRouteAlternatives(
        graph: TrailGraph,
        startAccess: TrailRouteEndpointAccess,
        destinationAccesses: List<TrailRouteEndpointAccess>,
        graphSegmentType: TrailRouteSegmentType = TrailRouteSegmentType.Trail,
        cancellationCheckpoint: () -> Unit = {},
    ): List<List<TrailRoute>> {
        val destinationAccessGroups = destinationAccesses.map { access -> listOf(access) }
        val weightedRoutes = findRoutes(
            graph = graph,
            startAccesses = listOf(startAccess),
            destinationAccessGroups = destinationAccessGroups,
            graphSegmentType = graphSegmentType,
            edgeCost = TrailEdgeWeightSijko::cost,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        val distanceRoutes = findRoutes(
            graph = graph,
            startAccesses = listOf(startAccess),
            destinationAccessGroups = destinationAccessGroups,
            graphSegmentType = graphSegmentType,
            edgeCost = TrailRouteDistanceWeightSijko::cost,
            cancellationCheckpoint = cancellationCheckpoint,
        )

        return weightedRoutes.zip(distanceRoutes).map { (weightedRoute, distanceRoute) ->
            listOfNotNull(weightedRoute, distanceRoute)
                .distinctBy { route -> route.edgeSignature() }
        }
    }

    fun findRoute(
        graph: TrailGraph,
        startAccesses: List<TrailRouteEndpointAccess>,
        destinationAccesses: List<TrailRouteEndpointAccess>,
        graphSegmentType: TrailRouteSegmentType = TrailRouteSegmentType.Trail,
        cancellationCheckpoint: () -> Unit = {},
        edgeCost: (TrailGraphEdge) -> Double = TrailEdgeWeightSijko::cost,
    ): TrailRoute? {
        return findRoutes(
            graph = graph,
            startAccesses = startAccesses,
            destinationAccessGroups = listOf(destinationAccesses),
            graphSegmentType = graphSegmentType,
            cancellationCheckpoint = cancellationCheckpoint,
            edgeCost = edgeCost,
        ).singleOrNull()
    }

    fun findRoutes(
        graph: TrailGraph,
        startAccesses: List<TrailRouteEndpointAccess>,
        destinationAccessGroups: List<List<TrailRouteEndpointAccess>>,
        graphSegmentType: TrailRouteSegmentType = TrailRouteSegmentType.Trail,
        cancellationCheckpoint: () -> Unit = {},
        edgeCost: (TrailGraphEdge) -> Double = TrailEdgeWeightSijko::cost,
    ): List<TrailRoute?> {
        cancellationCheckpoint()
        if (destinationAccessGroups.isEmpty()) {
            return emptyList()
        }
        if (graph.edges.isEmpty() ||
            graph.nodes.isEmpty() ||
            startAccesses.isEmpty()
        ) {
            return List(destinationAccessGroups.size) { null }
        }

        val startNodeId = (graph.nodes.maxOfOrNull { it.id } ?: 0) + 1
        val destinationNodeIds = destinationAccessGroups.indices.map { index ->
            startNodeId + index + 1
        }
        val nodesById = graph.nodes.associateBy { it.id }
        val searchEdges = graph.edges.toMutableList()
        startAccesses.forEach { access ->
            addSnapEdges(
                edges = searchEdges,
                access = access,
                nodeId = startNodeId,
                nodesById = nodesById,
                graphSegmentType = graphSegmentType,
            )
        }
        destinationAccessGroups.forEachIndexed { index, destinationAccesses ->
            val destinationNodeId = destinationNodeIds[index]
            destinationAccesses.forEach { access ->
                addSnapEdges(
                    edges = searchEdges,
                    access = access,
                    nodeId = destinationNodeId,
                    nodesById = nodesById,
                    graphSegmentType = graphSegmentType,
                )
            }
            startAccesses.forEach { startAccess ->
                destinationAccesses.forEach { destinationAccess ->
                    if (startAccess.snap.edge.id == destinationAccess.snap.edge.id) {
                        searchEdges += snapToSnapEdge(
                            id = searchEdges.size,
                            startNodeId = startNodeId,
                            destinationNodeId = destinationNodeId,
                            startAccess = startAccess,
                            destinationAccess = destinationAccess,
                            graphSegmentType = graphSegmentType,
                        )
                    }
                }
            }
        }

        return shortestPaths(
            nodeIds = graph.nodes.map { it.id } + startNodeId + destinationNodeIds,
            edges = searchEdges,
            startNodeId = startNodeId,
            destinationNodeIds = destinationNodeIds,
            edgeCost = edgeCost,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }

    private fun addSnapEdges(
        edges: MutableList<TrailGraphEdge>,
        access: TrailRouteEndpointAccess,
        nodeId: Int,
        nodesById: Map<Int, TrailGraphNode>,
        graphSegmentType: TrailRouteSegmentType,
    ) {
        val snap = access.snap
        nodesById[snap.edge.fromNodeId]?.let { graphNode ->
            edges += snapConnectorEdge(
                id = edges.size,
                access = access,
                nodeId = nodeId,
                graphNodeId = snap.edge.fromNodeId,
                graphNodePoint = graphNode.point,
                towardEdgeEnd = false,
                trailDistanceMeters = snap.distanceFromStartMeters,
                graphSegmentType = graphSegmentType,
            )
        }
        nodesById[snap.edge.toNodeId]?.let { graphNode ->
            edges += snapConnectorEdge(
                id = edges.size,
                access = access,
                nodeId = nodeId,
                graphNodeId = snap.edge.toNodeId,
                graphNodePoint = graphNode.point,
                towardEdgeEnd = true,
                trailDistanceMeters = snap.distanceToEndMeters,
                graphSegmentType = graphSegmentType,
            )
        }
    }

    private fun snapConnectorEdge(
        id: Int,
        access: TrailRouteEndpointAccess,
        nodeId: Int,
        graphNodeId: Int,
        graphNodePoint: MapPoint,
        towardEdgeEnd: Boolean,
        trailDistanceMeters: Double,
        graphSegmentType: TrailRouteSegmentType,
    ): TrailGraphEdge {
        val snap = access.snap
        return snap.edge.copy(
            id = id,
            fromNodeId = nodeId,
            toNodeId = graphNodeId,
            distanceMeters = access.accessDistanceMeters + trailDistanceMeters,
            ordinaryAccessDistanceMeters = if (graphSegmentType == TrailRouteSegmentType.Access) {
                access.accessDistanceMeters + trailDistanceMeters
            } else {
                access.accessDistanceMeters
            },
            routeSegments = buildRouteSegments(
                access.accessSegments +
                    TrailRouteSegment(
                        type = graphSegmentType,
                        points = snap.trailPointsToward(graphNodePoint, towardEdgeEnd),
                        routeRoles = snap.edge.routeRolesFor(graphSegmentType),
                        displayStyle = snap.edge.displayStyleFor(graphSegmentType),
                        name = snap.edge.routeSegmentName(),
                    ),
            ),
        )
    }

    private fun snapToSnapEdge(
        id: Int,
        startNodeId: Int,
        destinationNodeId: Int,
        startAccess: TrailRouteEndpointAccess,
        destinationAccess: TrailRouteEndpointAccess,
        graphSegmentType: TrailRouteSegmentType,
    ): TrailGraphEdge {
        val startSnap = startAccess.snap
        val destinationSnap = destinationAccess.snap
        val networkDistanceMeters = abs(startSnap.distanceFromStartMeters - destinationSnap.distanceFromStartMeters)
        val accessDistanceMeters = startAccess.accessDistanceMeters + destinationAccess.accessDistanceMeters
        return startSnap.edge.copy(
            id = id,
            fromNodeId = startNodeId,
            toNodeId = destinationNodeId,
            distanceMeters = accessDistanceMeters + networkDistanceMeters,
            ordinaryAccessDistanceMeters = if (graphSegmentType == TrailRouteSegmentType.Access) {
                accessDistanceMeters + networkDistanceMeters
            } else {
                accessDistanceMeters
            },
            routeSegments = buildRouteSegments(
                startAccess.accessSegments +
                    TrailRouteSegment(
                        type = graphSegmentType,
                        points = startSnap.trailPointsTo(destinationSnap),
                        routeRoles = startSnap.edge.routeRolesFor(graphSegmentType),
                        displayStyle = startSnap.edge.displayStyleFor(graphSegmentType),
                        name = startSnap.edge.routeSegmentName(),
                    ) +
                    destinationAccess.accessSegments.reversedForTraversal(),
            ),
        )
    }

    private fun buildRouteSegments(segments: List<TrailRouteSegment>): List<TrailRouteSegment> {
        return TrailRouteSegmentMergeSijko.merge(segments)
    }

    private fun shortestPaths(
        nodeIds: List<Int>,
        edges: List<TrailGraphEdge>,
        startNodeId: Int,
        destinationNodeIds: List<Int>,
        edgeCost: (TrailGraphEdge) -> Double,
        cancellationCheckpoint: () -> Unit,
    ): List<TrailRoute?> {
        val adjacency = mutableMapOf<Int, MutableList<Pair<Int, TrailGraphEdge>>>()
        nodeIds.forEach { adjacency[it] = mutableListOf() }
        edges.forEach { edge ->
            adjacency.getOrPut(edge.fromNodeId) { mutableListOf() } += edge.toNodeId to edge
            adjacency.getOrPut(edge.toNodeId) { mutableListOf() } += edge.fromNodeId to edge.reversedForTraversal()
        }

        val distances = nodeIds.associateWith { Double.POSITIVE_INFINITY }.toMutableMap()
        val previousNode = mutableMapOf<Int, Int>()
        val previousEdge = mutableMapOf<Int, TrailGraphEdge>()
        distances[startNodeId] = 0.0
        val queue = TrailRoutePriorityQueue()
        queue.push(TrailRouteQueueEntry(nodeId = startNodeId, cost = 0.0))
        val destinationNodeIdSet = destinationNodeIds.toSet()
        val remainingDestinationNodeIds = destinationNodeIdSet.toMutableSet()

        var processedNodeCount = 0
        while (true) {
            if (processedNodeCount % CHECKPOINT_NODE_INTERVAL == 0) {
                cancellationCheckpoint()
            }
            processedNodeCount += 1
            val current = queue.pop() ?: break
            val currentDistance = distances[current.nodeId] ?: Double.POSITIVE_INFINITY
            if (current.cost > currentDistance) {
                continue
            }
            if (current.nodeId in destinationNodeIdSet) {
                remainingDestinationNodeIds.remove(current.nodeId)
                if (remainingDestinationNodeIds.isEmpty()) {
                    break
                }
                continue
            }

            adjacency[current.nodeId].orEmpty().forEach { (neighbor, edge) ->
                val candidate = currentDistance + edgeCost(edge)
                if (candidate < (distances[neighbor] ?: Double.POSITIVE_INFINITY)) {
                    distances[neighbor] = candidate
                    previousNode[neighbor] = current.nodeId
                    previousEdge[neighbor] = edge
                    queue.push(TrailRouteQueueEntry(nodeId = neighbor, cost = candidate))
                }
            }
        }

        return destinationNodeIds.map { destinationNodeId ->
            routeToDestination(
                destinationNodeId = destinationNodeId,
                startNodeId = startNodeId,
                distances = distances,
                previousNode = previousNode,
                previousEdge = previousEdge,
            )
        }
    }

    private fun routeToDestination(
        destinationNodeId: Int,
        startNodeId: Int,
        distances: Map<Int, Double>,
        previousNode: Map<Int, Int>,
        previousEdge: Map<Int, TrailGraphEdge>,
    ): TrailRoute? {
        val totalCost = distances[destinationNodeId] ?: return null
        if (totalCost == Double.POSITIVE_INFINITY) {
            return null
        }

        val routeEdges = mutableListOf<TrailGraphEdge>()
        var cursor = destinationNodeId
        while (cursor != startNodeId) {
            val edge = previousEdge[cursor] ?: return null
            routeEdges += edge
            cursor = previousNode[cursor] ?: return null
        }
        routeEdges.reverse()

        return TrailRoute(
            edges = routeEdges,
            segments = TrailRouteSegmentMergeSijko.merge(routeEdges.flatMap { it.routeSegments }),
            totalDistanceMeters = routeEdges.sumOf { it.distanceMeters },
            ordinaryAccessDistanceMeters = routeEdges.sumOf { it.ordinaryAccessDistanceMeters },
            sharedRoadwayDistanceMeters = TrailRouteSharedRoadwayDistanceSijko.distanceMeters(routeEdges),
            totalCost = totalCost,
        )
    }

    private fun TrailGraphEdge.reversedForTraversal(): TrailGraphEdge {
        return copy(
            fromNodeId = toNodeId,
            toNodeId = fromNodeId,
            routeSegments = routeSegments.asReversed().map { segment ->
                segment.copy(points = segment.points.asReversed())
            },
        )
    }

    private fun List<TrailRouteSegment>.reversedForTraversal(): List<TrailRouteSegment> {
        return asReversed().map { segment ->
            segment.copy(points = segment.points.asReversed())
        }
    }

    private fun TrailGraphEdge.routeRolesFor(segmentType: TrailRouteSegmentType): Set<TrailNetworkRole> {
        return if (segmentType == TrailRouteSegmentType.Trail) {
            routeRoles
        } else {
            emptySet()
        }
    }

    private fun TrailGraphEdge.displayStyleFor(segmentType: TrailRouteSegmentType): TrailRouteDisplayStyle {
        return if (segmentType == TrailRouteSegmentType.Trail) {
            routeSegments.firstOrNull()?.displayStyle ?: TrailRouteDisplayStyle.Unknown
        } else {
            TrailRouteDisplayStyle.Unknown
        }
    }

    private fun TrailGraphEdge.routeSegmentName(): String? {
        return TrailRouteNameSijko.normalized(routeSegments.firstOrNull()?.name)
    }

    private fun TrailRoute.edgeSignature(): String {
        return edges.joinToString(separator = "|") { edge ->
            "${edge.sourceFeatureId}:${edge.fromNodeId}:${edge.toNodeId}:${edge.distanceMeters}"
        }
    }

    private const val CHECKPOINT_NODE_INTERVAL = 256
}
