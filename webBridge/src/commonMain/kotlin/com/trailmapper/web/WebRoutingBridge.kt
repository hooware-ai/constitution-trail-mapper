package com.trailmapper.web

import com.trailmapper.shared.LocalTrailGuide
import com.trailmapper.shared.routing.*
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import kotlin.time.Clock

/** The browser boundary is JSON; all route decisions remain in the common Kotlin core. */
class WebRoutingBridge {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private var features: List<TrailNetworkFeature>? = null
    private var roads: List<AccessNetworkFeature>? = null
    private val endpointLocalRoadIds = mutableSetOf<String>()
    /** Identity of the loaded dataset as declared by the caller; echoed back, never interpreted. */
    private var datasetIdentity: JsonElement = JsonNull
    /** Fixture-only: accept serialized routes that carry no feature identities (hand-built test geometry). */
    private var trustSerializedRoutes = false
    private var featureIndex: Map<String, TrailNetworkFeature> = emptyMap()
    private val revalidationCache = mutableMapOf<String, NetworkCheck>()
    private val geometryIndexes = mutableMapOf<String, GeometryIndex>()

    fun dispatch(requestJson: String): String = try {
        val request = json.parseToJsonElement(requestJson).jsonObject
        val now = request["now"]?.jsonPrimitive?.long ?: Clock.System.now().toEpochMilliseconds()
        val result = when (request.string("op")) {
            "initialize" -> initialize(request, now)
            "plan" -> plan(request, now)
            "mapPoint" -> mapPoint(request, now)
            "inspect" -> describe(request.route(), now)
            "snapshot" -> snapshot(request, now)
            "reroute" -> reroute(request, now)
            "recalculate" -> recalculate(request, now)
            else -> error("Unknown routing operation.")
        }
        JsonObject(mapOf("ok" to JsonPrimitive(true)) + result).toString()
    } catch (error: Exception) {
        buildJsonObject {
            put("ok", false)
            put("error", error.message?.take(400) ?: "Unable to process routing request.")
            put("closures", JsonArray(emptyList()))
        }.toString()
    }

    private fun initialize(request: JsonObject, now: Long): JsonObject {
        // A failed dataset replacement must not silently leave the old network active.
        features = null
        roads = null
        endpointLocalRoadIds.clear()
        datasetIdentity = JsonNull
        trustSerializedRoutes = false
        featureIndex = emptyMap()
        revalidationCache.clear()
        geometryIndexes.clear()
        val loaded = NormalizedTrailNetworkJsonSijko.features(request.string("trails"))
        require(loaded.isNotEmpty()) { "The trail dataset contains no features." }
        loaded.flatMap { it.paths }.flatten().forEach(::validatePoint)
        val loadedRoads = request["access"]?.jsonPrimitive?.contentOrNull?.let(::accessFeatures)
        require(loaded.map { it.id }.toSet().size == loaded.size) { "The trail dataset contains duplicate feature identifiers." }
        features = loaded
        roads = loadedRoads
        featureIndex = loaded.associateBy { it.id }
        datasetIdentity = request["dataset"] ?: JsonNull
        trustSerializedRoutes = request.boolean("trustSerializedRoutes")
        return buildJsonObject {
            put("dataset", datasetIdentity)
            put("featureCount", loaded.size)
            put("accessFeatureCount", loadedRoads?.size ?: 0)
            put("features", JsonArray(loaded.map { feature -> buildJsonObject {
                put("id", feature.id)
                put("name", feature.name)
                put("status", feature.status.name)
                put("roles", strings(feature.routeRoles.map { it.name }))
                put("paths", json.encodeToJsonElement(feature.paths))
            } }))
            put("freshnessMessage", LocalTrailGuide.freshnessMessage)
            put("updates", JsonArray(LocalTrailGuide.entries().map { entry -> buildJsonObject {
                put("id", entry.id)
                put("category", entry.category.label)
                put("title", entry.title)
                put("details", entry.details)
                put("status", entry.statusAt(now))
                put("source", buildJsonObject { put("title", entry.source.title); put("url", entry.source.url) })
            } }))
            put("closures", closureJson(TrailRouteClosureSijko.activeClosures(now)))
        }
    }

    /** Resolve only an explicit map-picker tap; place and current-location inputs stay unchanged. */
    private fun mapPoint(request: JsonObject, now: Long): JsonObject {
        val point = request.point("point")
        val network = requireNetwork()
        val layers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = request.boolean("proposed"))
        val open = TrailRouteClosureSijko.openFeatures(TrailFeatureFilterSijko.enabledFeatures(network, layers), now).features
        val graph = TrailGraphBuilderSijko.buildGraph(open)
        val snap = NearestTrailSnapSijko.nearestSnap(graph, point)?.takeIf { it.accessDistanceMeters <= 20.0 }
        val label = snap?.edge?.routeSegments?.firstNotNullOfOrNull { it.name?.takeIf(String::isNotBlank) }
            ?: snap?.edge?.sourceFeatureId?.let { id -> network.firstOrNull { it.id == id }?.name?.takeIf(String::isNotBlank) }
            ?: if (snap == null) "Map point" else "Mapped trail"
        return buildJsonObject {
            put("point", json.encodeToJsonElement(snap?.projectedPoint ?: point))
            put("label", label)
            put("snapDistance", snap?.accessDistanceMeters ?: 0.0)
            put("snapped", snap != null)
            put("receipt", snap?.let {
                val meters = kotlin.math.round(it.accessDistanceMeters).toInt()
                "Selected mapped trail $meters m from your tap; access to that point is not included."
            })
        }
    }

    private fun plan(request: JsonObject, now: Long): JsonObject {
        val network = requireNetwork()
        val start = request.point("start")
        val layers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = request.boolean("proposed"))
        val route = if (request["destination"] != null && request["destination"] != JsonNull) {
            val destination = request.point("destination")
            val outcome = TrailRouteCalculationSijko.findRouteOutcome(
                network, layers, start, destination, accessGraph(listOf(start, destination)), nowEpochMillis = now,
            )
            outcome.route ?: return noRoute(outcome.blockingClosures)
        } else {
            val meters = request.getValue("miles").jsonPrimitive.double * 1609.344
            require(ExerciseRouteTargetSijko.isValid(meters)) { "Exercise distance must be between 0.5 and 100 miles." }
            val graph = accessRoads(listOf(start))?.let { AccessGraphBuilderSijko.buildGraph(ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(it, start, meters)) }
            ExerciseRouteCalculationSijko.findRoute(network, layers, start, meters, emptyList(), graph, now)?.route
                ?: return noRoute(TrailRouteClosureSijko.openFeatures(TrailFeatureFilterSijko.enabledFeatures(network, layers), now).appliedClosures)
        }
        if (route.totalDistanceMeters <= 0.01 || route.segments.none { it.isRouted && it.points.size >= 2 }) return noRoute(emptyList())
        return describe(route, now)
    }

    private fun describe(route: TrailRoute, now: Long): JsonObject {
        validateRoute(route)
        val advisories = TrailRouteAdvisorySijko.forRoute(route, now)
        val blocking = TrailRouteClosureGateSijko.blockingAdvisories(route, now)
        val accessGaps = accessGapJson(route)
        val estimated = accessGaps.isNotEmpty()
        val proposed = route.edges.any { it.status == TrailFeatureStatus.Proposed } ||
            route.segments.any { TrailNetworkRole.ProposedTrails in it.routeRoles }
        val warnings = advisories.map { "${it.title}: ${it.message}" }.toMutableList()
        // The serialized route carries the eligibility it was planned with; only the loaded network is current.
        val network = revalidate(route, now)
        val networkCurrent = network.status == "current" || network.status == "trusted"
        if (!networkCurrent) warnings += network.message()
        val target = route.requestedDistanceMeters
        val targetMatched = target == null || kotlin.math.abs(route.totalDistanceMeters - target) <= ExerciseRouteTargetSijko.toleranceMeters(target)
        if (route.kind == TrailRouteKind.ExerciseLoop && !targetMatched) {
            val requestedMiles = kotlin.math.round(target / 1609.344 * 10.0) / 10.0
            val actualMiles = kotlin.math.round(route.totalDistanceMeters / 1609.344 * 10.0) / 10.0
            warnings += "The closest available loop is $actualMiles miles for your $requestedMiles-mile target. Review its length before riding."
        }
        if (proposed) warnings += "This route includes proposed trails and is preview-only. They are not confirmed usable infrastructure."
        return buildJsonObject {
            put("route", json.encodeToJsonElement(route))
            put("segments", JsonArray(routedDrawableSegments(route).map { segment -> buildJsonObject {
                put("points", json.encodeToJsonElement(segment.points))
                put("type", segment.type.name)
                put("roles", strings(segment.routeRoles.map { it.name }))
                put("isRouted", segment.isRouted)
                put("name", segment.name)
            } }))
            put("distance", route.totalDistanceMeters)
            put("accessDistance", route.ordinaryAccessDistanceMeters)
            put("accessGaps", accessGaps)
            put("sharedDistance", route.sharedRoadwayDistanceMeters)
            put("kind", route.kind.name)
            put("summary", TrailRouteSummarySijko.summaryFor(route))
            put("requestedDistance", target)
            put("targetMatched", targetMatched)
            put("retracedDistance", ExerciseRouteOverlapSijko.selfOverlapMeters(route.traversalEdges))
            put("instructions", JsonArray(TrailRouteTurnInstructionSijko.instructionsFor(route).map(::instructionJson)))
            put("warnings", strings(warnings))
            put("closures", JsonArray(blocking.map(::advisoryJson)))
            put("key", "${route.kind.name}:${json.encodeToString(route.segments).hashCode()}")
            // Route-level facts the segments alone cannot carry: a Proposed edge need not carry the role, and
            // closure/warning status is only as fresh as this evaluation.
            put("proposed", proposed)
            put("evaluatedAt", now)
            put("network", network.toJson())
            put("canNavigate", networkCurrent && blocking.isEmpty() && !estimated && !proposed && route.segments.any { it.points.size >= 2 })
        }
    }

    private fun snapshot(request: JsonObject, now: Long): JsonObject {
        val route = request.route()
        val description = describe(route, now)
        require(description.getValue("canNavigate").jsonPrimitive.boolean) { "This route cannot start navigation: review its closure and access warnings." }
        val state = request["state"]?.takeIf { it != JsonNull }?.let { json.decodeFromJsonElement<BrowserNavigationState>(it) } ?: BrowserNavigationState()
        val progress = request["progress"]?.jsonPrimitive?.double ?: state.maximumProgress
        require(progress.isFinite() && progress >= 0.0) { "Invalid navigation progress." }
        val point = request.point("point")
        val resuming = request.boolean("resume")
        val fix = TrailRouteNavigationFix(point, request["accuracy"]?.jsonPrimitive?.doubleOrNull, request["timestamp"]?.jsonPrimitive?.long ?: now)
        val previousDeviation = if (resuming) TrailRouteDeviationState() else TrailRouteDeviationState(
            TrailRouteDeviationStatus.valueOf(state.deviationStatus), state.streakStartMillis, state.streakStartPoint,
            state.streakFixCount, state.returnFixCount, state.lastCredibleFixMillis,
        )
        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(route)
        val loop = route.kind == TrailRouteKind.ExerciseLoop
        // A loop keeps its last observed progress as an ordering floor even when reacquiring, so a rider
        // on the return leg of repeated geometry is not matched to the completed outbound pass. Nothing is
        // credited for this: reacquisition never adds distance, it only picks the occurrence.
        var snapshot = requireNotNull(TrailRouteNavigationSnapshotSijko.snapshotFor(
            route, instructions, point,
            minimumProgressMeters = if (loop) progress else 0.0,
            previousProgressMeters = progress.takeUnless { resuming },
        )) { "No drawable navigation geometry is available." }
        // The shared floor is only a soft hint (it prefers an earlier, comparably close match to tolerate
        // start/end jitter), so validate the chosen traversal against the saved progress on every loop fix,
        // not just the first one after reacquiring. Use a supported
        // later occurrence when one exists; when the rider is on the route only at points earlier than
        // their progress, report ambiguity instead of steering them along an earlier leg or as off route.
        var ambiguous = false
        // Ordinary fixes with a known previous position: which pass the rider occupies follows from how far
        // they can have travelled, so an unchanged location keeps the pass nearest their saved progress and a
        // real movement cannot land on a pass farther away than that movement (plus GPS slack) allows.
        val lastPoint = state.lastPoint
        val continuous = loop && progress > 0.0 && !resuming && lastPoint != null
        if (continuous && lastPoint != null) {
            val reach = TrailDistanceSijko.metersBetween(lastPoint, point) +
                2.0 * (fix.accuracyMeters ?: TRAVERSAL_DEFAULT_ACCURACY_METERS).coerceIn(0.0, TRAVERSAL_MAX_ACCURACY_METERS) +
                TRAVERSAL_SLACK_METERS
            val onRoute = onRouteOccurrences(route, point)
            val reachable = onRoute.filter { kotlin.math.abs(it.along - progress) <= reach }
            // Physical closeness first: an old vertex a few metres away must not beat the exact position on
            // the route. Only among places equally close to the rider does saved progress pick the pass.
            val closest = reachable.minOfOrNull { it.distance }
            val chosen = reachable
                .filter { closest != null && it.distance <= closest + TRAVERSAL_PHYSICAL_TOLERANCE_METERS }
                // Where the route retraces itself two passes can be equally near; riders move forward, so prefer that one.
                .minWithOrNull(compareBy<Occurrence>({ kotlin.math.abs(it.along - progress) - if (it.along >= progress) TRAVERSAL_FORWARD_BIAS_METERS else 0.0 }, { it.distance }))
            when {
                chosen != null -> if (kotlin.math.abs(snapshot.distanceAlongRouteMeters - chosen.along) > PINNED_OCCURRENCE_TOLERANCE_METERS) {
                    val pinned = requireNotNull(TrailRouteNavigationSnapshotSijko.snapshotFor(
                        route, instructions, chosen.point, minimumProgressMeters = pinnedFloor(chosen.along), previousProgressMeters = null,
                    ))
                    if (kotlin.math.abs(pinned.distanceAlongRouteMeters - chosen.along) <= PINNED_OCCURRENCE_TOLERANCE_METERS) {
                        snapshot = pinned.copy(distanceFromRouteMeters = chosen.distance)
                    } else ambiguous = true
                }
                // On the route, but only where the rider cannot have travelled to: do not guess.
                onRoute.isNotEmpty() -> ambiguous = true
            }
        }
        if (!continuous && loop && progress > 0.0) {
            val floor = (progress - TRAVERSAL_BACKTRACK_METERS).coerceAtLeast(0.0)
            // After a gap any position behind the floor is suspect; on ordinary fixes only a rewind bigger
            // than the continuity window is (small backtracking is normal and earns no progress or credit).
            val rewindLimit = if (resuming) floor else (progress - TRAVERSAL_CONTINUITY_METERS).coerceAtLeast(0.0)
            val crossedFloor = snapshot.distanceAlongRouteMeters < rewindLimit
            if (crossedFloor || (resuming && snapshot.distanceFromRouteMeters > TrailRouteNavigationSnapshotSijko.OFF_ROUTE_METERS)) {
                val onRoute = onRouteOccurrences(route, point)
                val later = onRoute.filter { it.along >= floor }
                val best = later.minOfOrNull { it.distance }
                val supported = if (best == null) null else later.filter { it.distance <= best + 5.0 }.minByOrNull { it.along }
                // A distant later pass competing with geometry just behind the rider is not a safe choice:
                // the rider cannot be told which one they are on, so say so instead of jumping ahead.
                val competingNearBehind = supported != null && supported.along - progress > TRAVERSAL_CONTINUITY_METERS &&
                    onRoute.any { it.along < floor && it.along >= progress - TRAVERSAL_CONTINUITY_METERS }
                when {
                    competingNearBehind -> ambiguous = true
                    supported != null && crossedFloor -> {
                        // The shared matcher can still fall back to an earlier, comparably close point (a repeated
                        // junction), so ask it about the supported occurrence itself and verify what it returns.
                        val pinned = requireNotNull(TrailRouteNavigationSnapshotSijko.snapshotFor(
                            route, instructions, supported.point, minimumProgressMeters = pinnedFloor(supported.along), previousProgressMeters = null,
                        ))
                        if (kotlin.math.abs(pinned.distanceAlongRouteMeters - supported.along) <= PINNED_OCCURRENCE_TOLERANCE_METERS &&
                            pinned.distanceAlongRouteMeters >= floor) {
                            snapshot = pinned.copy(distanceFromRouteMeters = supported.distance)
                        } else ambiguous = true
                    }
                    supported == null && onRoute.isNotEmpty() -> ambiguous = true
                }
            }
        }
        val deviation = TrailRouteDeviationSijko.next(previousDeviation, fix, snapshot.distanceFromRouteMeters, now)
        val credible = TrailRouteDeviationSijko.isCredible(fix, now) && (fix.accuracyMeters ?: -1.0) >= 0.0
        val verified = if (credible && !resuming) ExerciseRouteCompletionSijko.verifiedProgressMeters(state.verifiedProgress, state.maximumProgress, snapshot) else state.verifiedProgress
        val departed = credible && !resuming && ExerciseRouteCompletionSijko.hasDeparted(route, snapshot, state.departed) || state.departed
        val nextState = BrowserNavigationState(
            maximumProgress = when {
                !credible -> state.maximumProgress
                ambiguous -> maxOf(state.maximumProgress, progress)
                resuming && loop -> maxOf(state.maximumProgress, snapshot.distanceAlongRouteMeters)
                resuming -> snapshot.distanceAlongRouteMeters
                else -> maxOf(state.maximumProgress, snapshot.distanceAlongRouteMeters)
            },
            verifiedProgress = verified, departed = departed,
            deviationStatus = deviation.status.name, streakStartMillis = deviation.streakStartMillis,
            streakStartPoint = deviation.streakStartPoint, streakFixCount = deviation.streakFixCount,
            returnFixCount = deviation.returnFixCount, lastCredibleFixMillis = deviation.lastCredibleFixMillis,
            lastPoint = if (credible && !ambiguous) point else state.lastPoint,
        )
        val arrived = credible && !resuming && !ambiguous && if (route.kind == TrailRouteKind.ExerciseLoop) {
            ExerciseRouteCompletionSijko.shouldComplete(route, snapshot, departed, false, verified)
        } else snapshot.remainingDistanceMeters <= 25.0 && snapshot.distanceFromRouteMeters <= 35.0
        return buildJsonObject {
            put("progress", if (credible && !ambiguous) snapshot.distanceAlongRouteMeters else progress)
            put("ambiguous", ambiguous)
            put("remaining", snapshot.remainingDistanceMeters)
            put("distanceFromRoute", snapshot.distanceFromRouteMeters)
            put("offRoute", deviation.isConfirmed)
            put("deviationStatus", deviation.status.name)
            put("credible", credible)
            put("nextInstruction", snapshot.nextInstruction?.let(::instructionJson) ?: JsonNull)
            put("distanceToNextInstruction", snapshot.distanceToNextInstructionMeters)
            put("snappedPoint", json.encodeToJsonElement(snapshot.snappedPoint))
            put("cameraTarget", json.encodeToJsonElement(snapshot.cameraTarget))
            put("bearing", snapshot.bearingDegrees)
            put("arrived", arrived)
            put("canNavigate", true)
            put("state", json.encodeToJsonElement(nextState))
        }
    }

    private fun reroute(request: JsonObject, now: Long): JsonObject {
        val network = requireNetwork()
        val route = request.route()
        val point = request.point("point")
        val mode = request.string("mode")
        val graph = accessGraph(listOfNotNull(point, TrailRouteRerouteSijko.destinationOf(route)))
        val outcome = when (mode) {
            "rejoin" -> {
                require(route.kind == TrailRouteKind.ExerciseLoop) { "Only an exercise loop can be rejoined." }
                val progress = request["progress"]?.jsonPrimitive?.double ?: 0.0
                require(progress.isFinite() && progress >= 0.0) { "Invalid navigation progress." }
                TrailRouteLoopRerouteSijko.rejoin(network, route, point, progress, graph, nowEpochMillis = now)
            }
            "return" -> {
                require(route.kind == TrailRouteKind.ExerciseLoop) { "Return to start is available for exercise loops." }
                TrailRouteLoopRerouteSijko.returnToStart(network, route, point, graph, nowEpochMillis = now)
            }
            "destination" -> {
                require(route.kind != TrailRouteKind.ExerciseLoop) { "Choose rejoin or return to start for an exercise loop." }
                TrailRouteRerouteSijko.pointToPoint(network, route, point, graph, nowEpochMillis = now)
            }
            else -> error("Unknown reroute mode.")
        }
        return when (outcome) {
            is TrailRouteRerouteOutcome.Replacement -> describe(outcome.route, now)
            is TrailRouteRerouteOutcome.NoSafeRoute -> noRoute(outcome.blockingClosures)
        }
    }

    private fun recalculate(request: JsonObject, now: Long): JsonObject {
        val route = request.route()
        val access = accessRoads(TrailRouteClosureGateSijko.accessEndpoints(route))?.let(TrailRouteRerouteAccess::Roads) ?: TrailRouteRerouteAccess.NotAvailable
        return when (val result = TrailRouteClosureGateSijko.recalculate(requireNetwork(), route, access, nowEpochMillis = now)) {
            is TrailRouteRecalculationOutcome.Replacement -> describe(result.route, now)
            is TrailRouteRecalculationOutcome.NoSafeRoute -> noRoute(result.blockingClosures)
            TrailRouteRecalculationOutcome.RoadDataFailed -> error("Road access data failed to load.")
        }
    }

    private fun noRoute(closures: List<TrailRouteClosure>): JsonObject = buildJsonObject {
        put("route", JsonNull)
        put("canNavigate", false)
        put("error", if (closures.isEmpty()) "No safe route was found between these points on the available network." else "No safe route avoids the active trail closure. Review the official detour guidance.")
        put("closures", closureJson(closures))
    }

    private fun accessFeatures(text: String): List<AccessNetworkFeature> =
        json.parseToJsonElement(text.removePrefix("\uFEFF")).jsonObject.getValue("layers").jsonArray.flatMap { layer ->
            layer.jsonObject.getValue("features").jsonArray.map { value ->
                val feature = value.jsonObject
                AccessNetworkFeature(
                    id = feature.string("id").also { id ->
                        if (layer.jsonObject["id"]?.jsonPrimitive?.contentOrNull == "osm-service") endpointLocalRoadIds += id
                    }, name = feature["name"]?.jsonPrimitive?.contentOrNull,
                    roadClass = feature["mtfcc"]?.jsonPrimitive?.contentOrNull,
                    paths = feature.getValue("paths").jsonArray.map { path -> path.jsonArray.map { coordinate ->
                        val pair = coordinate.jsonArray
                        MapPoint(pair[1].jsonPrimitive.double, pair[0].jsonPrimitive.double).also(::validatePoint)
                    } },
                )
            }
        }

    // Match the native access adapter: service roads are included only near requested endpoints.
    private fun accessRoads(endpoints: List<MapPoint>): List<AccessNetworkFeature>? = roads?.filter { feature ->
        feature.id !in endpointLocalRoadIds || AccessNetworkFeatureProximitySijko.isNearAnyPoint(feature, endpoints, 600.0)
    }
    private fun accessGraph(endpoints: List<MapPoint>): TrailGraph? = accessRoads(endpoints)?.let { AccessGraphBuilderSijko.buildGraph(it) }
    private fun requireNetwork(): List<TrailNetworkFeature> = requireNotNull(features) { "Load a trail dataset before planning." }
    private fun JsonObject.string(name: String): String = getValue(name).jsonPrimitive.content
    private fun JsonObject.boolean(name: String): Boolean = get(name)?.jsonPrimitive?.booleanOrNull ?: false
    private fun JsonObject.point(name: String): MapPoint = json.decodeFromJsonElement<MapPoint>(getValue(name)).also(::validatePoint)
    private fun JsonObject.route(): TrailRoute = json.decodeFromJsonElement<TrailRoute>(getValue("route")).also(::validateRoute)
    private fun validatePoint(point: MapPoint) {
        require(point.latitude.isFinite() && point.longitude.isFinite() && point.latitude in -90.0..90.0 && point.longitude in -180.0..180.0) { "Invalid latitude or longitude." }
    }
    private fun validateRoute(route: TrailRoute) {
        require(route.totalDistanceMeters.isFinite() && route.totalDistanceMeters >= 0.0) { "Invalid route distance." }
        route.segments.flatMap { it.points }.forEach(::validatePoint)
    }
    /** The matcher subtracts its 60 m backtrack tolerance, so add it back to exclude anything behind the occurrence. */
    private fun pinnedFloor(along: Double) = along + TRAVERSAL_BACKTRACK_METERS - 0.1

    private class NetworkIssue(val code: String, val featureId: String?, val detail: String)

    /** status: current (verified), trusted (fixture-only, not verified), stale (differs) or unverifiable. */
    private class NetworkCheck(val status: String, val checkedEdges: Int, val issues: List<NetworkIssue>) {
        fun message(): String = when (status) {
            "unverifiable" -> "This saved route cannot be checked against the current trail data. Recalculate it before riding."
            else -> "This saved route no longer matches the current trail data (" +
                issues.map { it.detail }.distinct().take(3).joinToString("; ") +
                "). Recalculate it before riding."
        }
        fun toJson(): JsonObject = buildJsonObject {
            put("status", status)
            put("checkedEdges", checkedEdges)
            put("issues", JsonArray(issues.take(20).map { issue -> buildJsonObject {
                put("code", issue.code)
                put("featureId", issue.featureId)
                put("detail", issue.detail)
            } }))
            put("issueCount", issues.size)
        }
    }

    /**
     * Checks a serialized route against the network that is loaded now: every edge must still name a feature that
     * exists, has the same status, is eligible under the route's layer choices, and still lies on the same geometry.
     * A route that cannot be checked (no feature identities) is not trusted unless the dataset is the fixture.
     */
    private fun revalidate(route: TrailRoute, now: Long): NetworkCheck {
        if (features == null) return NetworkCheck("unverifiable", 0, listOf(NetworkIssue("no-network", null, "no trail data is loaded")))
        if (route.edges.isEmpty())
            return if (trustSerializedRoutes) NetworkCheck("trusted", 0, emptyList())
            else NetworkCheck("unverifiable", 0, listOf(NetworkIssue("legacy-route", null, "the saved route has no feature identities to check")))
        val layers = route.routeLayers ?: RouteLayerDefaultsSijko.defaultSelection()
        val enabled = TrailFeatureFilterSijko.enabledFeatures(requireNetwork(), layers)
        val openNetwork = TrailRouteClosureSijko.openFeatures(enabled, now)
        val closedKey = openNetwork.appliedClosures.map { it.featureId }.sorted().joinToString(",")
        // The key is every input the check reads (identities, statuses, choices, closure state and each coordinate),
        // compared for equality: a route that merely resembles an earlier one can never borrow its verdict.
        val key = buildString {
            append(layers.toString()).append('#').append(closedKey).append('#')
            route.edges.forEach { edge ->
                append(edge.id).append('|').append(edge.sourceFeatureId).append('|').append(edge.status.ordinal).append('|')
                append(edge.connectorOfEdgeId).append('|').append(edge.accessRoadClass).append('|')
                edge.routeSegments.forEach { segment ->
                    if (segment.isRouted) segment.points.forEach { append(it.latitude).append(',').append(it.longitude).append(';') }
                    append('/')
                }
                append('#')
            }
        }
        revalidationCache[key]?.let { return it }
        if (revalidationCache.size >= REVALIDATION_CACHE_LIMIT) revalidationCache.clear()
        // What the planner would build today: the graph of the enabled trails with active closures cut out (and,
        // when a closure applies, the uncut graph as well, so a route made before it is not misread as moved).
        val indexes = buildList {
            add(geometryIndexes.getOrPut("open|$layers|$closedKey") { GeometryIndex(TrailGraphBuilderSijko.buildGraph(openNetwork.features)) })
            if (closedKey.isNotEmpty()) add(geometryIndexes.getOrPut("all|$layers") { GeometryIndex(TrailGraphBuilderSijko.buildGraph(enabled)) })
        }
        val issues = mutableListOf<NetworkIssue>()
        val seen = mutableSetOf<String>()
        for (edge in route.edges) {
            val id = edge.sourceFeatureId
            if (edge.accessRoadClass != null) {
                // Access roads come from a separate dataset; without it a route that used them cannot be honoured.
                val known = roads?.any { it.id == id } ?: false
                if (!known && seen.add("access:$id")) issues += NetworkIssue("access-unavailable", id, "a road connection is not in the current data")
                continue
            }
            if (id == null) {
                if (seen.add("unidentified:${edge.id}")) issues += NetworkIssue("unidentified", null, "an edge names no trail feature")
                continue
            }
            val feature = featureIndex[id]
            if (feature == null) {
                if (seen.add("removed:$id")) issues += NetworkIssue("removed", id, "trail $id is no longer in the data")
                continue
            }
            if (feature.status != edge.status && seen.add("status:$id"))
                issues += NetworkIssue("status-changed", id, "trail $id is now ${feature.status.name.lowercase()}")
            if (TrailFeatureFilterSijko.enabledFeatures(listOf(feature), layers).isEmpty() && seen.add("eligible:$id"))
                issues += NetworkIssue("not-eligible", id, "trail $id is not available under this route's choices")
            if (seen.add("geometry-checked:${edge.id}") && !edgeMatchesGraph(edge, id, indexes) && seen.add("geometry:$id"))
                issues += NetworkIssue("geometry-changed", id, "trail $id has different geometry")
        }
        val result = NetworkCheck(if (issues.isEmpty()) "current" else "stale", route.edges.size, issues)
        revalidationCache[key] = result
        return result
    }

    /**
     * Every drawn line of a route edge must be a piece of geometry the CURRENT graph derives from that feature: its
     * node-to-node run, or the run with its two ends anchored to the graph's nodes (which is what snapped start and
     * destination points and junction connectors are cut from). The reference geometry comes from building the graph
     * the way the planner does, so nothing here is a tolerance around the feature: a trail that moved, was redrawn or
     * was replaced has no matching derived geometry, and a normal snapped route over an unchanged network always does.
     */
    private fun edgeMatchesGraph(edge: TrailGraphEdge, featureId: String, indexes: List<GeometryIndex>): Boolean {
        val lines = edge.routeSegments.filter { it.isRouted }.map { it.points }.filter { it.isNotEmpty() }
        return lines.all { line -> indexes.any { it.derives(featureId, line) } }
    }

    /** The polylines the planner's graph derives from each feature: raw runs, connectors, and their node-anchored forms. */
    private class GeometryIndex(graph: TrailGraph) {
        private class Reference(val points: List<MapPoint>) {
            val south = points.minOf { it.latitude }
            val north = points.maxOf { it.latitude }
            val west = points.minOf { it.longitude }
            val east = points.maxOf { it.longitude }
        }

        private val byFeature = HashMap<String, MutableList<Reference>>()

        init {
            val nodes = graph.nodes.associateBy { it.id }
            for (edge in graph.edges) {
                val id = edge.sourceFeatureId ?: continue
                val raw = edge.routeSegments.flatMap { it.points }
                if (raw.isEmpty()) continue
                val references = byFeature.getOrPut(id) { mutableListOf() }
                references += Reference(raw)
                val from = nodes[edge.fromNodeId]
                val to = nodes[edge.toNodeId]
                if (from != null && to != null && raw.size >= 2) references += Reference(listOf(from.point) + raw.drop(1).dropLast(1) + to.point)
            }
        }

        /**
         * True when the whole drawn line lies along one of the feature's derived polylines. Checked continuously, not by
         * sampling: a straight leg lies within tolerance of a reference segment everywhere exactly when both of its ends
         * do (distance to a segment is convex), so each leg must be covered by a single reference segment. A leg that
         * spans a bend of the reference, however short, is not, and a line whose vertices differ from the derived ones
         * is conservatively treated as changed (recalculating always works).
         */
        fun derives(featureId: String, line: List<MapPoint>): Boolean {
            val references = byFeature[featureId] ?: return false
            val margin = 0.0001
            val south = line.minOf { it.latitude } - margin
            val north = line.maxOf { it.latitude } + margin
            val west = line.minOf { it.longitude } - margin
            val east = line.maxOf { it.longitude } + margin
            return references.any { ref ->
                ref.south <= north && ref.north >= south && ref.west <= east && ref.east >= west && covers(ref.points, line)
            }
        }

        private fun covers(polyline: List<MapPoint>, line: List<MapPoint>): Boolean {
            if (polyline.size == 1) return line.all { TrailDistanceSijko.metersBetween(it, polyline[0]) <= DERIVED_GEOMETRY_METERS }
            if (line.size == 1) return near(line[0], polyline)
            return line.windowed(size = 2, step = 1).all { (a, b) ->
                (0 until polyline.size - 1).any { i -> within(a, polyline[i], polyline[i + 1]) && within(b, polyline[i], polyline[i + 1]) }
            }
        }

        private fun near(point: MapPoint, polyline: List<MapPoint>): Boolean =
            (0 until polyline.size - 1).any { i -> within(point, polyline[i], polyline[i + 1]) }

        private fun within(point: MapPoint, start: MapPoint, end: MapPoint): Boolean =
            TrailDistanceSijko.projectToSegment(point = point, segmentStart = start, segmentEnd = end).distanceMeters <= DERIVED_GEOMETRY_METERS
    }

    private class Occurrence(val along: Double, val distance: Double, val point: MapPoint)

    /** Every place along the route within on-route distance of [point], using the snapshot's leg arithmetic. */
    private fun onRouteOccurrences(route: TrailRoute, point: MapPoint): List<Occurrence> {
        var cumulative = 0.0
        val found = mutableListOf<Occurrence>()
        TrailRouteDrawableSegmentMergeSijko.merge(route.segments).forEach { segment ->
            segment.points.windowed(size = 2, step = 1).forEach { (start, end) ->
                val leg = TrailDistanceSijko.metersBetween(start, end)
                if (leg >= 0.1) {
                    val projection = TrailDistanceSijko.projectToSegment(point = point, segmentStart = start, segmentEnd = end)
                    if (projection.distanceMeters <= TrailRouteNavigationSnapshotSijko.OFF_ROUTE_METERS) {
                        found += Occurrence(cumulative + projection.distanceFromStartMeters.coerceIn(0.0, leg), projection.distanceMeters, projection.projectedPoint)
                    }
                    cumulative += leg
                }
            }
        }
        return found
    }
    private fun routedDrawableSegments(route: TrailRoute): List<TrailRouteSegment> = buildList {
        val run = mutableListOf<TrailRouteSegment>()
        route.segments.forEach { segment ->
            if (segment.isRouted) {
                run += segment
            } else {
                // An estimated segment is a hard boundary, even inside the native merge tolerance.
                addAll(TrailRouteDrawableSegmentMergeSijko.merge(run))
                run.clear()
            }
        }
        addAll(TrailRouteDrawableSegmentMergeSijko.merge(run))
    }

    private fun accessGapJson(route: TrailRoute): JsonArray = JsonArray(route.segments.mapIndexedNotNull { index, segment ->
        if (segment.isRouted) return@mapIndexedNotNull null
        val meters = segment.points.zipWithNext().sumOf { (a, b) -> TrailDistanceSijko.metersBetween(a, b) }
        if (!(meters > 0.01)) return@mapIndexedNotNull null
        val label = when (index) {
            0 -> "Start connection"
            route.segments.lastIndex -> if (route.kind == TrailRouteKind.ExerciseLoop) "Return connection" else "Destination connection"
            else -> listOfNotNull(route.segments.getOrNull(index - 1), route.segments.getOrNull(index + 1))
                .firstNotNullOfOrNull { it.name?.takeIf(String::isNotBlank) }
                ?.let { "Near $it" } ?: "Along the route"
        }
        buildJsonObject {
            put("id", "gap-$index")
            put("distanceMeters", meters)
            put("from", json.encodeToJsonElement(segment.points.first()))
            put("to", json.encodeToJsonElement(segment.points.last()))
            put("label", label)
        }
    })
    private fun strings(values: List<String>): JsonArray = JsonArray(values.map(::JsonPrimitive))
    private fun instructionJson(instruction: TrailRouteInstruction): JsonObject = buildJsonObject {
        put("text", instruction.text); put("distance", instruction.distanceMeters)
        put("point", json.encodeToJsonElement(instruction.point)); put("maneuver", instruction.maneuver.name)
    }
    private fun advisoryJson(advisory: TrailRouteAdvisory): JsonObject = buildJsonObject {
        put("id", advisory.id); put("title", advisory.title); put("message", advisory.message)
        put("sourceUrl", advisory.sourceUrl); put("locationDescription", advisory.locationDescription)
    }
    private fun closureJson(closures: List<TrailRouteClosure>): JsonArray = JsonArray(closures.map { closure -> buildJsonObject {
        put("id", closure.id); put("title", closure.title); put("message", closure.guidance)
        put("sourceUrl", closure.noticeUrl); put("locationDescription", closure.featureId)
        put("closedFrom", json.encodeToJsonElement(closure.closedFrom))
        put("closedTo", json.encodeToJsonElement(closure.closedTo))
        // Draw only the actual loaded source path; boundary coordinates alone do not imply a chord.
        val points = features?.firstOrNull { it.id == closure.featureId }?.paths?.firstNotNullOfOrNull { path ->
            val first = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedFrom) <= 1.0 }
            val last = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedTo) <= 1.0 }
            if (first >= 0 && last >= 0 && first != last) path.subList(minOf(first, last), maxOf(first, last) + 1) else null
        } ?: emptyList()
        put("points", json.encodeToJsonElement(points))
    } })
}

/** Round-tripped by the browser; makes GPS confidence and exercise completion match native rules. */
@Serializable
private data class BrowserNavigationState(
    val maximumProgress: Double = 0.0,
    val verifiedProgress: Double = 0.0,
    val departed: Boolean = false,
    val deviationStatus: String = "OnRoute",
    val streakStartMillis: Long? = null,
    val streakStartPoint: MapPoint? = null,
    val streakFixCount: Int = 0,
    val returnFixCount: Int = 0,
    val lastCredibleFixMillis: Long? = null,
    /** Position of the last accepted loop fix, used to tell an unchanged location from real movement. */
    val lastPoint: MapPoint? = null,
)

private const val TRAVERSAL_BACKTRACK_METERS = 60.0
private const val TRAVERSAL_CONTINUITY_METERS = 300.0
private const val PINNED_OCCURRENCE_TOLERANCE_METERS = 5.0
private const val TRAVERSAL_SLACK_METERS = 25.0
private const val TRAVERSAL_FORWARD_BIAS_METERS = 5.0
private const val TRAVERSAL_PHYSICAL_TOLERANCE_METERS = 5.0
private const val TRAVERSAL_DEFAULT_ACCURACY_METERS = 25.0
private const val TRAVERSAL_MAX_ACCURACY_METERS = 50.0
private const val DERIVED_GEOMETRY_METERS = 0.5
private const val REVALIDATION_CACHE_LIMIT = 64
