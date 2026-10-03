package com.trailmapper.web

import com.trailmapper.shared.CarriedExerciseRide
import com.trailmapper.shared.CompletedExerciseSession
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
    /**
     * Position of each endpoint-local road in the original extract, when the caller says. The access graph merges nearby
     * nodes in feature order, so roads that arrive later (tiles) must be presented in the order a whole-file load would
     * have used, or an access path could differ by a snapped node. Roads without a position keep arrival order.
     */
    private val localOrdinals = mutableMapOf<String, Int>()
    /** Identity of the loaded dataset as declared by the caller; echoed back, never interpreted. */
    private var datasetIdentity: JsonElement = JsonNull
    /** Fixture-only: accept serialized routes that carry no feature identities (hand-built test geometry). */
    private var trustSerializedRoutes = false
    private var featureIndex: Map<String, TrailNetworkFeature> = emptyMap()
    private val revalidationCache = mutableMapOf<String, NetworkCheck>()
    private val geometryIndexes = mutableMapOf<String, GeometryIndex>()
    /** Changes whenever the loaded access data changes, so no cached verdict or geometry outlives the data it read. */
    private var accessEpoch = 0

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
            "reverse" -> reverse(request, now)
            "mapCues" -> mapCues(request)
            "completedSession" -> completedSession(request)
            "carryRide" -> carryRide(request)
            "addAccess" -> addAccess(request)
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
        localOrdinals.clear()
        datasetIdentity = JsonNull
        trustSerializedRoutes = false
        featureIndex = emptyMap()
        revalidationCache.clear()
        geometryIndexes.clear()
        accessEpoch++
        val loaded = NormalizedTrailNetworkJsonSijko.features(request.string("trails"))
        require(loaded.isNotEmpty()) { "The trail dataset contains no features." }
        loaded.flatMap { it.paths }.flatten().forEach(::validatePoint)
        val parsedRoads = request["access"]?.jsonPrimitive?.contentOrNull?.let(::parseAccess)
        val loadedRoads = parsedRoads?.map { it.feature }
        require(loaded.map { it.id }.toSet().size == loaded.size) { "The trail dataset contains duplicate feature identifiers." }
        features = loaded
        roads = loadedRoads
        parsedRoads?.filter { it.local }?.forEach {
            endpointLocalRoadIds += it.feature.id
            it.ord?.let { ord -> localOrdinals[it.feature.id] = ord }
        }
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

    /**
     * What the map draws besides the line, exactly as native computes it (TrailRouteMapCuesSijko): the route as direction-
     * ordered pieces (a second pass over the same trail already shifted 8 m to the right of travel so both stay visible),
     * where the route turns back, and the navigation distance at every point so ridden progress can be drawn.
     */
    private fun mapCues(request: JsonObject): JsonObject {
        val cues = TrailRouteMapCuesSijko.cuesFor(request.route())
        return buildJsonObject {
            put("pieces", JsonArray(cues.pieces.map { piece -> buildJsonObject {
                put("points", json.encodeToJsonElement(piece.segment.points))
                put("type", piece.segment.type.name)
                put("isRouted", piece.segment.isRouted)
                put("roles", strings(piece.segment.routeRoles.map { it.name }))
                put("name", piece.segment.name)
                put("repeatsEarlierTravel", piece.repeatsEarlierTravel)
                put("distances", json.encodeToJsonElement(piece.distancesAlongRouteMeters))
            } }))
            put("turnarounds", JsonArray(cues.turnarounds.map { turnaround -> buildJsonObject {
                put("point", json.encodeToJsonElement(turnaround.point))
                put("distance", turnaround.distanceAlongRouteMeters)
            } }))
        }
    }

    /** The rider's completed loops (newest first, browser-local), which make recently ridden edges cost more. */
    private fun completedSessions(request: JsonObject): List<CompletedExerciseSession> {
        val value = request["completedSessions"]?.takeIf { it != JsonNull } ?: return emptyList()
        val sessions = json.decodeFromJsonElement<List<CompletedExerciseSession>>(value)
        require(sessions.size <= MAX_COMPLETED_SESSIONS) { "Too many completed exercise sessions." }
        sessions.forEach { session ->
            require(session.completedAtEpochMillis >= 0 && session.completedDistanceMeters.isFinite() && session.completedDistanceMeters >= 0.0) { "Invalid completed exercise session." }
        }
        return sessions
    }

    /**
     * The history record for a finished loop, built as native builds it (CompletedExerciseSessionFactorySijko): only an
     * exercise loop with traversal edges counts; what was ridden of earlier routes before a rejoin is included; the key
     * is direction independent. A route that cannot support overlap scoring returns no session.
     */
    private fun completedSession(request: JsonObject): JsonObject {
        val route = request.route()
        val completedAt = request.getValue("completedAt").jsonPrimitive.long
        val carried = request["carried"]?.takeIf { it != JsonNull }?.let { json.decodeFromJsonElement<CarriedExerciseRide>(it) } ?: CarriedExerciseRide()
        if (route.kind != TrailRouteKind.ExerciseLoop || route.traversalEdges.isEmpty() || completedAt < 0L) {
            return buildJsonObject { put("session", JsonNull) }
        }
        val edges = carried.traversalEdges + route.traversalEdges
        val key = ExerciseRouteKeySijko.keyFor(edges)
        val session = CompletedExerciseSession(
            id = "$completedAt:$key",
            routeKey = key,
            completedAtEpochMillis = completedAt,
            completedDistanceMeters = carried.distanceMeters + route.totalDistanceMeters,
            traversalEdges = edges,
        )
        return buildJsonObject { put("session", json.encodeToJsonElement(session)) }
    }

    /** What has been ridden of [route] up to [progress], added to what earlier routes of the same ride already carried. */
    private fun carryRide(request: JsonObject): JsonObject {
        val route = request.route()
        val progress = request.getValue("progress").jsonPrimitive.double
        require(progress.isFinite() && progress >= 0.0) { "Invalid navigation progress." }
        val carried = request["carried"]?.takeIf { it != JsonNull }?.let { json.decodeFromJsonElement<CarriedExerciseRide>(it) } ?: CarriedExerciseRide()
        return buildJsonObject { put("carried", json.encodeToJsonElement(carried.plusRiddenPart(route, progress))) }
    }

    /**
     * The same exercise loop ridden the other way, exactly as the shared core reverses it (traversal order and geometry;
     * distances, costs and direction-independent traversal keys unchanged). It is described afresh, so closures, the
     * network check and the turn instructions are recomputed for the reversed direction. Only loops can be reversed.
     */
    private fun reverse(request: JsonObject, now: Long): JsonObject {
        val route = request.route()
        require(route.kind == TrailRouteKind.ExerciseLoop) { "Only an exercise loop can be ridden in reverse." }
        return describe(TrailRouteReverseSijko.reversed(route), now)
    }

    /**
     * Adds more access roads to the loaded set without re-initializing, so the trail network, the pinned identity and
     * every route already planned stay exactly as they are. Idempotent: a feature that is already loaded must be
     * identical (same paths); a different geometry under a known id is a conflict, never a silent replacement.
     */
    private fun addAccess(request: JsonObject): JsonObject {
        requireNetwork()
        // Nothing below touches loaded state until every check has passed, so a refused batch changes nothing.
        val incoming = LinkedHashMap<String, ParsedAccessFeature>()
        parseAccess(request.string("access")).forEach { parsed ->
            val repeated = incoming[parsed.feature.id]
            require(repeated == null || repeated == parsed) { "Access road ${parsed.feature.id} appears twice with different content." }
            incoming[parsed.feature.id] = parsed
        }
        val current = roads.orEmpty()
        val known = current.associateBy { it.id }
        val fresh = mutableListOf<ParsedAccessFeature>()
        incoming.values.forEach { parsed ->
            val existing = known[parsed.feature.id]
            if (existing == null) fresh += parsed
            else require(existing == parsed.feature && (existing.id in endpointLocalRoadIds) == parsed.local && localOrdinals[existing.id] == parsed.ord) {
                "Access road ${parsed.feature.id} is already loaded with different content."
            }
        }
        if (fresh.isNotEmpty()) {
            fresh.filter { it.local }.forEach {
                endpointLocalRoadIds += it.feature.id
                it.ord?.let { ord -> localOrdinals[it.feature.id] = ord }
            }
            roads = inExtractOrder(current + fresh.map { it.feature })
            revalidationCache.clear()
            geometryIndexes.clear()
            accessEpoch++
        }
        return buildJsonObject {
            put("added", fresh.size)
            put("accessFeatureCount", roads.orEmpty().size)
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
            ExerciseRouteCalculationSijko.findRoute(network, layers, start, meters, completedSessions(request), graph, now)?.route
                ?: return noRoute(TrailRouteClosureSijko.openFeatures(TrailFeatureFilterSijko.enabledFeatures(network, layers), now).appliedClosures)
        }
        if (route.totalDistanceMeters <= 0.01 || route.segments.none { it.isRouted && it.points.size >= 2 }) return noRoute(emptyList())
        return describe(route, now)
    }

    private fun describe(route: TrailRoute, now: Long): JsonObject {
        validateRoute(route)
        val derived = derivedClosureLegs(route)
        val advisories = TrailRouteAdvisorySijko.forRoute(route, now, derived)
        val blocking = TrailRouteClosureGateSijko.blockingAdvisories(route, now, derived)
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
        // Ridden progress is what a rejoin and a carried ride are measured from, exactly as in native: a position an
        // off-route fix projects onto never counts. The first evaluation of a ride starts from the saved progress.
        val hasState = request["state"]?.takeIf { it != JsonNull } != null
        // With no state yet (a new or restored ride) it starts from the caller's saved ridden progress, else the progress.
        val savedRidden = request["ridden"]?.jsonPrimitive?.doubleOrNull?.takeIf { it.isFinite() && it >= 0.0 }
        val previousRidden = TrailRouteRiddenProgress(if (hasState) state.ridden else savedRidden ?: progress, state.pendingJump)
        val riddenNow = if (credible && !resuming && !ambiguous) TrailRouteRiddenProgressSijko.next(previousRidden, snapshot) else previousRidden
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
            ridden = riddenNow.riddenMeters, pendingJump = riddenNow.pendingJumpMeters,
        )
        val arrived = credible && !resuming && !ambiguous && if (route.kind == TrailRouteKind.ExerciseLoop) {
            ExerciseRouteCompletionSijko.shouldComplete(route, snapshot, departed, false, verified)
        } else snapshot.remainingDistanceMeters <= 25.0 && snapshot.distanceFromRouteMeters <= 35.0
        return buildJsonObject {
            put("progress", if (credible && !ambiguous) snapshot.distanceAlongRouteMeters else progress)
            put("ridden", riddenNow.riddenMeters)
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
        return when (val result = TrailRouteClosureGateSijko.recalculate(requireNetwork(), route, access, completedSessions(request), nowEpochMillis = now, derived = derivedClosureLegs(route))) {
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

    private class ParsedAccessFeature(val feature: AccessNetworkFeature, val local: Boolean, val ord: Int?) {
        override fun equals(other: Any?) = other is ParsedAccessFeature && feature == other.feature && local == other.local && ord == other.ord
        override fun hashCode() = (feature.hashCode() * 31 + local.hashCode()) * 31 + (ord ?: -1)
    }

    /** Other roads first in arrival order, then endpoint-local roads in their original extract order (stable). */
    private fun inExtractOrder(list: List<AccessNetworkFeature>): List<AccessNetworkFeature> {
        val (local, other) = list.partition { it.id in endpointLocalRoadIds }
        return other + local.sortedBy { localOrdinals[it.id] ?: Int.MAX_VALUE }
    }

    /** Parses access JSON with no side effects; whether a feature is endpoint-local (service roads) travels with it. */
    private fun parseAccess(text: String): List<ParsedAccessFeature> =
        json.parseToJsonElement(text.removePrefix("﻿")).jsonObject.getValue("layers").jsonArray.flatMap { layer ->
            val local = layer.jsonObject["id"]?.jsonPrimitive?.contentOrNull == "osm-service"
            layer.jsonObject.getValue("features").jsonArray.map { value ->
                val feature = value.jsonObject
                ParsedAccessFeature(AccessNetworkFeature(
                    id = feature.string("id"), name = feature["name"]?.jsonPrimitive?.contentOrNull,
                    roadClass = feature["mtfcc"]?.jsonPrimitive?.contentOrNull,
                    paths = feature.getValue("paths").jsonArray.map { path -> path.jsonArray.map { coordinate ->
                        val pair = coordinate.jsonArray
                        MapPoint(pair[1].jsonPrimitive.double, pair[0].jsonPrimitive.double).also(::validatePoint)
                    } },
                ), local, feature["ord"]?.jsonPrimitive?.intOrNull)
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
            if (closedKey.isNotEmpty()) add(geometryIndexes.getOrPut("all|$layers") { GeometryIndex(TrailGraphBuilderSijko.buildGraph(enabled), keepGraph = true) })
        }
        // Ordinary-road access the planner spliced into the route comes from the access graph it built for the same
        // endpoints (start and destination are the route's own first and last points), so check it against that.
        val accessIndex = accessIndexFor(route)
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
            if (seen.add("geometry-checked:${edge.id}") && !edgeMatchesGraph(edge, id, indexes, accessIndex) && seen.add("geometry:$id"))
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
    private fun edgeMatchesGraph(edge: TrailGraphEdge, featureId: String, indexes: List<GeometryIndex>, accessIndex: GeometryIndex?): Boolean =
        edge.routeSegments.filter { it.isRouted && it.points.isNotEmpty() }.all { segment ->
            // A trail-typed line is trail geometry and must derive from this feature. A connector edge also carries the
            // ordinary-road access the planner spliced in front of (or behind) the trail piece: that line is road
            // geometry, so it must derive from the access roads the planner saw, never from the trail.
            indexes.any { it.derives(featureId, segment.points) } ||
                (segment.type == TrailRouteSegmentType.Access && accessIndex?.derivesFromAny(segment.points) == true)
        }

    /**
     * Where the graph this route was planned on derives geometry for a closure's source leg, with the closure's interval
     * transferred onto it: computed from the CURRENT graph (never from the saved route), so a route snapped onto a displaced
     * node anchor is judged against the interval the graph itself puts there. Empty unless the route touches a closure's feature.
     */
    private fun derivedClosureLegs(route: TrailRoute): List<TrailRouteDerivedClosureLeg> {
        if (features == null) return emptyList()
        val featureIds = TrailRouteClosureSijko.closures.filter { it.boundsProjected || it.isCrossing }.mapTo(mutableSetOf()) { it.featureId }
        if (route.edges.none { it.sourceFeatureId in featureIds }) return emptyList()
        val layers = route.routeLayers ?: RouteLayerDefaultsSijko.defaultSelection()
        val enabled = TrailFeatureFilterSijko.enabledFeatures(requireNetwork(), layers)
        return geometryIndexes.getOrPut("all|$layers") { GeometryIndex(TrailGraphBuilderSijko.buildGraph(enabled), keepGraph = true) }.derivedClosureLegs
    }

    /** The planner's access graph for this route's endpoints, as geometry references; null when no access data is loaded. */
    private fun accessIndexFor(route: TrailRoute): GeometryIndex? {
        if (roads == null) return null
        val points = route.segments.firstOrNull()?.points?.firstOrNull() to route.segments.lastOrNull()?.points?.lastOrNull()
        val first = points.first ?: return null
        val last = points.second ?: return null
        val key = "access|$accessEpoch|${first.latitude},${first.longitude}|${last.latitude},${last.longitude}"
        return geometryIndexes.getOrPut(key) { GeometryIndex(accessGraph(listOf(first, last)) ?: return null) }
    }

    /** The polylines the planner's graph derives from each feature: raw runs, connectors, and their node-anchored forms. */
    private class GeometryIndex(graph: TrailGraph, keepGraph: Boolean = false) {
        private val kept = if (keepGraph) graph else null

        /** Where this graph's derived geometry stands for a closure's source leg (computed once, on first use; needs [keepGraph]). */
        val derivedClosureLegs: List<TrailRouteDerivedClosureLeg> by lazy {
            kept?.let(TrailRouteClosureDerivationSijko::legsFor) ?: emptyList()
        }

        private class Reference(val points: List<MapPoint>) {
            val south = points.minOf { it.latitude }
            val north = points.maxOf { it.latitude }
            val west = points.minOf { it.longitude }
            val east = points.maxOf { it.longitude }
        }

        private val byFeature = HashMap<String, MutableList<Reference>>()
        private val all = mutableListOf<Reference>()

        init {
            val nodes = graph.nodes.associateBy { it.id }
            for (edge in graph.edges) {
                val id = edge.sourceFeatureId ?: continue
                val raw = edge.routeSegments.flatMap { it.points }
                if (raw.isEmpty()) continue
                val references = byFeature.getOrPut(id) { mutableListOf() }
                references += Reference(raw)
                all += references.last()
                val from = nodes[edge.fromNodeId]
                val to = nodes[edge.toNodeId]
                if (from != null && to != null && raw.size >= 2) {
                    references += Reference(listOf(from.point) + raw.drop(1).dropLast(1) + to.point)
                    all += references.last()
                }
            }
        }

        /**
         * True when the whole drawn line lies along one of the feature's derived polylines. Checked continuously, not by
         * sampling: a straight leg lies within tolerance of a reference segment everywhere exactly when both of its ends
         * do (distance to a segment is convex), so each leg must be covered by a single reference segment. A leg that
         * spans a bend of the reference, however short, is not, and a line whose vertices differ from the derived ones
         * is conservatively treated as changed (recalculating always works).
         */
        fun derives(featureId: String, line: List<MapPoint>): Boolean = derivesFrom(byFeature[featureId] ?: return false, line)

        /**
         * Access roads are anonymous in a connector line, and the planner's route line runs across several graph edges.
         * So each leg is checked on its own, and every leg must lie along ONE reference segment of the access graph
         * the planner built: a road segment, an intersection connector the graph derived (node to road, including the
         * short hop the graph itself adds between roads within its snap tolerance), or a node-anchored form of a run.
         * There is no blanket tolerance: a hop between two roads that the graph does not connect has no reference
         * segment, so an invented bridge, however short, is not accepted. A road that moved or vanished fails likewise.
         */
        fun derivesFromAny(line: List<MapPoint>): Boolean {
            if (line.size == 1) return all.any { near(line[0], it.points) }
            return line.windowed(size = 2, step = 1).all { (a, b) -> derivesFrom(all, listOf(a, b)) }
        }

        private fun derivesFrom(references: List<Reference>, line: List<MapPoint>): Boolean {
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
            if (closure.boundsProjected) {
                // Bounds inside a source leg: draw the section between them on the unchanged source line.
                TrailRouteClosureSijko.closedSection(path, closure)
            } else {
                val first = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedFrom) <= 1.0 }
                val last = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedTo) <= 1.0 }
                if (first >= 0 && last >= 0 && first != last) path.subList(minOf(first, last), maxOf(first, last) + 1) else null
            }
        } ?: emptyList()
        put("points", json.encodeToJsonElement(points))
        // An estimate and an approximation label are information for the rider; neither lifts the closure.
        put("estimatedEnd", closure.estimatedEndEpochMillis?.let { JsonPrimitive(it) } ?: JsonNull)
        put("activeFrom", closure.activeFromEpochMillis)
        put("mappingNote", closure.mappingNote)
        // A crossing-only closure has a known place but no interval: nothing is drawn as a section and none is assumed.
        put("crossing", closure.isCrossing)
        put("checkedOn", closure.checkedOn)
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
    /** How far along the route the rider has credibly ridden (native's TrailRouteRiddenProgressSijko): on-route, forward, no unconfirmed jumps. */
    val ridden: Double = 0.0,
    val pendingJump: Double? = null,
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
/** Native keeps the newest 100 completed sessions (CompletedExerciseSessionHistorySijko.MAX_SESSION_COUNT). */
private const val MAX_COMPLETED_SESSIONS = 100
private const val REVALIDATION_CACHE_LIMIT = 64
