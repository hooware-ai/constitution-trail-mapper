/**
 * Job: Verify loop rerouting rejoins ahead of the rider's progress and returns to the start on request.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class TrailRouteLoopRerouteSijkoTest {
    @Test
    fun theRemainderStartsAtTheCutAndKeepsTheRestOfTheRoute() {
        val outAndBack = loopRoute(listOf(a, north, a))
        val leg = TrailDistanceSijko.metersBetween(a, north)

        val remainder = TrailRouteDistanceBasisSijko.segmentsFrom(
            outAndBack,
            TrailRouteDistanceBasisSijko.geometryMetersAt(outAndBack, leg * 1.5),
        )

        // The cut lies halfway down the return leg, not on the outbound pass through the same place.
        assertEquals(1, remainder.size)
        assertTrue(TrailDistanceSijko.metersBetween(remainder.single().points.first(), midpoint(a, north)) < 0.01)
        assertEquals(a, remainder.single().points.last())
        assertEquals(leg * 0.5, TrailDistanceSijko.pathLengthMeters(remainder.single().points), 0.5)
    }

    @Test
    fun aRejoinStaysAheadAndNeverJumpsToTheReturnPassThroughTheSamePlace() {
        // Riding north on an out-and-back, the rider strays 85 m west at 300 m in. The return pass
        // runs through the same place 1.7 km in, which would wrongly skip most of the ride.
        val outAndBack = loopRoute(listOf(a, north, a))
        val rider = MapPoint(40.0027, -89.001)

        val outcome = TrailRouteLoopRerouteSijko.rejoin(
            features = listOf(trail("main", a, north)),
            route = outAndBack,
            from = rider,
            progressMeters = 300.0,
            accessGraph = null,
        )

        val replacement = assertIs<TrailRouteRerouteOutcome.Replacement>(outcome).route
        assertEquals(TrailRouteKind.ExerciseLoop, replacement.kind)
        assertEquals(a, replacement.segments.last().points.last())
        // Rejoining ahead on the outbound leaves at least the rest of it plus the whole return.
        assertTrue(replacement.totalDistanceMeters > TrailDistanceSijko.metersBetween(a, north), "${replacement.totalDistanceMeters}")
        assertTrue(replacement.segments.any { segment -> segment.points.any { it == north } }, "keeps the turnaround")
    }

    @Test
    fun aRejoinPrefersTheEarliestComparableRejoinPoint() {
        val square = loopRoute(listOf(a, north, northEast, east, a))
        val rider = MapPoint(40.002, -89.001)

        val outcome = TrailRouteLoopRerouteSijko.rejoin(
            features = listOf(trail("loop", a, north, northEast, east, a)),
            route = square,
            from = rider,
            progressMeters = 200.0,
            accessGraph = null,
        )

        val replacement = assertIs<TrailRouteRerouteOutcome.Replacement>(outcome).route
        val loopMeters = TrailDistanceSijko.pathLengthMeters(listOf(a, north, northEast, east, a))
        // Rejoined 100-300 m ahead of the rider's 200 m, so nearly the whole remaining loop is kept.
        assertTrue(replacement.totalDistanceMeters > loopMeters - 600.0, "${replacement.totalDistanceMeters}")
        assertTrue(replacement.totalDistanceMeters < loopMeters, "${replacement.totalDistanceMeters}")
    }

    @Test
    fun aRejoinKeepsOnlyTheTraversalLeftToRide() {
        val sides = listOf(a, north, northEast, east, a).zipWithNext().mapIndexed { index, (from, to) ->
            TrailRouteTraversalEdge(key = "side-$index", distanceMeters = TrailDistanceSijko.metersBetween(from, to))
        }
        val square = loopRoute(listOf(a, north, northEast, east, a)).copy(traversalEdges = sides)

        val replacement = assertIs<TrailRouteRerouteOutcome.Replacement>(
            TrailRouteLoopRerouteSijko.rejoin(
                features = listOf(trail("loop", a, north, northEast, east, a)),
                route = square,
                from = MapPoint(40.002, -89.001),
                progressMeters = 200.0,
                accessGraph = null,
            ),
        ).route

        // The loop's own traversal in the replacement is its remainder: the stretch before the rejoin point
        // (at least the 200 m already ridden) is not credited again.
        val loopTraversal = replacement.traversalEdges.filter { it.key.startsWith("side-") }
        assertEquals(listOf("side-0", "side-1", "side-2", "side-3"), loopTraversal.map { it.key })
        assertTrue(loopTraversal.first().distanceMeters < sides.first().distanceMeters - 200.0)
        assertEquals(sides.drop(1), loopTraversal.drop(1))
    }

    @Test
    fun returnToStartIsAPlainRouteHome() {
        val square = loopRoute(listOf(a, north, northEast, east, a))

        val outcome = TrailRouteLoopRerouteSijko.returnToStart(
            features = listOf(trail("loop", a, north, northEast, east, a)),
            route = square,
            from = MapPoint(40.005, -89.001),
            accessGraph = null,
        )

        val home = assertIs<TrailRouteRerouteOutcome.Replacement>(outcome).route
        assertEquals(TrailRouteKind.Navigation, home.kind)
        assertEquals(a, home.segments.last().points.last())
    }

    @Test
    fun returnToStartAfterARejoinStillHeadsForTheWorkoutStart() {
        val features = listOf(trail("loop", a, north, northEast, east, a))
        val firstDeparture = MapPoint(40.002, -89.001)
        val rejoined = assertIs<TrailRouteRerouteOutcome.Replacement>(
            TrailRouteLoopRerouteSijko.rejoin(features, loopRoute(listOf(a, north, northEast, east, a)), firstDeparture, 200.0, null),
        ).route
        // The replacement now begins at the first departure's connector, not at the workout start.
        assertTrue(TrailDistanceSijko.metersBetween(rejoined.segments.first().points.first(), a) > 100.0)

        // A second departure, then the rider chooses to go home.
        val home = assertIs<TrailRouteRerouteOutcome.Replacement>(
            TrailRouteLoopRerouteSijko.returnToStart(features, rejoined, MapPoint(40.009, -88.995), null),
        ).route

        assertEquals(a, home.segments.last().points.last())
    }

    @Test
    fun aDisconnectedNetworkIsAnExplicitNoSafeRoute() {
        val square = loopRoute(listOf(a, north, northEast, east, a))

        val outcome = TrailRouteLoopRerouteSijko.rejoin(
            features = listOf(trail("elsewhere", MapPoint(40.05, -89.0), MapPoint(40.06, -89.0))),
            route = square,
            from = MapPoint(40.002, -89.001),
            progressMeters = 200.0,
            accessGraph = null,
        )

        assertIs<TrailRouteRerouteOutcome.NoSafeRoute>(outcome)
    }

    private fun loopRoute(points: List<MapPoint>) = TrailRoute(
        segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, points, name = "Main trail")),
        totalDistanceMeters = TrailDistanceSijko.pathLengthMeters(points),
        ordinaryAccessDistanceMeters = 0.0,
        totalCost = 0.0,
        kind = TrailRouteKind.ExerciseLoop,
    )

    private fun trail(id: String, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        name = "Main trail",
        status = TrailFeatureStatus.Existing,
        routeRoles = setOf(TrailNetworkRole.TrailBranches),
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )

    private fun midpoint(from: MapPoint, to: MapPoint) =
        MapPoint((from.latitude + to.latitude) / 2.0, (from.longitude + to.longitude) / 2.0)

    private val a = MapPoint(40.0, -89.0)
    private val north = MapPoint(40.009, -89.0)
    private val northEast = MapPoint(40.009, -88.988)
    private val east = MapPoint(40.0, -88.988)
}
