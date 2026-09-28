/**
 * Job: Verify live route positions produce active navigation progress and camera inputs.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailRouteNavigationSnapshotSijkoTest {
    @Test
    fun looksAheadAlongTheRouteAndUsesRouteBearing() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.002, longitude = -89.0)
        val route = routeWith(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(start, destination),
            ),
        )

        val snapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = TrailRouteTurnInstructionSijko.instructionsFor(route),
                userPoint = start,
            ),
        )

        assertTrue(snapshot.cameraTarget.latitude > start.latitude)
        assertTrue(snapshot.bearingDegrees < 1.0 || snapshot.bearingDegrees > 359.0)
        assertEquals(TrailRouteInstructionManeuver.Arrive, snapshot.nextInstruction?.maneuver)
    }

    @Test
    fun nextInstructionDistanceShrinksWithProgress() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val corner = MapPoint(latitude = 40.001, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -88.999)
        val route = routeWith(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(start, corner),
                name = "Constitution Trail",
            ),
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(corner, destination),
                name = "Illinois Central Trail",
            ),
        )
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(route)

        val startSnapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = instructions,
                userPoint = start,
            ),
        )
        val nearTurnSnapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = instructions,
                userPoint = MapPoint(latitude = 40.0008, longitude = -89.0),
            ),
        )

        assertEquals(TrailRouteInstructionManeuver.TurnRight, startSnapshot.nextInstruction?.maneuver)
        assertEquals(TrailRouteInstructionManeuver.TurnRight, nearTurnSnapshot.nextInstruction?.maneuver)
        assertTrue(
            nearTurnSnapshot.distanceToNextInstructionMeters!! <
                startSnapshot.distanceToNextInstructionMeters!!,
        )
    }

    @Test
    fun reportsDistanceFromRouteWhenUserIsOffRoute() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.002, longitude = -89.0)
        val route = routeWith(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(start, destination),
            ),
        )

        val snapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = TrailRouteTurnInstructionSijko.instructionsFor(route),
                userPoint = MapPoint(latitude = 40.001, longitude = -88.999),
            ),
        )

        assertTrue(snapshot.distanceFromRouteMeters > 50.0)
        assertEquals(start.longitude, snapshot.snappedPoint.longitude)
    }

    @Test
    fun loopProgressDoesNotSnapBackToTheStartAfterDeparture() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val route = routeWith(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(
                    start,
                    MapPoint(latitude = 40.0, longitude = -88.999),
                    MapPoint(latitude = 40.001, longitude = -88.999),
                    MapPoint(latitude = 40.001, longitude = -89.0),
                    start,
                ),
            ),
        )

        val snapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = TrailRouteTurnInstructionSijko.instructionsFor(route),
                userPoint = start,
                minimumProgressMeters = 150.0,
            ),
        )

        assertTrue(snapshot.distanceAlongRouteMeters > 300.0)
        assertTrue(snapshot.remainingDistanceMeters < 1.0)
    }

    @Test
    fun returnJunctionInstructionRemainsUpcomingOnTheReturnLeg() {
        val route = repeatedJunctionLoop()
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(route)
        val returnJunctionIndex = instructions.lastIndex - 1
        val returnJunctionInstruction = instructions[returnJunctionIndex]
        assertEquals(repeatedJunction, returnJunctionInstruction.point)
        assertTrue(returnJunctionInstruction.text.contains("Access road"))

        val progressAtEast = route.segments.take(3)
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        val returning = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = instructions,
                userPoint = MapPoint(latitude = 40.0005, longitude = -88.9995),
                minimumProgressMeters = progressAtEast,
            ),
        )
        val returnJunctionDistanceAlongRoute = instructions.take(returnJunctionIndex + 1)
            .sumOf { it.distanceMeters }
        val distanceUntilReturnJunction = returnJunctionDistanceAlongRoute - returning.distanceAlongRouteMeters
        assertTrue(distanceUntilReturnJunction in 60.0..80.0)

        // Before the fix: #5, Return to start in 155.216 m, because the junction resolved to its first visit.
        assertEquals(returnJunctionIndex, returning.nextInstructionIndex)
        assertEquals(returnJunctionInstruction, returning.nextInstruction)
        assertEquals(
            distanceUntilReturnJunction,
            assertNotNull(returning.distanceToNextInstructionMeters),
            0.01,
        )
    }

    @Test
    fun repeatedJunctionUsesItsFirstVisitOnTheOutboundLeg() {
        val route = repeatedJunctionLoop()
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(route)
        val outboundJunctionInstruction = instructions[1]
        assertEquals(repeatedJunction, outboundJunctionInstruction.point)
        assertTrue(outboundJunctionInstruction.text.contains("North trail"))

        val outbound = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = instructions,
                userPoint = MapPoint(latitude = 40.0, longitude = -89.0005),
            ),
        )

        assertEquals(1, outbound.nextInstructionIndex)
        assertEquals(
            outboundJunctionInstruction.distanceMeters - outbound.distanceAlongRouteMeters,
            assertNotNull(outbound.distanceToNextInstructionMeters),
            0.01,
        )
    }

    @Test
    fun repeatedJunctionWithoutInterveningInstructionsUsesItsReturnVisit() {
        val route = repeatedJunctionLoop()
        val firstLegMeters = TrailDistanceSijko.pathLengthMeters(route.segments.first().points)
        val loopMeters = route.segments.drop(1).dropLast(1)
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        val instructions = listOf(
            TrailRouteInstruction(TrailRouteInstructionManeuver.Start, "Start", 0.0, route.segments.first().points.first()),
            TrailRouteInstruction(TrailRouteInstructionManeuver.Continue, "Enter loop", firstLegMeters, repeatedJunction),
            TrailRouteInstruction(TrailRouteInstructionManeuver.TurnRight, "Return to access road", loopMeters, repeatedJunction),
            TrailRouteInstruction(
                TrailRouteInstructionManeuver.Arrive,
                "Return to start",
                firstLegMeters,
                route.segments.last().points.last(),
            ),
        )
        val progressAtEast = route.segments.take(3)
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }

        val returning = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = instructions,
                userPoint = MapPoint(latitude = 40.0005, longitude = -88.9995),
                minimumProgressMeters = progressAtEast,
            ),
        )

        assertEquals(2, returning.nextInstructionIndex)
        assertEquals(instructions[2], returning.nextInstruction)
    }

    @Test
    fun singleVisitTurnDistanceMatchesItsRoutePosition() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val corner = MapPoint(latitude = 40.001, longitude = -89.0)
        val route = routeWith(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(start, corner),
                name = "Constitution Trail",
            ),
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(corner, MapPoint(latitude = 40.001, longitude = -88.999)),
                name = "Illinois Central Trail",
            ),
        )
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(route)

        val snapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = instructions,
                userPoint = MapPoint(latitude = 40.0004, longitude = -89.0),
            ),
        )

        assertEquals(1, snapshot.nextInstructionIndex)
        assertEquals(
            TrailDistanceSijko.metersBetween(start, corner) - snapshot.distanceAlongRouteMeters,
            assertNotNull(snapshot.distanceToNextInstructionMeters),
            0.01,
        )
    }

    @Test
    fun loopProgressHoldsWhileTheRiderIsFarOffRoute() {
        // #47: 2.7 km east of the loop's far side, every part of the loop is about as far away.
        val farOff = MapPoint(40.0045, -88.956)
        // The off-route banner reports the physical distance to the nearest part: here the far side.
        val physicalMeters = TrailDistanceSijko.projectToSegment(
            point = farOff,
            segmentStart = MapPoint(40.009, -88.988),
            segmentEnd = MapPoint(40.0, -88.988),
        ).distanceMeters
        var progress = 200.0
        // Repeated off-route fixes, each fed back as the progress floor, must not creep forward.
        repeat(5) {
            val snapshot = snapshotAt(squareLoop(), farOff, minimumProgressMeters = progress)
            assertEquals(physicalMeters, snapshot.distanceFromRouteMeters, 0.01)
            assertTrue(snapshot.distanceAlongRouteMeters <= 200.0, "progress ${snapshot.distanceAlongRouteMeters}")
            assertTrue(snapshot.remainingDistanceMeters >= snapshot.routeDistanceMeters - 200.0)
            progress = maxOf(progress, snapshot.distanceAlongRouteMeters)
        }
    }

    @Test
    fun loopProgressStillJumpsWhenTheRiderIsBackOnAFarPartOfTheRoute() {
        // After a GPS gap the rider can reappear on a fresh part of the loop.
        val snapshot = snapshotAt(squareLoop(), MapPoint(40.0045, -88.988), minimumProgressMeters = 200.0)

        assertTrue(snapshot.distanceFromRouteMeters < 1.0)
        assertTrue(snapshot.distanceAlongRouteMeters > 2_000.0)
    }

    @Test
    fun pointToPointProgressHoldsWhileTheRiderIsOffRouteNearALaterLeg() {
        // 167 m off the second leg, which is nearer than the first leg the rider was riding.
        val offRoute = MapPoint(40.0075, -88.990)

        val held = snapshotAt(lRoute(), offRoute, previousProgressMeters = 200.0)
        val physicalMeters = TrailDistanceSijko.projectToSegment(
            point = offRoute,
            segmentStart = MapPoint(40.009, -89.0),
            segmentEnd = MapPoint(40.009, -88.988),
        ).distanceMeters
        assertEquals(physicalMeters, held.distanceFromRouteMeters, 0.01)
        assertTrue(physicalMeters in 160.0..175.0, "physical $physicalMeters")
        assertTrue(held.distanceAlongRouteMeters <= 200.0, "progress ${held.distanceAlongRouteMeters}")
        assertEquals(0.0, snapshotAt(lRoute(), offRoute, previousProgressMeters = 0.0).distanceAlongRouteMeters)

        // Without a credible previous position the nearest projection is used, as before.
        assertTrue(snapshotAt(lRoute(), offRoute).distanceAlongRouteMeters > 1_500.0)
    }

    @Test
    fun pointToPointProgressFollowsTheRiderBackOntoALaterLeg() {
        val snapshot = snapshotAt(lRoute(), MapPoint(40.009, -88.990), previousProgressMeters = 200.0)

        assertTrue(snapshot.distanceFromRouteMeters < 1.0)
        assertTrue(snapshot.distanceAlongRouteMeters > 1_500.0)
    }

    private fun snapshotAt(
        route: TrailRoute,
        point: MapPoint,
        minimumProgressMeters: Double = 0.0,
        previousProgressMeters: Double? = null,
    ): TrailRouteNavigationSnapshot = assertNotNull(
        TrailRouteNavigationSnapshotSijko.snapshotFor(
            route = route,
            instructions = TrailRouteTurnInstructionSijko.instructionsFor(route),
            userPoint = point,
            minimumProgressMeters = minimumProgressMeters,
            previousProgressMeters = previousProgressMeters,
        ),
    )

    /** About 1 km north, 1 km east, back south and west to the start. */
    private fun squareLoop(): TrailRoute = routeWith(
        TrailRouteSegment(
            type = TrailRouteSegmentType.Trail,
            points = listOf(
                MapPoint(40.0, -89.0),
                MapPoint(40.009, -89.0),
                MapPoint(40.009, -88.988),
                MapPoint(40.0, -88.988),
                MapPoint(40.0, -89.0),
            ),
            name = "Main trail",
        ),
        kind = TrailRouteKind.ExerciseLoop,
    )

    /** About 1 km north, then 1 km east. */
    private fun lRoute(): TrailRoute = routeWith(
        TrailRouteSegment(
            type = TrailRouteSegmentType.Trail,
            points = listOf(MapPoint(40.0, -89.0), MapPoint(40.009, -89.0), MapPoint(40.009, -88.988)),
            name = "Main trail",
        ),
    )

    /** Access road to a junction, a trail loop back to the same junction, then the access road home. */
    private fun repeatedJunctionLoop(): TrailRoute {
        val start = MapPoint(latitude = 40.0, longitude = -89.001)
        val north = MapPoint(latitude = 40.001, longitude = -89.0)
        val east = MapPoint(latitude = 40.001, longitude = -88.999)
        return routeWith(
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(start, repeatedJunction), name = "Access road"),
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(repeatedJunction, north), name = "North trail"),
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(north, east), name = "East trail"),
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(east, repeatedJunction), name = "Return trail"),
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(repeatedJunction, start), name = "Access road"),
            kind = TrailRouteKind.ExerciseLoop,
        )
    }

    private fun routeWith(
        vararg segments: TrailRouteSegment,
        kind: TrailRouteKind = TrailRouteKind.Navigation,
    ): TrailRoute {
        return TrailRoute(
            edges = emptyList(),
            segments = segments.toList(),
            totalDistanceMeters = segments.sumOf { segment -> TrailDistanceSijko.pathLengthMeters(segment.points) },
            ordinaryAccessDistanceMeters = segments
                .filter { segment -> segment.type == TrailRouteSegmentType.Access }
                .sumOf { segment -> TrailDistanceSijko.pathLengthMeters(segment.points) },
            totalCost = 0.0,
            kind = kind,
        )
    }

    private val repeatedJunction = MapPoint(latitude = 40.0, longitude = -89.0)
}
