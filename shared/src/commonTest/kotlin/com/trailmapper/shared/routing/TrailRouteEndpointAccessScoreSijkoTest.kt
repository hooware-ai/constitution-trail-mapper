/**
 * Job: Verify endpoint access scoring separates routed road access from direct unmapped trail cuts.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertTrue

class TrailRouteEndpointAccessScoreSijkoTest {
    @Test
    fun scoresRoutedRoadAccessAheadOfShortDirectUnmappedCut() {
        val endpoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val directTrailPoint = MapPoint(latitude = 40.0006, longitude = -89.0)
        val roadSnap = MapPoint(latitude = 40.0002, longitude = -89.0)
        val roadTurn = MapPoint(latitude = 40.0002, longitude = -89.0005)
        val connectorSnap = MapPoint(latitude = 40.0005, longitude = -89.0005)

        val directAccess = endpointAccess(
            endpoint = endpoint,
            snapPoint = directTrailPoint,
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(endpoint, directTrailPoint),
                    isRouted = false,
                ),
            ),
        )
        val routedAccess = endpointAccess(
            endpoint = endpoint,
            snapPoint = connectorSnap,
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(endpoint, roadSnap),
                    isRouted = false,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(roadSnap, roadTurn),
                    isRouted = true,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(roadTurn, connectorSnap),
                    isRouted = false,
                ),
            ),
        )

        assertTrue(
            TrailRouteEndpointAccessScoreSijko.score(routedAccess) <
                TrailRouteEndpointAccessScoreSijko.score(directAccess),
        )
    }

    @Test
    fun scoresConnectorEndpointAheadOfComparableMainTrailEndpoint() {
        val endpoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val snapPoint = MapPoint(latitude = 40.0002, longitude = -89.0)
        val accessSegments = listOf(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Access,
                points = listOf(endpoint, snapPoint),
                isRouted = true,
            ),
        )
        val connector = endpointAccess(
            endpoint = endpoint,
            snapPoint = snapPoint,
            routeRoles = setOf(TrailNetworkRole.ParkConnectors),
            segments = accessSegments,
        )
        val mainTrail = endpointAccess(
            endpoint = endpoint,
            snapPoint = snapPoint,
            routeRoles = setOf(TrailNetworkRole.TrailBranches),
            segments = accessSegments,
        )

        assertTrue(
            TrailRouteEndpointAccessScoreSijko.score(connector) <
                TrailRouteEndpointAccessScoreSijko.score(mainTrail),
        )
    }

    private fun endpointAccess(
        endpoint: MapPoint,
        snapPoint: MapPoint,
        routeRoles: Set<TrailNetworkRole> = emptySet(),
        segments: List<TrailRouteSegment>,
    ): TrailRouteEndpointAccess {
        return TrailRouteEndpointAccess(
            endpointPoint = endpoint,
            snap = TrailNetworkSnap(
                edge = TrailGraphEdge(
                    id = 0,
                    fromNodeId = 0,
                    toNodeId = 1,
                    distanceMeters = 1.0,
                    routeRoles = routeRoles,
                ),
                projectedPoint = snapPoint,
                accessDistanceMeters = TrailDistanceSijko.metersBetween(endpoint, snapPoint),
                distanceFromStartMeters = 0.0,
                distanceToEndMeters = 0.0,
            ),
            accessSegments = segments,
            accessDistanceMeters = segments.sumOf { TrailDistanceSijko.pathLengthMeters(it.points) },
        )
    }
}
