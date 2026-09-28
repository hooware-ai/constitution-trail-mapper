/**
 * Job: Verify trail routes choose entry and exit snaps by mapped-road access instead of aerial distance.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailRouteWithAccessFinderSijkoTest {
    @Test
    fun choosesNearbyApprovedTrailLineOverLongRoadLoop() {
        val trailEntry = MapPoint(latitude = 40.0, longitude = -89.0)
        val nearbyTrailPoint = MapPoint(latitude = 40.0, longitude = -88.996)
        val trailExit = MapPoint(latitude = 40.004, longitude = -88.996)
        val start = MapPoint(latitude = 40.00002, longitude = -88.99599)
        val destination = MapPoint(latitude = 40.0041, longitude = -88.996)
        val roadBend = MapPoint(latitude = 40.001, longitude = -89.0)
        val trailGraph = trailGraph(
            trailEntry = trailEntry,
            visuallyNearestTrailPoint = nearbyTrailPoint,
            trailTurn = trailExit,
            trailExit = trailExit,
        )
        val accessGraph = accessGraph(
            start = start,
            roadBend = roadBend,
            trailEntry = trailEntry,
            destination = destination,
            trailExit = trailExit,
        )

        val route = assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(
                trailGraph = trailGraph,
                accessGraph = accessGraph,
                start = start,
                destination = destination,
            ),
        )

        assertEquals(start, route.segments.first().points.first())
        val startAccess = route.segments.first {
            it.type == TrailRouteSegmentType.Access && it.points.first() == start
        }
        assertTrue(TrailDistanceSijko.metersBetween(start, startAccess.points.last()) < 8.0)
        assertTrue(route.segments.none { roadBend in it.points })
    }

    @Test
    fun choosesFartherTrailNodeWhenRoadAccessReachesItFirst() {
        val trailEntry = MapPoint(latitude = 40.0, longitude = -89.0)
        val visuallyNearestTrailPoint = MapPoint(latitude = 40.0, longitude = -88.996)
        val trailTurn = MapPoint(latitude = 40.0, longitude = -88.992)
        val trailExit = MapPoint(latitude = 40.004, longitude = -88.992)
        val start = MapPoint(latitude = 40.0014, longitude = -88.996)
        val roadBend = MapPoint(latitude = 40.0014, longitude = -89.0)
        val destination = MapPoint(latitude = 40.0041, longitude = -88.992)
        val trailGraph = trailGraph(
            trailEntry = trailEntry,
            visuallyNearestTrailPoint = visuallyNearestTrailPoint,
            trailTurn = trailTurn,
            trailExit = trailExit,
        )
        val accessGraph = accessGraph(
            start = start,
            roadBend = roadBend,
            trailEntry = trailEntry,
            destination = destination,
            trailExit = trailExit,
        )

        val route = assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(
                trailGraph = trailGraph,
                accessGraph = accessGraph,
                start = start,
                destination = destination,
            ),
        )

        assertEquals(start, route.segments.first().points.first())
        val startAccess = route.segments.first {
            it.type == TrailRouteSegmentType.Access && it.points.first() == start
        }
        assertEquals(trailEntry, startAccess.points.last())
        assertTrue(startAccess.isRouted)
        assertTrue(roadBend in startAccess.points)
    }

    @Test
    fun prefersMappedRoadToApprovedConnectorOverShortUnmappedCut() {
        val start = MapPoint(latitude = 40.0005, longitude = -88.9994)
        val directTrailPoint = MapPoint(latitude = 40.0, longitude = -88.9994)
        val connectorEntry = MapPoint(latitude = 40.0005, longitude = -89.0014)
        val connectorJoin = MapPoint(latitude = 40.0, longitude = -89.0014)
        val roadStart = MapPoint(latitude = 40.00077, longitude = -88.9994)
        val roadEnd = MapPoint(latitude = 40.00077, longitude = -89.0014)
        val tinyMappedSliverStart = MapPoint(latitude = 40.00025, longitude = -88.9994)
        val tinyMappedSliverEnd = MapPoint(latitude = 40.000255, longitude = -88.9994)
        val trailExit = MapPoint(latitude = 40.0, longitude = -88.9954)
        val destination = trailExit
        val trailGraph = trailGraphWithConnector(
            connectorEntry = connectorEntry,
            connectorJoin = connectorJoin,
            directTrailPoint = directTrailPoint,
            trailExit = trailExit,
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "neighborhood-road",
                    paths = listOf(listOf(roadStart, roadEnd)),
                ),
                AccessNetworkFeature(
                    id = "tiny-sliver-near-shortcut",
                    paths = listOf(listOf(tinyMappedSliverStart, tinyMappedSliverEnd)),
                ),
            ),
        )
        val startCandidates = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = start,
        )
        assertTrue(
            startCandidates.any { candidate ->
                candidate.snap.edge.sourceFeatureId == "connector" &&
                    candidate.accessSegments.any { it.isRouted }
            },
            "Expected connector start candidate but got $startCandidates",
        )
        assertTrue(
            startCandidates.none { candidate ->
                candidate.snap.edge.sourceFeatureId == "main-trail" &&
                    candidate.accessSegments.none { it.isRouted }
            },
            "Expected longer unmapped cut to main trail to be rejected but got $startCandidates",
        )
        assertTrue(
            startCandidates.none { candidate ->
                candidate.snap.edge.sourceFeatureId == "main-trail" &&
                    candidate.routedAccessDistanceMeters() < candidate.estimatedAccessDistanceMeters() &&
                    candidate.estimatedAccessDistanceMeters() > 8.0
            },
            "Expected mapped-road access to dominate estimated gaps but got $startCandidates",
        )

        val route = assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(
                trailGraph = trailGraph,
                accessGraph = accessGraph,
                start = start,
                destination = destination,
            ),
        )

        val leadingAccessSegments = route.segments.takeWhile {
            it.type == TrailRouteSegmentType.Access
        }
        assertTrue(
            leadingAccessSegments.any { it.isRouted },
            "Expected routed leading access but route segments were ${route.segments} and edges were ${route.edges.map { it.sourceFeatureId }}",
        )
        assertTrue(
            TrailDistanceSijko.metersBetween(connectorEntry, leadingAccessSegments.last().points.last()) < 1.0,
            "Expected mapped road access to end at $connectorEntry but was ${leadingAccessSegments.last().points.last()}",
        )
        assertTrue(route.edges.any { it.sourceFeatureId == "connector" })
    }

    @Test
    fun extendsOrdinaryRoadAccessWhenDestinationIsFarFromTrailNetwork() {
        val trailStart = MapPoint(latitude = 40.0, longitude = -89.0)
        val trailExit = MapPoint(latitude = 40.0, longitude = -89.01)
        val destination = MapPoint(latitude = 40.025, longitude = -89.01)
        val trailGraph = trailGraph(
            trailEntry = trailStart,
            visuallyNearestTrailPoint = trailStart,
            trailTurn = trailExit,
            trailExit = trailExit,
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "long-destination-access-road",
                    paths = listOf(listOf(destination, trailExit)),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(
                trailGraph = trailGraph,
                accessGraph = accessGraph,
                start = trailStart,
                destination = destination,
            ),
        )

        assertTrue(
            route.ordinaryAccessDistanceMeters > 2_000.0,
            "Expected the route to retain the long ordinary-road access leg, but route was $route",
        )
        assertEquals(destination, route.segments.last().points.last())
    }

    @Test
    fun doesNotLetDenseTrailSnapsHideDirectSharedRoadExit() {
        val sharedRoadStart = MapPoint(latitude = 40.005, longitude = -89.0)
        val sharedRoadExit = MapPoint(latitude = 40.0, longitude = -89.0)
        val destinationRoadTurn = MapPoint(latitude = 39.996, longitude = -89.0)
        val destination = MapPoint(latitude = 39.996, longitude = -89.006)
        val denseTrailPoints = buildList {
            add(sharedRoadExit)
            for (index in 1..160) {
                add(
                    MapPoint(
                        latitude = 40.0,
                        longitude = -89.0 - index * 0.00005,
                    ),
                )
            }
        }
        val trailGraph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "shared-road",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                    facilityType = TrailFacilityType.SharedLane,
                    comfortLevel = TrailComfortLevel.ExperiencedBicyclists,
                    paths = listOf(listOf(sharedRoadStart, sharedRoadExit)),
                ),
                TrailNetworkFeature(
                    id = "dense-trail",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(denseTrailPoints),
                ),
            ),
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "destination-road",
                    paths = listOf(
                        listOf(
                            destination,
                            destinationRoadTurn,
                            sharedRoadExit,
                            denseTrailPoints[120],
                        ),
                    ),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(
                trailGraph = trailGraph,
                accessGraph = accessGraph,
                start = sharedRoadStart,
                destination = destination,
            ),
        )

        assertTrue(
            route.edges.none { it.sourceFeatureId == "dense-trail" },
            "Expected shared road to hand off directly to destination access, but route used ${route.edges.map { it.sourceFeatureId }}",
        )
        assertEquals(sharedRoadExit, route.segments.last { it.type == TrailRouteSegmentType.Trail }.points.last())
    }

    private fun trailGraph(
        trailEntry: MapPoint,
        visuallyNearestTrailPoint: MapPoint,
        trailTurn: MapPoint,
        trailExit: MapPoint,
    ): TrailGraph {
        return TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "trail",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(
                        listOf(
                            trailEntry,
                            visuallyNearestTrailPoint,
                            trailTurn,
                            trailExit,
                        ),
                    ),
                ),
            ),
        )
    }

    private fun trailGraphWithConnector(
        connectorEntry: MapPoint,
        connectorJoin: MapPoint,
        directTrailPoint: MapPoint,
        trailExit: MapPoint,
    ): TrailGraph {
        return TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "connector",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.ParkConnectors),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(listOf(connectorEntry, connectorJoin)),
                ),
                TrailNetworkFeature(
                    id = "main-trail",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(listOf(connectorJoin, directTrailPoint, trailExit)),
                ),
            ),
        )
    }

    private fun accessGraph(
        start: MapPoint,
        roadBend: MapPoint,
        trailEntry: MapPoint,
        destination: MapPoint,
        trailExit: MapPoint,
    ): TrailGraph {
        return AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "start-road",
                    paths = listOf(listOf(start, roadBend, trailEntry)),
                ),
                AccessNetworkFeature(
                    id = "destination-road",
                    paths = listOf(listOf(destination, trailExit)),
                ),
            ),
        )
    }

    private fun TrailRouteEndpointAccess.routedAccessDistanceMeters(): Double {
        return accessSegments
            .filter { it.type == TrailRouteSegmentType.Access && it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
    }

    private fun TrailRouteEndpointAccess.estimatedAccessDistanceMeters(): Double {
        return accessSegments
            .filter { it.type == TrailRouteSegmentType.Access && !it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
    }
}
