/**
 * Job: Verify two routes count as the same ride by kind and drawn path, not by scoring metadata.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TrailRouteIdentitySijkoTest {
    private val route = TrailRoute(
        segments = listOf(
            TrailRouteSegment(type = TrailRouteSegmentType.Access, points = listOf(point(0), point(1))),
            TrailRouteSegment(type = TrailRouteSegmentType.Trail, points = listOf(point(1), point(2), point(3))),
        ),
        totalDistanceMeters = 3000.0,
        ordinaryAccessDistanceMeters = 200.0,
        totalCost = 3100.0,
    )

    @Test
    fun metadataChangesDoNotMakeADifferentRoute() {
        val rescored = route.copy(
            totalCost = route.totalCost + 1.0,
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
            requestedDistanceMeters = 3200.0,
        )

        assertTrue(TrailRouteIdentitySijko.isSameRoute(route, rescored))
    }

    @Test
    fun theSamePathRiddenBackwardsIsTheSameRoute() {
        assertTrue(TrailRouteIdentitySijko.isSameRoute(route, TrailRouteReverseSijko.reversed(route)))
    }

    @Test
    fun aDifferentPathOrKindIsADifferentRoute() {
        val detour = route.copy(
            segments = route.segments + TrailRouteSegment(type = TrailRouteSegmentType.Trail, points = listOf(point(3), point(4))),
        )

        assertFalse(TrailRouteIdentitySijko.isSameRoute(route, detour))
        assertFalse(TrailRouteIdentitySijko.isSameRoute(route, route.copy(kind = TrailRouteKind.ExerciseLoop)))
    }

    private fun point(index: Int) = MapPoint(latitude = 40.5 + index * 0.001, longitude = -88.98)
}
