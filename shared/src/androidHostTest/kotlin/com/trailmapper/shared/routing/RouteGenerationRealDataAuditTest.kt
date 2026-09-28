/**
 * Job: Exercise generation over representative positions in the packaged approved trail network.
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.*

class RouteGenerationRealDataAuditTest {
    private val roots = mutableMapOf<String, JsonObject>()

    @Test
    fun routesAcrossRepresentativeConnectedNetworkPoints() {
        val features = trailFeatures()
        val graph = TrailGraphBuilderSijko.buildGraph(
            TrailFeatureFilterSijko.enabledFeatures(features, RouteLayerDefaultsSijko.defaultSelection()),
        )
        val nodes = largestComponent(graph)
        val positions = listOf(
            "south" to nodes.minBy { it.point.latitude },
            "north" to nodes.maxBy { it.point.latitude },
            "west" to nodes.minBy { it.point.longitude },
            "east" to nodes.maxBy { it.point.longitude },
            "central" to nodes.minBy { TrailDistanceSijko.metersBetween(it.point, MapPoint(40.49, -88.9875)) },
            "southeast" to nodes.minBy { TrailDistanceSijko.metersBetween(it.point, MapPoint(40.467065, -88.934114)) },
        ).distinctBy { it.second.id }
        println("GEN_NETWORK nodes=${graph.nodes.size} edges=${graph.edges.size} largest_component=${nodes.size}")
        (positions.zipWithNext() + (positions.last() to positions.first())).forEach { (from, to) ->
            val started = System.nanoTime()
            val access = AccessGraphBuilderSijko.buildGraph(accessFeatures(listOf(from.second.point, to.second.point)))
            val route = TrailRouteCalculationSijko.findRoute(
                features, RouteLayerDefaultsSijko.defaultSelection(), from.second.point, to.second.point, access,
            )
            val millis = (System.nanoTime() - started) / 1_000_000
            println("GEN_POINT ${from.first}->${to.first} start=${from.second.point} end=${to.second.point} result=${route?.totalDistanceMeters} ms=$millis")
            assertNotNull(route, "Connected approved-network points ${from.first}->${to.first} should route")
            assertTrue(route.edges.none { it.status == TrailFeatureStatus.Proposed })
        }
    }

    @Test
    fun surveysExerciseTargetsAtThreeNetworkPositions() {
        val features = trailFeatures()
        val graph = TrailGraphBuilderSijko.buildGraph(
            TrailFeatureFilterSijko.enabledFeatures(features, RouteLayerDefaultsSijko.defaultSelection()),
        )
        val nodes = largestComponent(graph)
        val starts = listOf(
            "central" to MapPoint(40.49, -88.9875),
            "southeast" to MapPoint(40.467065, -88.934114),
            "north" to nodes.maxBy { it.point.latitude }.point,
        )
        starts.forEach { (label, start) ->
            val roads = accessFeatures(listOf(start))
            listOf(0.5, 1.0, 3.0, 5.0, 10.0, 20.0).forEach { miles ->
                val target = miles * 1609.344
                val started = System.nanoTime()
                val access = AccessGraphBuilderSijko.buildGraph(
                    ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(roads, start, target),
                )
                val result = ExerciseRouteCalculationSijko.findRoute(
                    features = features,
                    routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                    startPoint = start,
                    targetDistanceMeters = target,
                    completedSessions = emptyList(),
                    accessGraph = access,
                    nowEpochMillis = 1_700_000_000_000L,
                )
                val millis = (System.nanoTime() - started) / 1_000_000
                println("GEN_EXERCISE start=$label target_miles=$miles result_miles=${result?.route?.totalDistanceMeters?.div(1609.344)} status=${result?.status} ms=$millis")
                // This sweep records availability and target accuracy; a missing loop is not assumed feasible.
                result?.route?.let { assertTrue(it.edges.none { edge -> edge.status == TrailFeatureStatus.Proposed }) }
            }
        }
    }

    @Test
    fun uptownClosureStillMatchesTheShippedNetworkAndRoutesAvoidIt() {
        // Fails if a data refresh moves the closure's bounding vertices, so the cut would silently stop.
        val features = trailFeatures()
        val now = 1_790_528_400_000L
        val enabled = TrailFeatureFilterSijko.enabledFeatures(features, RouteLayerDefaultsSijko.defaultSelection())
        assertTrue(TrailRouteClosureSijko.openFeatures(enabled, now).appliedClosures.isNotEmpty())

        val south = MapPoint(40.5030, -88.9838)
        val north = MapPoint(40.5120, -88.9840)
        val access = AccessGraphBuilderSijko.buildGraph(accessFeatures(listOf(south, north)))
        fun route(applyClosures: Boolean) = assertNotNull(
            TrailRouteCalculationSijko.findRoute(
                features, RouteLayerDefaultsSijko.defaultSelection(), south, north, access,
                nowEpochMillis = now, applyClosures = applyClosures,
            ),
        )
        val uptownAdvisory = TrailRouteClosureSijko.uptownUnderpass.id
        assertTrue(TrailRouteAdvisorySijko.forRoute(route(applyClosures = true), now).none { it.id == uptownAdvisory })
        assertTrue(TrailRouteAdvisorySijko.forRoute(route(applyClosures = false), now).any { it.id == uptownAdvisory })
    }

    @Test
    fun aLoopRiderWhoStraysRejoinsTheRemainingLoopAhead() {
        val features = trailFeatures()
        val start = MapPoint(40.50930, -88.98450)
        val target = 5.0 * 1609.344
        val loop = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features, RouteLayerDefaultsSijko.defaultSelection(), start, target, emptyList(),
                AccessGraphBuilderSijko.buildGraph(
                    ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(accessFeatures(listOf(start)), start, target),
                ),
                nowEpochMillis = 1_700_000_000_000L,
            ),
        ).route
        // About 300 m off the loop after riding its first 900 m.
        val rider = MapPoint(40.5105, -88.9819)

        val outcome = TrailRouteLoopRerouteSijko.rejoin(
            features = features,
            route = loop,
            from = rider,
            progressMeters = 900.0,
            accessGraph = AccessGraphBuilderSijko.buildGraph(accessFeatures(listOf(rider, start))),
            nowEpochMillis = 1_700_000_000_000L,
        )

        val rejoin = assertIs<TrailRouteRerouteOutcome.Replacement>(outcome).route
        assertEquals(TrailRouteKind.ExerciseLoop, rejoin.kind)
        assertEquals(loop.segments.last().points.last(), rejoin.segments.last().points.last())
        // It keeps the loop from ahead of the rider: no fresh loop, no rewind, no skip to a later pass.
        assertTrue(rejoin.totalDistanceMeters in (loop.totalDistanceMeters - 900.0 - 1_000.0)..loop.totalDistanceMeters, "${rejoin.totalDistanceMeters}")
    }

    @Test
    fun loopsKeepTheirShapeWhenTheNetworkIsNudged() {
        // Moving vertices by up to 0.5 m without changing the graph's topology used to swing these
        // loops' self-overlap by 26-44 percentage points: a different near-equal anchor or via won.
        val base = trailFeatures()
        val cases = listOf(
            MapPoint(40.50203932870311, -88.9830169968467) to 5.0,
            MapPoint(40.49827656955975, -88.98341689822537) to 10.0,
            MapPoint(40.46440373260387, -88.93101051354766) to 10.0,
        )
        val frozen = snapSensitivePoints(base)
        fun topology(features: List<TrailNetworkFeature>) = TrailGraphBuilderSijko.buildGraph(features).edges
            .map { edge -> listOf(edge.fromNodeId, edge.toNodeId, edge.connectorOfEdgeId ?: -1) + edge.sourceFeatureId.hashCode() }
        val baseTopology = topology(base)
        val variants = listOf(base) + listOf(1, 2).map { seed ->
            nudged(base, frozen, seed).also { assertEquals(baseTopology, topology(it), "seed $seed must keep the topology") }
        }
        cases.forEach { (start, miles) ->
            val target = miles * 1609.344
            val access = AccessGraphBuilderSijko.buildGraph(
                ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(accessFeatures(listOf(start)), start, target),
            )
            val overlapRatios = variants.map { features ->
                val result = assertNotNull(
                    ExerciseRouteCalculationSijko.findRoute(
                        features, RouteLayerDefaultsSijko.defaultSelection(), start, target, emptyList(), access,
                        nowEpochMillis = 1_700_000_000_000L,
                    ),
                )
                assertEquals(ExerciseRouteStatus.Exact, result.status, "$start at $miles mi")
                result.selfOverlapMeters / result.route.totalDistanceMeters
            }
            println("GEN_STABILITY start=$start miles=$miles overlap=${overlapRatios.map { "%.3f".format(it) }}")
            assertTrue(overlapRatios.max() - overlapRatios.min() < 0.05, "$start at $miles mi: $overlapRatios")
            assertTrue(overlapRatios.max() < 0.15, "$start at $miles mi: $overlapRatios")
        }
    }

    @Test
    fun everyGraphEdgeMeasuresItsOwnGeometry() {
        val trailGraph = TrailGraphBuilderSijko.buildGraph(trailFeatures())
        val accessGraph = AccessGraphBuilderSijko.buildGraph(accessFeatures(listOf(MapPoint(40.49, -88.9875))))
        listOf("trail" to trailGraph, "access" to accessGraph).forEach { (label, graph) ->
            assertTrue(graph.edges.size > graph.nodes.size / 2, "$label graph should be the real network")
            val mismatches = graph.edges.filter { edge ->
                val geometryMeters = edge.routeSegments.sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
                abs(edge.distanceMeters - geometryMeters) > 0.5
            }
            assertTrue(mismatches.isEmpty(), "$label edges whose distance is not their geometry: ${mismatches.take(5).map { it.id }}")
        }
        assertTrue(trailGraph.edges.any { it.connectorOfEdgeId != null }, "the audit must cover snap connectors")
    }

    @Test
    fun endpointSnapsAndEdgesMeasureTheirOwnGeometry() {
        val features = trailFeatures()
        val graph = TrailGraphBuilderSijko.buildGraph(features)
        val nodesById = graph.nodes.associateBy { it.id }
        val junctions = largestComponent(graph).sortedBy { it.id }
        // Junction points snap at nodes; points 40 m north of them snap onto edges or come in by road.
        val onNodes = (0 until 4).map { junctions[it * junctions.size / 4].point }
        val points = onNodes + onNodes.map { MapPoint(it.latitude + 40.0 / 111_195.0, it.longitude) }

        var nodeSnaps = 0
        points.forEach { point ->
            NearestTrailSnapSijko.nearestSnaps(graph, point, limit = 400, maxAccessDistanceMeters = 800.0, includeNodeSnaps = true)
                .forEach { snap ->
                    if (snap.projectedPoint == nodesById[snap.edge.fromNodeId]?.point ||
                        snap.projectedPoint == nodesById[snap.edge.toNodeId]?.point
                    ) {
                        nodeSnaps++
                    }
                    listOf(
                        Triple(snap.edge.fromNodeId, snap.distanceFromStartMeters, false),
                        Triple(snap.edge.toNodeId, snap.distanceToEndMeters, true),
                    ).forEach { (nodeId, meters, towardEdgeEnd) ->
                        val geometry = snap.trailPointsToward(nodesById.getValue(nodeId).point, towardEdgeEnd)
                        assertEquals(TrailDistanceSijko.pathLengthMeters(geometry), meters, 0.5, "snap on edge ${snap.edge.id} toward node $nodeId")
                    }
                }
        }
        assertTrue(nodeSnaps > 0, "the audit must cover node snaps")

        points.forEachIndexed { index, start ->
            val target = 3.0 * 1609.344
            val loop = ExerciseRouteCalculationSijko.findRoute(
                features, RouteLayerDefaultsSijko.defaultSelection(), start, target, emptyList(),
                AccessGraphBuilderSijko.buildGraph(ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(accessFeatures(listOf(start)), start, target)),
                nowEpochMillis = 1_700_000_000_000L,
            )?.route
            val destination = points[(index + 3) % points.size]
            val pointToPoint = TrailRouteCalculationSijko.findRoute(
                features, RouteLayerDefaultsSijko.defaultSelection(), start, destination,
                AccessGraphBuilderSijko.buildGraph(accessFeatures(listOf(start, destination))),
                nowEpochMillis = 1_700_000_000_000L,
            )
            listOfNotNull(loop, pointToPoint).flatMap { it.edges }.forEach { edge ->
                val geometryMeters = edge.routeSegments.sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
                assertEquals(geometryMeters, edge.distanceMeters, 0.5, "edge ${edge.id} ${edge.fromNodeId}->${edge.toNodeId} from $start")
            }
        }
    }

    @Test
    fun navigationProgressMapsOntoTheSameSpotOfTheTraversal() {
        // The southeast loop's drawn route bridges gaps: navigation measures more than its traversal.
        val features = trailFeatures()
        val start = MapPoint(40.467065, -88.934114)
        val target = 5.0 * 1609.344
        val loop = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features, RouteLayerDefaultsSijko.defaultSelection(), start, target, emptyList(),
                AccessGraphBuilderSijko.buildGraph(
                    ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(accessFeatures(listOf(start)), start, target),
                ),
                nowEpochMillis = 1_700_000_000_000L,
            ),
        ).route
        val pieces = TrailRouteTraversalShapeSijko.shapeFor(loop).pieces
        val navigationMeters = pieces.last().distancesAlongRouteMeters.last()
        val traversalMeters = loop.traversalEdges.sumOf { it.distanceMeters }
        val segmentMeters = loop.segments.sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        val geometryMeters = loop.traversalEdges.sumOf { it.geometryMeters ?: it.distanceMeters }
        assertTrue(navigationMeters > traversalMeters + 50.0, "the bases must differ for this to test anything")
        // Every edge measures its own geometry, so only navigation's bridged gaps set it apart.
        assertEquals(segmentMeters, traversalMeters, 1.0)
        assertEquals(segmentMeters, geometryMeters, 1.0)
        assertEquals(traversalMeters, TrailRouteDistanceBasisSijko.traversalMetersAt(loop, navigationMeters), 1.0)

        (1..9).map { tenth -> navigationMeters * tenth / 10.0 }.forEach { progress ->
            val navigated = pieces.firstNotNullOf { piece ->
                val distances = piece.distancesAlongRouteMeters
                val index = distances.indexOfLast { it <= progress }
                if (index in 0 until distances.lastIndex && distances[index + 1] >= progress) {
                    val ratio = (progress - distances[index]) / (distances[index + 1] - distances[index])
                    val from = piece.segment.points[index]
                    val to = piece.segment.points[index + 1]
                    MapPoint(from.latitude + (to.latitude - from.latitude) * ratio, from.longitude + (to.longitude - from.longitude) * ratio)
                } else {
                    null
                }
            }
            val geometry = TrailRouteDistanceBasisSijko.geometryMetersAt(loop, progress)
            val traversal = TrailRouteDistanceBasisSijko.traversalMetersAtGeometry(loop.traversalEdges, geometry)
            val cut = TrailRouteDistanceBasisSijko.segmentsFrom(loop, geometry).first().points.first()
            assertTrue(TrailDistanceSijko.metersBetween(navigated, cut) < 1.0, "at $progress m: ${TrailDistanceSijko.metersBetween(navigated, cut)} m apart")
            // What is carried plus what remains is the whole traversal, with nothing credited twice.
            val carried = ExerciseRouteTraversalSijko.slice(loop.traversalEdges, 0.0, traversal)
            val remaining = ExerciseRouteTraversalSijko.slice(loop.traversalEdges, traversal)
            assertEquals(traversalMeters, (carried + remaining).sumOf { it.distanceMeters }, 1e-6)
        }
    }

    @Test
    fun rerouteAroundTheUptownClosureNeverUsesTheClosedSection() {
        val features = trailFeatures()
        val now = 1_790_528_400_000L
        val rider = MapPoint(40.5030, -88.9838)
        val destination = MapPoint(40.5120, -88.9840)
        val original = assertNotNull(
            TrailRouteCalculationSijko.findRoute(
                features, RouteLayerDefaultsSijko.defaultSelection(), rider, destination,
                AccessGraphBuilderSijko.buildGraph(accessFeatures(listOf(rider, destination))),
                nowEpochMillis = now,
            ),
        )

        // The saved route predates layer recording, and the rider has drifted off it near the closure.
        val outcome = TrailRouteRerouteSijko.pointToPoint(
            features = features,
            route = original.copy(routeLayers = null),
            from = rider,
            accessGraph = AccessGraphBuilderSijko.buildGraph(accessFeatures(listOf(rider, destination))),
            nowEpochMillis = now,
        )

        val replacement = assertIs<TrailRouteRerouteOutcome.Replacement>(outcome).route
        val uptownAdvisory = TrailRouteClosureSijko.uptownUnderpass.id
        assertTrue(TrailRouteAdvisorySijko.forRoute(replacement, now).none { it.id == uptownAdvisory })
    }

    private fun largestComponent(graph: TrailGraph): List<TrailGraphNode> {
        val adjacency = mutableMapOf<Int, MutableList<Int>>()
        graph.edges.forEach { edge ->
            adjacency.getOrPut(edge.fromNodeId) { mutableListOf() }.add(edge.toNodeId)
            adjacency.getOrPut(edge.toNodeId) { mutableListOf() }.add(edge.fromNodeId)
        }
        val visited = mutableSetOf<Int>()
        var largest = emptySet<Int>()
        graph.nodes.forEach { node ->
            if (visited.add(node.id)) {
                val component = mutableSetOf(node.id)
                val queue = ArrayDeque<Int>()
                queue.add(node.id)
                while (queue.isNotEmpty()) {
                    adjacency[queue.removeFirst()].orEmpty().forEach { neighbor ->
                        if (visited.add(neighbor)) { component.add(neighbor); queue.add(neighbor) }
                    }
                }
                if (component.size > largest.size) largest = component
            }
        }
        return graph.nodes.filter { it.id in largest }
    }

    /** Moves each vertex not in [frozen] by up to 0.5 m east and north; one point always moves the same way. */
    private fun nudged(features: List<TrailNetworkFeature>, frozen: Set<MapPoint>, seed: Int): List<TrailNetworkFeature> {
        val metersPerDegree = 6_371_008.8 * PI / 180.0
        fun move(point: MapPoint): MapPoint {
            if (point in frozen) {
                return point
            }
            val random = Random(point.latitude.toBits().hashCode() * 31 + point.longitude.toBits().hashCode() * 17 + seed)
            val eastMeters = random.nextDouble(-0.5, 0.5)
            val northMeters = random.nextDouble(-0.5, 0.5)
            return MapPoint(
                latitude = point.latitude + northMeters / metersPerDegree,
                longitude = point.longitude + eastMeters / (metersPerDegree * cos(point.latitude * PI / 180.0)),
            )
        }
        return features.map { feature -> feature.copy(paths = feature.paths.map { path -> path.map(::move) }) }
    }

    /**
     * Vertices a 0.5 m nudge could move across a graph-building decision: those near the snap tolerance
     * from another vertex or a segment, or so close to another vertex that their order could change.
     */
    private fun snapSensitivePoints(features: List<TrailNetworkFeature>): Set<MapPoint> {
        val paths = features.flatMap { it.paths }
        val cellDegrees = 20.0 / 111_000.0
        fun cell(point: MapPoint) = Pair(floor(point.latitude / cellDegrees).toInt(), floor(point.longitude / cellDegrees).toInt())
        val pointsByCell = paths.flatten().distinct().groupBy(::cell)
        val segmentsByCell = mutableMapOf<Pair<Int, Int>, MutableList<Pair<MapPoint, MapPoint>>>()
        paths.forEach { path ->
            path.zipWithNext().forEach { segment ->
                setOf(cell(segment.first), cell(segment.second)).forEach { segmentsByCell.getOrPut(it) { mutableListOf() } += segment }
            }
        }
        val nearSnapTolerance = 13.4..16.6
        val frozen = mutableSetOf<MapPoint>()
        pointsByCell.values.flatten().forEach { point ->
            val (row, column) = cell(point)
            for (rowOffset in -1..1) {
                for (columnOffset in -1..1) {
                    val neighbor = Pair(row + rowOffset, column + columnOffset)
                    pointsByCell[neighbor].orEmpty().forEach { other ->
                        val meters = TrailDistanceSijko.metersBetween(point, other)
                        if (other != point && (meters < 1.5 || meters in nearSnapTolerance)) {
                            frozen += point
                            frozen += other
                        }
                    }
                    segmentsByCell[neighbor].orEmpty().forEach { (from, to) ->
                        if (point != from && point != to &&
                            TrailDistanceSijko.projectToPolyline(point, listOf(from, to)).distanceMeters in nearSnapTolerance
                        ) {
                            frozen += listOf(point, from, to)
                        }
                    }
                }
            }
        }
        return frozen
    }

    private fun trailFeatures(): List<TrailNetworkFeature> {
        val layers = normalizedRoot(TRAIL_ASSET_NAME).getValue("layers").jsonArray
        return layers.flatMap { layerElement ->
            layerElement.jsonObject.getValue("features").jsonArray.map { featureElement ->
                val feature = featureElement.jsonObject
                TrailNetworkFeature(
                    id = feature.getValue("id").jsonPrimitive.content,
                    name = feature.optionalString("name"),
                    status = if (feature.optionalString("status") == "Proposed") {
                        TrailFeatureStatus.Proposed
                    } else {
                        TrailFeatureStatus.Existing
                    },
                    routeRoles = feature.routeRoles(),
                    facilityType = feature.facilityType(),
                    comfortLevel = feature.comfortLevel(),
                    paths = feature.paths(),
                )
            }
        }
    }

    private fun accessFeatures(points: List<MapPoint>): List<AccessNetworkFeature> {
        val layers = normalizedRoot(ACCESS_ASSET_NAME).getValue("layers").jsonArray
        return layers.flatMap { layerElement ->
            val layer = layerElement.jsonObject
            val endpointLocal = layer.getValue("id").jsonPrimitive.content == ENDPOINT_LOCAL_LAYER_ID
            layer.getValue("features").jsonArray.mapNotNull { featureElement ->
                val feature = featureElement.jsonObject
                val accessFeature = AccessNetworkFeature(
                    id = feature.getValue("id").jsonPrimitive.content,
                    name = feature.optionalString("name"),
                    roadClass = feature.optionalString("mtfcc"),
                    paths = feature.paths(),
                )
                accessFeature.takeIf {
                    !endpointLocal || AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                        feature = it,
                        points = points,
                        maxDistanceMeters = ENDPOINT_LOCAL_RADIUS_METERS,
                    )
                }
            }
        }
    }

    private fun normalizedRoot(name: String): JsonObject {
        return roots.getOrPut(name) { Json.parseToJsonElement(assetFile(name).readText()).jsonObject }
    }

    private fun assetFile(name: String): File {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).absoluteFile
        repeat(5) {
            val candidate = directory.resolve("data/generated/$name")
            if (candidate.isFile) {
                return candidate
            }
            directory = directory.parentFile ?: return@repeat
        }
        error("Unable to locate data/generated/$name from ${System.getProperty("user.dir")}")
    }

    private fun JsonObject.paths(): List<List<MapPoint>> {
        return getValue("paths").jsonArray.map { pathElement ->
            pathElement.jsonArray.map { coordinateElement ->
                val coordinate = coordinateElement.jsonArray
                MapPoint(
                    latitude = coordinate[1].jsonPrimitive.double,
                    longitude = coordinate[0].jsonPrimitive.double,
                )
            }
        }
    }

    private fun JsonObject.routeRoles(): Set<TrailNetworkRole> {
        val roleElement = getValue("routeRoles")
        val roleNames = if (roleElement is JsonArray) {
            roleElement.map { it.jsonPrimitive.content }
        } else {
            listOf(roleElement.jsonPrimitive.content)
        }
        return roleNames.mapNotNullTo(mutableSetOf()) { roleName ->
            when (roleName) {
                "TrailBranches" -> TrailNetworkRole.TrailBranches
                "ParkConnectors" -> TrailNetworkRole.ParkConnectors
                "SharedRoadways" -> TrailNetworkRole.SharedRoadways
                "ProposedTrails" -> TrailNetworkRole.ProposedTrails
                else -> null
            }
        }
    }

    private fun JsonObject.facilityType(): TrailFacilityType {
        return when (optionalString("facilityType")) {
            "Bike Lane" -> TrailFacilityType.BikeLane
            "Off-Road Trail" -> TrailFacilityType.OffRoadTrail
            "Separated Trail" -> TrailFacilityType.SeparatedTrail
            "Shared Lane" -> TrailFacilityType.SharedLane
            "Urban Trail" -> TrailFacilityType.UrbanTrail
            "Other" -> TrailFacilityType.Other
            else -> TrailFacilityType.Unknown
        }
    }

    private fun JsonObject.comfortLevel(): TrailComfortLevel {
        return when (optionalString("comfort")) {
            "All Ages and Abilities" -> TrailComfortLevel.AllAgesAndAbilities
            "Most Adults" -> TrailComfortLevel.MostAdults
            "Experienced Bicyclists" -> TrailComfortLevel.ExperiencedBicyclists
            "Strong and Fearless" -> TrailComfortLevel.StrongAndFearless
            else -> TrailComfortLevel.Unknown
        }
    }

    private fun JsonObject.optionalString(name: String): String? {
        return get(name)?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)
    }

    private companion object {
        const val TRAIL_ASSET_NAME = "mcgis-trails.normalized.json"
        const val ACCESS_ASSET_NAME = "mclean-access-roads.normalized.json"
        const val ENDPOINT_LOCAL_LAYER_ID = "osm-service"
        const val ENDPOINT_LOCAL_RADIUS_METERS = 600.0
    }
}
