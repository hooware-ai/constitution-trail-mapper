/**
 * Job: Verify exercise start-root edges keep their own ids and only their share of snapped-edge history.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteRootEdgeSijkoTest {
    @Test
    fun rootEdgesUseReservedIdsThatDoNotCollideWithGraphEdges() {
        val rootEdges = rootEdgesFor(historyEdgeCosts = emptyMap())
        val rootEdgeIds = rootEdges.adjacency.values.flatten().map { it.edge.id }

        assertEquals(4, rootEdgeIds.size)
        assertTrue(rootEdgeIds.none { it in graphEdgeIds })
        assertEquals(setOf(firstRootEdgeId, firstRootEdgeId + 1), rootEdgeIds.toSet())
        rootEdges.adjacency.getValue(rootNodeId).forEach { connection ->
            val reverse = rootEdges.adjacency.getValue(connection.toNodeId).single()
            assertEquals(connection.edge.id, reverse.edge.id)
            assertEquals(rootNodeId, reverse.toNodeId)
        }
    }

    @Test
    fun rootEdgesReceiveOnlyTheirShareOfSnappedEdgeHistory() {
        val fullSnappedCost = snappedEdge.distanceMeters * 2.0
        val rootEdges = rootEdgesFor(historyEdgeCosts = mapOf(snappedEdge.id to fullSnappedCost, 1 to 50.0))
        val costByNode = rootEdges.adjacency.getValue(rootNodeId)
            .associate { it.toNodeId to rootEdges.historyCostsByEdgeId.getValue(it.edge.id) }

        assertEquals(250.0 * 2.0, costByNode.getValue(snappedEdge.fromNodeId), 1e-9)
        assertEquals(750.0 * 2.0, costByNode.getValue(snappedEdge.toNodeId), 1e-9)
        assertTrue(costByNode.values.all { it < fullSnappedCost })
        assertEquals(setOf(firstRootEdgeId, firstRootEdgeId + 1), rootEdges.historyCostsByEdgeId.keys)
    }

    @Test
    fun rootHalvesSplitHistoryByTheSnapsOwnMeasureOfTheEdge() {
        // The snap measures the node-anchored line, 10 m longer than the edge's own vertices here.
        val fullSnappedCost = snappedEdge.distanceMeters * 2.0
        val rootEdges = rootEdgesFor(
            historyEdgeCosts = mapOf(snappedEdge.id to fullSnappedCost),
            distanceFromStartMeters = 260.0,
            distanceToEndMeters = 750.0,
        )

        assertEquals(fullSnappedCost, rootEdges.historyCostsByEdgeId.values.sum(), 1e-9)
        assertEquals(fullSnappedCost * 260.0 / 1_010.0, rootEdges.historyCostsByEdgeId.getValue(firstRootEdgeId), 1e-9)
    }

    @Test
    fun rootEdgesWithoutSnappedHistoryCarryNoHistoryCost() {
        val rootEdges = rootEdgesFor(historyEdgeCosts = mapOf(1 to 50.0))

        assertTrue(rootEdges.historyCostsByEdgeId.isEmpty())
    }

    @Test
    fun rootHalvesOverlapOnlyTheSnappedEdgeInProportionToTheirTrail() {
        val rootEdges = rootEdgesFor(historyEdgeCosts = emptyMap())

        assertEquals(mapOf(snappedEdge.id to 1.0), rootEdges.overlapSharesByEdgeId.getValue(firstRootEdgeId))
        assertEquals(mapOf(snappedEdge.id to 1.0), rootEdges.overlapSharesByEdgeId.getValue(firstRootEdgeId + 1))
        assertEquals(
            mapOf(firstRootEdgeId to 0.25, firstRootEdgeId + 1 to 0.75),
            rootEdges.overlapSharesByEdgeId.getValue(snappedEdge.id),
        )
    }

    @Test
    fun snappedEdgeIsOnlyPartlyReusedAfterLeavingThroughAShortRootHalf() {
        val rootEdges = rootEdgesFor(
            historyEdgeCosts = emptyMap(),
            distanceFromStartMeters = 0.5,
            distanceToEndMeters = 999.5,
        )
        val shortHalf = setOf(firstRootEdgeId)

        assertEquals(0.0005, rootEdges.reusedShare(snappedEdge, shortHalf), 1e-12)
        assertEquals(0.0, rootEdges.reusedShare(rootEdge(rootEdges, firstRootEdgeId + 1), shortHalf))
        assertEquals(1.0, rootEdges.reusedShare(rootEdge(rootEdges, firstRootEdgeId + 1), setOf(snappedEdge.id)))
        assertEquals(1.0, rootEdges.reusedShare(snappedEdge, setOf(snappedEdge.id)))
        assertEquals(1.0, rootEdges.reusedShare(snappedEdge, setOf(firstRootEdgeId, firstRootEdgeId + 1)))
    }

    @Test
    fun zeroLengthRootHalfDoesNotOverlapTheSnappedEdge() {
        val rootEdges = rootEdgesFor(
            historyEdgeCosts = emptyMap(),
            distanceFromStartMeters = 0.0,
            distanceToEndMeters = 1_000.0,
        )

        assertTrue(rootEdges.overlapSharesByEdgeId[firstRootEdgeId].orEmpty().isEmpty())
        assertEquals(mapOf(firstRootEdgeId + 1 to 1.0), rootEdges.overlapSharesByEdgeId.getValue(snappedEdge.id))
        assertEquals(0.0, rootEdges.reusedShare(snappedEdge, setOf(firstRootEdgeId)))
    }

    private fun rootEdge(rootEdges: ExerciseRouteRootEdges, edgeId: Int): TrailGraphEdge {
        return rootEdges.adjacency.getValue(rootNodeId).single { it.edge.id == edgeId }.edge
    }

    private fun rootEdgesFor(
        historyEdgeCosts: Map<Int, Double>,
        distanceFromStartMeters: Double = 250.0,
        distanceToEndMeters: Double = 750.0,
    ): ExerciseRouteRootEdges {
        return ExerciseRouteRootEdgeSijko.edgesFor(
            rootNodeId = rootNodeId,
            firstRootEdgeId = firstRootEdgeId,
            access = TrailRouteEndpointAccessSijko.estimated(
                endpointPoint = MapPoint(40.00225, -89.0),
                snap = TrailNetworkSnap(
                    edge = snappedEdge,
                    projectedPoint = MapPoint(40.00225, -89.0),
                    accessDistanceMeters = 0.0,
                    distanceFromStartMeters = distanceFromStartMeters,
                    distanceToEndMeters = distanceToEndMeters,
                ),
            ),
            nodesById = nodes.associateBy { it.id },
            historyEdgeCosts = historyEdgeCosts,
        )
    }

    private val nodes = listOf(
        TrailGraphNode(10, MapPoint(40.0, -89.0)),
        TrailGraphNode(11, MapPoint(40.009, -89.0)),
    )
    private val snappedEdge = TrailGraphEdge(
        id = 3,
        fromNodeId = 10,
        toNodeId = 11,
        distanceMeters = 1_000.0,
        sourceFeatureId = "trail",
        routeSegments = listOf(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = nodes.map { it.point },
            ),
        ),
    )
    private val graphEdgeIds = setOf(1, 2, snappedEdge.id)
    private val rootNodeId = 12
    private val firstRootEdgeId = graphEdgeIds.max() + 1
}
