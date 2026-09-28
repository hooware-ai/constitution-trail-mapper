/**
 * Job: Verify normalized trail polylines become a snapped route graph.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.PI
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailGraphBuilderSijkoTest {
    @Test
    fun createsEdgesFromPolylineSegments() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "trail",
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                        MapPoint(latitude = 40.001, longitude = -88.999),
                    ),
                ),
            ),
        )

        assertEquals(3, graph.nodes.size)
        assertEquals(2, graph.edges.size)
        assertTrue(graph.edges.all { it.distanceMeters > 0.0 })
    }

    @Test
    fun snapsNearbyVerticesIntoOneGraphNode() {
        val shared = MapPoint(latitude = 40.0, longitude = -88.999)
        val almostShared = MapPoint(latitude = 40.000005, longitude = -88.999)

        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "first",
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        shared,
                    ),
                ),
                feature(
                    id = "second",
                    path = listOf(
                        almostShared,
                        MapPoint(latitude = 40.0, longitude = -88.998),
                    ),
                ),
            ),
            snapToleranceMeters = 2.0,
        )

        assertEquals(3, graph.nodes.size)
        assertEquals(graph.edges[0].toNodeId, graph.edges[1].fromNodeId)
    }

    @Test
    fun denselySampledTrailRoutesAtItsPolylineLength() {
        val path = denselySampledPath()
        val polylineMeters = path.polylineMeters()
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(feature(id = "dense", path = path)),
        )

        assertTrue(graph.edges.none { edge -> edge.fromNodeId == edge.toNodeId })
        graph.edges.zipWithNext().forEach { (previous, next) ->
            assertEquals(previous.toNodeId, next.fromNodeId)
            assertEquals(previous.routeSegments.single().points.last(), next.routeSegments.single().points.first())
        }
        graph.edges.forEach { edge ->
            assertEquals(edge.routeSegments.single().points.polylineMeters(), edge.distanceMeters, 0.001)
        }

        val route = assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = graph,
                start = path.first(),
                destination = path.last(),
            ),
        )
        assertEquals(polylineMeters, route.totalDistanceMeters, DEFAULT_SNAP_TOLERANCE_METERS)
        assertEquals(
            polylineMeters,
            route.segments.sumOf { segment -> segment.points.polylineMeters() },
            DEFAULT_SNAP_TOLERANCE_METERS,
        )
    }

    @Test
    fun duplicateOnlyPathCreatesNoGraph() {
        val point = MapPoint(latitude = 40.0, longitude = -89.0)

        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(feature(id = "stub", path = listOf(point, point, point))),
        )

        assertTrue(graph.nodes.isEmpty())
        assertTrue(graph.edges.isEmpty())
    }

    @Test
    fun connectsNearbyEndpointToTheRealLegOfAFoldedEdge() {
        // A-B-C folds into one bent edge. D is 14 m from leg A-B but ~19.8 m from the A-C chord.
        val a = offset(0.0, 0.0)
        val b = offset(14.0, 0.0)
        val c = offset(14.0, 14.0)
        val d = offset(28.0, 0.0)
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(id = "bent", path = listOf(a, b, c)),
                feature(id = "approach", path = listOf(d, offset(80.0, 0.0))),
            ),
        )

        val approachNode = graph.nodes.single { node -> node.point == d }
        val connectors = graph.edges.filter { edge ->
            edge.fromNodeId == approachNode.id && edge.sourceFeatureId == "bent"
        }
        assertEquals(2, connectors.size)
        connectors.forEach { connector ->
            // 14 m across to the bend, then 14 m along the leg to A or C.
            assertEquals(28.0, connector.distanceMeters, 0.05)
            assertEquals(
                connector.distanceMeters,
                connector.routeSegments.single().points.polylineMeters(),
                0.05,
            )
        }
        assertEquals(setOf(a, c), connectors.map { edge -> graph.nodes[edge.toNodeId].point }.toSet())
    }

    @Test
    fun connectorDistanceCountsTheHopToAnOffsetEndNode() {
        // The trail's first vertex snaps onto the node already 10 m west of it, so the connector from D
        // ends 10 m past the edge's own end vertex: 5 m across, then 60 m to that node.
        val node = offset(-10.0, 0.0)
        val d = offset(50.0, 5.0)
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(id = "first", path = listOf(offset(-10.0, -80.0), node)),
                feature(id = "trail", path = listOf(offset(0.0, 0.0), offset(100.0, 0.0))),
                feature(id = "approach", path = listOf(d, offset(50.0, 80.0))),
            ),
        )

        val approachNode = graph.nodes.single { it.point == d }
        val connector = graph.edges.single { edge ->
            edge.fromNodeId == approachNode.id && graph.nodes[edge.toNodeId].point == node
        }
        assertEquals(65.0, connector.distanceMeters, 0.1)
        graph.edges.forEach { edge ->
            assertEquals(edge.routeSegments.sumOf { it.points.polylineMeters() }, edge.distanceMeters, 1e-6)
        }
    }

    @Test
    fun connectsNearbyVertexToEdgeInterior() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "east-west",
                    name = "East West Trail",
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.001),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                    ),
                ),
                feature(
                    id = "approach",
                    path = listOf(
                        MapPoint(latitude = 39.999, longitude = -89.0),
                        MapPoint(latitude = 39.99999, longitude = -89.0),
                    ),
                ),
            ),
            snapToleranceMeters = 2.0,
        )

        val approachNode = graph.nodes.first { node ->
            node.point == MapPoint(latitude = 39.99999, longitude = -89.0)
        }

        assertTrue(
            graph.edges.any { edge ->
                edge.fromNodeId == approachNode.id && edge.sourceFeatureId == "east-west"
            },
        )
        assertTrue(
            graph.edges
                .filter { edge -> edge.sourceFeatureId == "east-west" }
                .flatMap { edge -> edge.routeSegments }
                .all { segment -> segment.name == "East West Trail" },
        )
    }

    @Test
    fun preservesFeatureRolesOnRouteSegments() {
        val routeRoles = setOf(TrailNetworkRole.ParkConnectors)

        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "connector",
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                    ),
                    routeRoles = routeRoles,
                ),
            ),
        )

        assertTrue(graph.edges.isNotEmpty())
        assertTrue(
            graph.edges.all { edge ->
                edge.routeSegments.all { segment -> segment.routeRoles == routeRoles }
            },
        )
    }

    @Test
    fun preservesFeatureDisplayStyleOnRouteSegments() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "interurban",
                    name = "Interurban",
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                    ),
                ),
            ),
        )

        assertTrue(graph.edges.isNotEmpty())
        assertTrue(
            graph.edges.all { edge ->
                edge.routeSegments.all { segment ->
                    segment.displayStyle == TrailRouteDisplayStyle.Interurban
                }
            },
        )
    }

    @Test
    fun normalizesBlankFeatureNamesToNull() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                feature(
                    id = "unnamed",
                    name = "   ",
                    path = listOf(
                        MapPoint(latitude = 40.0, longitude = -89.0),
                        MapPoint(latitude = 40.0, longitude = -88.999),
                    ),
                ),
            ),
        )

        assertTrue(graph.edges.flatMap { edge -> edge.routeSegments }.all { segment -> segment.name == null })
    }

    @Test
    fun propagatesCancellationCheckpoint() {
        assertFailsWith<CancellationException> {
            TrailGraphBuilderSijko.buildGraph(
                features = listOf(
                    feature(
                        id = "trail",
                        path = listOf(
                            MapPoint(latitude = 40.0, longitude = -89.0),
                            MapPoint(latitude = 40.0, longitude = -88.999),
                        ),
                    ),
                ),
                cancellationCheckpoint = {
                    throw CancellationException("cancel graph build")
                },
            )
        }
    }

    /** A 1 km east-west trail sampled every 5 m, well inside the 15 m snap tolerance. */
    private fun denselySampledPath(): List<MapPoint> {
        val metersPerDegreeLongitude = 111_320.0 * cos(40.0 * PI / 180.0)
        return (0..200).map { index ->
            MapPoint(latitude = 40.0, longitude = -89.0 + index * 5.0 / metersPerDegreeLongitude)
        }
    }

    /** A point [eastMeters] east and [northMeters] north of (40, -89). */
    private fun offset(eastMeters: Double, northMeters: Double): MapPoint {
        val metersPerDegree = 6_371_008.8 * PI / 180.0
        return MapPoint(
            latitude = 40.0 + northMeters / metersPerDegree,
            longitude = -89.0 + eastMeters / (metersPerDegree * cos(40.0 * PI / 180.0)),
        )
    }

    private fun List<MapPoint>.polylineMeters(): Double {
        return zipWithNext().sumOf { (first, second) -> TrailDistanceSijko.metersBetween(first, second) }
    }

    private fun feature(
        id: String,
        path: List<MapPoint>,
        routeRoles: Set<TrailNetworkRole> = setOf(TrailNetworkRole.TrailBranches),
        name: String? = null,
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = id,
            name = name,
            status = TrailFeatureStatus.Existing,
            routeRoles = routeRoles,
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            paths = listOf(path),
        )
    }

    private companion object {
        const val DEFAULT_SNAP_TOLERANCE_METERS = 15.0
    }
}
