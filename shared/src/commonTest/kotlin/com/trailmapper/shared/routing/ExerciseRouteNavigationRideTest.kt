/**
 * Job: Drive simulated GPS rides through exercise navigation to verify departure and completion end to end.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ExerciseRouteNavigationRideTest {
    @Test
    fun earlyTurnaroundDoesNotCompleteThePlannedLoop() {
        val outboundPoint = MapPoint(latitude = 40.0, longitude = -88.997)
        val initial = snapshot(start, minimumProgressMeters = 0.0)
        assertFalse(ExerciseRouteCompletionSijko.hasDeparted(route, initial, false))

        val outbound = snapshot(outboundPoint, minimumProgressMeters = 0.0)
        val departed = ExerciseRouteCompletionSijko.hasDeparted(route, outbound, false)
        assertTrue(departed)
        assertTrue(outbound.distanceAlongRouteMeters in 250.0..260.0)
        val verified = outbound.distanceAlongRouteMeters
        assertFalse(ExerciseRouteCompletionSijko.shouldComplete(route, outbound, departed, false, verified))

        val returned = snapshot(start, minimumProgressMeters = outbound.distanceAlongRouteMeters)
        val actualOutAndBackDistanceMeters = 2.0 * TrailDistanceSijko.metersBetween(start, outboundPoint)
        assertTrue(actualOutAndBackDistanceMeters < route.totalDistanceMeters * 0.15)

        // Before the fix: route=3927.384310 m, outbound=255.541120 m, actual out-and-back=511.082240 m,
        // but the return projected to 3927.384310 m with 0 m remaining and shouldComplete=true.
        assertTrue(returned.remainingDistanceMeters > routeLengthMeters - 1.0)
        assertFalse(ExerciseRouteCompletionSijko.shouldComplete(route, returned, departed, false, verified))
        // The snapshot guard alone keeps the return from matching the finish.
        assertFalse(ExerciseRouteCompletionSijko.shouldComplete(route, returned, departed, false, routeLengthMeters))
    }

    @Test
    fun rideAroundTheLoopCompletesOnlyAtTheFinish() {
        val ride = Ride()

        pointsAlong(loop, stepMeters = 20.0).forEach(ride::fix)

        val completedAt = assertNotNull(ride.completedAtProgressMeters)
        assertTrue(completedAt >= routeLengthMeters - 60.0, "Completed early at $completedAt m")
        assertTrue(ride.verifiedMeters > routeLengthMeters * 0.95)
    }

    @Test
    fun outAndBackRideWithJitterAtTheStartNeverCompletes() {
        val ride = Ride()
        val out = pointsAlong(listOf(start, MapPoint(latitude = 40.0, longitude = -88.997)), stepMeters = 20.0)

        (out + out.asReversed() + jitterAround(start)).forEach(ride::fix)

        assertTrue(ride.departed)
        assertNull(ride.completedAtProgressMeters)
        assertTrue(assertNotNull(ride.lastSnapshot).remainingDistanceMeters > routeLengthMeters - 300.0)
    }

    @Test
    fun gpsJitterAtTheStartNeitherDepartsNorCompletes() {
        val ride = Ride()

        repeat(3) { jitterAround(start).forEach(ride::fix) }

        assertFalse(ride.departed)
        assertNull(ride.completedAtProgressMeters)
        assertTrue(ride.maximumProgressMeters < 100.0)
    }

    @Test
    fun ridingTheLoopBackwardsDoesNotComplete() {
        val ride = Ride()

        pointsAlong(loop.asReversed(), stepMeters = 20.0).forEach(ride::fix)

        assertNull(ride.completedAtProgressMeters)
    }

    @Test
    fun gpsGapOnAFreshPartOfTheLoopStillCompletes() {
        val ride = Ride()
        val fixes = pointsAlong(loop, stepMeters = 20.0)
        // Drop about 500 m of fixes partway up the east side, away from the start and finish.
        val gap = 70 until 95

        fixes.filterIndexed { index, _ -> index !in gap }.forEach(ride::fix)

        assertNotNull(ride.completedAtProgressMeters)
        assertEquals(true, ride.verifiedMeters < routeLengthMeters - 400.0)
    }

    /** Mirrors the per-fix progress, departure, and completion updates in the Android route map. */
    @Test
    fun selectedReverseLapCompletesOnlyAtTheFinish() {
        val ride = Ride(reversedRoute)

        pointsAlong(loop.reversed(), stepMeters = 20.0).forEach(ride::fix)

        val completedAt = assertNotNull(ride.completedAtProgressMeters)
        assertTrue(completedAt >= routeLengthMeters - 60.0, "Completed early at $completedAt m")
    }

    @Test
    fun earlyTurnaroundOnTheReversedLoopDoesNotComplete() {
        val ride = Ride(reversedRoute)
        // The reversed loop leaves the start northward, along the original final side.
        val out = pointsAlong(listOf(start, MapPoint(latitude = 40.0023, longitude = -89.0)), stepMeters = 20.0)

        (out + out.reversed() + jitterAround(start)).forEach(ride::fix)

        assertTrue(ride.departed)
        assertNull(ride.completedAtProgressMeters)
    }

    @Test
    fun switchingDirectionMidRideStartsOverWithoutRetroactiveCredit() {
        val forward = Ride()
        val fixes = pointsAlong(loop, stepMeters = 20.0)
        val switchIndex = fixes.size * 2 / 5
        fixes.take(switchIndex + 1).forEach(forward::fix)
        assertNull(forward.completedAtProgressMeters)

        // Switching direction starts a fresh ride on the reversed route; the rider heads back to the start.
        val reversed = Ride(reversedRoute)
        fixes.take(switchIndex + 1).reversed().forEach(reversed::fix)
        repeat(3) { jitterAround(start).forEach(reversed::fix) }

        assertNull(reversed.completedAtProgressMeters)
        assertTrue(reversed.verifiedMeters < routeLengthMeters * 0.75)
    }

    private inner class Ride(private val rideRoute: TrailRoute = route) {
        private val rideInstructions = TrailRouteTurnInstructionSijko.instructionsFor(rideRoute)

        var maximumProgressMeters = 0.0
        var verifiedMeters = 0.0
        var departed = false
        var completedAtProgressMeters: Double? = null
        var lastSnapshot: TrailRouteNavigationSnapshot? = null

        fun fix(point: MapPoint) {
            // The map recomputes the snapshot after its progress floor moves, so evaluate until stable.
            do {
                val previousMaximum = maximumProgressMeters
                val snapshot = snapshot(point, maximumProgressMeters, rideRoute, rideInstructions)
                lastSnapshot = snapshot
                verifiedMeters = ExerciseRouteCompletionSijko.verifiedProgressMeters(
                    previousVerifiedMeters = verifiedMeters,
                    previousMaximumProgressMeters = maximumProgressMeters,
                    snapshot = snapshot,
                )
                maximumProgressMeters = maxOf(maximumProgressMeters, snapshot.distanceAlongRouteMeters)
                departed = ExerciseRouteCompletionSijko.hasDeparted(rideRoute, snapshot, departed)
                if (ExerciseRouteCompletionSijko.shouldComplete(
                        route = rideRoute,
                        snapshot = snapshot,
                        hasDeparted = departed,
                        alreadyCompleted = completedAtProgressMeters != null,
                        verifiedProgressMeters = verifiedMeters,
                    )
                ) {
                    completedAtProgressMeters = snapshot.distanceAlongRouteMeters
                }
            } while (maximumProgressMeters != previousMaximum)
        }
    }

    private fun snapshot(
        point: MapPoint,
        minimumProgressMeters: Double,
        snapshotRoute: TrailRoute = route,
        snapshotInstructions: List<TrailRouteInstruction> = instructions,
    ): TrailRouteNavigationSnapshot =
        assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = snapshotRoute,
                instructions = snapshotInstructions,
                userPoint = point,
                minimumProgressMeters = minimumProgressMeters,
            ),
        )

    /** Evenly spaced fixes along [path], always including each vertex. */
    private fun pointsAlong(path: List<MapPoint>, stepMeters: Double): List<MapPoint> {
        return listOf(path.first()) + path.zipWithNext().flatMap { (from, to) ->
            val steps = maxOf(1, (TrailDistanceSijko.metersBetween(from, to) / stepMeters).toInt())
            (1..steps).map { step ->
                val ratio = step.toDouble() / steps
                MapPoint(
                    latitude = from.latitude + (to.latitude - from.latitude) * ratio,
                    longitude = from.longitude + (to.longitude - from.longitude) * ratio,
                )
            }
        }
    }

    /** Fixes about 10 m from [point] in each direction, including toward the loop's final side. */
    private fun jitterAround(point: MapPoint): List<MapPoint> {
        val offset = 0.00009
        return listOf(
            MapPoint(point.latitude + offset, point.longitude),
            MapPoint(point.latitude, point.longitude + offset),
            MapPoint(point.latitude - offset, point.longitude),
            MapPoint(point.latitude, point.longitude - offset),
            MapPoint(point.latitude + offset, point.longitude - offset),
            point,
        )
    }

    private val start = MapPoint(latitude = 40.0, longitude = -89.0)
    private val loop = listOf(
        start,
        MapPoint(latitude = 40.0, longitude = -88.99),
        MapPoint(latitude = 40.01, longitude = -88.99),
        MapPoint(latitude = 40.01, longitude = -89.0),
        start,
    )
    private val routeLengthMeters = TrailDistanceSijko.pathLengthMeters(loop)
    private val route = TrailRoute(
        segments = listOf(TrailRouteSegment(type = TrailRouteSegmentType.Trail, points = loop, name = "Square trail")),
        totalDistanceMeters = routeLengthMeters,
        ordinaryAccessDistanceMeters = 0.0,
        totalCost = routeLengthMeters,
        kind = TrailRouteKind.ExerciseLoop,
    )
    private val instructions = TrailRouteTurnInstructionSijko.instructionsFor(route)
    private val reversedRoute = TrailRouteReverseSijko.reversed(route)
}
