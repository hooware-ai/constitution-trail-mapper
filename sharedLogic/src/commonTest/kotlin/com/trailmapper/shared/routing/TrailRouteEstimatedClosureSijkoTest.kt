package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TrailRouteEstimatedClosureSijkoTest {
    private fun route(points: List<MapPoint>, mapped: Boolean = false) = TrailRoute(
        segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Access, points, isRouted = mapped)),
        totalDistanceMeters = TrailDistanceSijko.pathLengthMeters(points),
        ordinaryAccessDistanceMeters = TrailDistanceSijko.pathLengthMeters(points), totalCost = 1.0,
    )

    @Test fun estimatedTravelAlongEachKnownClosureIsRefusedOnlyWhileActive() {
        for (closure in TrailRouteClosureSijko.closures) {
            val points = if (closure.id == TrailRouteClosureSijko.uptownUnderpass.id) {
                TrailRouteAdvisorySijko.approximateCorridors(closure.activeFromEpochMillis).single { it.advisoryId == closure.id }.points
            } else closure.sourceLine
            val route = route(points)
            assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route, closure.activeFromEpochMillis - 1), closure.id)
            assertTrue(TrailRouteAdvisorySijko.entersClosedSection(route, closure.activeFromEpochMillis), closure.id)
            assertTrue(TrailRouteAdvisorySijko.entersClosedSection(route, closure), closure.id)
            closure.estimatedEndEpochMillis?.let { assertTrue(TrailRouteAdvisorySijko.entersClosedSection(route, it + 1), closure.id) }
            assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(points, mapped = true), closure), "mapped roads remain distinct: ${closure.id}")
        }
    }

    @Test fun anEstimatedPerpendicularConnectionAndNearbyParallelGeometryDoNotCloseCamelbackRoads() {
        val closure = TrailRouteClosureSijko.camelbackCrossing
        val crossing = closure.closedFrom
        val across = listOf(crossing.copy(longitude = crossing.longitude - 0.001), crossing.copy(longitude = crossing.longitude + 0.001))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(across), closure))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(across, mapped = true), closure))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(closure.sourceLine.map { it.copy(longitude = it.longitude + 0.001) }), closure))
    }

    @Test fun uptownUsesItsCurvedSourceLineAndLeavesUnrelatedConnectionsOpen() {
        val closure = TrailRouteClosureSijko.uptownUnderpass
        val source = TrailRouteAdvisorySijko.approximateCorridors(closure.activeFromEpochMillis).single { it.advisoryId == closure.id }.points
        val inside = MapPoint((source[8].latitude + source[9].latitude) / 2, (source[8].longitude + source[9].longitude) / 2)
        assertTrue(TrailRouteAdvisorySijko.entersClosedSection(route(listOf(inside.copy(longitude = inside.longitude + 0.001), inside)), closure))
        assertTrue(TrailRouteAdvisorySijko.entersClosedSection(route(listOf(inside, inside.copy(longitude = inside.longitude + 0.001))), closure))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(source.map { it.copy(longitude = it.longitude + 0.002) }), closure))
        val perpendicular = listOf(inside.copy(longitude = inside.longitude - 0.002), inside.copy(longitude = inside.longitude + 0.002))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(perpendicular), closure))
    }

    @Test fun estimatedCamelbackTravelCannotSkirtTheGateBecauseOneEndpointIsSlightlyOffTheSourceLine() {
        val closure = TrailRouteClosureSijko.camelbackCrossing
        // A 30 m start connection, ending 10 m north of the crossing. Its south end is only 0.6 m east
        // of the source line; the connector passes within 0.2 m of the closed crossing.
        val points = listOf(
            MapPoint(40.49808950410614, -88.9833938123798),
            MapPoint(40.49835871554693, -88.98342392332951),
        )
        assertTrue(TrailDistanceSijko.projectToSegment(closure.closedFrom, points.first(), points.last()).distanceMeters < 0.3)
        for (ordered in listOf(points, points.reversed())) {
            assertTrue(TrailRouteAdvisorySijko.entersClosedSection(route(ordered), closure))
            assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(ordered, mapped = true), closure))
        }
        // An unrelated parallel connection 5 m away does not travel through this crossing.
        val parallel = closure.sourceLine.map { it.copy(longitude = it.longitude + 0.00006) }
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(parallel), closure))
    }

    @Test fun estimatedWillowTravelIsCheckedWhereItOverlapsTheClosedIntervalInsteadOfAtItsDistantEndpoints() {
        val closure = TrailRouteClosureSijko.willowTrailCrossing
        // Both ends lie outside the interval. The south endpoint is 19 m east of the source line,
        // but the connection travels along the closure corridor and reaches within 2 m near its north end.
        val points = listOf(
            MapPoint(40.5129293115819, -88.98442471294656),
            MapPoint(40.5151035170181, -88.9848322634829),
        )
        assertTrue(TrailDistanceSijko.projectToSegment(closure.closedTo, points.first(), points.last()).distanceMeters < 2.0)
        for (ordered in listOf(points, points.reversed())) {
            assertTrue(TrailRouteAdvisorySijko.entersClosedSection(route(ordered), closure))
            assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(ordered, mapped = true), closure))
        }
        // Nearby parallel geometry beyond the graph's existing 15 m reach remains distinct.
        val parallel = closure.sourceLine.map { it.copy(longitude = it.longitude + 0.00024) }
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(route(parallel), closure))
    }
}
