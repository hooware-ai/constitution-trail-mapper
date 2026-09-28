/**
 * Job: Verify route search stays on approved graph edges plus endpoint access legs.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailRouteFinderSijkoTest {
    @Test
    fun findsRouteAcrossApprovedTrailGraph() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "main",
                    status = TrailFeatureStatus.Existing,
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                        MapPoint(latitude = 40.001, longitude = -88.999),
                    ),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = graph,
                start = MapPoint(latitude = 40.00005, longitude = -89.0),
                destination = MapPoint(latitude = 40.001, longitude = -88.99895),
                maxAccessMeters = 50.0,
            ),
        )

        assertTrue(route.edges.isNotEmpty())
        assertTrue(route.totalDistanceMeters > 150.0)
        assertTrue(route.ordinaryAccessDistanceMeters in 1.0..20.0)
        assertTrue(route.edges.all { it.sourceFeatureId == "main" })
        assertTrue(route.segments.any { it.type == TrailRouteSegmentType.Access })
        assertTrue(route.segments.any { it.type == TrailRouteSegmentType.Trail })
        assertTrue(route.segments.filter { it.type == TrailRouteSegmentType.Access }.all { !it.isRouted })
        assertTrue(route.segments.filter { it.type == TrailRouteSegmentType.Trail }.all { it.isRouted })
        assertEquals(MapPoint(latitude = 40.00005, longitude = -89.0), route.segments.first().points.first())
        assertEquals(MapPoint(latitude = 40.001, longitude = -88.99895), route.segments.last().points.last())
    }

    @Test
    fun orientsDrawableSegmentsWhenTravelingAgainstPolylineDirection() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "main",
                    status = TrailFeatureStatus.Existing,
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                    ),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = graph,
                start = MapPoint(latitude = 40.0, longitude = -88.999),
                destination = MapPoint(latitude = 40.0, longitude = -89.0),
                maxAccessMeters = 25.0,
            ),
        )

        assertEquals(MapPoint(latitude = 40.0, longitude = -88.999), route.segments.first().points.first())
        assertEquals(MapPoint(latitude = 40.0, longitude = -89.0), route.segments.last().points.last())
    }

    @Test
    fun proposedOnlyRouteRequiresProposedTrailsSelection() {
        val proposedFeature = feature(
            id = "future",
            status = TrailFeatureStatus.Proposed,
            path = listOf(
                MapPoint(latitude = 40.0, longitude = -89.0),
                MapPoint(latitude = 40.0, longitude = -88.999),
            ),
        )

        val defaultFeatures = TrailFeatureFilterSijko.enabledFeatures(
            features = listOf(proposedFeature),
            selection = RouteLayerDefaultsSijko.defaultSelection(),
        )
        val proposedFeatures = TrailFeatureFilterSijko.enabledFeatures(
            features = listOf(proposedFeature),
            selection = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true),
        )

        assertNull(
            TrailRouteFinderSijko.findRoute(
                graph = TrailGraphBuilderSijko.buildGraph(defaultFeatures),
                start = MapPoint(latitude = 40.0, longitude = -89.0),
                destination = MapPoint(latitude = 40.0, longitude = -88.999),
                maxAccessMeters = 25.0,
            ),
        )
        assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = TrailGraphBuilderSijko.buildGraph(proposedFeatures),
                start = MapPoint(latitude = 40.0, longitude = -89.0),
                destination = MapPoint(latitude = 40.0, longitude = -88.999),
                maxAccessMeters = 25.0,
            ),
        )
    }

    @Test
    fun prefersTrailRouteOverShorterSharedRoadwayRoute() {
        val graph = parallelChoiceGraph(trailLegDistanceMeters = 450.0)
        val route = assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = graph,
                startAccesses = listOf(
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "shared" }, graph.nodes[0].point, 0.0),
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "trail-a" }, graph.nodes[0].point, 0.0),
                ),
                destinationAccesses = listOf(
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "shared" }, graph.nodes[2].point, 100.0),
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "trail-b" }, graph.nodes[2].point, 450.0),
                ),
            ),
        )

        assertTrue(route.edges.none { it.sourceFeatureId == "shared" })
        assertTrue(route.edges.any { it.sourceFeatureId == "trail-a" })
        assertTrue(route.edges.any { it.sourceFeatureId == "trail-b" })
    }

    @Test
    fun returnsTrailPreferredAndShortestDistanceAlternatives() {
        val graph = parallelChoiceGraph(trailLegDistanceMeters = 450.0)
        val alternatives = TrailRouteFinderSijko.findRouteAlternatives(
            graph = graph,
            startAccess = endpointAccess(
                graph.edges.first { it.sourceFeatureId == "trail-a" },
                graph.nodes[0].point,
                0.0,
            ),
            destinationAccess = endpointAccess(
                graph.edges.first { it.sourceFeatureId == "trail-b" },
                graph.nodes[2].point,
                450.0,
            ),
        )

        assertTrue(
            alternatives.any { route -> route.edges.none { it.sourceFeatureId == "shared" } },
            "Expected a trail-preferred alternative but got ${alternatives.map { route -> route.edges.map { it.sourceFeatureId } }}",
        )
        assertTrue(
            alternatives.any { route -> route.edges.any { it.sourceFeatureId == "shared" } },
            "Expected a shortest-distance shared-road alternative but got ${alternatives.map { route -> route.edges.map { it.sourceFeatureId } }}",
        )
    }

    @Test
    fun usesSharedRoadwayWhenTrailDetourIsUntenable() {
        val graph = parallelChoiceGraph(trailLegDistanceMeters = 600.0)
        val route = assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = graph,
                startAccesses = listOf(
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "shared" }, graph.nodes[0].point, 0.0),
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "trail-a" }, graph.nodes[0].point, 0.0),
                ),
                destinationAccesses = listOf(
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "shared" }, graph.nodes[2].point, 100.0),
                    endpointAccess(graph.edges.first { it.sourceFeatureId == "trail-b" }, graph.nodes[2].point, 600.0),
                ),
            ),
        )

        assertTrue(route.edges.any { it.sourceFeatureId == "shared" })
    }

    @Test
    fun preservesRouteRolesOnInteriorSnapSegments() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.9995)
        val destination = MapPoint(latitude = 40.0, longitude = -88.999)
        val sharedRoadEdge = edge(
            id = 0,
            fromNodeId = 0,
            toNodeId = 1,
            distanceMeters = 100.0,
            sourceFeatureId = "shared",
            routeRoles = setOf(TrailNetworkRole.SharedRoadways),
            displayStyle = TrailRouteDisplayStyle.SuggestedSharedRoadways,
            name = "Veterans Parkway",
            points = listOf(start, destination),
        )
        val graph = TrailGraph(
            nodes = listOf(
                TrailGraphNode(id = 0, point = start),
                TrailGraphNode(id = 1, point = destination),
            ),
            edges = listOf(sharedRoadEdge),
        )

        val route = assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = graph,
                startAccesses = listOf(endpointAccess(sharedRoadEdge, middle, 50.0)),
                destinationAccesses = listOf(endpointAccess(sharedRoadEdge, destination, 100.0)),
            ),
        )

        assertTrue(route.segments.any { segment -> segment.type == TrailRouteSegmentType.Trail })
        assertTrue(
            route.segments
                .filter { segment -> segment.type == TrailRouteSegmentType.Trail }
                .all { segment -> TrailNetworkRole.SharedRoadways in segment.routeRoles },
        )
        assertTrue(
            route.segments
                .filter { segment -> segment.type == TrailRouteSegmentType.Trail }
                .all { segment -> segment.name == "Veterans Parkway" },
        )
        assertTrue(
            route.segments
                .filter { segment -> segment.type == TrailRouteSegmentType.Trail }
                .all { segment -> segment.displayStyle == TrailRouteDisplayStyle.SuggestedSharedRoadways },
        )
    }

    @Test
    fun batchedDestinationsCannotBridgeDisconnectedSnapAlternatives() {
        val firstStart = MapPoint(latitude = 40.0, longitude = -89.0)
        val firstEnd = MapPoint(latitude = 40.0, longitude = -88.999)
        val secondStart = MapPoint(latitude = 40.01, longitude = -89.0)
        val secondEnd = MapPoint(latitude = 40.01, longitude = -88.999)
        val firstEdge = edge(
            id = 0,
            fromNodeId = 0,
            toNodeId = 1,
            distanceMeters = 100.0,
            sourceFeatureId = "first-component",
            routeRoles = setOf(TrailNetworkRole.TrailBranches),
            points = listOf(firstStart, firstEnd),
        )
        val secondEdge = edge(
            id = 1,
            fromNodeId = 2,
            toNodeId = 3,
            distanceMeters = 100.0,
            sourceFeatureId = "second-component",
            routeRoles = setOf(TrailNetworkRole.TrailBranches),
            points = listOf(secondStart, secondEnd),
        )
        val graph = TrailGraph(
            nodes = listOf(
                TrailGraphNode(id = 0, point = firstStart),
                TrailGraphNode(id = 1, point = firstEnd),
                TrailGraphNode(id = 2, point = secondStart),
                TrailGraphNode(id = 3, point = secondEnd),
            ),
            edges = listOf(firstEdge, secondEdge),
        )

        val routes = TrailRouteFinderSijko.findRoutes(
            graph = graph,
            startAccesses = listOf(endpointAccess(firstEdge, firstStart, 0.0)),
            destinationAccessGroups = listOf(
                listOf(
                    endpointAccess(firstEdge, firstEnd, 100.0),
                    endpointAccess(secondEdge, secondStart, 0.0),
                ),
                listOf(endpointAccess(secondEdge, secondEnd, 100.0)),
            ),
        )

        assertNotNull(routes[0])
        assertNull(routes[1])
    }

    @Test
    fun propagatesCancellationCheckpoint() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "main",
                    status = TrailFeatureStatus.Existing,
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                    ),
                ),
            ),
        )

        assertFailsWith<CancellationException> {
            TrailRouteFinderSijko.findRoute(
                graph = graph,
                start = MapPoint(latitude = 40.0, longitude = -89.0),
                destination = MapPoint(latitude = 40.0, longitude = -88.999),
                maxAccessMeters = 25.0,
                cancellationCheckpoint = {
                    throw CancellationException("cancel route search")
                },
            )
        }
    }

    private fun feature(
        id: String,
        status: TrailFeatureStatus,
        path: List<MapPoint>,
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = id,
            status = status,
            routeRoles = if (status == TrailFeatureStatus.Proposed) {
                setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ProposedTrails)
            } else {
                setOf(TrailNetworkRole.TrailBranches)
            },
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            paths = listOf(path),
        )
    }

    private fun parallelChoiceGraph(trailLegDistanceMeters: Double): TrailGraph {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.001, longitude = -89.0)
        val destination = MapPoint(latitude = 40.0, longitude = -88.999)
        val nodes = listOf(
            TrailGraphNode(id = 0, point = start),
            TrailGraphNode(id = 1, point = middle),
            TrailGraphNode(id = 2, point = destination),
        )
        return TrailGraph(
            nodes = nodes,
            edges = listOf(
                edge(
                    id = 0,
                    fromNodeId = 0,
                    toNodeId = 2,
                    distanceMeters = 100.0,
                    sourceFeatureId = "shared",
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                    points = listOf(start, destination),
                ),
                edge(
                    id = 1,
                    fromNodeId = 0,
                    toNodeId = 1,
                    distanceMeters = trailLegDistanceMeters,
                    sourceFeatureId = "trail-a",
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    points = listOf(start, middle),
                ),
                edge(
                    id = 2,
                    fromNodeId = 1,
                    toNodeId = 2,
                    distanceMeters = trailLegDistanceMeters,
                    sourceFeatureId = "trail-b",
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    points = listOf(middle, destination),
                ),
            ),
        )
    }

    private fun edge(
        id: Int,
        fromNodeId: Int,
        toNodeId: Int,
        distanceMeters: Double,
        sourceFeatureId: String,
        routeRoles: Set<TrailNetworkRole>,
        displayStyle: TrailRouteDisplayStyle = TrailRouteDisplayStyle.Unknown,
        name: String? = null,
        points: List<MapPoint>,
    ): TrailGraphEdge {
        return TrailGraphEdge(
            id = id,
            fromNodeId = fromNodeId,
            toNodeId = toNodeId,
            distanceMeters = distanceMeters,
            sourceFeatureId = sourceFeatureId,
            routeRoles = routeRoles,
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            routeSegments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = points,
                    routeRoles = routeRoles,
                    displayStyle = displayStyle,
                    name = name,
                ),
            ),
        )
    }

    private fun endpointAccess(
        edge: TrailGraphEdge,
        projectedPoint: MapPoint,
        distanceFromStartMeters: Double,
    ): TrailRouteEndpointAccess {
        return TrailRouteEndpointAccess(
            endpointPoint = projectedPoint,
            snap = TrailNetworkSnap(
                edge = edge,
                projectedPoint = projectedPoint,
                accessDistanceMeters = 0.0,
                distanceFromStartMeters = distanceFromStartMeters,
                distanceToEndMeters = edge.distanceMeters - distanceFromStartMeters,
            ),
            accessSegments = emptyList(),
            accessDistanceMeters = 0.0,
        )
    }
}
