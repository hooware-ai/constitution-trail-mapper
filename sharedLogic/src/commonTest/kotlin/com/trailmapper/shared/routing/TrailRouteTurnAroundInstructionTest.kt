/**
 * Job: Verify route reversals get turn-around instructions that agree with navigation distances.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailRouteTurnAroundInstructionTest {
    @Test
    fun outAndBackTurnsAroundAtTheFarEnd() {
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(route("stem" to listOf(a, b), "stem" to listOf(b, a)))

        assertEquals(
            listOf(TrailRouteInstructionManeuver.Start, TrailRouteInstructionManeuver.TurnAround, TrailRouteInstructionManeuver.Arrive),
            instructions.map { it.maneuver },
        )
        assertEquals("Turn around on Main trail", instructions[1].text)
        assertEquals(b, instructions[1].point)
        assertEquals(TrailDistanceSijko.metersBetween(a, b), instructions[1].distanceMeters, 1e-6)
    }

    @Test
    fun mergedOutAndBackSegmentStillTurnsAround() {
        // Route construction joins the out-and-back into one A -> B -> A segment.
        val merged = route("stem" to listOf(a, b), "stem" to listOf(b, a)).let { it.copy(segments = listOf(it.segments.first().copy(points = listOf(a, b, a)))) }

        assertEquals(1, TrailRouteTurnInstructionSijko.instructionsFor(merged).count { it.maneuver == TrailRouteInstructionManeuver.TurnAround })
    }

    @Test
    fun lollipopRetracesItsStemWithoutATurnAround() {
        val lollipop = route(
            "stem" to listOf(a, b),
            "loop-east" to listOf(b, c, d),
            "loop-west" to listOf(d, e, b),
            "stem" to listOf(b, a),
        )

        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(lollipop).none { it.maneuver == TrailRouteInstructionManeuver.TurnAround })
    }

    @Test
    fun aDegenerateStubAtTheTurnStillGivesOneTurnAround() {
        // Real data: the turn vertex has a near-duplicate neighbour, so the U-turn centres on a zero-length stub.
        val nearTurn = MapPoint(b.latitude + 2e-11, b.longitude)
        val stub = route("stem" to listOf(a, nearTurn, b, nearTurn, a))

        val turnArounds = TrailRouteTurnInstructionSijko.instructionsFor(stub).filter { it.maneuver == TrailRouteInstructionManeuver.TurnAround }
        assertEquals(1, turnArounds.size)
        assertTrue(TrailDistanceSijko.metersBetween(turnArounds.single().point, b) < 0.1)
    }

    @Test
    fun aZeroLengthStubOnAStraightRunGivesNoTurnAround() {
        val nearB = MapPoint(b.latitude + 2e-11, b.longitude + 3e-10)
        val straight = route("run" to listOf(a, nearB, b, nearB, e))

        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(straight).none { it.maneuver == TrailRouteInstructionManeuver.TurnAround })
    }

    @Test
    fun crossingsAndNearParallelReturnsNeverTurnAround() {
        val figureEight = route("x1" to listOf(a, d), "x2" to listOf(d, e), "x3" to listOf(e, c), "x4" to listOf(c, a))
        val nearParallel = routeOf(
            listOf("east" to trail("Main trail", a, b), "west" to trail("Side path", MapPoint(40.0045, -88.99985), MapPoint(40.0, -88.99985))),
        )

        listOf(figureEight, nearParallel).forEach { route ->
            assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(route).none { it.maneuver == TrailRouteInstructionManeuver.TurnAround })
        }
    }

    @Test
    fun aShortUnnamedSpurStillGetsItsTurnAround() {
        val spurTip = MapPoint(40.00460, -88.99985)
        val withSpur = routeOf(
            listOf(
                "stem" to trail("Main trail", a, b),
                "spur" to trail(null, b, spurTip),
                "spur" to trail(null, spurTip, b),
                "loop-east" to trail("Main trail", b, c, d),
            ),
        )

        val turnAround = TrailRouteTurnInstructionSijko.instructionsFor(withSpur).single { it.maneuver == TrailRouteInstructionManeuver.TurnAround }
        assertEquals(spurTip, turnAround.point)
    }

    @Test
    fun routesWithoutEdgesOrTraversalKeysStillTurnAround() {
        val saved = route("stem" to listOf(a, b), "stem" to listOf(b, a)).copy(edges = emptyList(), traversalEdges = emptyList())

        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(saved).any { it.maneuver == TrailRouteInstructionManeuver.TurnAround })
    }

    @Test
    fun navigationAnnouncesTheTurnAroundOnApproachAtNavigationDistance() {
        // Gapped join like PR #42's review case: A -> B, then C -> D -> C about 20 m past B.
        val gapStart = MapPoint(40.00468, -89.0)
        val turn = MapPoint(40.0070, -89.0)
        val gapped = routeOf(listOf("first" to trail("Main trail", a, b), "second" to trail("Main trail", gapStart, turn, gapStart)))
            .copy(kind = TrailRouteKind.Navigation)
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(gapped)
        val approach = MapPoint(40.0060, -89.0)

        val snapshot = assertNotNull(TrailRouteNavigationSnapshotSijko.snapshotFor(gapped, instructions, approach))
        val reversal = TrailRouteTraversalShapeSijko.shapeFor(gapped).reversals.single()

        assertEquals(TrailRouteInstructionManeuver.TurnAround, snapshot.nextInstruction?.maneuver)
        assertEquals(
            reversal.distanceAlongRouteMeters - snapshot.distanceAlongRouteMeters,
            assertNotNull(snapshot.distanceToNextInstructionMeters),
            1e-6,
        )
    }

    @Test
    fun turnAroundInstructionDistanceIncludesAGappedJoin() {
        val gapStart = MapPoint(40.00468, -89.0)
        val turn = MapPoint(40.0070, -89.0)
        assertInstructionDistanceMatchesReversal(
            listOf("first" to trail("Main trail", a, b), "second" to trail("Main trail", gapStart, turn, gapStart)),
        )
    }

    @Test
    fun turnAroundInstructionDistanceIncludesSeveralGappedJoins() {
        val p1 = MapPoint(40.00468, -89.0)
        val p2 = MapPoint(40.0055, -89.0)
        val p3 = MapPoint(40.00565, -89.0)
        val turn = MapPoint(40.0075, -89.0)
        assertInstructionDistanceMatchesReversal(
            listOf(
                "first" to trail("Main trail", a, b),
                "second" to trail("Main trail", p1, p2),
                "third" to trail("Main trail", p3, turn, p3),
            ),
        )
    }

    private fun assertInstructionDistanceMatchesReversal(parts: List<Pair<String, TrailRouteSegment>>) {
        val gapped = routeOf(parts).copy(kind = TrailRouteKind.Navigation)
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(gapped)
        val turnAroundIndex = instructions.indexOfFirst { it.maneuver == TrailRouteInstructionManeuver.TurnAround }
        val cumulativeMeters = instructions.take(turnAroundIndex + 1).sumOf { it.distanceMeters }

        assertEquals(
            TrailRouteTraversalShapeSijko.shapeFor(gapped).reversals.single().distanceAlongRouteMeters,
            cumulativeMeters,
            1e-6,
        )
    }

    private fun trail(name: String?, vararg points: MapPoint) = TrailRouteSegment(
        type = TrailRouteSegmentType.Trail,
        points = points.toList(),
        name = name,
        displayStyle = TrailRouteDisplayStyle.Route66,
    )

    private fun route(vararg parts: Pair<String, List<MapPoint>>) =
        routeOf(parts.map { (source, points) -> source to trail("Main trail", *points.toTypedArray()) })

    private fun routeOf(parts: List<Pair<String, TrailRouteSegment>>): TrailRoute {
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
        val length = edges.sumOf { it.distanceMeters }
        return TrailRoute(
            edges = edges,
            segments = parts.map { it.second },
            totalDistanceMeters = length,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = length,
            kind = TrailRouteKind.ExerciseLoop,
            traversalEdges = ExerciseRouteTraversalSijko.traversalFor(edges),
        )
    }

    private val a = MapPoint(40.0, -89.0)
    private val b = MapPoint(40.0045, -89.0)
    private val c = MapPoint(40.0045, -88.994)
    private val d = MapPoint(40.009, -88.994)
    private val e = MapPoint(40.009, -89.0)
}
