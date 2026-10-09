/**
 * Job: Verify ordinary-road access routing can skip disconnected nearest road snaps.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailRouteAccessPathFinderSijkoTest {
    @Test
    fun choosesConnectedRoadSnapWhenNearestRoadSnapIsDisconnected() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val disconnectedRoadStart = MapPoint(latitude = 40.00005, longitude = -89.0)
        val disconnectedRoadEnd = MapPoint(latitude = 40.00005, longitude = -88.9995)
        val connectedRoadStart = MapPoint(latitude = 40.0003, longitude = -89.0)
        val roadBend = MapPoint(latitude = 40.0003, longitude = -89.001)
        val connectedRoadEnd = MapPoint(latitude = 40.001, longitude = -89.001)
        val destination = MapPoint(latitude = 40.0012, longitude = -89.001)
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "disconnected-nearest-road",
                    paths = listOf(listOf(disconnectedRoadStart, disconnectedRoadEnd)),
                ),
                AccessNetworkFeature(
                    id = "connected-road",
                    paths = listOf(listOf(connectedRoadStart, roadBend, connectedRoadEnd)),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteAccessPathFinderSijko.findRoute(
                accessGraph = accessGraph,
                start = start,
                destination = destination,
            ),
        )

        assertTrue(route.segments.any { segment ->
            segment.isRouted && roadBend in segment.points
        })
    }

    @Test
    fun avoidsLongEndpointSnapToPathOnlyAccessEdge() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val pathOnlySnap = MapPoint(latitude = 39.99982, longitude = -89.0)
        val roadSnap = MapPoint(latitude = 40.00036, longitude = -89.0)
        val destination = MapPoint(latitude = 40.00036, longitude = -88.999)
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "tempting-path-only-access",
                    roadClass = "S1820",
                    paths = listOf(listOf(pathOnlySnap, destination)),
                ),
                AccessNetworkFeature(
                    id = "ordinary-road-access",
                    roadClass = "S1400",
                    paths = listOf(listOf(roadSnap, destination)),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteAccessPathFinderSijko.findRoute(
                accessGraph = accessGraph,
                start = start,
                destination = destination,
                snapCandidateLimit = 2,
            ),
        )

        assertTrue(
            route.segments.first().points.contains(roadSnap),
            "Expected endpoint access to snap to ordinary road, but route was ${route.segments}",
        )
        assertTrue(
            route.segments.none { segment -> segment.points.first() == start && pathOnlySnap in segment.points },
            "Expected long path-only endpoint snap to be rejected, but route was ${route.segments}",
        )
    }

    @Test
    fun entersAConnectedParkingLotAtTheNearestMappedAisle() {
        val endpoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val parkingAisleNearEndpoint = MapPoint(latitude = 40.0003, longitude = -89.0)
        val parkingAisleExit = MapPoint(latitude = 40.0003, longitude = -88.9996)
        val streetConnection = MapPoint(latitude = 40.0008, longitude = -88.9996)
        val destination = MapPoint(latitude = 40.0015, longitude = -88.9996)
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "mapped-parking-aisle",
                    roadClass = "OSM_PARKING_AISLE",
                    paths = listOf(listOf(parkingAisleNearEndpoint, parkingAisleExit)),
                ),
                AccessNetworkFeature(
                    id = "mapped-parking-lot-driveway",
                    roadClass = "OSM_SERVICE",
                    paths = listOf(listOf(parkingAisleExit, streetConnection)),
                ),
                AccessNetworkFeature(
                    id = "connected-public-street",
                    roadClass = "S1400",
                    paths = listOf(listOf(streetConnection, destination)),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteAccessPathFinderSijko.findRoute(
                accessGraph = accessGraph,
                start = endpoint,
                destination = destination,
            ),
        )

        val initialEstimate = assertNotNull(
            route.segments.firstOrNull { segment -> !segment.isRouted },
        )
        assertTrue(
            TrailDistanceSijko.pathLengthMeters(initialEstimate.points) < 40.0,
            "Expected a short endpoint-to-aisle estimate, but route was ${route.segments}",
        )
        assertTrue(
            route.segments.any { segment -> segment.isRouted && parkingAisleExit in segment.points },
            "Expected the route to follow the connected parking aisle, but route was ${route.segments}",
        )
    }

    @Test
    fun batchesMultipleDestinationsWithoutChangingTheirRoutes() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val bend = MapPoint(latitude = 40.001, longitude = -89.0)
        val firstDestination = MapPoint(latitude = 40.001, longitude = -88.999)
        val secondDestination = MapPoint(latitude = 40.002, longitude = -89.0)
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "first-branch",
                    roadClass = "S1400",
                    paths = listOf(listOf(start, bend, firstDestination)),
                ),
                AccessNetworkFeature(
                    id = "second-branch",
                    roadClass = "S1400",
                    paths = listOf(listOf(bend, secondDestination)),
                ),
            ),
        )

        val routes = TrailRouteAccessPathFinderSijko.findRoutes(
            accessGraph = accessGraph,
            start = start,
            destinations = listOf(firstDestination, secondDestination),
        )

        assertTrue(routes.all { route -> route != null })
        assertTrue(routes[0]!!.segments.any { segment -> firstDestination in segment.points })
        assertTrue(routes[1]!!.segments.any { segment -> secondDestination in segment.points })
    }

}
