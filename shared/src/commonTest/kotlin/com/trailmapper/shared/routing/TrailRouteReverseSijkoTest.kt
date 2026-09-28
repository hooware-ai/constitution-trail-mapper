/**
 * Job: Verify a reversed exercise loop keeps its identity while reversing order, geometry and guidance.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class TrailRouteReverseSijkoTest {
    @Test
    fun reversesSegmentsEdgesAndTraversalOrder() {
        val reversed = TrailRouteReverseSijko.reversed(route)

        assertEquals(listOf(start, corner3, corner2), reversed.segments.first().points)
        assertEquals(listOf(corner2, corner1, start), reversed.segments.last().points)
        assertEquals(listOf(2, 1), reversed.edges.map { it.id })
        assertEquals(listOf(12 to 11, 11 to 10), reversed.edges.map { it.fromNodeId to it.toNodeId })
        assertEquals(listOf(start, corner3, corner2), reversed.edges.first().routeSegments.single().points)
        assertEquals(route.traversalEdges.reversed(), reversed.traversalEdges)
    }

    @Test
    fun keepsDistancesKeysAndIdentity() {
        val reversed = TrailRouteReverseSijko.reversed(route)

        assertEquals(route.totalDistanceMeters, reversed.totalDistanceMeters)
        assertEquals(route.kind, reversed.kind)
        assertEquals(route.traversalEdges.map { it.key }.toSet(), reversed.traversalEdges.map { it.key }.toSet())
        assertEquals(ExerciseRouteKeySijko.keyFor(route.traversalEdges), ExerciseRouteKeySijko.keyFor(reversed.traversalEdges))
        assertEquals(route, TrailRouteReverseSijko.reversed(reversed))
    }

    @Test
    fun regeneratedInstructionsFollowTheReversedDirection() {
        val forward = TrailRouteTurnInstructionSijko.instructionsFor(route)
        val reversed = TrailRouteTurnInstructionSijko.instructionsFor(TrailRouteReverseSijko.reversed(route))

        assertEquals(forward.size, reversed.size)
        assertEquals("Start on East side", forward.first().text)
        assertEquals("Start on North side", reversed.first().text)
        assertNotEquals(forward[1].maneuver, reversed[1].maneuver)
        assertEquals(start, reversed.last().point)
    }

    private val start = MapPoint(latitude = 40.0, longitude = -89.0)
    private val corner1 = MapPoint(latitude = 40.0, longitude = -88.99)
    private val corner2 = MapPoint(latitude = 40.01, longitude = -88.99)
    private val corner3 = MapPoint(latitude = 40.01, longitude = -89.0)
    private val east = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(start, corner1, corner2), name = "East side")
    private val north = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(corner2, corner3, start), name = "North side")
    private val edges = listOf(
        TrailGraphEdge(id = 1, fromNodeId = 10, toNodeId = 11, distanceMeters = 1_964.0, sourceFeatureId = "east", routeSegments = listOf(east)),
        TrailGraphEdge(id = 2, fromNodeId = 11, toNodeId = 12, distanceMeters = 1_964.0, sourceFeatureId = "north", routeSegments = listOf(north)),
    )
    private val route = TrailRoute(
        edges = edges,
        segments = listOf(east, north),
        totalDistanceMeters = 3_928.0,
        ordinaryAccessDistanceMeters = 0.0,
        totalCost = 3_928.0,
        kind = TrailRouteKind.ExerciseLoop,
        traversalEdges = ExerciseRouteTraversalSijko.traversalFor(edges),
    )
}
