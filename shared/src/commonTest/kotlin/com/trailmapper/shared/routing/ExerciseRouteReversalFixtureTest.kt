/**
 * Job: Pin the #26 spike's non-sensitive reversal fixtures and the guidance targets they set for follow-up work.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteReversalFixtureTest {
    @Test
    fun theOutAndBackCountsOneTurnaround() {
        assertEquals(1, ExerciseRouteTurnaroundSijko.count(outAndBack.edges))
    }

    @Test
    fun loopsCrossingsAndNearParallelReturnsAreNotReversals() {
        assertEquals(0, ExerciseRouteTurnaroundSijko.count(lollipop.edges))
        assertEquals(0, ExerciseRouteTurnaroundSijko.count(figureEightCrossing.edges))
        assertEquals(0, ExerciseRouteTurnaroundSijko.count(nearParallelReturn.edges))
    }

    @Test
    fun outAndBackGivesATurnAroundInstruction() {
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(outAndBack)
        assertTrue(instructions.any { it.text.contains("Turn around") && it.point == b })
    }

    @Test
    fun drawableSegmentsDoNotMergeAcrossAReversal() {
        val drawable = TrailRouteDrawableSegmentMergeSijko.merge(outAndBack.edges.flatMap { it.routeSegments })
        assertEquals(2, drawable.size)
    }

    private val a = MapPoint(latitude = 40.0, longitude = -89.0)
    private val b = MapPoint(latitude = 40.0045, longitude = -89.0)
    private val c = MapPoint(latitude = 40.0045, longitude = -88.994)
    private val d = MapPoint(latitude = 40.009, longitude = -88.994)
    private val e = MapPoint(latitude = 40.009, longitude = -89.0)

    private val outAndBack = route("stem" to trail("Main trail", a, b), "stem" to trail("Main trail", b, a))
    private val lollipop = route(
        "stem" to trail("Main trail", a, b),
        "loop-east" to trail("Main trail", b, c, d),
        "loop-west" to trail("Main trail", d, e, b),
        "stem" to trail("Main trail", b, a),
    )
    private val figureEightCrossing = route(
        "diagonal-1" to trail("Main trail", a, d),
        "north" to trail("Main trail", d, e),
        "diagonal-2" to trail("Main trail", e, c),
        "south" to trail("Main trail", c, a),
    )
    private val nearParallelReturn = route(
        "east" to trail("Main trail", a, b),
        "west" to trail("Side path", MapPoint(40.0045, -88.99985), MapPoint(40.0, -88.99985)),
    )

    private fun trail(name: String, vararg points: MapPoint) = TrailRouteSegment(
        type = TrailRouteSegmentType.Trail,
        points = points.toList(),
        name = name,
        displayStyle = TrailRouteDisplayStyle.Route66,
    )

    private fun route(vararg parts: Pair<String, TrailRouteSegment>): TrailRoute {
        val edges = parts.mapIndexed { index, (source, segment) ->
            TrailGraphEdge(
                id = index,
                fromNodeId = index,
                toNodeId = index + 1,
                distanceMeters = TrailDistanceSijko.pathLengthMeters(segment.points),
                sourceFeatureId = source,
                routeSegments = listOf(segment),
            )
        }
        val lengthMeters = edges.sumOf { it.distanceMeters }
        return TrailRoute(
            edges = edges,
            segments = parts.map { it.second },
            totalDistanceMeters = lengthMeters,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = lengthMeters,
            kind = TrailRouteKind.ExerciseLoop,
            traversalEdges = ExerciseRouteTraversalSijko.traversalFor(edges),
        )
    }
}
