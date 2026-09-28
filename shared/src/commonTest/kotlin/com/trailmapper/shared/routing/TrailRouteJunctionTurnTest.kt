/**
 * Job: Verify same-trail turn guidance appears only at verified choice points recorded when a route is built.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteJunctionTurnTest {
    @Test
    fun aRealTrailJunctionIsRecordedAndGetsASameTrailTurn() {
        // j joins three distinct neighbors: west, north and east.
        val route = annotated(
            trailGraph(nodes = listOf(west, j, north, east), links = listOf(west to j, j to north, j to east)),
            edge(west, j), edge(j, north),
        )

        assertEquals(listOf(coordinate(j)), route.traversalEdges.first().junctionCoordinates)
        val turn = TrailRouteTurnInstructionSijko.instructionsFor(route).single { it.point == j }
        assertEquals(TrailRouteInstructionManeuver.TurnLeft, turn.maneuver)
        assertEquals("Turn left to stay on Main trail", turn.text)
    }

    @Test
    fun aRealJunctionWhereTheRouteRoleChangesStillGetsItsTurn() {
        // PR #45 review: the junction is the boundary of two differently styled pieces.
        val route = annotated(
            trailGraph(nodes = listOf(west, j, north, east), links = listOf(west to j, j to north, j to east)),
            edge(west, j), edge(j, north, setOf(TrailNetworkRole.SharedRoadways)),
        )

        assertEquals(listOf(coordinate(j)), route.traversalEdges.first().junctionCoordinates)
        val turn = TrailRouteTurnInstructionSijko.instructionsFor(route).single { it.point == j }
        assertEquals(TrailRouteInstructionManeuver.TurnLeft, turn.maneuver)
        assertEquals("Turn left onto Main trail", turn.text)
    }

    @Test
    fun aGentleTurnAtAJunctionOnARoleBoundaryGetsNoTurn() {
        val ahead = MapPoint(40.0027, -88.9977)
        val route = annotated(
            trailGraph(nodes = listOf(west, j, ahead, north), links = listOf(west to j, j to ahead, j to north)),
            edge(MapPoint(39.997, -89.0), j), edge(j, ahead, setOf(TrailNetworkRole.SharedRoadways)),
        )

        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(route).none { it.point == j && it.maneuver != TrailRouteInstructionManeuver.Continue })
    }

    @Test
    fun aDegreeTwoBendIsNotAChoicePoint() {
        val route = annotated(trailGraph(nodes = listOf(west, j, north), links = listOf(west to j, j to north)), edge(west, j), edge(j, north))

        assertTrue(route.traversalEdges.all { it.junctionCoordinates.isEmpty() })
        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(route).none { it.point == j })
    }

    @Test
    fun aSharedRoadwayCornerAtAStreetIntersectionIsAChoicePoint() {
        val graph = trailGraph(nodes = listOf(west, j, north), links = listOf(west to j, j to north))
        // A street intersection about 5 m from the corner, with a cross street continuing south.
        val corner = MapPoint(j.latitude, j.longitude + 0.00006)
        val streets = trailGraph(
            nodes = listOf(MapPoint(40.0, -89.003), corner, MapPoint(40.003, -88.99994), MapPoint(39.997, -88.99994)),
            links = listOf(MapPoint(40.0, -89.003) to corner, corner to MapPoint(40.003, -88.99994), corner to MapPoint(39.997, -88.99994)),
        )
        val shared = setOf(TrailNetworkRole.SharedRoadways)

        val onStreet = annotated(graph, edge(west, j, shared), edge(j, north, shared), accessGraph = streets)
        val withoutStreets = annotated(graph, edge(west, j, shared), edge(j, north, shared), accessGraph = null)
        val offStreetTrail = annotated(graph, edge(west, j), edge(j, north), accessGraph = streets)

        assertEquals(listOf(coordinate(j)), onStreet.traversalEdges.first().junctionCoordinates)
        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(onStreet).any { it.point == j && it.text.contains("to stay on") })
        assertTrue(withoutStreets.traversalEdges.all { it.junctionCoordinates.isEmpty() })
        assertTrue(offStreetTrail.traversalEdges.all { it.junctionCoordinates.isEmpty() })
    }

    @Test
    fun aGentleTurnAtAChoicePointGetsNoInstruction() {
        // About 40 degrees: below the standard-turn threshold.
        val ahead = MapPoint(40.0027, -88.9977)
        val route = annotated(
            trailGraph(nodes = listOf(west, j, ahead, north), links = listOf(west to j, j to ahead, j to north)),
            edge(MapPoint(39.997, -89.0), j), edge(j, ahead),
        )

        assertTrue(route.traversalEdges.first().junctionCoordinates.isNotEmpty())
        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(route).none { it.point == j })
    }

    @Test
    fun anOlderSavedRouteKeepsItsEarlierGuidance() {
        val built = annotated(
            trailGraph(nodes = listOf(west, j, north, east), links = listOf(west to j, j to north, j to east)),
            edge(west, j), edge(j, north), edge(north, j), edge(j, west),
        )
        val savedBeforeThisChange = built.copy(traversalEdges = built.traversalEdges.map { it.copy(junctionCoordinates = emptyList()) })

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(savedBeforeThisChange)

        assertTrue(instructions.none { it.text.contains("to stay on") })
        assertEquals(1, instructions.count { it.maneuver == TrailRouteInstructionManeuver.TurnAround })
    }

    private fun annotated(graph: TrailGraph, vararg edges: TrailGraphEdge, accessGraph: TrailGraph? = null): TrailRoute {
        val traversal = TrailRouteChoicePointSijko.annotate(edges.toList(), ExerciseRouteTraversalSijko.traversalFor(edges.toList()), graph, accessGraph)
        val length = edges.sumOf { it.distanceMeters }
        return TrailRoute(
            edges = edges.toList(),
            segments = TrailRouteSegmentMergeSijko.merge(edges.flatMap { it.routeSegments }),
            totalDistanceMeters = length,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = length,
            kind = TrailRouteKind.ExerciseLoop,
            traversalEdges = traversal,
        )
    }

    private fun trailGraph(nodes: List<MapPoint>, links: List<Pair<MapPoint, MapPoint>>): TrailGraph {
        val ids = nodes.withIndex().associate { (index, point) -> point to index }
        return TrailGraph(
            nodes = nodes.mapIndexed { index, point -> TrailGraphNode(index, point) },
            edges = links.mapIndexed { index, (from, to) ->
                TrailGraphEdge(index, ids.getValue(from), ids.getValue(to), TrailDistanceSijko.metersBetween(from, to))
            },
        )
    }

    private fun edge(from: MapPoint, to: MapPoint, roles: Set<TrailNetworkRole> = setOf(TrailNetworkRole.TrailBranches)): TrailGraphEdge {
        val segment = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(from, to), routeRoles = roles, name = "Main trail")
        return TrailGraphEdge(
            id = 0,
            fromNodeId = 0,
            toNodeId = 1,
            distanceMeters = TrailDistanceSijko.metersBetween(from, to),
            sourceFeatureId = "$from-$to",
            routeRoles = roles,
            routeSegments = listOf(segment),
        )
    }

    private fun coordinate(point: MapPoint) = ExerciseRouteTraversalSijko.coordinateOf(point)

    private val west = MapPoint(40.0, -89.003)
    private val j = MapPoint(40.0, -89.0)
    private val north = MapPoint(40.003, -89.0)
    private val east = MapPoint(40.0, -88.997)
}
