/**
 * Job: Find deterministic distance-targeted exercise loops over the enabled trail network.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerSelection
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.max

object ExerciseRouteCalculationSijko {
    fun findRoute(
        features: List<TrailNetworkFeature>,
        routeLayers: RouteLayerSelection,
        startPoint: MapPoint,
        targetDistanceMeters: Double,
        completedSessions: List<CompletedExerciseSession>,
        accessGraph: TrailGraph? = null,
        nowEpochMillis: Long,
        cancellationCheckpoint: () -> Unit = {},
        candidateObserver: (Double, Double, Boolean) -> Unit = { _, _, _ -> },
    ): ExerciseRouteResult? {
        cancellationCheckpoint()
        if (!ExerciseRouteTargetSijko.isValid(targetDistanceMeters)) {
            return null
        }
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = TrailRouteClosureSijko.openFeatures(
                features = TrailFeatureFilterSijko.enabledFeatures(features, routeLayers),
                nowEpochMillis = nowEpochMillis,
            ).features,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        if (graph.nodes.isEmpty() || graph.edges.isEmpty()) {
            return null
        }
        val adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph)
        val startCandidates = startCandidates(graph, accessGraph, startPoint, adjacency, cancellationCheckpoint)
        if (startCandidates.isEmpty()) {
            return null
        }
        val history = ExerciseRouteHistoryIndex.build(completedSessions, nowEpochMillis)
        val historyEdgeCosts = ExerciseRouteHistoryEdgeCostSijko.costsByEdgeId(
            edges = graph.edges,
            history = history,
        )
        val nodesById = graph.nodes.associateBy { it.id }
        val rootNodeId = (graph.nodes.maxOfOrNull { it.id } ?: 0) + 1
        val firstRootEdgeId = graph.edges.maxOf { it.id } + 1
        var bestCircuit: ExerciseRouteCandidate? = null
        var bestFallback: ExerciseRouteCandidate? = null

        fun consider(candidate: ExerciseRouteCandidate) {
            val isCircuit = ExerciseRouteLoopQualitySijko.isCircuit(
                    totalDistanceMeters = candidate.totalDistanceMeters,
                    selfOverlapMeters = candidate.selfOverlapMeters,
                )
            candidateObserver(
                candidate.totalDistanceMeters,
                candidate.selfOverlapMeters,
                isCircuit,
            )
            if (isCircuit) {
                if (bestCircuit == null || candidate.isBetterThan(bestCircuit!!)) {
                    bestCircuit = candidate
                }
            } else if (bestFallback == null || candidate.isBetterThan(bestFallback!!)) {
                bestFallback = candidate
            }
        }

        startCandidates.forEachIndexed { candidateIndex, startAccess ->
            if (candidateIndex >= MaximumStartCandidates &&
                bestCircuit?.let { it.isWithinTargetTolerance && !it.entersHazard } == true
            ) {
                return@forEachIndexed
            }
            cancellationCheckpoint()
            val rootEdges = ExerciseRouteRootEdgeSijko.edgesFor(
                rootNodeId = rootNodeId,
                firstRootEdgeId = firstRootEdgeId,
                access = startAccess,
                nodesById = nodesById,
                historyEdgeCosts = historyEdgeCosts,
            )
            val extraEdges = rootEdges.adjacency
            fun explorationSearchCost(edge: TrailGraphEdge): Double {
                val historyCost = rootEdges.historyCostsByEdgeId[edge.id] ?: historyEdgeCosts[edge.id] ?: 0.0
                return TrailEdgeWeightSijko.cost(edge) + historyCost * SearchHistoryWeight
            }
            val outbound = ExerciseRouteSearchSijko.searchTree(
                adjacency = adjacency,
                startNodeId = rootNodeId,
                extraEdges = extraEdges,
                edgeCost = ::explorationSearchCost,
                maximumPhysicalDistanceMeters = targetDistanceMeters * RootSearchDistanceRatio +
                    startAccess.accessDistanceMeters * 2.0,
                cancellationCheckpoint = cancellationCheckpoint,
            )
            anchors(outbound, rootNodeId, nodesById, startPoint, targetDistanceMeters).forEach { anchorNodeId ->
                cancellationCheckpoint()
                val outboundPath = ExerciseRouteSearchSijko.pathTo(outbound, anchorNodeId) ?: return@forEach
                if (outboundPath.edges.isEmpty()) {
                    return@forEach
                }
                val outboundEdgeIds = outboundPath.edges
                    .filter { it.ordinaryAccessDistanceMeters <= 0.0 }
                    .mapTo(mutableSetOf()) { edge -> edge.id }
                val fromAnchorSearch = ExerciseRouteSearchSijko.searchTree(
                    adjacency = adjacency,
                    startNodeId = anchorNodeId,
                    extraEdges = extraEdges,
                    edgeCost = { edge ->
                        val baseCost = explorationSearchCost(edge)
                        baseCost +
                            if (edge.ordinaryAccessDistanceMeters <= 0.0) {
                                baseCost * OutboundReusePenalty * rootEdges.reusedShare(edge, outboundEdgeIds)
                            } else {
                                0.0
                            }
                    },
                    maximumPhysicalDistanceMeters = targetDistanceMeters * ViaSearchDistanceRatio +
                        startAccess.accessDistanceMeters * 2.0,
                    terminalNodeIds = setOf(rootNodeId),
                    cancellationCheckpoint = cancellationCheckpoint,
                )

                ExerciseRouteSearchSijko.pathTo(fromAnchorSearch, rootNodeId)?.let { returnPath ->
                    consider(
                        candidateFor(
                            edges = outboundPath.edges + returnPath.edges,
                            targetDistanceMeters = targetDistanceMeters,
                            history = history,
                            startCandidateIndex = candidateIndex,
                            startPoint = startPoint,
                            adjacency = adjacency,
                        ),
                    )
                }

                viaAnchorNodeIds(
                    outboundPath = outboundPath,
                    fromAnchorSearch = fromAnchorSearch,
                    rootSearch = outbound,
                    anchorNodeId = anchorNodeId,
                    rootNodeId = rootNodeId,
                    nodesById = nodesById,
                    startPoint = startPoint,
                    targetDistanceMeters = targetDistanceMeters,
                ).forEach { viaNodeId ->
                    cancellationCheckpoint()
                    val anchorToVia = ExerciseRouteSearchSijko.pathTo(
                        tree = fromAnchorSearch,
                        destinationNodeId = viaNodeId,
                    ) ?: return@forEach
                    val rootToVia = ExerciseRouteSearchSijko.pathTo(
                        tree = outbound,
                        destinationNodeId = viaNodeId,
                    ) ?: return@forEach
                    val viaToRoot = ExerciseRouteSearchSijko.reversed(rootToVia)
                    consider(
                        candidateFor(
                            edges = outboundPath.edges + anchorToVia.edges + viaToRoot.edges,
                            targetDistanceMeters = targetDistanceMeters,
                            history = history,
                            startCandidateIndex = candidateIndex,
                            startPoint = startPoint,
                            adjacency = adjacency,
                        ),
                    )
                }
            }
        }

        val circuitBeforeShortcut = bestCircuit
        if (accessGraph != null &&
            circuitBeforeShortcut != null &&
            circuitBeforeShortcut.distanceErrorMeters > ExerciseRouteTargetSijko.toleranceMeters(targetDistanceMeters) &&
            circuitBeforeShortcut.totalDistanceMeters > targetDistanceMeters
        ) {
            ExerciseRouteShortcutSijko.candidates(
                routeEdges = circuitBeforeShortcut.edges,
                accessGraph = accessGraph,
                targetDistanceMeters = targetDistanceMeters,
                cancellationCheckpoint = cancellationCheckpoint,
            ).forEach { shortcutEdges ->
                consider(
                    candidateFor(
                        edges = shortcutEdges,
                        targetDistanceMeters = targetDistanceMeters,
                        history = history,
                        startCandidateIndex = circuitBeforeShortcut.startCandidateIndex,
                        startPoint = startPoint,
                        adjacency = adjacency,
                    ),
                )
            }
        }

        // A reviewed hazard outranks loop shape: a safe out-and-back beats a circuit through it.
        // Otherwise a circuit is preferred only within the target tolerance; a far-off circuit
        // competes with the best out-and-back on the normal candidate ranking.
        val circuit = bestCircuit
        val fallback = bestFallback
        val selected = when {
            circuit == null -> fallback
            fallback == null -> circuit
            fallback.entersHazard != circuit.entersHazard -> if (circuit.entersHazard) fallback else circuit
            circuit.isWithinTargetTolerance -> circuit
            fallback.isBetterThan(circuit) -> fallback
            else -> circuit
        } ?: return null
        val status = if (
            selected.distanceErrorMeters <= ExerciseRouteTargetSijko.toleranceMeters(targetDistanceMeters) &&
            ExerciseRouteLoopQualitySijko.isCircuit(
                totalDistanceMeters = selected.totalDistanceMeters,
                selfOverlapMeters = selected.selfOverlapMeters,
            )
        ) {
            ExerciseRouteStatus.Exact
        } else {
            ExerciseRouteStatus.Closest
        }
        val route = TrailRoute(
            edges = selected.edges,
            segments = TrailRouteSegmentMergeSijko.merge(selected.edges.flatMap { it.routeSegments }),
            totalDistanceMeters = selected.totalDistanceMeters,
            ordinaryAccessDistanceMeters = selected.edges.sumOf { it.ordinaryAccessDistanceMeters },
            sharedRoadwayDistanceMeters = TrailRouteSharedRoadwayDistanceSijko.distanceMeters(selected.edges),
            totalCost = selected.safetyCost,
            kind = TrailRouteKind.ExerciseLoop,
            requestedDistanceMeters = targetDistanceMeters,
            routeLayers = routeLayers,
            traversalEdges = TrailRouteChoicePointSijko.annotate(selected.edges, selected.traversalEdges, graph, accessGraph),
        )
        val durationSummary = ExerciseRouteDurationSijko.formatFor(route.totalDistanceMeters)
        return ExerciseRouteResult(
            route = route,
            status = status,
            summary = ExerciseRouteSummarySijko.summaryFor(route, status, durationSummary),
            routeKey = ExerciseRouteKeySijko.keyFor(selected.traversalEdges),
            durationSummary = durationSummary,
            distanceErrorMeters = selected.distanceErrorMeters,
            historyOverlapMeters = selected.historyOverlapMeters,
            selfOverlapMeters = selected.selfOverlapMeters,
        )
    }

    private fun startCandidates(
        graph: TrailGraph,
        accessGraph: TrailGraph?,
        startPoint: MapPoint,
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
        cancellationCheckpoint: () -> Unit,
    ): List<TrailRouteEndpointAccess> {
        if (accessGraph != null && accessGraph.edges.isNotEmpty()) {
            val routedCandidates = TrailRouteEndpointAccessSelectorSijko.candidates(
                trailGraph = graph,
                accessGraph = accessGraph,
                endpointPoint = startPoint,
                roughCandidateLimit = MaximumRoughAccessCandidates,
                resultLimit = MaximumRoughAccessCandidates,
                cancellationCheckpoint = cancellationCheckpoint,
            )
            if (routedCandidates.isNotEmpty()) {
                return expandedStartCandidates(routedCandidates, adjacency, cancellationCheckpoint)
            }
        }
        val directCandidates = NearestTrailSnapSijko.nearestSnaps(
            graph = graph,
            point = startPoint,
            limit = graph.edges.size + graph.nodes.size,
            maxAccessDistanceMeters = MaximumDirectAccessMeters,
            includeNodeSnaps = true,
            cancellationCheckpoint = cancellationCheckpoint,
        ).map { snap -> TrailRouteEndpointAccessSijko.estimated(startPoint, snap) }
        return expandedStartCandidates(directCandidates, adjacency, cancellationCheckpoint)
    }

    private fun expandedStartCandidates(
        candidates: List<TrailRouteEndpointAccess>,
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
        cancellationCheckpoint: () -> Unit,
    ): List<TrailRouteEndpointAccess> {
        // Preserve normal successful choices; reserve extra searches for a missed target.
        val primary = candidates.take(MaximumStartCandidates)
        val coveredNodeIds = mutableSetOf<Int>()
        fun coverComponent(startNodeId: Int) {
            if (!coveredNodeIds.add(startNodeId)) {
                return
            }
            val pending = mutableListOf(startNodeId)
            var cursor = 0
            while (cursor < pending.size) {
                if (cursor % ComponentCheckpointInterval == 0) {
                    cancellationCheckpoint()
                }
                adjacency[pending[cursor++]].orEmpty().forEach { edge ->
                    if (coveredNodeIds.add(edge.toNodeId)) {
                        pending += edge.toNodeId
                    }
                }
            }
        }
        primary.forEach { coverComponent(it.snap.edge.fromNodeId) }
        val selected = primary.toMutableList()
        for (candidate in candidates) {
            if (selected.size >= MaximumExpandedStartCandidates) {
                break
            }
            // A farther entry in an already searched component can disguise retraced
            // trail as estimated access. Recover only components not yet searched.
            if (candidate.snap.edge.fromNodeId !in coveredNodeIds) {
                selected += candidate
                coverComponent(candidate.snap.edge.fromNodeId)
            }
        }
        return selected
    }

    private fun anchors(
        searchTree: ExerciseRouteSearchTree,
        rootNodeId: Int,
        nodesById: Map<Int, TrailGraphNode>,
        startPoint: MapPoint,
        targetDistanceMeters: Double,
    ): List<Int> {
        val targetOutboundDistance = targetDistanceMeters / 2.0
        val reachable = searchTree.physicalDistancesMeters
            .asSequence()
            .filter { (nodeId, distanceMeters) ->
                nodeId != rootNodeId && distanceMeters > 0.0 && nodesById[nodeId] != null
            }
            .sortedWith(
                compareBy<Map.Entry<Int, Double>> { abs(it.value - targetOutboundDistance) }
                    .thenBy { it.key },
            )
            .toList()
        // An anchor very near the start or past half the target almost never closes a loop without
        // retracing, so the distance bands are spent inside that window when the network reaches it.
        val ranked = reachable
            .filter { (_, distanceMeters) ->
                distanceMeters in (targetDistanceMeters * MinimumAnchorRatio)..(targetDistanceMeters * MaximumAnchorRatio)
            }
            .ifEmpty { reachable }
        val selectedBearings = mutableSetOf<Int>()
        val selectedDistances = mutableSetOf<Int>()
        val selected = mutableListOf<Int>()
        fun distanceBucket(distanceMeters: Double): Int {
            return (distanceMeters / max(1.0, targetOutboundDistance) * DistanceAnchorBands).toInt()
        }
        fun select(accept: (Int, Int) -> Boolean) {
            ranked.forEach { (nodeId, distanceMeters) ->
                if (selected.size >= MaximumAnchors || nodeId in selected) {
                    return@forEach
                }
                val bearing = bearingBucket(startPoint, nodesById.getValue(nodeId).point)
                val distance = distanceBucket(distanceMeters)
                if (accept(bearing, distance)) {
                    selected += nodeId
                    selectedBearings += bearing
                    selectedDistances += distance
                }
            }
        }
        select { bearing, distance -> bearing !in selectedBearings && distance !in selectedDistances }
        select { bearing, distance -> bearing !in selectedBearings || distance !in selectedDistances }
        select { _, _ -> true }
        return selected.ifEmpty {
            searchTree.physicalDistancesMeters
                .filterKeys { it != rootNodeId && it in nodesById }
                .maxByOrNull { it.value }
                ?.key
                ?.let(::listOf)
                .orEmpty()
        }
    }

    private fun bearingBucket(start: MapPoint, point: MapPoint): Int {
        val radians = atan2(point.longitude - start.longitude, point.latitude - start.latitude)
        val normalized = (radians + PI * 2.0) % (PI * 2.0)
        return (normalized / (PI * 2.0) * BearingBucketCount).toInt()
    }

    private fun viaAnchorNodeIds(
        outboundPath: ExerciseRouteSearchPath,
        fromAnchorSearch: ExerciseRouteSearchTree,
        rootSearch: ExerciseRouteSearchTree,
        anchorNodeId: Int,
        rootNodeId: Int,
        nodesById: Map<Int, TrailGraphNode>,
        startPoint: MapPoint,
        targetDistanceMeters: Double,
    ): List<Int> {
        val viaOverlap = ExerciseRouteViaOverlapSijko(rootSearch, fromAnchorSearch, anchorNodeId)
        val ranked = fromAnchorSearch.physicalDistancesMeters
            .mapNotNull { (nodeId, anchorDistanceMeters) ->
                if (nodeId == rootNodeId || nodeId == anchorNodeId || nodeId !in nodesById) {
                    return@mapNotNull null
                }
                val rootDistanceMeters = rootSearch.physicalDistancesMeters[nodeId]
                    ?: return@mapNotNull null
                val estimatedDistanceMeters = outboundPath.totalDistanceMeters +
                    anchorDistanceMeters + rootDistanceMeters
                // Rank as the candidate score will, so near-equal distances are split by retracing, not noise.
                nodeId to ExerciseRouteCandidate.shapeScore(
                    distanceErrorMeters = abs(estimatedDistanceMeters - targetDistanceMeters),
                    totalDistanceMeters = estimatedDistanceMeters,
                    selfOverlapMeters = viaOverlap.retracedMeters(nodeId),
                )
            }
            .sortedWith(compareBy<Pair<Int, Double>> { it.second }.thenBy { it.first })
        val anchorBearing = nodesById[anchorNodeId]?.point?.let { point ->
            bearingBucket(startPoint, point)
        }
        val selected = mutableListOf<Int>()
        if (anchorBearing != null) {
            ranked.forEach { (nodeId, _) ->
                if (selected.size >= MaximumViaAnchors) {
                    return@forEach
                }
                val nodeBearing = bearingBucket(startPoint, nodesById.getValue(nodeId).point)
                if (nodeBearing != anchorBearing) {
                    selected += nodeId
                }
            }
        }
        ranked.forEach { (nodeId, _) ->
            if (selected.size < MaximumViaAnchors && nodeId !in selected) {
                selected += nodeId
            }
        }
        return selected
    }

    private fun candidateFor(
        edges: List<TrailGraphEdge>,
        targetDistanceMeters: Double,
        history: ExerciseRouteHistoryIndex,
        startCandidateIndex: Int,
        startPoint: MapPoint,
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
    ): ExerciseRouteCandidate {
        // Score the route as ridden: a return through snap-connector copies reuses the edge itself.
        val edges = ExerciseRouteConnectorDetourSijko.collapse(edges, adjacency)
        val traversalEdges = ExerciseRouteTraversalSijko.traversalFor(edges)
        val totalDistance = edges.sumOf { it.distanceMeters }
        val historyOverlap = history.overlapMeters(traversalEdges)
        val selfOverlap = ExerciseRouteOverlapSijko.selfOverlapMeters(traversalEdges)
        return ExerciseRouteCandidate(
            edges = edges,
            traversalEdges = traversalEdges,
            totalDistanceMeters = totalDistance,
            distanceErrorMeters = abs(totalDistance - targetDistanceMeters),
            safetyCost = edges.sumOf(TrailEdgeWeightSijko::cost),
            historyOverlapMeters = historyOverlap,
            selfOverlapMeters = selfOverlap,
            explorationShapePenaltyMeters = ExerciseRouteExplorationShapeSijko.penaltyMeters(
                edges = edges,
                startPoint = startPoint,
                targetDistanceMeters = targetDistanceMeters,
            ),
            ordinaryAccessDistanceMeters = edges.sumOf { edge -> edge.ordinaryAccessDistanceMeters },
            entersHazard = edges.any { edge -> TrailRoutingHazardPenaltySijko.enters(edge) },
            isWithinTargetTolerance = abs(totalDistance - targetDistanceMeters) <=
                ExerciseRouteTargetSijko.toleranceMeters(targetDistanceMeters),
            startCandidateIndex = startCandidateIndex,
        )
    }

    private const val MaximumStartCandidates = 2
    private const val MaximumExpandedStartCandidates = 8
    private const val ComponentCheckpointInterval = 128
    private const val MaximumRoughAccessCandidates = 16
    private const val MaximumAnchors = 10
    private const val MinimumAnchorRatio = 0.08
    private const val MaximumAnchorRatio = 0.55
    private const val MaximumViaAnchors = 6
    private const val MaximumDirectAccessMeters = 800.0
    private const val BearingBucketCount = 8
    private const val DistanceAnchorBands = 4.0
    private const val OutboundReusePenalty = 2.0
    private const val SearchHistoryWeight = 2.0
    private const val RootSearchDistanceRatio = 0.85
    private const val ViaSearchDistanceRatio = 1.0
}
