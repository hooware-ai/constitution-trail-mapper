/**
 * Job: Verify map cues separate first and second passes, mark turnarounds, and trace ridden progress.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailRouteMapCuesSijkoTest {
    @Test
    fun outAndBackHasAFirstPassATurnaroundAndAnOffsetSecondPass() {
        val cues = TrailRouteMapCuesSijko.cuesFor(route(listOf(a, b, a)))

        assertEquals(listOf(listOf(a, b)), cues.firstPass.map { it.points })
        assertEquals(listOf(b), cues.turnarounds.map { it.point })
        val secondPass = cues.secondPass.single().points
        // The return runs south, so its right-hand side is west.
        secondPass.zip(listOf(b, a)).forEach { (shifted, original) ->
            assertEquals(8.0, TrailDistanceSijko.metersBetween(shifted, original), 0.01)
            assertTrue(shifted.longitude < original.longitude)
        }
        assertTrue(cues.hasTraversalCues)
    }

    @Test
    fun aLoopWithACrossingHasNoTraversalCues() {
        val cues = TrailRouteMapCuesSijko.cuesFor(route(listOf(a, d, e, c, a)))

        assertTrue(cues.secondPass.isEmpty())
        assertTrue(cues.turnarounds.isEmpty())
        assertTrue(!cues.hasTraversalCues)
        assertEquals(listOf(listOf(a, d, e, c, a)), cues.firstPass.map { it.points })
    }

    @Test
    fun lollipopMarksItsReturnStemAsASecondPassWithoutATurnaround() {
        val cues = TrailRouteMapCuesSijko.cuesFor(route(listOf(a, b, c, d, e, b, a)))

        assertTrue(cues.turnarounds.isEmpty())
        assertEquals(1, cues.secondPass.size)
        assertEquals(2, cues.secondPass.single().points.size)
    }

    @Test
    fun offsetIsToTheRightOfTravel() {
        val north = TrailRouteMapCuesSijko.offsetToTheRight(listOf(a, b), 8.0)
        val east = TrailRouteMapCuesSijko.offsetToTheRight(listOf(a, c.copy(latitude = a.latitude)), 8.0)

        assertTrue(north.all { it.longitude > a.longitude })
        assertTrue(east.all { it.latitude < a.latitude })
    }

    @Test
    fun riddenPolylinesFollowNavigationProgress() {
        val cues = TrailRouteMapCuesSijko.cuesFor(route(listOf(a, b, c)))
        val firstLeg = TrailDistanceSijko.metersBetween(a, b)
        val halfway = firstLeg / 2.0

        val firstHalf = cues.riddenPolylines(halfway)
        assertEquals(halfway, firstHalf.sumOf { TrailDistanceSijko.pathLengthMeters(it) }, 1e-6)
        assertTrue(cues.riddenPolylines(0.0).isEmpty())
        val pastTheCorner = cues.riddenPolylines(firstLeg + 100.0)
        assertEquals(firstLeg + 100.0, pastTheCorner.sumOf { TrailDistanceSijko.pathLengthMeters(it) }, 1e-6)
    }

    @Test
    fun aRiddenReturnFollowsTheOffsetSecondPassLine() {
        val cues = TrailRouteMapCuesSijko.cuesFor(route(listOf(a, b, a)))
        val leg = TrailDistanceSijko.metersBetween(a, b)

        val ridden = cues.riddenPolylines(leg * 1.5)

        assertEquals(2, ridden.size)
        assertEquals(listOf(a, b), ridden.first())
        val drawnReturn = cues.secondPass.single().points
        val riddenReturn = ridden.last()
        assertEquals(drawnReturn.first(), riddenReturn.first())
        // The ridden return ends halfway down the drawn return line, 8 m to the side of the centerline.
        val midReturn = MapPoint(
            latitude = (drawnReturn.first().latitude + drawnReturn.last().latitude) / 2.0,
            longitude = (drawnReturn.first().longitude + drawnReturn.last().longitude) / 2.0,
        )
        assertTrue(TrailDistanceSijko.metersBetween(riddenReturn.last(), midReturn) < 0.01)
        assertEquals(8.0, TrailDistanceSijko.metersBetween(riddenReturn.last(), MapPoint(midReturn.latitude, a.longitude)), 0.01)
    }

    @Test
    fun riddenPolylinesEndAtTheNavigationSnapshotAcrossAGappedJoin() {
        val gapStart = MapPoint(40.00468, -89.0)
        val turn = MapPoint(40.0070, -89.0)
        val gapped = routeOf(
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(a, b), name = "Main trail"),
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(gapStart, turn, gapStart), name = "Main trail"),
        ).copy(kind = TrailRouteKind.Navigation)
        val rider = MapPoint(40.0060, -89.0)
        val snapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(gapped, TrailRouteTurnInstructionSijko.instructionsFor(gapped), rider),
        )

        val ridden = TrailRouteMapCuesSijko.cuesFor(gapped).riddenPolylines(snapshot.distanceAlongRouteMeters)

        assertTrue(TrailDistanceSijko.metersBetween(ridden.last().last(), snapshot.snappedPoint) < 0.01)
    }

    private fun route(points: List<MapPoint>) = routeOf(TrailRouteSegment(TrailRouteSegmentType.Trail, points, name = "Main trail"))

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

    private val a = MapPoint(40.0, -89.0)
    private val b = MapPoint(40.0045, -89.0)
    private val c = MapPoint(40.0045, -88.994)
    private val d = MapPoint(40.009, -88.994)
    private val e = MapPoint(40.009, -89.0)
}
