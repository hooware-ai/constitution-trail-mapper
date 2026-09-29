/**
 * Job: Run deterministic bounded shortest-path searches for exercise-loop construction.
 *
 */
package com.trailmapper.shared.routing

internal object ExerciseRouteSearchSijko {
    fun adjacencyFor(graph: TrailGraph): Map<Int, List<ExerciseRouteSearchEdge>> {
        val adjacency = graph.nodes.associate { it.id to mutableListOf<ExerciseRouteSearchEdge>() }.toMutableMap()
        graph.edges.forEach { edge ->
            adjacency.getOrPut(edge.fromNodeId) { mutableListOf() } += ExerciseRouteSearchEdge(edge.toNodeId, edge)
            adjacency.getOrPut(edge.toNodeId) { mutableListOf() } += ExerciseRouteSearchEdge(edge.fromNodeId, edge.reversed())
        }
        return adjacency.mapValues { (_, edges) ->
            edges.sortedWith(compareBy({ it.toNodeId }, { it.edge.id }))
        }
    }

    /**
     * Keeps up to two labels per node, each with its own predecessor: the cheapest and the
     * physically shortest. A cheaper but longer prefix therefore cannot discard the shorter one
     * that is the only way to reach a farther node within [maximumPhysicalDistanceMeters], and
     * every node whose shortest distance fits the cap is reached. Intermediate cost/distance
     * tradeoffs are not kept; keeping every nondominated label was too slow on the shipped network.
     */
    fun searchTree(
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
        startNodeId: Int,
        extraEdges: Map<Int, List<ExerciseRouteSearchEdge>> = emptyMap(),
        edgeCost: (TrailGraphEdge) -> Double,
        destinationNodeId: Int? = null,
        maximumPhysicalDistanceMeters: Double = Double.POSITIVE_INFINITY,
        terminalNodeIds: Set<Int> = emptySet(),
        cancellationCheckpoint: () -> Unit,
    ): ExerciseRouteSearchTree {
        val labels = mutableListOf(ExerciseRouteSearchLabel(startNodeId, 0.0, 0.0, null, null))
        val cheapestLabelIds = mutableMapOf(startNodeId to 0)
        val shortestLabelIds = mutableMapOf(startNodeId to 0)
        val retiredLabelIds = mutableSetOf<Int>()
        val queue = TrailRoutePriorityQueue()
        queue.push(TrailRouteQueueEntry(startNodeId, 0.0, labelId = 0))
        var processed = 0

        fun addLabel(label: ExerciseRouteSearchLabel): Boolean {
            val nodeId = label.nodeId
            val cheapestId = cheapestLabelIds[nodeId]
            val shortestId = shortestLabelIds[nodeId]
            val becomesCheapest = cheapestId == null || label.isCheaperThan(labels[cheapestId])
            val becomesShortest = shortestId == null || label.isShorterThan(labels[shortestId])
            if (!becomesCheapest && !becomesShortest) {
                return false
            }
            val labelId = labels.size
            labels += label
            if (becomesCheapest) {
                cheapestLabelIds[nodeId] = labelId
            }
            if (becomesShortest) {
                shortestLabelIds[nodeId] = labelId
            }
            // A replaced label that no longer holds either slot need not be expanded.
            listOfNotNull(cheapestId, shortestId).forEach { oldId ->
                if (oldId != cheapestLabelIds[nodeId] && oldId != shortestLabelIds[nodeId]) {
                    retiredLabelIds += oldId
                }
            }
            return true
        }

        while (true) {
            if (processed++ % CheckpointInterval == 0) {
                cancellationCheckpoint()
            }
            val entry = queue.pop() ?: break
            if (entry.labelId in retiredLabelIds) {
                continue
            }
            val current = labels[entry.labelId]
            if (current.nodeId == destinationNodeId) {
                break
            }
            if (current.nodeId in terminalNodeIds) {
                continue
            }
            val graphNeighbors = adjacency[current.nodeId].orEmpty()
            val additionalNeighbors = extraEdges[current.nodeId].orEmpty()
            val neighbors = if (additionalNeighbors.isEmpty()) {
                graphNeighbors
            } else {
                (graphNeighbors + additionalNeighbors)
                    .sortedWith(compareBy({ it.toNodeId }, { it.edge.id }))
            }
            neighbors.forEach { searchEdge ->
                val candidateDistance = current.physicalDistanceMeters + searchEdge.edge.distanceMeters
                if (candidateDistance > maximumPhysicalDistanceMeters) {
                    return@forEach
                }
                val candidate = ExerciseRouteSearchLabel(
                    nodeId = searchEdge.toNodeId,
                    totalCost = current.totalCost + edgeCost(searchEdge.edge),
                    physicalDistanceMeters = candidateDistance,
                    previousLabelId = entry.labelId,
                    edge = searchEdge.edge,
                )
                if (addLabel(candidate)) {
                    queue.push(TrailRouteQueueEntry(candidate.nodeId, candidate.totalCost, labels.lastIndex))
                }
            }
        }

        return ExerciseRouteSearchTree(
            startNodeId = startNodeId,
            totalCosts = cheapestLabelIds.mapValues { (_, labelId) -> labels[labelId].totalCost },
            physicalDistancesMeters = cheapestLabelIds.mapValues { (_, labelId) -> labels[labelId].physicalDistanceMeters },
            bestLabelIds = cheapestLabelIds,
            labels = labels,
        )
    }

    fun pathTo(
        tree: ExerciseRouteSearchTree,
        destinationNodeId: Int,
    ): ExerciseRouteSearchPath? {
        val destination = tree.bestLabelIds[destinationNodeId]?.let(tree.labels::get) ?: return null
        val edges = mutableListOf<TrailGraphEdge>()
        var cursor = destination
        while (true) {
            val previousLabelId = cursor.previousLabelId ?: break
            edges += cursor.edge ?: return null
            cursor = tree.labels[previousLabelId]
        }
        return ExerciseRouteSearchPath(
            edges = edges.asReversed(),
            totalCost = destination.totalCost,
            totalDistanceMeters = destination.physicalDistanceMeters,
        )
    }

    fun reversed(path: ExerciseRouteSearchPath): ExerciseRouteSearchPath {
        return ExerciseRouteSearchPath(
            edges = path.edges.asReversed().map { edge -> edge.reversed() },
            totalCost = path.totalCost,
            totalDistanceMeters = path.totalDistanceMeters,
        )
    }

    private fun TrailGraphEdge.reversed(): TrailGraphEdge {
        return copy(
            fromNodeId = toNodeId,
            toNodeId = fromNodeId,
            routeSegments = routeSegments.asReversed().map { segment -> segment.copy(points = segment.points.asReversed()) },
        )
    }

    private fun ExerciseRouteSearchLabel.isCheaperThan(other: ExerciseRouteSearchLabel): Boolean {
        return totalCost < other.totalCost - CostEpsilon ||
            (totalCost <= other.totalCost + CostEpsilon &&
                physicalDistanceMeters < other.physicalDistanceMeters - DistanceEpsilonMeters)
    }

    private fun ExerciseRouteSearchLabel.isShorterThan(other: ExerciseRouteSearchLabel): Boolean {
        return physicalDistanceMeters < other.physicalDistanceMeters - DistanceEpsilonMeters ||
            (physicalDistanceMeters <= other.physicalDistanceMeters + DistanceEpsilonMeters &&
                totalCost < other.totalCost - CostEpsilon)
    }

    private const val CheckpointInterval = 128
    private const val CostEpsilon = 0.000001
    private const val DistanceEpsilonMeters = 0.000001
}
