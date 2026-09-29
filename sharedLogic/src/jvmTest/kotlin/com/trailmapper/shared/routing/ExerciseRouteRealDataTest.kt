/**
 * Job: Guard five-mile exercise-loop quality and performance against the packaged Bloomington network.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class ExerciseRouteRealDataTest {
    @Test
    fun currentLocationProducesASafeNearFiveMileRoute() {
        // At true trail lengths every near-five-mile circuit from this start crosses the reviewed
        // Oakland/Veterans hazard (the shortest safe circuit is ~7.5 mi), so the safe route wins
        // and is honestly reported as Closest rather than an exact loop.
        val (result, nextDay) = assertSafeFiveMileRoutes(
            start = MapPoint(latitude = 40.467065, longitude = -88.934114),
            expectedStatus = ExerciseRouteStatus.Closest,
        )

        assertTrue(
            ExerciseRouteTurnaroundSijko.count(result.route.edges) <= 1,
            "The exercise route contains multiple out-and-back arms.",
        )
        assertTrue(nextDay.routeKey != result.routeKey)
    }

    @Test
    fun centralStartProducesAnExactFiveMileCircuitAndAFreshNextDayRoute() {
        val (result, nextDay) = assertSafeFiveMileRoutes(
            start = MapPoint(latitude = 40.490226181297764, longitude = -88.9865969809043),
            expectedStatus = ExerciseRouteStatus.Exact,
        )

        assertTrue(
            ExerciseRouteLoopQualitySijko.isCircuit(
                totalDistanceMeters = result.route.totalDistanceMeters,
                selfOverlapMeters = result.selfOverlapMeters,
            ),
            "Expected a circuit, got ${result.route.totalDistanceMeters.toMiles()} miles with " +
                "${result.selfOverlapMeters.toMiles()} overlap.",
        )
        assertTrue(
            ExerciseRouteTurnaroundSijko.count(result.route.edges) <= 1,
            "The exercise route contains multiple out-and-back arms.",
        )
        assertTrue(nextDay.routeKey != result.routeKey)
        assertTrue(
            nextDay.historyOverlapMeters < nextDay.route.totalDistanceMeters * 0.75,
            "The next-day route reused ${nextDay.historyOverlapMeters.toMiles()} of " +
                "${nextDay.route.totalDistanceMeters.toMiles()} miles.",
        )
    }

    /** Plans a first-day and next-day five-mile route and checks what every start must satisfy. */
    private fun assertSafeFiveMileRoutes(
        start: MapPoint,
        expectedStatus: ExerciseRouteStatus,
    ): Pair<ExerciseRouteResult, ExerciseRouteResult> {
        val trails = trailFeatures()
        val accessFeatures = accessFeatures(start)
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(
                features = accessFeatures,
                startPoint = start,
                targetDistanceMeters = FIVE_MILES_METERS,
            ),
        )
        val candidates = mutableListOf<Triple<Double, Double, Boolean>>()
        val startedAtNanos = System.nanoTime()

        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = trails,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = FIVE_MILES_METERS,
                completedSessions = emptyList(),
                accessGraph = accessGraph,
                nowEpochMillis = 1_700_000_000_000L,
                candidateObserver = { distanceMeters, overlapMeters, isCircuit ->
                    candidates += Triple(distanceMeters, overlapMeters, isCircuit)
                },
            ),
        )
        val elapsedMillis = (System.nanoTime() - startedAtNanos) / 1_000_000L
        val explorationShapePenaltyMeters = ExerciseRouteExplorationShapeSijko.penaltyMeters(
            edges = result.route.edges,
            startPoint = start,
            targetDistanceMeters = FIVE_MILES_METERS,
        )
        val nearestCircuits = candidates
            .filter { candidate -> candidate.third }
            .sortedBy { candidate -> abs(candidate.first - FIVE_MILES_METERS) }
            .take(12)
            .joinToString { candidate ->
                "${candidate.first.toMiles()}mi/${candidate.second.toMiles()}mi-overlap"
            }
        val nearestCandidates = candidates
            .sortedBy { candidate -> abs(candidate.first - FIVE_MILES_METERS) }
            .take(12)
            .joinToString { candidate ->
                "${candidate.first.toMiles()}mi/${candidate.second.toMiles()}mi-overlap/${candidate.third}"
            }
        println(
            "ExerciseRouteRealData $start: ${result.route.totalDistanceMeters.toMiles()} miles, " +
                "${result.status}, ${result.selfOverlapMeters.toMiles()} overlap, " +
                "${result.route.ordinaryAccessDistanceMeters.toMiles()} access, " +
                "${explorationShapePenaltyMeters.toMiles()} shape penalty, " +
                "$elapsedMillis ms; nearest=$nearestCircuits",
        )

        assertEquals(
            expectedStatus,
            result.status,
            "Got ${result.route.totalDistanceMeters.toMiles()} miles with " +
                "${result.selfOverlapMeters.toMiles()} overlap. Nearest circuits: $nearestCircuits",
        )
        assertTrue(
            result.distanceErrorMeters <= ExerciseRouteTargetSijko.toleranceMeters(FIVE_MILES_METERS),
            "Expected a near-five-mile route, got ${result.route.totalDistanceMeters.toMiles()} miles in " +
                "$elapsedMillis ms. Nearest circuits: $nearestCircuits. Nearest candidates: $nearestCandidates",
        )
        assertTrue(
            explorationShapePenaltyMeters < FIVE_MILES_METERS * 0.10,
            "Expected one coherent exploration, but shape penalty was " +
                "${explorationShapePenaltyMeters.toMiles()} miles.",
        )
        assertEquals(
            0.0,
            result.route.edges.sumOf(TrailRoutingHazardPenaltySijko::additionalCost),
            "The exercise route traversed a reviewed safety-hazard zone.",
        )
        assertTrue(
            elapsedMillis <= MAXIMUM_SEARCH_MILLIS,
            "Exercise route search took $elapsedMillis ms.",
        )

        val nextDay = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = trails,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = FIVE_MILES_METERS,
                completedSessions = listOf(
                    CompletedExerciseSession(
                        id = "first-day",
                        routeKey = result.routeKey,
                        completedAtEpochMillis = 1_700_000_000_000L,
                        completedDistanceMeters = result.route.totalDistanceMeters,
                        traversalEdges = result.route.traversalEdges,
                    ),
                ),
                accessGraph = accessGraph,
                nowEpochMillis = 1_700_000_000_000L + ONE_DAY_MILLIS,
            ),
        )
        assertEquals(
            0.0,
            nextDay.route.edges.sumOf(TrailRoutingHazardPenaltySijko::additionalCost),
            "The next-day exercise route traversed a reviewed safety-hazard zone.",
        )
        return result to nextDay
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

    private fun accessFeatures(start: MapPoint): List<AccessNetworkFeature> {
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
                        points = listOf(start),
                        maxDistanceMeters = ENDPOINT_LOCAL_RADIUS_METERS,
                    )
                }
            }
        }
    }

    private fun normalizedRoot(name: String): JsonObject {
        return Json.parseToJsonElement(assetFile(name).readText()).jsonObject
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

    private fun Double.toMiles(): String {
        return String.format("%.2f", this / METERS_PER_MILE)
    }

    private companion object {
        const val TRAIL_ASSET_NAME = "mcgis-trails.normalized.json"
        const val ACCESS_ASSET_NAME = "mclean-access-roads.normalized.json"
        const val ENDPOINT_LOCAL_LAYER_ID = "osm-service"
        const val ENDPOINT_LOCAL_RADIUS_METERS = 600.0
        const val METERS_PER_MILE = 1_609.344
        const val FIVE_MILES_METERS = 5.0 * METERS_PER_MILE
        const val MAXIMUM_SEARCH_MILLIS = 10_000L
        const val ONE_DAY_MILLIS = 24L * 60L * 60L * 1_000L
    }
}
