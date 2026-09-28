/**
 * Job: Verify ordinary access-network polylines become routed access graph edges.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AccessGraphBuilderSijkoTest {
    @Test
    fun createsRoutedAccessEdgesFromPolylineSegments() {
        val graph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "road",
                    roadClass = "S1400",
                    paths = listOf(
                        listOf(
                            MapPoint(latitude = 40.0, longitude = -89.0),
                            MapPoint(latitude = 40.0, longitude = -88.999),
                            MapPoint(latitude = 40.001, longitude = -88.999),
                        ),
                    ),
                ),
            ),
        )

        assertEquals(3, graph.nodes.size)
        assertEquals(2, graph.edges.size)
        assertTrue(graph.edges.all { it.accessRoadClass == "S1400" })
        assertTrue(graph.edges.all { it.ordinaryAccessDistanceMeters == it.distanceMeters })
        assertTrue(graph.edges.all { edge ->
            edge.routeSegments.all { it.type == TrailRouteSegmentType.Access && it.isRouted }
        })
    }

    @Test
    fun denselySampledRoadKeepsItsFullLengthWithoutSelfLoops() {
        val metersPerDegreeLongitude = 111_320.0 * cos(40.0 * PI / 180.0)
        val path = (0..100).map { index ->
            MapPoint(latitude = 40.0, longitude = -89.0 + index * 3.0 / metersPerDegreeLongitude)
        }
        val polylineMeters = path.zipWithNext().sumOf { (first, second) ->
            TrailDistanceSijko.metersBetween(first, second)
        }

        val graph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(AccessNetworkFeature(id = "dense-road", paths = listOf(path))),
        )

        assertTrue(graph.edges.none { edge -> edge.fromNodeId == edge.toNodeId })
        assertTrue(graph.edges.all { edge -> edge.ordinaryAccessDistanceMeters == edge.distanceMeters })
        val route = assertNotNull(
            TrailRouteAccessPathFinderSijko.findRoute(
                accessGraph = graph,
                start = path.first(),
                destination = path.last(),
            ),
        )
        assertEquals(polylineMeters, route.totalDistanceMeters, 8.0)
    }

    @Test
    fun connectsNearbyEndpointToTheRealLegOfAFoldedRoad() {
        // With the 8 m access tolerance, A-B-C folds into one bent edge. D is 7 m from leg A-B
        // but ~9.9 m from the A-C chord.
        val a = offset(0.0, 0.0)
        val b = offset(7.0, 0.0)
        val c = offset(7.0, 7.0)
        val d = offset(14.0, 0.0)
        val graph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(id = "bent-road", paths = listOf(listOf(a, b, c))),
                AccessNetworkFeature(id = "approach-road", paths = listOf(listOf(d, offset(60.0, 0.0)))),
            ),
        )

        val approachNode = graph.nodes.single { node -> node.point == d }
        val connectors = graph.edges.filter { edge ->
            edge.fromNodeId == approachNode.id && edge.sourceFeatureId == "bent-road"
        }
        assertEquals(2, connectors.size)
        connectors.forEach { connector ->
            assertEquals(14.0, connector.distanceMeters, 0.05)
            assertEquals(connector.distanceMeters, connector.ordinaryAccessDistanceMeters)
            assertEquals(
                connector.distanceMeters,
                TrailDistanceSijko.pathLengthMeters(connector.routeSegments.single().points),
                0.05,
            )
        }
        assertEquals(setOf(a, c), connectors.map { edge -> graph.nodes[edge.toNodeId].point }.toSet())
    }

    @Test
    fun connectorDistanceCountsTheHopToAnOffsetEndNode() {
        // The road's first vertex snaps onto the node already 6 m west of it, so the connector from D
        // ends 6 m past the edge's own end vertex: 5 m across, then 36 m to that node.
        val node = offset(-6.0, 0.0)
        val d = offset(30.0, 5.0)
        val graph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(id = "first-road", paths = listOf(listOf(offset(-6.0, -60.0), node))),
                AccessNetworkFeature(id = "road", paths = listOf(listOf(offset(0.0, 0.0), offset(60.0, 0.0)))),
                AccessNetworkFeature(id = "approach-road", paths = listOf(listOf(d, offset(30.0, 60.0)))),
            ),
        )

        val approachNode = graph.nodes.single { it.point == d }
        val connector = graph.edges.single { edge ->
            edge.fromNodeId == approachNode.id && graph.nodes[edge.toNodeId].point == node
        }
        assertEquals(41.0, connector.distanceMeters, 0.1)
        assertEquals(connector.distanceMeters, connector.ordinaryAccessDistanceMeters)
        graph.edges.forEach { edge ->
            assertEquals(
                edge.routeSegments.sumOf { TrailDistanceSijko.pathLengthMeters(it.points) },
                edge.distanceMeters,
                1e-6,
            )
        }
    }

    @Test
    fun connectsAccessRoadVertexToNearbyCrossingSegment() {
        val south = MapPoint(latitude = 39.9995, longitude = -89.0)
        val intersection = MapPoint(latitude = 40.0, longitude = -89.0)
        val north = MapPoint(latitude = 40.0005, longitude = -89.0)
        val west = MapPoint(latitude = 40.0, longitude = -89.0005)
        val east = MapPoint(latitude = 40.0, longitude = -88.9995)
        val graph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "vertical-road",
                    name = "North Street",
                    roadClass = "S1400",
                    paths = listOf(listOf(south, intersection, north)),
                ),
                AccessNetworkFeature(
                    id = "crossing-road-without-intersection-vertex",
                    name = "East Street",
                    roadClass = "S1400",
                    paths = listOf(listOf(west, east)),
                ),
            ),
        )

        val route = assertNotNull(
            TrailRouteAccessPathFinderSijko.findRoute(
                accessGraph = graph,
                start = south,
                destination = east,
            ),
        )

        assertTrue(
            route.segments.any { segment -> intersection in segment.points },
            "Expected access route to use the repaired intersection but route was ${route.segments}",
        )
        assertTrue(
            route.segments.any { segment -> east in segment.points },
            "Expected access route to reach the crossing road but route was ${route.segments}",
        )
        assertTrue(
            graph.edges
                .filter { edge -> edge.sourceFeatureId == "crossing-road-without-intersection-vertex" }
                .flatMap { edge -> edge.routeSegments }
                .all { segment -> segment.name == "East Street" },
        )
    }

    @Test
    fun preservesNearbyJunctionOnLongDiagonalAcrossSparseCells() {
        val west = MapPoint(40.45, -89.05)
        val east = MapPoint(40.55, -88.95)
        val junction = MapPoint(40.50001, -89.0)
        val branchEnd = MapPoint(40.502, -89.0)
        val graph = AccessGraphBuilderSijko.buildGraph(
            listOf(
                AccessNetworkFeature(
                    id = "long-diagonal",
                    paths = listOf(listOf(west, east)),
                ),
                AccessNetworkFeature(
                    id = "branch",
                    paths = listOf(listOf(branchEnd, junction)),
                ),
            ),
        )

        assertEquals(4, graph.nodes.size)
        assertEquals(4, graph.edges.size)
        val junctionNode = graph.nodes.single { it.point == junction }
        val repairedConnections = graph.edges.filter {
            it.sourceFeatureId == "long-diagonal" && it.fromNodeId == junctionNode.id
        }
        assertEquals(2, repairedConnections.size)
        assertEquals(
            setOf(west, east),
            repairedConnections.map { edge -> graph.nodes[edge.toNodeId].point }.toSet(),
        )
    }

    @Test
    fun normalizesBlankAccessRoadNamesToNull() {
        val graph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "unnamed-road",
                    name = "\t ",
                    paths = listOf(
                        listOf(
                            MapPoint(latitude = 40.0, longitude = -89.0),
                            MapPoint(latitude = 40.0, longitude = -88.999),
                        ),
                    ),
                ),
            ),
        )

        assertTrue(graph.edges.flatMap { edge -> edge.routeSegments }.all { segment -> segment.name == null })
    }

    /** A point [eastMeters] east and [northMeters] north of (40, -89). */
    private fun offset(eastMeters: Double, northMeters: Double): MapPoint {
        val metersPerDegree = 6_371_008.8 * PI / 180.0
        return MapPoint(
            latitude = 40.0 + northMeters / metersPerDegree,
            longitude = -89.0 + eastMeters / (metersPerDegree * cos(40.0 * PI / 180.0)),
        )
    }
}
