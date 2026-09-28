/**
 * Job: Verify route reversals, leg order and repeated travel are derived from geometry, for new and saved routes.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteTraversalShapeSijkoTest {
    @Test
    fun outAndBackHasOneReversalAtItsFarEndAndARepeatedReturnLeg() {
        val shape = TrailRouteTraversalShapeSijko.shapeFor(route(listOf(a, b), listOf(b, a)))

        assertEquals(listOf(b), shape.reversals.map { it.point })
        assertEquals(TrailDistanceSijko.metersBetween(a, b), shape.reversals.single().distanceAlongRouteMeters, 1e-6)
        assertEquals(listOf(0 to false, 1 to true), shape.pieces.map { it.legIndex to it.repeatsEarlierTravel })
        assertEquals(listOf(listOf(a, b), listOf(b, a)), shape.pieces.map { it.segment.points })
    }

    @Test
    fun aMergedSegmentStillRevealsItsReversal() {
        // Route construction merges a same-trail out-and-back into one segment A -> B -> A.
        val shape = TrailRouteTraversalShapeSijko.shapeFor(route(listOf(a, b, a)))

        assertEquals(listOf(b), shape.reversals.map { it.point })
        assertEquals(2, shape.pieces.size)
        assertEquals(listOf(false, true), shape.pieces.map { it.repeatsEarlierTravel })
        assertEquals(listOf(listOf(a, b), listOf(b, a)), TrailRouteDrawableSegmentMergeSijko.merge(route(listOf(a, b, a)).segments).map { it.points })
    }

    @Test
    fun lollipopRepeatsItsStemWithoutAReversal() {
        val shape = TrailRouteTraversalShapeSijko.shapeFor(route(listOf(a, b, c, d, e, b, a)))

        assertTrue(shape.reversals.isEmpty())
        assertEquals(listOf(listOf(a, b, c, d, e, b), listOf(b, a)), shape.pieces.map { it.segment.points })
        assertEquals(listOf(false, true), shape.pieces.map { it.repeatsEarlierTravel })
        assertTrue(shape.pieces.all { it.legIndex == 0 })
    }

    @Test
    fun crossingsAndNearParallelReturnsAreNeitherReversalsNorRepeats() {
        val figureEight = TrailRouteTraversalShapeSijko.shapeFor(route(listOf(a, d, e, c, a)))
        val nearParallel = TrailRouteTraversalShapeSijko.shapeFor(
            route(listOf(a, b), listOf(MapPoint(40.0045, -88.99985), MapPoint(40.0, -88.99985))),
        )

        listOf(figureEight, nearParallel).forEach { shape ->
            assertTrue(shape.reversals.isEmpty())
            assertTrue(shape.pieces.none { it.repeatsEarlierTravel })
        }
    }

    @Test
    fun piecesKeepTheirSourceSegmentStyling() {
        val access = TrailRouteSegment(TrailRouteSegmentType.Access, listOf(start, a), name = "Access road")
        val trail = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(a, b, a), name = "Main trail")
        val backToStart = access.copy(points = listOf(a, start))
        val shape = TrailRouteTraversalShapeSijko.shapeFor(routeOf(access, trail, backToStart))

        assertEquals(
            listOf(TrailRouteSegmentType.Access, TrailRouteSegmentType.Trail, TrailRouteSegmentType.Trail, TrailRouteSegmentType.Access),
            shape.pieces.map { it.segment.type },
        )
        assertEquals(listOf("Access road", "Main trail", "Main trail", "Access road"), shape.pieces.map { it.segment.name })
        assertEquals(listOf(false, false, true, true), shape.pieces.map { it.repeatsEarlierTravel })
    }

    @Test
    fun reversedLoopHasTheSameReversalsFromTheOtherEnd() {
        val forward = route(listOf(a, b), listOf(b, c, d), listOf(d, c), listOf(c, a))
        val forwardShape = TrailRouteTraversalShapeSijko.shapeFor(forward)
        val reversedShape = TrailRouteTraversalShapeSijko.shapeFor(TrailRouteReverseSijko.reversed(forward))
        val length = forward.segments.sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }

        assertEquals(forwardShape.reversals.map { it.point }.reversed(), reversedShape.reversals.map { it.point })
        forwardShape.reversals.zip(reversedShape.reversals.reversed()).forEach { (f, r) ->
            assertEquals(length - f.distanceAlongRouteMeters, r.distanceAlongRouteMeters, 1e-6)
        }
    }

    @Test
    fun savedRouteJsonYieldsTheSameShape() {
        val routeWithReversal = route(listOf(a, b, a))
        val json = Json.encodeToString(TrailRoute.serializer(), routeWithReversal)
        // A route saved before this analysis existed has the same fields; the shape comes from its segments.
        val reopened = Json.decodeFromString(TrailRoute.serializer(), json)

        assertEquals(TrailRouteTraversalShapeSijko.shapeFor(routeWithReversal), TrailRouteTraversalShapeSijko.shapeFor(reopened))
        assertEquals(1, TrailRouteTraversalShapeSijko.shapeFor(reopened.copy(edges = emptyList(), traversalEdges = emptyList())).reversals.size)
    }

    @Test
    fun reversalDistanceMatchesNavigationProgressAcrossAGappedJoin() {
        // A -> B, then a separate same-style segment starting about 20 m past B: C -> D -> C.
        val gapStart = MapPoint(40.00468, -89.0)
        val turn = MapPoint(40.0070, -89.0)
        val gapped = navigationRoute(listOf(a, b), listOf(gapStart, turn, gapStart))

        assertReversalMatchesNavigation(gapped, turn)
    }

    @Test
    fun reversalDistanceMatchesNavigationProgressAfterSeveralGappedJoins() {
        val p1 = MapPoint(40.00468, -89.0)
        val p2 = MapPoint(40.0055, -89.0)
        val p3 = MapPoint(40.00565, -89.0)
        val turn = MapPoint(40.0075, -89.0)
        val gapped = navigationRoute(listOf(a, b), listOf(p1, p2), listOf(p3, turn, p3))

        assertReversalMatchesNavigation(gapped, turn)
    }

    private fun assertReversalMatchesNavigation(route: TrailRoute, turn: MapPoint) {
        val reversal = TrailRouteTraversalShapeSijko.shapeFor(route).reversals.single()
        val atTurn = TrailRouteNavigationSnapshotSijko.snapshotFor(
            route = route,
            instructions = TrailRouteTurnInstructionSijko.instructionsFor(route),
            userPoint = turn,
        )!!

        assertEquals(turn, reversal.point)
        assertEquals(atTurn.distanceAlongRouteMeters, reversal.distanceAlongRouteMeters, 1e-6)
    }

    private fun navigationRoute(vararg paths: List<MapPoint>) = routeOf(
        *paths.map { TrailRouteSegment(TrailRouteSegmentType.Trail, it, name = "Main trail") }.toTypedArray(),
    ).copy(kind = TrailRouteKind.Navigation)

    @Test
    fun aZeroLengthStubOnAStraightRunIsNotAReversal() {
        // Real data (10 mi loop from Uptown Circle): three vertices within 1e-10 degrees mid-run.
        val nearB = MapPoint(b.latitude + 2e-11, b.longitude + 3e-10)
        val shape = TrailRouteTraversalShapeSijko.shapeFor(route(listOf(a, nearB, b, nearB, e)))

        assertTrue(shape.reversals.isEmpty())
        assertEquals(1, TrailRouteDrawableSegmentMergeSijko.merge(route(listOf(a, nearB, b, nearB, e)).segments).size)
    }

    @Test
    fun aRealUTurnAroundAZeroLengthStubIsStillOneReversal() {
        val nearB = MapPoint(b.latitude + 2e-11, b.longitude)
        val stubbed = route(listOf(a, nearB, b, nearB, a))

        val shape = TrailRouteTraversalShapeSijko.shapeFor(stubbed)
        assertEquals(1, shape.reversals.size)
        assertEquals(TrailDistanceSijko.metersBetween(a, nearB), shape.reversals.single().distanceAlongRouteMeters, 1e-6)
    }

    @Test
    fun splitAtReversalsNeverReturnsAPolylineThatDoublesBack() {
        val pieces = TrailRouteTraversalShapeSijko.splitAtReversals(listOf(a, b, a, b, c))

        assertEquals(listOf(listOf(a, b), listOf(b, a), listOf(a, b, c)), pieces)
    }

    private fun route(vararg paths: List<MapPoint>) = routeOf(
        *paths.map { TrailRouteSegment(TrailRouteSegmentType.Trail, it, name = "Main trail") }.toTypedArray(),
    )

    private fun routeOf(vararg segments: TrailRouteSegment): TrailRoute {
        val length = segments.sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        return TrailRoute(
            segments = segments.toList(),
            totalDistanceMeters = length,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = length,
            kind = TrailRouteKind.ExerciseLoop,
        )
    }

    private val start = MapPoint(39.9995, -89.0)
    private val a = MapPoint(40.0, -89.0)
    private val b = MapPoint(40.0045, -89.0)
    private val c = MapPoint(40.0045, -88.994)
    private val d = MapPoint(40.009, -88.994)
    private val e = MapPoint(40.009, -89.0)
}
