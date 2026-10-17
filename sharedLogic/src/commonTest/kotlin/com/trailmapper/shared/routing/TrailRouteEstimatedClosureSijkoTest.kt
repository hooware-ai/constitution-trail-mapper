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
}
