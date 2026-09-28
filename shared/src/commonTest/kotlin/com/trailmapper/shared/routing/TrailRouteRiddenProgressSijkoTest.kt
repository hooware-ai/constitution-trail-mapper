/**
 * Job: Verify ridden progress follows credible on-route travel and ignores navigation jumps.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailRouteRiddenProgressSijkoTest {
    @Test
    fun continuousOnRouteTravelAdvancesRiddenProgress() {
        val ridden = ride(0.0 to 0.0, 120.0 to 5.0, 260.0 to 12.0)

        assertEquals(260.0, ridden.riddenMeters)
        assertNull(ridden.pendingJumpMeters)
    }

    @Test
    fun anOffRoutePositionDoesNotCountAsRidden() {
        // #47: a position far off the route projects onto a distant part of the loop.
        val ridden = ride(0.0 to 0.0, 200.0 to 5.0, 6_800.0 to 2_700.0)

        assertEquals(200.0, ridden.riddenMeters)
    }

    @Test
    fun anOnRouteJumpIsHeldUntilTheRiderKeepsGoingFromThere() {
        val held = ride(0.0 to 0.0, 200.0 to 5.0, 1_500.0 to 10.0)
        assertEquals(200.0, held.riddenMeters)
        assertEquals(1_500.0, held.pendingJumpMeters)

        val stillHeld = TrailRouteRiddenProgressSijko.next(held, snapshot(1_600.0, 10.0))
        assertEquals(200.0, stillHeld.riddenMeters)

        val confirmed = TrailRouteRiddenProgressSijko.next(stillHeld, snapshot(1_700.0, 10.0))
        assertEquals(1_700.0, confirmed.riddenMeters)
        assertNull(confirmed.pendingJumpMeters)
    }

    @Test
    fun aJumpThatKeepsJumpingIsNeverConfirmed() {
        val ridden = ride(0.0 to 0.0, 200.0 to 5.0, 1_500.0 to 10.0, 3_000.0 to 10.0, 4_500.0 to 10.0)

        assertEquals(200.0, ridden.riddenMeters)
    }

    @Test
    fun anOffRouteReadingBreaksAPendingJump() {
        val ridden = ride(0.0 to 0.0, 200.0 to 5.0, 1_500.0 to 10.0, 1_600.0 to 120.0, 1_650.0 to 10.0)

        assertEquals(200.0, ridden.riddenMeters)
        assertEquals(1_650.0, ridden.pendingJumpMeters)
    }

    @Test
    fun aBackwardReadingBreaksAPendingJump() {
        val ridden = ride(0.0 to 0.0, 200.0 to 5.0, 1_500.0 to 10.0, 150.0 to 5.0, 1_650.0 to 10.0)

        assertEquals(200.0, ridden.riddenMeters)
        assertEquals(1_650.0, ridden.pendingJumpMeters)
    }

    @Test
    fun backwardPositionsKeepTheRiddenProgress() {
        val ridden = ride(0.0 to 0.0, 250.0 to 5.0, 100.0 to 5.0)

        assertEquals(250.0, ridden.riddenMeters)
    }

    @Test
    fun anOffRouteGpsPositionOnARealLoopLeavesTheRiddenProgressInPlace() {
        val loop = loopRoute()
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(loop)
        var progress = TrailRouteRiddenProgress()
        var maximumProgressMeters = 0.0
        fun rideTo(point: MapPoint): TrailRouteNavigationSnapshot {
            val snapshot = assertNotNull(
                TrailRouteNavigationSnapshotSijko.snapshotFor(loop, instructions, point, maximumProgressMeters),
            )
            progress = TrailRouteRiddenProgressSijko.next(progress, snapshot)
            maximumProgressMeters = maxOf(maximumProgressMeters, snapshot.distanceAlongRouteMeters)
            return snapshot
        }

        listOf(0.0005, 0.001, 0.0015).forEach { north -> rideTo(MapPoint(a.latitude + north, a.longitude)) }
        val riddenBeforeJump = progress.riddenMeters
        // A position well east of the loop's far side is nearest the far side, far ahead of the rider.
        val offRoute = rideTo(MapPoint(40.0045, -88.97))

        assertTrue(offRoute.distanceFromRouteMeters > 1_000.0)
        assertTrue(offRoute.distanceAlongRouteMeters <= riddenBeforeJump + 1.0)
        assertEquals(riddenBeforeJump, progress.riddenMeters)
    }

    private fun ride(vararg positions: Pair<Double, Double>): TrailRouteRiddenProgress {
        return positions.fold(TrailRouteRiddenProgress()) { progress, (along, off) ->
            TrailRouteRiddenProgressSijko.next(progress, snapshot(along, off))
        }
    }

    private fun snapshot(alongMeters: Double, offRouteMeters: Double) = TrailRouteNavigationSnapshot(
        snappedPoint = a,
        cameraTarget = a,
        bearingDegrees = 0.0,
        distanceFromRouteMeters = offRouteMeters,
        distanceAlongRouteMeters = alongMeters,
        routeDistanceMeters = 8_000.0,
        remainingDistanceMeters = 8_000.0 - alongMeters,
        nextInstruction = null,
        nextInstructionIndex = 0,
        distanceToNextInstructionMeters = null,
    )

    private fun loopRoute(): TrailRoute {
        val points = listOf(a, b, c, d, a)
        val length = TrailDistanceSijko.pathLengthMeters(points)
        return TrailRoute(
            segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, points, name = "Main trail")),
            totalDistanceMeters = length,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = length,
            kind = TrailRouteKind.ExerciseLoop,
        )
    }

    private val a = MapPoint(40.0, -89.0)
    private val b = MapPoint(40.009, -89.0)
    private val c = MapPoint(40.009, -88.988)
    private val d = MapPoint(40.0, -88.988)
}
