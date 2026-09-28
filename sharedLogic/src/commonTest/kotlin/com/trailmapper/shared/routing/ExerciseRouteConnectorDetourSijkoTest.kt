/**
 * Job: Verify snap-connector detours collapse to the edge they copy, and real paths are left alone.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteConnectorDetourSijkoTest {
    @Test
    fun aReturnThroughConnectorCopiesCollapsesToTheReusedEdge() {
        val graph = graphOf(feature("main", x, y), feature("side", sideNode, sideEnd))
        val adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph)
        val (xId, yId, nId) = listOf(x, y, sideNode).map { nodeAt(graph, it) }
        val out = edge(adjacency, xId, yId, "main")
        val back = listOf(edge(adjacency, yId, nId, "main"), edge(adjacency, nId, xId, "main"))

        val collapsed = ExerciseRouteConnectorDetourSijko.collapse(listOf(out) + back, adjacency)

        assertEquals(listOf(xId to yId, yId to xId), collapsed.map { it.fromNodeId to it.toNodeId })
        assertEquals(out.id, collapsed.last().id)
        // Both legs now share one traversal key, so the retrace counts as self-overlap.
        val traversal = ExerciseRouteTraversalSijko.traversalFor(collapsed)
        assertEquals(traversal.first().key, traversal.last().key)
        assertEquals(0.0, ExerciseRouteOverlapSijko.selfOverlapMeters(ExerciseRouteTraversalSijko.traversalFor(listOf(out) + back)))
        assertTrue(ExerciseRouteOverlapSijko.selfOverlapMeters(traversal) > 200.0)
        assertTrue(collapsed.flatMap { it.routeSegments }.flatMap { it.points }.none { it == sideNode })
    }

    @Test
    fun enteringTheSideTrailThroughAConnectorIsKept() {
        val graph = graphOf(feature("main", x, y), feature("side", sideNode, sideEnd))
        val adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph)
        val (xId, nId, zId) = listOf(x, sideNode, sideEnd).map { nodeAt(graph, it) }
        val path = listOf(edge(adjacency, xId, nId, "main"), edge(adjacency, nId, zId, "side"))

        assertEquals(path, ExerciseRouteConnectorDetourSijko.collapse(path, adjacency))
    }

    @Test
    fun aSameTrailBranchFarFromTheDirectEdgeIsKept() {
        val branchPoint = MapPoint(40.001, -88.9988)
        val graph = graphOf(feature("loop", x, y), feature("loop", x, branchPoint), feature("loop", branchPoint, y))
        val adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph)
        val (xId, yId, mId) = listOf(x, y, branchPoint).map { nodeAt(graph, it) }
        val path = listOf(edge(adjacency, xId, mId, "loop"), edge(adjacency, mId, yId, "loop"))

        assertEquals(path, ExerciseRouteConnectorDetourSijko.collapse(path, adjacency))
    }

    @Test
    fun anOutAndBackPastTheConnectorIsKept() {
        // Riding to the far end and back to the side trail's node retraces 111 m: a real out-and-back.
        val graph = graphOf(feature("main", x, y), feature("side", sideNode, sideEnd))
        val adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph)
        val (xId, yId, nId) = listOf(x, y, sideNode).map { nodeAt(graph, it) }
        val path = listOf(edge(adjacency, xId, yId, "main"), edge(adjacency, yId, nId, "main"))

        assertEquals(path, ExerciseRouteConnectorDetourSijko.collapse(path, adjacency))
    }

    @Test
    fun aRealSameTrailBranchBesideTheDirectEdgeIsKept() {
        // The branch vertex sits 9 m beside the straight edge, as close as a connector node would.
        val graph = graphOf(feature("loop", x, y), feature("loop", x, sideNode), feature("loop", sideNode, y))
        val adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph)
        val (xId, yId, nId) = listOf(x, y, sideNode).map { nodeAt(graph, it) }
        val branch = listOf(originalEdge(adjacency, xId, nId), originalEdge(adjacency, nId, yId))

        assertEquals(branch, ExerciseRouteConnectorDetourSijko.collapse(branch, adjacency))
    }

    private fun originalEdge(
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
        from: Int,
        to: Int,
    ): TrailGraphEdge = adjacency.getValue(from)
        .single { it.toNodeId == to && it.edge.connectorOfEdgeId == null }
        .edge

    private fun graphOf(vararg features: TrailNetworkFeature) = TrailGraphBuilderSijko.buildGraph(features.toList())

    private fun feature(id: String, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        name = id,
        status = TrailFeatureStatus.Existing,
        routeRoles = emptySet(),
        facilityType = TrailFacilityType.SeparatedTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )

    private fun nodeAt(graph: TrailGraph, point: MapPoint): Int =
        graph.nodes.single { TrailDistanceSijko.metersBetween(it.point, point) < 0.01 }.id

    private fun edge(
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
        from: Int,
        to: Int,
        source: String,
    ): TrailGraphEdge = adjacency.getValue(from)
        .filter { it.toNodeId == to && it.edge.sourceFeatureId == source }
        .minBy { it.edge.distanceMeters }
        .edge

    private val x = MapPoint(40.0, -89.0)
    private val y = MapPoint(40.002, -89.0)
    // About 9 m east of the main trail's midpoint, within the builder's snap tolerance.
    private val sideNode = MapPoint(40.001, -88.999894)
    private val sideEnd = MapPoint(40.001, -88.997)
}
