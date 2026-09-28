/**
 * Job: Verify straight endpoint access estimates are replaced by ordinary-road routes when possible.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TrailRouteAccessRoutingSijkoTest {
    @Test
    fun replacesEstimatedAccessWithRoutedAccessGeometry() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val roadBend = MapPoint(latitude = 40.0, longitude = -88.999)
        val trailEntry = MapPoint(latitude = 40.001, longitude = -88.999)
        val trailEnd = MapPoint(latitude = 40.001, longitude = -88.998)
        val route = TrailRoute(
            edges = emptyList(),
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(start, trailEntry),
                    isRouted = false,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(trailEntry, trailEnd),
                ),
            ),
            totalDistanceMeters = TrailDistanceSijko.pathLengthMeters(listOf(start, trailEntry, trailEnd)),
            ordinaryAccessDistanceMeters = TrailDistanceSijko.pathLengthMeters(listOf(start, trailEntry)),
            totalCost = 0.0,
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "road",
                    paths = listOf(listOf(start, roadBend, trailEntry)),
                ),
            ),
        )

        val routed = TrailRouteAccessRoutingSijko.routeAccessSegments(
            route = route,
            accessGraph = accessGraph,
            maxEndpointSnapMeters = 5.0,
        )

        val accessSegments = routed.segments.filter { it.type == TrailRouteSegmentType.Access }
        assertTrue(accessSegments.any { it.isRouted && roadBend in it.points })
        assertFalse(accessSegments.any { !it.isRouted })
        assertTrue(routed.ordinaryAccessDistanceMeters > route.ordinaryAccessDistanceMeters)
        assertEquals(trailEnd, routed.segments.last().points.last())
    }

    @Test
    fun keepsEstimatedAccessWhenRoadRouteCannotSnapToEndpoint() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val trailEntry = MapPoint(latitude = 40.001, longitude = -88.999)
        val route = TrailRoute(
            edges = emptyList(),
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(start, trailEntry),
                    isRouted = false,
                ),
            ),
            totalDistanceMeters = TrailDistanceSijko.pathLengthMeters(listOf(start, trailEntry)),
            ordinaryAccessDistanceMeters = TrailDistanceSijko.pathLengthMeters(listOf(start, trailEntry)),
            totalCost = 0.0,
        )
        val farAccessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "far-road",
                    paths = listOf(
                        listOf(
                            MapPoint(latitude = 40.1, longitude = -89.1),
                            MapPoint(latitude = 40.1, longitude = -89.099),
                        ),
                    ),
                ),
            ),
        )

        val routed = TrailRouteAccessRoutingSijko.routeAccessSegments(
            route = route,
            accessGraph = farAccessGraph,
            maxEndpointSnapMeters = 5.0,
        )

        assertEquals(route.segments, routed.segments)
    }
}
