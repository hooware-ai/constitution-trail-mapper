/**
 * Job: Build a route graph from filtered trail-network polyline features.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

object TrailGraphBuilderSijko {
    const val DEFAULT_SNAP_TOLERANCE_METERS = 15.0

    fun buildGraph(
        features: List<TrailNetworkFeature>,
        snapToleranceMeters: Double = DEFAULT_SNAP_TOLERANCE_METERS,
        cancellationCheckpoint: () -> Unit = {},
    ): TrailGraph {
        val nodes = mutableListOf<TrailGraphNode>()
        val edges = mutableListOf<TrailGraphEdge>()
        val nodesByGridKey = mutableMapOf<TrailGraphGridKey, MutableList<TrailGraphNode>>()
        val latitudeStepDegrees = snapToleranceMeters / APPROXIMATE_METERS_PER_DEGREE_LATITUDE
        val longitudeStepDegrees = snapToleranceMeters /
            (APPROXIMATE_METERS_PER_DEGREE_LATITUDE * cos(REFERENCE_LATITUDE_RADIANS))

        fun gridKey(point: MapPoint): TrailGraphGridKey {
            return TrailGraphGridKey(
                latitudeBucket = floor(point.latitude / latitudeStepDegrees).toInt(),
                longitudeBucket = floor(point.longitude / longitudeStepDegrees).toInt(),
            )
        }

        fun nearbyGridKeys(point: MapPoint): List<TrailGraphGridKey> {
            val key = gridKey(point)
            return buildList {
                for (latitudeOffset in -1..1) {
                    for (longitudeOffset in -1..1) {
                        add(
                            TrailGraphGridKey(
                                latitudeBucket = key.latitudeBucket + latitudeOffset,
                                longitudeBucket = key.longitudeBucket + longitudeOffset,
                            ),
                        )
                    }
                }
            }
        }

        fun findOrCreateNode(point: MapPoint): Int {
            nearbyGridKeys(point).forEach { key ->
                nodesByGridKey[key].orEmpty().firstOrNull { node ->
                    TrailDistanceSijko.metersBetween(node.point, point) <= snapToleranceMeters
                }?.let { return it.id }
            }

            val id = nodes.size
            val node = TrailGraphNode(id = id, point = point)
            nodes += node
            nodesByGridKey.getOrPut(gridKey(point)) { mutableListOf() } += node
            return id
        }

        features.forEach { feature ->
            cancellationCheckpoint()
            val displayStyle = TrailRouteDisplayStyleSijko.styleFor(feature)
            feature.paths.forEach { path ->
                TrailGraphPolylineRunSijko.runs(
                    path = path,
                    nodeIdFor = ::findOrCreateNode,
                    cancellationCheckpoint = cancellationCheckpoint,
                ).forEach { run ->
                    edges += TrailGraphEdge(
                        id = edges.size,
                        fromNodeId = run.fromNodeId,
                        toNodeId = run.toNodeId,
                        distanceMeters = run.distanceMeters,
                        sourceFeatureId = feature.id,
                        routeRoles = feature.routeRoles,
                        facilityType = feature.facilityType,
                        comfortLevel = feature.comfortLevel,
                        status = feature.status,
                        routeSegments = listOf(
                            TrailRouteSegment(
                                type = TrailRouteSegmentType.Trail,
                                points = run.points,
                                routeRoles = feature.routeRoles,
                                displayStyle = displayStyle,
                                name = TrailRouteNameSijko.normalized(feature.name),
                            ),
                        ),
                    )
                }
            }
        }

        addNearbyIntersectionEdges(
            nodes = nodes,
            edges = edges,
            snapToleranceMeters = snapToleranceMeters,
            latitudeStepDegrees = latitudeStepDegrees,
            longitudeStepDegrees = longitudeStepDegrees,
            cancellationCheckpoint = cancellationCheckpoint,
        )

        return TrailGraph(
            nodes = nodes,
            edges = edges,
        )
    }

    private fun addNearbyIntersectionEdges(
        nodes: List<TrailGraphNode>,
        edges: MutableList<TrailGraphEdge>,
        snapToleranceMeters: Double,
        latitudeStepDegrees: Double,
        longitudeStepDegrees: Double,
        cancellationCheckpoint: () -> Unit,
    ) {
        val sourceEdges = edges.toList()
        val nodesById = nodes.associateBy { node -> node.id }
        val edgesByGridKey = mutableMapOf<TrailGraphGridKey, MutableList<TrailGraphEdge>>()
        sourceEdges.forEach { edge ->
            val points = edge.routeSegmentPoints()
            if (points.size < MINIMUM_CONNECTOR_POINT_COUNT) {
                return@forEach
            }
            points.forEachSegment { first, second ->
                val minimumLatitude = min(first.latitude, second.latitude) - latitudeStepDegrees
                val maximumLatitude = max(first.latitude, second.latitude) + latitudeStepDegrees
                val minimumLongitude = min(first.longitude, second.longitude) - longitudeStepDegrees
                val maximumLongitude = max(first.longitude, second.longitude) + longitudeStepDegrees
                for (latitudeBucket in floor(minimumLatitude / latitudeStepDegrees).toInt()..
                    ceil(maximumLatitude / latitudeStepDegrees).toInt()
                ) {
                    for (longitudeBucket in floor(minimumLongitude / longitudeStepDegrees).toInt()..
                        ceil(maximumLongitude / longitudeStepDegrees).toInt()
                    ) {
                        edgesByGridKey
                            .getOrPut(
                                TrailGraphGridKey(
                                    latitudeBucket = latitudeBucket,
                                    longitudeBucket = longitudeBucket,
                                ),
                            ) { mutableListOf() }
                            .add(edge)
                    }
                }
            }
        }

        val connectorKeys = mutableSetOf<String>()
        nodes.forEachIndexed { index, node ->
            if (index % INTERSECTION_CHECKPOINT_NODE_INTERVAL == 0) {
                cancellationCheckpoint()
            }

            val gridKey = TrailGraphGridKey(
                latitudeBucket = floor(node.point.latitude / latitudeStepDegrees).toInt(),
                longitudeBucket = floor(node.point.longitude / longitudeStepDegrees).toInt(),
            )
            edgesByGridKey[gridKey].orEmpty().forEach { edge ->
                if (edge.fromNodeId == node.id || edge.toNodeId == node.id) {
                    return@forEach
                }

                val edgePoints = edge.routeSegmentPoints()
                val projection = TrailDistanceSijko.projectToPolyline(
                    point = node.point,
                    points = edgePoints,
                )
                if (projection.distanceMeters > snapToleranceMeters) {
                    return@forEach
                }

                val connectorKey = "${node.id}:${edge.id}"
                if (!connectorKeys.add(connectorKey)) {
                    return@forEach
                }

                val fromNode = nodesById[edge.fromNodeId] ?: return@forEach
                val toNode = nodesById[edge.toNodeId] ?: return@forEach
                // A connector ends at the node's point, which may lie up to the snap tolerance from the edge's
                // own end vertex. Its distance is its geometry, hop included, so the graph measures what is ridden.
                val towardFromNode = connectorPoints(node.point, projection, edgePoints, fromNode.point, towardEdgeEnd = false)
                val towardToNode = connectorPoints(node.point, projection, edgePoints, toNode.point, towardEdgeEnd = true)
                edges += edge.copy(
                    id = edges.size,
                    connectorOfEdgeId = edge.id,
                    fromNodeId = node.id,
                    toNodeId = edge.fromNodeId,
                    distanceMeters = TrailDistanceSijko.pathLengthMeters(towardFromNode),
                    routeSegments = listOf(
                        TrailRouteSegment(
                            type = TrailRouteSegmentType.Trail,
                            points = towardFromNode,
                            routeRoles = edge.routeRoles,
                            displayStyle = edge.displayStyle(),
                            name = edge.routeSegmentName(),
                        ),
                    ),
                )
                edges += edge.copy(
                    id = edges.size,
                    connectorOfEdgeId = edge.id,
                    fromNodeId = node.id,
                    toNodeId = edge.toNodeId,
                    distanceMeters = TrailDistanceSijko.pathLengthMeters(towardToNode),
                    routeSegments = listOf(
                        TrailRouteSegment(
                            type = TrailRouteSegmentType.Trail,
                            points = towardToNode,
                            routeRoles = edge.routeRoles,
                            displayStyle = edge.displayStyle(),
                            name = edge.routeSegmentName(),
                        ),
                    ),
                )
            }
        }
    }

    /** Connector geometry from [nodePoint] onto the edge, then along its polyline to one end node. */
    private fun connectorPoints(
        nodePoint: MapPoint,
        projection: TrailSegmentProjection,
        edgePoints: List<MapPoint>,
        endNodePoint: MapPoint,
        towardEdgeEnd: Boolean,
    ): List<MapPoint> {
        val edgeMeters = projection.distanceFromStartMeters + projection.distanceToEndMeters
        val projectionFraction = if (edgeMeters > 0.0) projection.distanceFromStartMeters / edgeMeters else 0.0
        return listOf(nodePoint, projection.projectedPoint) +
            TrailDistanceSijko.verticesBetween(
                points = edgePoints,
                fromFraction = projectionFraction,
                toFraction = if (towardEdgeEnd) 1.0 else 0.0,
            ) +
            endNodePoint
    }

    private fun TrailGraphEdge.routeSegmentPoints(): List<MapPoint> {
        return routeSegments.firstOrNull()?.points.orEmpty()
    }

    private fun TrailGraphEdge.displayStyle(): TrailRouteDisplayStyle {
        return routeSegments.firstOrNull()?.displayStyle ?: TrailRouteDisplayStyle.Unknown
    }

    private fun TrailGraphEdge.routeSegmentName(): String? {
        return TrailRouteNameSijko.normalized(routeSegments.firstOrNull()?.name)
    }

    private fun List<MapPoint>.forEachSegment(block: (MapPoint, MapPoint) -> Unit) {
        windowed(size = 2, step = 1).forEach { (first, second) ->
            block(first, second)
        }
    }

    private const val APPROXIMATE_METERS_PER_DEGREE_LATITUDE = 111_320.0
    private const val REFERENCE_LATITUDE_RADIANS = 0.7068583470577035
    private const val INTERSECTION_CHECKPOINT_NODE_INTERVAL = 512
    private const val MINIMUM_CONNECTOR_POINT_COUNT = 2
}
