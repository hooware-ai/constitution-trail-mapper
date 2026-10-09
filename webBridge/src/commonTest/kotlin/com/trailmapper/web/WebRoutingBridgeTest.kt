package com.trailmapper.web

import com.trailmapper.shared.routing.*
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlinx.serialization.json.*
import kotlin.test.*

class WebRoutingBridgeTest {
    private val now = 1_790_600_000_000L
    private val start = MapPoint(40.4, -89.0)
    private val finish = MapPoint(40.42, -88.98)
    private val fixture = """{"layers":[{"features":[{"id":"test:1","name":"Test Trail","status":"Existing","routeRoles":["TrailBranches"],"facilityType":"Off-Road Trail","paths":[[[-89.0,40.4],[-89.0,40.42],[-88.98,40.42]]]}]}]}"""

    @Test fun nearbyMapTapSelectsNativeProjectedGeometryWithExplicitReceipt() {
        val tap = MapPoint(40.41, -89.0001)
        val result = mapPoint(loaded(), tap)
        val graph = TrailGraphBuilderSijko.buildGraph(NormalizedTrailNetworkJsonSijko.features(fixture))
        val expected = assertNotNull(NearestTrailSnapSijko.nearestSnap(graph, tap))
        assertTrue(result["snapped"]!!.jsonPrimitive.boolean)
        assertEquals(Json.encodeToJsonElement(expected.projectedPoint), result["point"])
        assertEquals(expected.accessDistanceMeters, result["snapDistance"]!!.jsonPrimitive.double)
        assertEquals("Test Trail", result["label"]!!.jsonPrimitive.content)
        assertTrue(result["receipt"]!!.jsonPrimitive.content.contains("access to that point is not included"))
    }

    @Test fun distantMapTapKeepsTheOriginalCoordinate() {
        val tap = MapPoint(40.41, -89.001)
        val result = mapPoint(loaded(), tap)
        assertFalse(result["snapped"]!!.jsonPrimitive.boolean)
        assertEquals(Json.encodeToJsonElement(tap), result["point"])
        assertEquals("Map point", result["label"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, result["receipt"])
    }

    @Test fun mapTapNeverSelectsProposedGeometryWithoutOptIn() {
        val bridge = loaded(fixture.replace("Existing", "Proposed").replace("TrailBranches", "ProposedTrails"))
        val tap = MapPoint(40.41, -89.0001)
        val defaults = mapPoint(bridge, tap)
        assertFalse(defaults["snapped"]!!.jsonPrimitive.boolean)
        assertEquals(Json.encodeToJsonElement(tap), defaults["point"])
        assertTrue(mapPoint(bridge, tap, proposed = true)["snapped"]!!.jsonPrimitive.boolean)
    }

    @Test fun mapTapSelectsOnlyCurrentlyOpenGeometry() {
        val source = """{"layers":[{"features":[{"id":"54:1305","name":"Closure fixture","status":"Existing","routeRoles":["TrailBranches"],"paths":[[[-88.984202,40.503656],[-88.984202,40.507656],[-88.984155,40.509023],[-88.984155,40.513023]]]}]}]}"""
        val bridge = loaded(source)
        val tap = MapPoint(40.5083, -88.98418)
        val activeFrom = TrailRouteClosureSijko.uptownUnderpass.activeFromEpochMillis
        assertTrue(mapPoint(bridge, tap, at = activeFrom - 1)["snapped"]!!.jsonPrimitive.boolean)
        val afterClosure = mapPoint(bridge, tap, at = activeFrom)
        assertFalse(afterClosure["snapped"]!!.jsonPrimitive.boolean)
        assertEquals(Json.encodeToJsonElement(tap), afterClosure["point"])
    }

    @Test fun bridgeRouteMatchesSharedCoreExactlyAndReopens() {
        val bridge = loaded()
        val result = plan(bridge)
        assertTrue(result["canNavigate"]!!.jsonPrimitive.boolean)
        val route = Json.decodeFromJsonElement<TrailRoute>(result.getValue("route"))
        val expected = assertNotNull(TrailRouteCalculationSijko.findRoute(
            NormalizedTrailNetworkJsonSijko.features(fixture), RouteLayerDefaultsSijko.defaultSelection(),
            start, finish, null, nowEpochMillis = now,
        ))
        assertEquals(expected, route)
        assertEquals(JsonArray(emptyList()), result["accessGaps"])
        assertTrue(result["instructions"]!!.jsonArray.size >= 2)
        val reopened = call(bridge, buildJsonObject { put("op", "inspect"); put("route", result.getValue("route")); put("now", now) })
        assertEquals(result, reopened)
    }

    @Test fun proposedInfrastructureRequiresOptIn() {
        val proposed = fixture.replace("Existing", "Proposed").replace("TrailBranches", "ProposedTrails")
        val bridge = loaded(proposed)
        assertEquals(JsonNull, plan(bridge)["route"])
        val optedIn = plan(bridge, proposed = true)
        assertNotEquals(JsonNull, optedIn["route"])
        assertFalse(optedIn["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(optedIn["warnings"]!!.jsonArray.any { "proposed" in it.jsonPrimitive.content })
        val proposedWithBranchRole = loaded(fixture.replace("Existing", "Proposed"))
        val statusOnly = plan(proposedWithBranchRole, proposed = true)
        assertFalse(statusOnly["canNavigate"]!!.jsonPrimitive.boolean)
        // The route-level flag survives even though no segment carries the ProposedTrails role.
        assertTrue(statusOnly["proposed"]!!.jsonPrimitive.boolean)
        assertEquals(now, statusOnly["evaluatedAt"]!!.jsonPrimitive.long)
        assertFalse(plan(loaded())["proposed"]!!.jsonPrimitive.boolean)
    }

    @Test fun estimatedAccessCanBePreviewedButCannotStartNavigation() {
        val bridge = loaded()
        val result = plan(bridge, from = MapPoint(40.4, -89.001))
        assertNotEquals(JsonNull, result["route"])
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(result["segments"]!!.jsonArray.all { it.jsonObject["isRouted"]!!.jsonPrimitive.boolean })
        val raw = Json.decodeFromJsonElement<TrailRoute>(result.getValue("route"))
        assertTrue(raw.segments.any { !it.isRouted })
        assertTrue(result["accessGaps"]!!.jsonArray.isNotEmpty())
        assertTrue(result["warnings"]!!.jsonArray.none { "unmapped ground" in it.jsonPrimitive.content })
        assertTrue(result["segments"]!!.jsonArray.none { segment ->
            segment.jsonObject["points"]!!.jsonArray.any { it.jsonObject["longitude"]!!.jsonPrimitive.double == -89.001 }
        })
        val snapshot = call(bridge, buildJsonObject {
            put("op", "snapshot"); put("route", result.getValue("route")); put("point", Json.encodeToJsonElement(start)); put("now", now)
        })
        assertFalse(snapshot["ok"]!!.jsonPrimitive.boolean)
    }

    @Test fun estimatedGapCannotBeBridgedByDrawableMergeTolerance() {
        val beforeGap = MapPoint(40.4, -88.999)
        val afterGap = MapPoint(40.4, -88.9988)
        val end = MapPoint(40.4, -88.9978)
        val firstTrail = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(start, beforeGap), name = "Same trail")
        val lastTrail = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(afterGap, end), name = "Same trail")
        val gapMeters = TrailDistanceSijko.metersBetween(beforeGap, afterGap)
        assertTrue(gapMeters in 1.0..35.0)
        val route = TrailRoute(
            segments = listOf(firstTrail, TrailRouteSegment(TrailRouteSegmentType.Access, listOf(beforeGap, afterGap), isRouted = false), lastTrail),
            totalDistanceMeters = TrailDistanceSijko.metersBetween(start, end),
            ordinaryAccessDistanceMeters = gapMeters,
            totalCost = 1.0,
        )
        val result = call(loaded(), buildJsonObject {
            put("op", "inspect"); put("route", Json.encodeToJsonElement(route)); put("now", now)
        })
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        val drawable = result["segments"]!!.jsonArray
        assertEquals(2, drawable.size)
        assertEquals(Json.encodeToJsonElement(firstTrail.points), drawable[0].jsonObject["points"])
        assertEquals(Json.encodeToJsonElement(lastTrail.points), drawable[1].jsonObject["points"])
        assertTrue(drawable.all { it.jsonObject["isRouted"]!!.jsonPrimitive.boolean })
    }

    @Test fun accessGapsDescribeOnlyEstimatedConnectionsWithExactDistancesAndLabels() {
        fun point(meters: Double) = MapPoint(0.0, meters / 6_371_008.8 * 180.0 / kotlin.math.PI)
        val points = listOf(0.0, 24.0, 124.0, 129.0, 229.0, 229.275, 329.275, 343.275).map(::point)
        val segments = points.zipWithNext().mapIndexed { index, (from, to) ->
            TrailRouteSegment(
                type = if (index == 5) TrailRouteSegmentType.Trail else TrailRouteSegmentType.Access,
                points = listOf(from, to), isRouted = index % 2 == 1,
                name = when (index) { 1 -> "Matlock Dr"; 3 -> " "; 5 -> "Test Trail"; else -> null },
            )
        }
        val route = TrailRoute(segments = segments, totalDistanceMeters = 343.275, ordinaryAccessDistanceMeters = 243.275, totalCost = 1.0)
        val result = inspect(route)
        val gaps = result["accessGaps"]!!.jsonArray.map { it.jsonObject }
        // The 0.275 m connector between two mapped segments (index 4) is a coordinate discrepancy, not a gap (see the join tests below).
        assertEquals(listOf("gap-0", "gap-2", "gap-6"), gaps.map { it["id"]!!.jsonPrimitive.content })
        assertEquals(listOf("Start connection", "Near Matlock Dr", "Destination connection"), gaps.map { it["label"]!!.jsonPrimitive.content })
        assertEquals(listOf("endpoint", "interior", "endpoint"), gaps.map { it["kind"]!!.jsonPrimitive.content })
        listOf(0 to 24.0, 2 to 5.0, 6 to 14.0).forEachIndexed { index, (segmentIndex, expected) ->
            assertEquals(expected, gaps[index]["distanceMeters"]!!.jsonPrimitive.double, 1e-8)
            assertEquals(Json.encodeToJsonElement(segments[segmentIndex].points.first()), gaps[index]["from"])
            assertEquals(Json.encodeToJsonElement(segments[segmentIndex].points.last()), gaps[index]["to"])
        }
        assertEquals(243.275, result["accessDistance"]!!.jsonPrimitive.double)
        assertEquals(43.0, gaps.sumOf { it["distanceMeters"]!!.jsonPrimitive.double }, 1e-8)
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(result["warnings"]!!.jsonArray.isEmpty())
        assertEquals(3, result["segments"]!!.jsonArray.size)
        assertEquals(result, inspect(route))
        val loopGaps = inspect(route.copy(kind = TrailRouteKind.ExerciseLoop))["accessGaps"]!!.jsonArray
        assertEquals("Return connection", loopGaps.last().jsonObject["label"]!!.jsonPrimitive.content)
    }

    @Test fun unnamedInternalAccessGapHasNeutralLocationLabel() {
        val points = listOf(start, MapPoint(40.401, -89.0), MapPoint(40.4011, -89.0), finish)
        val segments = points.zipWithNext().mapIndexed { index, (from, to) ->
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(from, to), isRouted = index != 1, name = " ")
        }
        val result = inspect(TrailRoute(segments = segments, totalDistanceMeters = 4000.0, ordinaryAccessDistanceMeters = 12.0, totalCost = 1.0))
        val gap = result["accessGaps"]!!.jsonArray.single().jsonObject
        assertEquals("Along the route", gap["label"]!!.jsonPrimitive.content)
        assertEquals("gap-1", gap["id"]!!.jsonPrimitive.content)
    }

    @Test fun accessGapMetadataUsesTheExistingNavigationLengthThreshold() {
        val trail = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(start, finish))
        for (gapMeters in listOf(0.0, 0.005, 0.015)) {
            val from = MapPoint(start.latitude - gapMeters / 6_371_008.8 * 180.0 / kotlin.math.PI, start.longitude)
            val route = TrailRoute(
                segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Access, listOf(from, start), isRouted = false), trail),
                totalDistanceMeters = 3000.0, ordinaryAccessDistanceMeters = gapMeters, totalCost = 1.0,
            )
            val result = inspect(route)
            assertEquals(gapMeters > 0.01, result["accessGaps"]!!.jsonArray.isNotEmpty())
            assertEquals(gapMeters <= 0.01, result["canNavigate"]!!.jsonPrimitive.boolean)
            assertEquals(listOf(Json.encodeToJsonElement(trail.points)), result["segments"]!!.jsonArray.map { it.jsonObject["points"] })
        }
    }

    @Test fun accessGapDistanceFollowsEveryVertexWhileMetadataKeepsOnlyEndpoints() {
        val bend = MapPoint(40.401, -89.001)
        val connection = MapPoint(40.4, -88.999)
        val gap = TrailRouteSegment(TrailRouteSegmentType.Access, listOf(start, bend, connection), isRouted = false)
        val route = TrailRoute(
            segments = listOf(gap, TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(connection, finish))),
            totalDistanceMeters = 4000.0, ordinaryAccessDistanceMeters = 400.0, totalCost = 1.0,
        )
        val described = inspect(route)["accessGaps"]!!.jsonArray.single().jsonObject
        val expected = TrailDistanceSijko.metersBetween(start, bend) + TrailDistanceSijko.metersBetween(bend, connection)
        assertEquals(expected, described["distanceMeters"]!!.jsonPrimitive.double)
        assertTrue(expected > TrailDistanceSijko.metersBetween(start, connection))
        assertEquals(Json.encodeToJsonElement(start), described["from"])
        assertEquals(Json.encodeToJsonElement(connection), described["to"])
        assertEquals(setOf("id", "kind", "distanceMeters", "from", "to", "label"), described.keys)
    }

    @Test fun savedRouteIsBlockedWhenOfficialClosureBecomesActive() {
        val closure = TrailRouteClosureSijko.uptownUnderpass
        val source = """{"layers":[{"features":[{"id":"54:1305","name":"Test closure fixture","status":"Existing","routeRoles":["TrailBranches"],"paths":[[[-88.984202,40.503656],[-88.984202,40.507656],[-88.984155,40.509023],[-88.984155,40.513023]]]}]}]}"""
        val bridge = loaded(source)
        val before = plan(bridge, from = MapPoint(40.503656, -88.984202), to = MapPoint(40.513023, -88.984155), at = closure.activeFromEpochMillis - 1)
        assertTrue(before["canNavigate"]!!.jsonPrimitive.boolean)
        val reopened = call(bridge, buildJsonObject { put("op", "inspect"); put("route", before.getValue("route")); put("now", closure.activeFromEpochMillis) })
        assertFalse(reopened["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(reopened["closures"]!!.jsonArray.isNotEmpty())
        val after = plan(bridge, from = MapPoint(40.503656, -88.984202), to = MapPoint(40.513023, -88.984155), at = closure.activeFromEpochMillis)
        assertEquals(JsonNull, after["route"])
    }

    // The ACTUAL source leg 97 to 98 of county trail 54:1305 (790 m): two unchanged source vertices, nothing inserted.
    private val willowSource = """{"layers":[{"features":[{"id":"54:1305","name":"Willow leg (actual source vertices)","status":"Existing","routeRoles":["TrailBranches"],"paths":[[[-88.9843690241,40.5096012799],[-88.9849653323,40.5166840740]]]}]}]}"""
    private val willowSouth = MapPoint(40.5096012799, -88.9843690241)
    private val willowNorth = MapPoint(40.5166840740, -88.9849653323)

    @Test fun willowClosureGatesSavedStartNewPlansAndRecalculationAtItsInstantInsideTheRawLeg() {
        val closure = TrailRouteClosureSijko.willowTrailCrossing
        val activeFrom = closure.activeFromEpochMillis
        val bridge = loaded(willowSource)
        val before = plan(bridge, from = willowSouth, to = willowNorth, at = activeFrom - 1)
        assertTrue(before["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(before["closures"]!!.jsonArray.isEmpty())
        // Scheduled, not claimed as a closure: a warning says so, and nothing blocks.
        assertTrue(before["warnings"]!!.jsonArray.any { it.jsonPrimitive.content.contains("Scheduled, not closed yet") })
        val saved = before.getValue("route")
        val atStart = call(bridge, buildJsonObject { put("op", "inspect"); put("route", saved); put("now", activeFrom) })
        assertFalse(atStart["canNavigate"]!!.jsonPrimitive.boolean)
        assertEquals(closure.id, atStart["closures"]!!.jsonArray.single().jsonObject["id"]!!.jsonPrimitive.content)
        // Start itself (the snapshot op) refuses the gated route, even with the rider exactly on it.
        val refused = call(bridge, buildJsonObject {
            put("op", "snapshot"); put("route", saved); put("point", Json.encodeToJsonElement(willowSouth))
            put("accuracy", 5.0); put("timestamp", activeFrom); put("now", activeFrom)
        })
        assertFalse(refused["ok"]!!.jsonPrimitive.boolean)
        assertTrue(refused["error"]!!.jsonPrimitive.content.contains("cannot start navigation"))
        // A new plan across the leg finds no route, and the guidance carries the closure and its approximation label.
        val none = plan(bridge, from = willowSouth, to = willowNorth, at = activeFrom)
        assertEquals(JsonNull, none["route"])
        val shown = none["closures"]!!.jsonArray.single().jsonObject
        assertEquals(closure.id, shown["id"]!!.jsonPrimitive.content)
        assertTrue(shown["mappingNote"]!!.jsonPrimitive.content.startsWith("Approximate"))
        assertEquals(closure.estimatedEndEpochMillis, shown["estimatedEnd"]!!.jsonPrimitive.long)
        // Recalculating the earlier route gives the closure's detour guidance, not a replacement through it.
        val recalculated = call(bridge, buildJsonObject { put("op", "recalculate"); put("route", saved); put("now", activeFrom) })
        assertEquals(JsonNull, recalculated["route"])
        // Both residual portions stay usable: each side of the section can still be planned, and neither is gated.
        val southern = plan(bridge, from = willowSouth, to = closure.closedFrom, at = activeFrom)
        val northern = plan(bridge, from = closure.closedTo, to = willowNorth, at = activeFrom)
        listOf(southern, northern).forEach { result ->
            assertTrue(result["canNavigate"]!!.jsonPrimitive.boolean)
            assertTrue(result["closures"]!!.jsonArray.isEmpty())
        }
        // After the estimated end nothing reopens by the date alone.
        val estimate = closure.estimatedEndEpochMillis!!
        val late = call(bridge, buildJsonObject { put("op", "inspect"); put("route", saved); put("now", estimate + 86_400_000L) })
        assertFalse(late["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(late["warnings"]!!.jsonArray.any { it.jsonPrimitive.content.contains("has passed; reopening has not been confirmed") })
    }

    @Test fun willowClosureIsDrawnFromTheUnchangedSourceLineOnlyWhileActive() {
        val closure = TrailRouteClosureSijko.willowTrailCrossing
        fun closuresAt(at: Long) = call(WebRoutingBridge(), buildJsonObject { put("op", "initialize"); put("trails", willowSource); put("now", at) })["closures"]!!.jsonArray
        assertTrue(closuresAt(closure.activeFromEpochMillis - 1).none { it.jsonObject["id"]!!.jsonPrimitive.content == closure.id })
        val drawn = closuresAt(closure.activeFromEpochMillis).single { it.jsonObject["id"]!!.jsonPrimitive.content == closure.id }.jsonObject
        val points = drawn["points"]!!.jsonArray
        assertEquals(2, points.size)
        assertEquals(Json.encodeToJsonElement(closure.closedFrom), points[0])
        assertEquals(Json.encodeToJsonElement(closure.closedTo), points[1])
    }

    @Test fun guideListsTheScheduledNoticesAndSwitchesStatusAtTheirInstants() {
        fun status(id: String, at: Long) = call(WebRoutingBridge(), buildJsonObject { put("op", "initialize"); put("trails", fixture); put("now", at) })["updates"]!!
            .jsonArray.single { it.jsonObject["id"]!!.jsonPrimitive.content == id }.jsonObject["status"]!!.jsonPrimitive.content
        val willow = TrailRouteClosureSijko.willowTrailCrossing
        assertTrue(status("willow-trail-closure", willow.activeFromEpochMillis - 1).startsWith("Scheduled"))
        assertTrue(status("willow-trail-closure", willow.activeFromEpochMillis).startsWith("Closed since October 5"))
        assertEquals("Recheck needed", status("willow-trail-closure", willow.estimatedEndEpochMillis!! + 1))
        assertTrue(status("camelback-trail-closure", 1_791_205_200_000L - 1).startsWith("Scheduled"))
        assertTrue(status("camelback-trail-closure", 1_791_205_200_000L).startsWith("Closed at Virginia Avenue since October 5"))
        assertEquals("Recheck needed", status("camelback-trail-closure", 1_791_324_000_001L))
        assertTrue(status("trail-paving-raab", 1_791_025_200_000L - 1).startsWith("Scheduled"))
        assertTrue(status("trail-paving-raab", 1_791_025_200_000L).startsWith("Paving reported"))
        assertEquals("Recheck needed", status("hamilton-rhodes", 1_793_487_600_001L))
    }

    @Test fun poorGpsCannotAdvanceProgressOrConfirmDeparture() {
        val bridge = loaded()
        val route = plan(bridge).getValue("route")
        val result = call(bridge, buildJsonObject {
            put("op", "snapshot"); put("route", route); put("point", Json.encodeToJsonElement(finish))
            put("progress", 100.0); put("accuracy", 500.0); put("timestamp", now); put("now", now)
        })
        assertEquals(100.0, result["progress"]!!.jsonPrimitive.double)
        assertFalse(result["arrived"]!!.jsonPrimitive.boolean)
        assertFalse(result["offRoute"]!!.jsonPrimitive.boolean)
        assertEquals("UncertainPosition", result["deviationStatus"]!!.jsonPrimitive.content)
    }

    @Test fun resumeReacquiresWithoutCreditingUnseenTravelOrArriving() {
        val bridge = loaded()
        val route = plan(bridge).getValue("route")
        val result = call(bridge, buildJsonObject {
            put("op", "snapshot"); put("route", route); put("point", Json.encodeToJsonElement(finish))
            put("progress", 100.0); put("accuracy", 5.0); put("timestamp", now); put("now", now); put("resume", true)
            put("state", buildJsonObject { put("maximumProgress", 100.0); put("verifiedProgress", 75.0) })
        })
        assertTrue(result["credible"]!!.jsonPrimitive.boolean)
        assertFalse(result["arrived"]!!.jsonPrimitive.boolean)
        val state = result["state"]!!.jsonObject
        assertEquals(75.0, state["verifiedProgress"]!!.jsonPrimitive.double)
        assertTrue(state["maximumProgress"]!!.jsonPrimitive.double > 100.0)
    }

    @Test fun exercisePlanAndReturnUseSharedLoopSemantics() {
        val bridge = loaded()
        val loop = call(bridge, buildJsonObject {
            put("op", "plan"); put("start", Json.encodeToJsonElement(start)); put("miles", 3.0); put("now", now)
        })
        assertEquals("ExerciseLoop", loop["kind"]!!.jsonPrimitive.content)
        val route = loop.getValue("route")
        val point = MapPoint(40.402, -89.0)
        val returned = call(bridge, buildJsonObject {
            put("op", "reroute"); put("route", route); put("point", Json.encodeToJsonElement(point)); put("mode", "return"); put("now", now)
        })
        assertEquals("Navigation", returned["kind"]!!.jsonPrimitive.content)
        val forbidden = call(bridge, buildJsonObject {
            put("op", "reroute"); put("route", route); put("point", Json.encodeToJsonElement(point)); put("mode", "destination"); put("now", now)
        })
        assertFalse(forbidden["ok"]!!.jsonPrimitive.boolean)
    }

    @Test fun emptyExerciseGeometryIsNotReportedAsAFoundRide() {
        val bridge = loaded()
        val result = call(bridge, buildJsonObject {
            put("op", "plan"); put("start", Json.encodeToJsonElement(start)); put("miles", 1.0); put("now", now)
        })
        assertEquals(JsonNull, result["route"])
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
    }

    @Test fun closestExerciseResultExplainsTargetAndRetracing() {
        val bridge = loaded()
        val result = call(bridge, buildJsonObject {
            put("op", "plan"); put("start", Json.encodeToJsonElement(start)); put("miles", 10.0); put("now", now)
        })
        assertFalse(result["targetMatched"]!!.jsonPrimitive.boolean)
        assertTrue(result["retracedDistance"]!!.jsonPrimitive.double > 0.0)
        assertTrue(result["warnings"]!!.jsonArray.any { "target" in it.jsonPrimitive.content })
    }

    @Test fun failedDatasetReplacementClearsOldNetwork() {
        val bridge = loaded()
        val failed = call(bridge, buildJsonObject { put("op", "initialize"); put("trails", "{}"); put("now", now) })
        assertFalse(failed["ok"]!!.jsonPrimitive.boolean)
        assertFalse(plan(bridge)["ok"]!!.jsonPrimitive.boolean)
    }

    @Test fun routeToDestinationRerouteUsesSharedRules() {
        val bridge = loaded()
        val previous = plan(bridge).getValue("route")
        val point = MapPoint(40.41, -89.0)
        val result = call(bridge, buildJsonObject {
            put("op", "reroute"); put("route", previous); put("point", Json.encodeToJsonElement(point)); put("mode", "destination"); put("now", now)
        })
        assertTrue(result["canNavigate"]!!.jsonPrimitive.boolean)
        val actual = Json.decodeFromJsonElement<TrailRoute>(result.getValue("route"))
        val oldRoute = Json.decodeFromJsonElement<TrailRoute>(previous)
        val expected = TrailRouteRerouteSijko.pointToPoint(NormalizedTrailNetworkJsonSijko.features(fixture), oldRoute, point, null, nowEpochMillis = now)
        assertEquals(assertIs<TrailRouteRerouteOutcome.Replacement>(expected).route, actual)
    }

    // ~1 degree of latitude is 111 km; these helpers build small synthetic loops around the origin.
    private fun metersNorth(meters: Double) = meters / 6_371_008.8 * 180.0 / kotlin.math.PI
    private fun at(eastMeters: Double, northMeters: Double) = MapPoint(metersNorth(northMeters), metersNorth(eastMeters))

    /** 2 km out and the same 2 km back: every point of the outbound pass is repeated on the return pass. */
    private fun outAndBackLoop(): TrailRoute {
        val out = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(at(0.0, 0.0), at(0.0, 1000.0), at(0.0, 2000.0)))
        val back = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(at(0.0, 2000.0), at(0.0, 1000.0), at(0.0, 0.0)))
        return TrailRoute(
            segments = listOf(out, back), totalDistanceMeters = 4000.0, ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1.0, kind = TrailRouteKind.ExerciseLoop,
        )
    }

    /** A 1 km square that never repeats geometry. */
    private fun squareLoop(): TrailRoute {
        val corners = listOf(at(0.0, 0.0), at(1000.0, 0.0), at(1000.0, 1000.0), at(0.0, 1000.0), at(0.0, 0.0))
        return TrailRoute(
            segments = corners.zipWithNext().map { (from, to) -> TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(from, to)) },
            totalDistanceMeters = 4000.0, ordinaryAccessDistanceMeters = 0.0, totalCost = 1.0, kind = TrailRouteKind.ExerciseLoop,
        )
    }

    private fun snapshot(route: TrailRoute, point: MapPoint, progress: Double, resume: Boolean, state: JsonObject? = null): JsonObject =
        call(loaded(), buildJsonObject {
            put("op", "snapshot"); put("route", Json.encodeToJsonElement(route)); put("point", Json.encodeToJsonElement(point))
            put("progress", progress); put("accuracy", 5.0); put("timestamp", now); put("now", now); put("resume", resume)
            if (state != null) put("state", state)
        })

    @Test fun reacquiringOnTheReturnLegOfRepeatedGeometryKeepsTheReturnPass() {
        val loop = outAndBackLoop()
        // The rider was on the return pass (3000 m along), 1000 m north, and is reacquired at the same place.
        val result = snapshot(loop, at(0.0, 1000.0), progress = 3000.0, resume = true)
        assertEquals(3000.0, result["progress"]!!.jsonPrimitive.double, 5.0)
        assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
        assertEquals(1000.0, result["remaining"]!!.jsonPrimitive.double, 5.0)
        assertFalse(result["arrived"]!!.jsonPrimitive.boolean)
        assertEquals(3000.0, result["state"]!!.jsonObject["maximumProgress"]!!.jsonPrimitive.double, 5.0)
    }

    @Test fun reacquiringOnTheOutboundPassStillMatchesTheOutboundPass() {
        val result = snapshot(outAndBackLoop(), at(0.0, 1000.0), progress = 1000.0, resume = true)
        assertEquals(1000.0, result["progress"]!!.jsonPrimitive.double, 5.0)
        assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
    }

    @Test fun reloadWithoutSavedNavigationStateStillUsesThePersistedProgress() {
        // On a browser reload only the persisted progress is available; there is no saved maximum.
        val result = snapshot(outAndBackLoop(), at(0.0, 1500.0), progress = 2450.0, resume = true, state = null)
        assertEquals(2500.0, result["progress"]!!.jsonPrimitive.double, 5.0)
        assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
    }

    @Test fun reacquiringOnlyAtAnEarlierPointIsAmbiguousInsteadOfBeingDirectedOrCredited() {
        val state = buildJsonObject { put("maximumProgress", 3200.0); put("verifiedProgress", 3000.0) }
        val result = snapshot(squareLoop(), at(500.0, 0.0), progress = 3200.0, resume = true, state = state)
        assertTrue(result["ambiguous"]!!.jsonPrimitive.boolean)
        assertEquals(3200.0, result["progress"]!!.jsonPrimitive.double)
        assertFalse(result["arrived"]!!.jsonPrimitive.boolean)
        assertFalse(result["offRoute"]!!.jsonPrimitive.boolean)
        val next = result["state"]!!.jsonObject
        assertEquals(3200.0, next["maximumProgress"]!!.jsonPrimitive.double)
        assertEquals(3000.0, next["verifiedProgress"]!!.jsonPrimitive.double)
    }

    @Test fun movingTowardTheStartOnTheReturnPassContinuesToTheSupportedLaterOccurrence() {
        // Return pass at 3000 m (1 km north), rider then moves 500 m toward the start: 3500 m, not the outbound 500 m.
        for (state in listOf(null, buildJsonObject { put("maximumProgress", 3000.0) })) {
            val result = snapshot(outAndBackLoop(), at(0.0, 500.0), progress = 3000.0, resume = true, state = state)
            assertEquals(3500.0, result["progress"]!!.jsonPrimitive.double, 5.0)
            assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
            assertEquals(3500.0, result["state"]!!.jsonObject["maximumProgress"]!!.jsonPrimitive.double, 5.0)
        }
    }

    @Test fun aForwardGapBeyondTheContinuityWindowKeepsTheSupportedLaterOccurrence() {
        val result = snapshot(outAndBackLoop(), at(0.0, 1800.0), progress = 1200.0, resume = true)
        assertEquals(1800.0, result["progress"]!!.jsonPrimitive.double, 5.0)
        assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
    }

    @Test fun movingBackwardOnlyToAnEarlierPassIsAmbiguousWithAndWithoutSavedState() {
        // Last progress 3200 (past 1 km on the way back); the rider is now at 1 km, which only matches earlier points.
        for (state in listOf(null, buildJsonObject { put("maximumProgress", 3200.0) })) {
            val result = snapshot(outAndBackLoop(), at(0.0, 1000.0), progress = 3200.0, resume = true, state = state)
            assertTrue(result["ambiguous"]!!.jsonPrimitive.boolean)
            assertEquals(3200.0, result["progress"]!!.jsonPrimitive.double)
            assertEquals(3200.0, result["state"]!!.jsonObject["maximumProgress"]!!.jsonPrimitive.double)
            assertFalse(result["arrived"]!!.jsonPrimitive.boolean)
        }
    }

    /** Reviewer fixture: a repeated junction at (0,0) that a second loop passes 4 m away at ~1696 m along. */
    private fun repeatedJunctionLoop(): TrailRoute {
        val path = listOf(
            0.0 to -1000.0, 0.0 to 0.0, 100.0 to 0.0, 100.0 to 250.0, 4.0 to 250.0, 4.0 to 0.0,
            4.0 to 600.0, -100.0 to 600.0, -100.0 to 0.0, 0.0 to 0.0, 0.0 to -1000.0,
        ).map { (east, north) -> at(east, north) }
        return TrailRoute(
            segments = path.zipWithNext().map { (from, to) -> TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(from, to)) },
            totalDistanceMeters = 4100.0, ordinaryAccessDistanceMeters = 0.0, totalCost = 1.0, kind = TrailRouteKind.ExerciseLoop,
        )
    }

    @Test fun aRepeatedJunctionKeepsTheSupportedLaterOccurrenceWithAndWithoutSavedState() {
        for (state in listOf(null, buildJsonObject { put("maximumProgress", 1700.0) })) {
            val result = snapshot(repeatedJunctionLoop(), at(0.0, 0.0), progress = 1700.0, resume = true, state = state)
            assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
            // The rider is at the junction the completed section also passes (~1000 m) but the supported pass is ~1696 m.
            assertEquals(1696.0, result["progress"]!!.jsonPrimitive.double, 10.0)
            assertEquals(1700.0, result["state"]!!.jsonObject["maximumProgress"]!!.jsonPrimitive.double, 10.0)
            assertEquals(2404.0, result["remaining"]!!.jsonPrimitive.double, 15.0)
            assertFalse(result["arrived"]!!.jsonPrimitive.boolean)
        }
    }

    @Test fun theNextFixAtTheSamePlaceKeepsTheRecoveredTraversalAndForwardMovementContinues() {
        val loop = repeatedJunctionLoop()
        for (initial in listOf<JsonObject?>(null, buildJsonObject { put("maximumProgress", 1700.0) })) {
            val resumed = snapshot(loop, at(0.0, 0.0), progress = 1700.0, resume = true, state = initial)
            assertEquals(1696.0, resumed["progress"]!!.jsonPrimitive.double, 10.0)
            // One second later, same place, an ordinary (non-resume) fix fed with the returned state and progress.
            val same = snapshot(loop, at(0.0, 0.0), progress = resumed["progress"]!!.jsonPrimitive.double, resume = false, state = resumed["state"]!!.jsonObject)
            assertFalse(same["ambiguous"]!!.jsonPrimitive.boolean)
            assertEquals(1696.0, same["progress"]!!.jsonPrimitive.double, 10.0)
            assertEquals(1700.0, same["state"]!!.jsonObject["maximumProgress"]!!.jsonPrimitive.double, 10.0)
            assertFalse(same["arrived"]!!.jsonPrimitive.boolean)
            // Then real forward movement 100 m up the supported pass.
            val ahead = snapshot(loop, at(4.0, 100.0), progress = same["progress"]!!.jsonPrimitive.double, resume = false, state = same["state"]!!.jsonObject)
            assertEquals(1796.0, ahead["progress"]!!.jsonPrimitive.double, 10.0)
            assertFalse(ahead["ambiguous"]!!.jsonPrimitive.boolean)
        }
    }

    @Test fun smallBacktrackingOnAnOrdinaryFixNeitherJumpsToTheReturnPassNorCreditsDistance() {
        // Progress 1000 m outbound; the rider is 61 m back (939 m north) 10 s later: stay on the outbound pass.
        for (state in listOf<JsonObject?>(null, buildJsonObject { put("maximumProgress", 1000.0) })) {
            val result = snapshot(outAndBackLoop(), at(0.0, 939.0), progress = 1000.0, resume = false, state = state)
            assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
            assertEquals(939.0, result["progress"]!!.jsonPrimitive.double, 5.0)
            assertEquals(3061.0, result["remaining"]!!.jsonPrimitive.double, 10.0)
        }
        // 50 m back is unchanged.
        val fifty = snapshot(outAndBackLoop(), at(0.0, 950.0), progress = 1000.0, resume = false)
        assertEquals(950.0, fifty["progress"]!!.jsonPrimitive.double, 5.0)
    }

    @Test fun aDistantLaterPassCompetingWithNearbyEarlierGeometryOnResumeIsAmbiguous() {
        // After a gap the rider is 61 m behind on the outbound pass; the return pass 2 km ahead also matches.
        val result = snapshot(outAndBackLoop(), at(0.0, 939.0), progress = 1000.0, resume = true)
        assertTrue(result["ambiguous"]!!.jsonPrimitive.boolean)
        assertEquals(1000.0, result["progress"]!!.jsonPrimitive.double)
    }

    /** Shorter repeated junction: the completed pass is only ~196 m behind the supported one. */
    private fun shortRepeatedJunctionLoop(): TrailRoute {
        val path = listOf(
            0.0 to -1000.0, 0.0 to 0.0, 25.0 to 0.0, 25.0 to 75.0, 4.0 to 75.0, 4.0 to 0.0,
            4.0 to 600.0, -100.0 to 600.0, -100.0 to 0.0, 0.0 to 0.0, 0.0 to -1000.0,
        ).map { (east, north) -> at(east, north) }
        return TrailRoute(
            segments = path.zipWithNext().map { (from, to) -> TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(from, to)) },
            totalDistanceMeters = 3600.0, ordinaryAccessDistanceMeters = 0.0, totalCost = 1.0, kind = TrailRouteKind.ExerciseLoop,
        )
    }

    @Test fun anUnchangedLocationKeepsTheSupportedPassEvenWhenTheCompletedPassIsOnlyAShortDistanceBehind() {
        val loop = shortRepeatedJunctionLoop()
        for (initial in listOf<JsonObject?>(null, buildJsonObject { put("maximumProgress", 1200.0) })) {
            val resumed = snapshot(loop, at(0.0, 0.0), progress = 1200.0, resume = true, state = initial)
            assertEquals(1196.0, resumed["progress"]!!.jsonPrimitive.double, 10.0)
            var state = resumed["state"]!!.jsonObject
            var progress = resumed["progress"]!!.jsonPrimitive.double
            // Several identical ordinary fixes: a stationary rider never switches to the completed pass.
            repeat(3) {
                val same = snapshot(loop, at(0.0, 0.0), progress = progress, resume = false, state = state)
                assertFalse(same["ambiguous"]!!.jsonPrimitive.boolean)
                assertEquals(1196.0, same["progress"]!!.jsonPrimitive.double, 10.0)
                assertFalse(same["arrived"]!!.jsonPrimitive.boolean)
                state = same["state"]!!.jsonObject
                progress = same["progress"]!!.jsonPrimitive.double
            }
            // Real forward movement up the supported pass continues from there.
            val ahead = snapshot(loop, at(4.0, 30.0), progress = progress, resume = false, state = state)
            assertEquals(1226.0, ahead["progress"]!!.jsonPrimitive.double, 10.0)
        }
    }

    @Test fun realBackwardMovementWithKnownPreviousPositionDoesNotJumpToTheDistantPass() {
        val loop = outAndBackLoop()
        val first = snapshot(loop, at(0.0, 1000.0), progress = 1000.0, resume = true)
        val back = snapshot(loop, at(0.0, 939.0), progress = first["progress"]!!.jsonPrimitive.double, resume = false, state = first["state"]!!.jsonObject)
        assertFalse(back["ambiguous"]!!.jsonPrimitive.boolean)
        assertEquals(939.0, back["progress"]!!.jsonPrimitive.double, 5.0)
        // A teleport to a place the rider cannot have reached, that only matches a far pass, is not guessed.
        val teleport = snapshot(loop, at(0.0, 1800.0), progress = back["progress"]!!.jsonPrimitive.double, resume = false, state = back["state"]!!.jsonObject)
        assertTrue(teleport["ambiguous"]!!.jsonPrimitive.boolean || kotlin.math.abs(teleport["progress"]!!.jsonPrimitive.double - 939.0) < 900.0)
    }

    /** A 1 km square ridden north first: (0,0) -> (0,1000) -> (1000,1000) -> (1000,0) -> (0,0). */
    private fun northFirstSquare(): TrailRoute {
        val corners = listOf(at(0.0, 0.0), at(0.0, 1000.0), at(1000.0, 1000.0), at(1000.0, 0.0), at(0.0, 0.0))
        return TrailRoute(
            segments = corners.zipWithNext().map { (from, to) -> TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(from, to)) },
            totalDistanceMeters = 4000.0, ordinaryAccessDistanceMeters = 0.0, totalCost = 1.0, kind = TrailRouteKind.ExerciseLoop,
        )
    }

    @Test fun ordinaryRidingAroundACornerAdvancesWithTheExactPositionNotTheOldVertex() {
        val square = northFirstSquare()
        val first = snapshot(square, at(0.0, 1000.0), progress = 1000.0, resume = true)
        var state = first["state"]!!.jsonObject
        var progress = first["progress"]!!.jsonPrimitive.double
        for (east in listOf(20.0, 40.0, 60.0)) {
            val result = snapshot(square, at(east, 1000.0), progress = progress, resume = false, state = state)
            assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
            assertEquals(1000.0 + east, result["progress"]!!.jsonPrimitive.double, 5.0)
            assertTrue(result["distanceFromRoute"]!!.jsonPrimitive.double < 5.0)
            state = result["state"]!!.jsonObject
            progress = result["progress"]!!.jsonPrimitive.double
        }
    }

    @Test fun anOrdinaryLoopFixAfterReacquisitionDoesNotBecomeAmbiguous() {
        val result = snapshot(squareLoop(), at(1000.0, 500.0), progress = 1400.0, resume = true)
        assertFalse(result["ambiguous"]!!.jsonPrimitive.boolean)
        assertEquals(1500.0, result["progress"]!!.jsonPrimitive.double, 5.0)
    }

    private fun savedRouteFrom(bridge: WebRoutingBridge): JsonElement = plan(bridge).getValue("route")
    private fun inspectSaved(bridge: WebRoutingBridge, route: JsonElement): JsonObject =
        call(bridge, buildJsonObject { put("op", "inspect"); put("route", route); put("now", now) })
    private fun networkIssueCodes(result: JsonObject): List<String> =
        result["network"]!!.jsonObject["issues"]!!.jsonArray.map { it.jsonObject["code"]!!.jsonPrimitive.content }

    @Test fun aSavedRouteIsCurrentWhileTheNetworkIsUnchanged() {
        val bridge = loaded(trust = false)
        val saved = savedRouteFrom(bridge)
        val result = inspectSaved(bridge, saved)
        assertEquals("current", result["network"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertTrue(result["network"]!!.jsonObject["checkedEdges"]!!.jsonPrimitive.int > 0)
        assertTrue(result["canNavigate"]!!.jsonPrimitive.boolean)
    }

    @Test fun existingToProposedInvalidatesNavigationEvenThoughTheSerializedRouteSaysExisting() {
        val saved = savedRouteFrom(loaded(trust = false))
        // Same identifier and geometry, now Proposed: the serialized edges still say Existing.
        val reloaded = loaded(fixture.replace("Existing", "Proposed"), trust = false)
        val result = inspectSaved(reloaded, saved)
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertEquals("stale", result["network"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertTrue("status-changed" in networkIssueCodes(result))
        assertTrue(result["warnings"]!!.jsonArray.any { "no longer matches the current trail data" in it.jsonPrimitive.content })
        // The route is preserved for review: its geometry is still returned.
        assertTrue(result["segments"]!!.jsonArray.isNotEmpty())
    }

    @Test fun aRemovedFeatureInvalidatesTheSavedRoute() {
        val saved = savedRouteFrom(loaded(trust = false))
        val result = inspectSaved(loaded(fixture.replace("test:1", "test:2"), trust = false), saved)
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertEquals(listOf("removed"), networkIssueCodes(result))
    }

    @Test fun changedGeometryInvalidatesTheSavedRoute() {
        val saved = savedRouteFrom(loaded(trust = false))
        val result = inspectSaved(loaded(fixture.replace("[-89.0,40.42]", "[-89.01,40.42]"), trust = false), saved)
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue("geometry-changed" in networkIssueCodes(result))
    }

    @Test fun aFeatureNoLongerEligibleForTheRoutesChoicesInvalidatesIt() {
        val saved = savedRouteFrom(loaded(trust = false))
        // The trail keeps its id and geometry but is no longer a branch/connector/roadway role the route may use.
        val result = inspectSaved(loaded(fixture.replace("TrailBranches", "ProposedTrails"), trust = false), saved)
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue("not-eligible" in networkIssueCodes(result))
    }

    private fun branch(id: String, vararg path: String) =
        """{"id":"$id","name":"$id","status":"Existing","routeRoles":["TrailBranches"],"facilityType":"Off-Road Trail","paths":[[${path.joinToString(",")}]]}"""
    private fun network(vararg features: String) = """{"layers":[{"features":[${features.joinToString(",")}]}]}"""
    private fun status(result: JsonObject) = result["network"]!!.jsonObject["status"]!!.jsonPrimitive.content

    @Test fun aRouteThatOnlyResemblesAnEarlierOneNeverBorrowsItsVerdict() {
        // Same feature id, edge count and vertex count; only the middle vertex differs between the two networks.
        val before = network(branch("test:1", "[-89.0,40.4]", "[-89.01,40.42]", "[-88.98,40.42]"))
        val after = network(branch("test:1", "[-89.0,40.4]", "[-89.005,40.42]", "[-88.98,40.42]"))
        val old = savedRouteFrom(loaded(before, trust = false))
        val bridge = loaded(after, trust = false)
        assertEquals("stale", status(inspectSaved(bridge, old)))
        // Planning the current route warms whatever the check remembers; the old route must stay stale afterwards.
        val current = savedRouteFrom(bridge)
        assertEquals("current", status(inspectSaved(bridge, current)))
        val again = inspectSaved(bridge, old)
        assertEquals("stale", status(again))
        assertFalse(again["canNavigate"]!!.jsonPrimitive.boolean)
        // And the other order: a stale verdict must not block the route that is valid now.
        val reversed = loaded(after, trust = false)
        assertEquals("stale", status(inspectSaved(reversed, old)))
        assertEquals("current", status(inspectSaved(reversed, savedRouteFrom(reversed))))
    }

    private val connectorMain = branch("main:1", "[-89.0,40.4]", "[-89.0,40.42]")
    private val connectorSpur = branch("spur:1", "[-89.01,40.41]", "[-89.00003,40.41]")
    private fun connectorRoute(bridge: WebRoutingBridge) =
        plan(bridge, from = MapPoint(40.41, -89.01), to = MapPoint(40.42, -89.0)).getValue("route")

    @Test fun aConnectorIsCheckedAlongItsTrailAndOnlyTheJunctionHopIsExempt() {
        val original = loaded(network(connectorMain, connectorSpur), trust = false)
        val saved = connectorRoute(original)
        val unchanged = inspectSaved(original, saved)
        assertEquals("current", status(unchanged))
        assertTrue(unchanged["canNavigate"]!!.jsonPrimitive.boolean)
        // The main trail's top moves ~400 m east: the ~1.1 km of it a connector rides is no longer where it was.
        val moved = network(branch("main:1", "[-89.0,40.4]", "[-88.995,40.42]"), connectorSpur)
        val cold = inspectSaved(loaded(moved, trust = false), saved)
        assertEquals("stale", status(cold))
        assertTrue("geometry-changed" in networkIssueCodes(cold))
        assertFalse(cold["canNavigate"]!!.jsonPrimitive.boolean)
    }

    @Test fun anUnsnappedShortTrailShiftedTwelveMetersNorthIsStaleEvenThoughEveryPointIsNearAnEnd() {
        val ends = listOf("[-89.0,40.4]", "[-88.99929223953718,40.4]")
        val shifted = listOf("[-89.0,40.400107797341]", "[-88.99929223953718,40.400107797341]")
        val original = loaded(network(branch("short:1", *ends.toTypedArray())), trust = false)
        val saved = plan(original, from = MapPoint(40.4, -89.0), to = MapPoint(40.4, -88.99929223953718)).getValue("route")
        assertEquals("current", status(inspectSaved(original, saved)))
        val moved = loaded(network(branch("short:1", *shifted.toTypedArray())), trust = false)
        val result = inspectSaved(moved, saved)
        assertEquals("stale", status(result))
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue("geometry-changed" in networkIssueCodes(result))
    }

    private fun savedAndRedrawn(straight: List<String>, redrawn: List<String>): Triple<JsonElement, JsonObject, WebRoutingBridge> {
        val ends = { points: List<String> -> points.first().removeSurrounding("[", "]").split(",").map { it.toDouble() } to points.last().removeSurrounding("[", "]").split(",").map { it.toDouble() } }
        val (from, to) = ends(straight)
        val original = loaded(network(branch("short:1", *straight.toTypedArray())), trust = false)
        val saved = plan(original, from = MapPoint(from[1], from[0]), to = MapPoint(to[1], to[0])).getValue("route")
        assertEquals("current", status(inspectSaved(original, saved)))
        val changed = loaded(network(branch("short:1", *redrawn.toTypedArray())), trust = false)
        return Triple(saved, inspectSaved(changed, saved), changed)
    }

    @Test fun aShortTrailRedrawnIntoADoglegWithTheSameEndsIsStaleAndFreshPlanningFollowsTheDogleg() {
        // 24 m straight; redrawn through a point 8 m off the old line (its midpoint is about 6.6 m from the new geometry).
        val straight = listOf("[-89.0,40.4]", "[-88.99971689581487,40.4]")
        val dogleg = listOf("[-89.0,40.4]", "[-88.99985844790744,40.400071864893995]", "[-88.99971689581487,40.4]")
        val (saved, result, changed) = savedAndRedrawn(straight, dogleg)
        assertEquals("stale", status(result))
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue("geometry-changed" in networkIssueCodes(result))
        // A route planned on the dogleg follows it, and is current: the check accepts what the graph derives.
        val fresh = plan(changed, from = MapPoint(40.4, -89.0), to = MapPoint(40.4, -88.99971689581487))
        assertEquals("current", status(fresh))
        assertEquals("current", status(inspectSaved(changed, fresh.getValue("route"))))
        assertEquals("stale", status(inspectSaved(changed, saved)))
    }

    @Test fun aChangeBetweenWhereASamplingCheckWouldLookIsStillStale() {
        // One 100 m run whose only interior vertices sit within a snap of its start: the old line and the redrawn one agree
        // at every 25 m position (0, 25, 50, 75, 100) and differ only in a 6 m bump between 5 m and 12 m from the start.
        val straight = listOf("[-89.0,40.4]", "[-88.9988194,40.4]")
        val bump = listOf("[-89.0,40.4]", "[-88.99994097,40.4]", "[-88.99989966,40.40005428]", "[-88.99985833,40.4]", "[-88.9988194,40.4]")
        val (_, result, changed) = savedAndRedrawn(straight, bump)
        assertEquals("stale", status(result))
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        val fresh = plan(changed, from = MapPoint(40.4, -89.0), to = MapPoint(40.4, -88.9988194))
        assertEquals("current", status(inspectSaved(changed, fresh.getValue("route"))))
    }

    @Test fun aRouteFromTheMapPickerOverAnUnchangedNetworkIsCurrentEvenWhenANearbyTrailAnchorsItsNode() {
        // The spur ends 12.8 m from the main trail's south end, so the graph anchors that end of main to the spur's node.
        val spur = branch("spur:1", "[-89.01,40.4]", "[-89.00015,40.4]")
        val main = branch("main:1", "[-89.0,40.4]", "[-89.0,40.42]")
        val bridge = loaded(network(spur, main), trust = false)
        val picked = call(bridge, buildJsonObject {
            put("op", "mapPoint"); put("point", Json.encodeToJsonElement(MapPoint(40.41, -89.0))); put("proposed", false); put("now", now)
        })
        val point = Json.decodeFromJsonElement<MapPoint>(picked.getValue("point"))
        val fresh = plan(bridge, from = point, to = MapPoint(40.42, -89.0))
        assertEquals("current", status(fresh))
        assertTrue(fresh["canNavigate"]!!.jsonPrimitive.boolean)
        // Reopening it, and recalculating it, keeps agreeing with the graph that made it.
        assertEquals("current", status(inspectSaved(bridge, fresh.getValue("route"))))
        // The same route is stale once main is redrawn between the same ends.
        val redrawn = loaded(network(spur, branch("main:1", "[-89.0,40.4]", "[-88.9995,40.41]", "[-89.0,40.42]")), trust = false)
        assertEquals("stale", status(inspectSaved(redrawn, fresh.getValue("route"))))
    }

    @Test fun aRouteWithoutFeatureIdentitiesIsUnverifiableUnlessTheDatasetIsAFixture() {
        val legacy = Json.encodeToJsonElement(TrailRoute(
            segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(start, finish))),
            totalDistanceMeters = 3000.0, ordinaryAccessDistanceMeters = 0.0, totalCost = 1.0,
        ))
        val strict = inspectSaved(loaded(trust = false), legacy)
        assertFalse(strict["canNavigate"]!!.jsonPrimitive.boolean)
        assertEquals("unverifiable", strict["network"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(listOf("legacy-route"), networkIssueCodes(strict))
        val trusted = inspectSaved(loaded(trust = true), legacy)
        assertTrue(trusted["canNavigate"]!!.jsonPrimitive.boolean)
        assertEquals("trusted", trusted["network"]!!.jsonObject["status"]!!.jsonPrimitive.content)
    }

    @Test fun snapshotRefusesAStaleRouteSoNavigationCannotResume() {
        val saved = savedRouteFrom(loaded(trust = false))
        val reloaded = loaded(fixture.replace("Existing", "Proposed"), trust = false)
        val result = call(reloaded, buildJsonObject {
            put("op", "snapshot"); put("route", saved); put("point", Json.encodeToJsonElement(start))
            put("progress", 0.0); put("accuracy", 5.0); put("timestamp", now); put("now", now); put("resume", true)
        })
        assertFalse(result["ok"]!!.jsonPrimitive.boolean)
        assertTrue(result["error"]!!.jsonPrimitive.content.contains("cannot start navigation"))
    }

    @Test fun proposedStaysOptInAfterRevalidation() {
        val proposedFixture = fixture.replace("Existing", "Proposed").replace("TrailBranches", "ProposedTrails")
        val bridge = loaded(proposedFixture, trust = false)
        val optedIn = plan(bridge, proposed = true)
        val result = inspectSaved(bridge, optedIn.getValue("route"))
        // Consistent with the loaded network, but proposed data is still preview-only.
        assertEquals("current", result["network"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(result["proposed"]!!.jsonPrimitive.boolean)
    }

    @Test fun datasetIdentityIsEchoedAndDuplicateIdentifiersAreRejected() {
        val bridge = WebRoutingBridge()
        val identity = buildJsonObject { put("id", "county-candidate"); put("version", "1"); put("contentSha256", "abc") }
        val ok = call(bridge, buildJsonObject {
            put("op", "initialize"); put("trails", fixture); put("now", now); put("dataset", identity)
        })
        assertEquals(identity, ok["dataset"])
        val duplicate = """{"layers":[{"features":[{"id":"test:1","name":"Test Trail","status":"Existing","routeRoles":["TrailBranches"],"facilityType":"Off-Road Trail","paths":[[[-89.0,40.4],[-89.0,40.42]]]},{"id":"test:1","name":"Test Trail","status":"Existing","routeRoles":["TrailBranches"],"facilityType":"Off-Road Trail","paths":[[[-89.0,40.4],[-89.0,40.42]]]}]}]}"""
        val failed = call(bridge, buildJsonObject { put("op", "initialize"); put("trails", duplicate); put("now", now) })
        assertFalse(failed["ok"]!!.jsonPrimitive.boolean)
        assertTrue(failed["error"]!!.jsonPrimitive.content.contains("duplicate"))
        // A failed replacement never leaves the previous network active.
        val plan = call(bridge, buildJsonObject {
            put("op", "plan"); put("start", Json.encodeToJsonElement(start)); put("destination", Json.encodeToJsonElement(finish)); put("now", now)
        })
        assertFalse(plan["ok"]!!.jsonPrimitive.boolean)
    }

    private fun inspect(route: TrailRoute, bridge: WebRoutingBridge = loaded()): JsonObject = call(bridge, buildJsonObject {
        put("op", "inspect"); put("route", Json.encodeToJsonElement(route)); put("now", now)
    })

    // ---- interior connectors: a mapped join is not a gap, a genuine missing link still is ----

    private fun northMeters(meters: Double) = MapPoint(40.4 + meters / 6_371_008.8 * 180.0 / kotlin.math.PI, -89.0)
    /** mapped road, then a connector of [joinMeters], then a mapped trail (both mapped parts routed). */
    private fun joinedRoute(joinMeters: Double, roadName: String? = "Test Dr", trailName: String? = "Test Trail", trailRoles: Set<TrailNetworkRole> = emptySet()): TrailRoute {
        val a = northMeters(0.0); val b = northMeters(200.0); val c = northMeters(200.0 + joinMeters); val d = northMeters(400.0 + joinMeters)
        return TrailRoute(
            segments = listOf(
                TrailRouteSegment(TrailRouteSegmentType.Access, listOf(a, b), isRouted = true, name = roadName),
                TrailRouteSegment(TrailRouteSegmentType.Access, listOf(b, c), isRouted = false),
                TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(c, d), isRouted = true, name = trailName, routeRoles = trailRoles),
            ),
            totalDistanceMeters = 400.0 + joinMeters, ordinaryAccessDistanceMeters = 200.0 + joinMeters, totalCost = 1.0,
        )
    }

    @Test fun anInteriorConnectorBetweenTwoMappedSegmentsIsAGapOnlyBeyondMappingPrecision() {
        for (join in listOf(0.03, 0.1, 0.27, 0.86, 1.0)) {
            val result = inspect(joinedRoute(join))
            assertTrue(result["accessGaps"]!!.jsonArray.isEmpty(), "a $join m join is a coordinate discrepancy")
            assertTrue(result["canNavigate"]!!.jsonPrimitive.boolean, "a $join m join does not block Start")
            // The route itself is untouched: the connector is still an unrouted segment with its length in the total.
            assertEquals(3, Json.decodeFromJsonElement<TrailRoute>(result["route"]!!).segments.size)
            assertFalse(Json.decodeFromJsonElement<TrailRoute>(result["route"]!!).segments[1].isRouted)
            assertEquals(400.0 + join, result["distance"]!!.jsonPrimitive.double, 1e-6)
        }
        for (join in listOf(1.5, 5.0, 13.84)) {
            val result = inspect(joinedRoute(join))
            val gap = result["accessGaps"]!!.jsonArray.single().jsonObject
            assertEquals("interior", gap["kind"]!!.jsonPrimitive.content)
            assertEquals(join, gap["distanceMeters"]!!.jsonPrimitive.double, 1e-3)
            assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        }
    }

    @Test fun sharingARoadNameDoesNotJoinAConnectorThatIsLongerThanMappingPrecision() {
        // Same name on both mapped sides is not proof of continuity: a 3 m break stays a gap, a 0.4 m one does not.
        assertEquals(1, inspect(joinedRoute(3.0, roadName = "Same Rd", trailName = "Same Rd"))["accessGaps"]!!.jsonArray.size)
        assertEquals(0, inspect(joinedRoute(0.4, roadName = "Same Rd", trailName = "Same Rd"))["accessGaps"]!!.jsonArray.size)
        assertEquals(0, inspect(joinedRoute(0.4, roadName = null, trailName = null))["accessGaps"]!!.jsonArray.size)
    }

    @Test fun aConnectorNextToAnEstimatedSegmentOrAtAnEndStaysAGapHoweverShort() {
        val a = northMeters(0.0); val b = northMeters(0.4); val c = northMeters(200.0); val d = northMeters(200.4)
        // an end connector of 0.4 m is still reported (kind endpoint)
        val atEnd = TrailRoute(
            segments = listOf(
                TrailRouteSegment(TrailRouteSegmentType.Access, listOf(a, b), isRouted = false),
                TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(b, c), isRouted = true),
            ),
            totalDistanceMeters = 200.0, ordinaryAccessDistanceMeters = 0.4, totalCost = 1.0,
        )
        val endGap = inspect(atEnd)["accessGaps"]!!.jsonArray.single().jsonObject
        assertEquals("endpoint", endGap["kind"]!!.jsonPrimitive.content)
        assertEquals("Start connection", endGap["label"]!!.jsonPrimitive.content)
        // two estimated segments in a row: the short one has an estimated neighbour, so it is not a join between two mapped parts
        val next = TrailRoute(
            segments = listOf(
                TrailRouteSegment(TrailRouteSegmentType.Access, listOf(a, b), isRouted = true),
                TrailRouteSegment(TrailRouteSegmentType.Access, listOf(b, c), isRouted = false),
                TrailRouteSegment(TrailRouteSegmentType.Access, listOf(c, d), isRouted = false),
                TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(d, northMeters(400.0)), isRouted = true),
            ),
            totalDistanceMeters = 400.0, ordinaryAccessDistanceMeters = 200.4, totalCost = 1.0,
        )
        val ids = inspect(next)["accessGaps"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }
        assertEquals(listOf("gap-1", "gap-2"), ids)
    }

    @Test fun aJoinedConnectorNeverBypassesProposedStaleOrTestModeRules() {
        val proposed = inspect(joinedRoute(0.5, trailRoles = setOf(TrailNetworkRole.ProposedTrails)))
        assertTrue(proposed["accessGaps"]!!.jsonArray.isEmpty())
        assertFalse(proposed["canNavigate"]!!.jsonPrimitive.boolean)
        val stale = inspect(joinedRoute(0.5), loaded(trust = false))
        assertFalse(stale["canNavigate"]!!.jsonPrimitive.boolean)
        // the private test mode counts and warns about the remaining estimated connections only
        val route = joinedRoute(5.0)
        val assumed = inspect(route, loaded(assume = true))
        assertTrue(assumed["warnings"]!!.jsonArray.any { it.jsonPrimitive.content.contains("1 estimated connection") })
        assertEquals(inspect(route)["accessGaps"], assumed["accessGaps"])
    }

    /**
     * The four rows of the owner's screenshot, rebuilt with their real measurements: "Start connection" 111 ft, "Near S Hershey Rd" 37 ft,
     * "Near Prospect Ave" under 1 ft, "Destination connection" 90 ft. Each is classified for a stated reason.
     */
    @Test fun eachRowOfTheOwnersScreenshotIsTreatedForItsOwnReason() {
        val ft = 0.3048
        val p = (0..8).map { northMeters(it * 100.0) }
        val startOff = northMeters(-111 * ft)
        val roadEnd = northMeters(150.0); val trailEntry = northMeters(150.0 + 37 * ft)
        val trailEnd = northMeters(600.0); val joinFar = northMeters(600.0 + 0.08)
        val destination = northMeters(800.0 + 90 * ft)
        val segments = listOf(
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(startOff, p[0]), isRouted = false),
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(p[0], roadEnd), isRouted = true, name = "S Hershey Rd"),
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(roadEnd, trailEntry), isRouted = false),
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(trailEntry, trailEnd), isRouted = true),
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(trailEnd, joinFar), isRouted = false),
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(joinFar, p[8]), isRouted = true, name = "Prospect Ave"),
            TrailRouteSegment(TrailRouteSegmentType.Access, listOf(p[8], destination), isRouted = false),
        )
        val route = TrailRoute(segments = segments, totalDistanceMeters = 900.0, ordinaryAccessDistanceMeters = 300.0, totalCost = 1.0)
        val result = inspect(route)
        val gaps = result["accessGaps"]!!.jsonArray.map { it.jsonObject }
        // Row 1 and row 4 (start and destination): real estimated connections, kept in the data, but obvious: kind endpoint.
        // Row 2 (road to the trail beside it, 37 ft with no mapped link between them): a REAL estimated connection, kept and now named
        // for what it joins. Row 3 (Prospect Ave, under 1 ft between two mapped segments): a coordinate discrepancy, not a gap.
        assertEquals(listOf("gap-0", "gap-2", "gap-6"), gaps.map { it["id"]!!.jsonPrimitive.content })
        assertEquals(listOf("endpoint", "interior", "endpoint"), gaps.map { it["kind"]!!.jsonPrimitive.content })
        assertEquals(listOf("Start connection", "S Hershey Rd to trail", "Destination connection"), gaps.map { it["label"]!!.jsonPrimitive.content })
        assertEquals(111 * ft, gaps[0]["distanceMeters"]!!.jsonPrimitive.double, 0.01)
        assertEquals(37 * ft, gaps[1]["distanceMeters"]!!.jsonPrimitive.double, 0.01)
        assertEquals(90 * ft, gaps[2]["distanceMeters"]!!.jsonPrimitive.double, 0.01)
        // Honest geometry: the route still has all four unrouted connectors and its total; only the notice list differs.
        val kept = Json.decodeFromJsonElement<TrailRoute>(result["route"]!!)
        assertEquals(4, kept.segments.count { !it.isRouted })
        assertEquals(route.totalDistanceMeters, result["distance"]!!.jsonPrimitive.double, 1e-9)
        // Strict Start is still blocked by the remaining estimated connections, and the private test mode still warns about all three.
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        val assumed = inspect(route, loaded(assume = true))
        assertTrue(assumed["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(assumed["warnings"]!!.jsonArray.any { it.jsonPrimitive.content.contains("3 estimated connection") })
    }

    @Test fun anInteriorStepBetweenARoadAndATrailIsNamedForWhatItJoins() {
        val a = northMeters(0.0); val b = northMeters(100.0); val c = northMeters(110.0); val d = northMeters(300.0)
        fun label(first: TrailRouteSegmentType, second: TrailRouteSegmentType, name: String?, nameOnFirst: Boolean): String {
            val route = TrailRoute(
                segments = listOf(
                    TrailRouteSegment(first, listOf(a, b), isRouted = true, name = if (nameOnFirst) name else null),
                    TrailRouteSegment(TrailRouteSegmentType.Access, listOf(b, c), isRouted = false),
                    TrailRouteSegment(second, listOf(c, d), isRouted = true, name = if (nameOnFirst) null else name),
                ),
                totalDistanceMeters = 300.0, ordinaryAccessDistanceMeters = 110.0, totalCost = 1.0,
            )
            return inspect(route)["accessGaps"]!!.jsonArray.single().jsonObject["label"]!!.jsonPrimitive.content
        }
        assertEquals("Oak St to trail", label(TrailRouteSegmentType.Access, TrailRouteSegmentType.Trail, "Oak St", true))
        assertEquals("Trail to Elm Ave", label(TrailRouteSegmentType.Trail, TrailRouteSegmentType.Access, "Elm Ave", false))
        assertEquals("Near Elm Ave", label(TrailRouteSegmentType.Access, TrailRouteSegmentType.Access, "Elm Ave", true))
        assertEquals("Along the route", label(TrailRouteSegmentType.Access, TrailRouteSegmentType.Trail, null, true))
    }

    // ---- PRIVATE TEST MODE: estimated connections assumed traversable (default off) ----

    private fun gappedRoute(roles: Set<TrailNetworkRole> = emptySet()): TrailRoute {
        val gapStart = MapPoint(40.3999, -89.0)
        val trail = TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(start, finish), routeRoles = roles)
        return TrailRoute(
            segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Access, listOf(gapStart, start), isRouted = false), trail),
            totalDistanceMeters = 3000.0, ordinaryAccessDistanceMeters = 11.0, totalCost = 1.0,
        )
    }

    @Test fun estimatedConnectionsBlockStartByDefaultAndOnlyAnExplicitTestModeAllowsIt() {
        val route = gappedRoute()
        val strict = inspect(route)
        val explicitOff = inspect(route, loaded(assume = false))
        val assumed = inspect(route, loaded(assume = true))
        assertFalse(strict["canNavigate"]!!.jsonPrimitive.boolean)
        assertEquals(strict, explicitOff)
        assertFalse(strict["assumedConnections"]!!.jsonPrimitive.boolean)
        assertTrue(assumed["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(assumed["assumedConnections"]!!.jsonPrimitive.boolean)
        // Nothing about the connection changes: same gaps, same drawn segments, same distances, still unrouted in the route.
        assertEquals(strict["accessGaps"], assumed["accessGaps"])
        assertEquals(strict["segments"], assumed["segments"])
        assertEquals(strict["distance"], assumed["distance"])
        assertEquals(strict["route"], assumed["route"])
        assertEquals(1, assumed["accessGaps"]!!.jsonArray.size)
        assertFalse(Json.decodeFromJsonElement<TrailRoute>(assumed["route"]!!).segments.first().isRouted)
        val warnings = assumed["warnings"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertTrue(warnings.any { it.startsWith("PRIVATE TEST MODE") && it.contains("estimated connection") && it.contains("Verify the actual connection before riding") })
        assertTrue(strict["warnings"]!!.jsonArray.none { it.jsonPrimitive.content.contains("TEST MODE") })
    }

    @Test fun testModeIsResetByTheNextInitializeAndIsNeverImpliedByTrustingSerializedRoutes() {
        val bridge = loaded(assume = true)
        assertTrue(inspect(gappedRoute(), bridge)["canNavigate"]!!.jsonPrimitive.boolean)
        call(bridge, buildJsonObject { put("op", "initialize"); put("trails", fixture); put("now", now) })
        assertFalse(inspect(gappedRoute(), bridge)["canNavigate"]!!.jsonPrimitive.boolean)
        assertFalse(inspect(gappedRoute(), loaded(trust = true))["canNavigate"]!!.jsonPrimitive.boolean)
    }

    @Test fun testModeStillBlocksProposedTrailsAndStaleNetworks() {
        val proposed = inspect(gappedRoute(setOf(TrailNetworkRole.ProposedTrails)), loaded(assume = true))
        assertTrue(proposed["proposed"]!!.jsonPrimitive.boolean)
        assertFalse(proposed["canNavigate"]!!.jsonPrimitive.boolean)
        // A hand-built route with no feature identities is not a current route on a network that is not told to trust it.
        val stale = inspect(gappedRoute(), loaded(trust = false, assume = true))
        assertNotEquals("current", stale["network"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertFalse(stale["canNavigate"]!!.jsonPrimitive.boolean)
    }

    @Test fun testModeLetsAnEstimatedGapRouteTakeNavigationSnapshotsButStrictStillRefuses() {
        val route = gappedRoute()
        fun snap(bridge: WebRoutingBridge) = call(bridge, buildJsonObject {
            put("op", "snapshot"); put("route", Json.encodeToJsonElement(route)); put("point", Json.encodeToJsonElement(start))
            put("progress", 0.0); put("accuracy", 5.0); put("timestamp", now); put("now", now); put("resume", true)
        })
        val strict = snap(loaded())
        assertEquals(false, strict["ok"]?.jsonPrimitive?.booleanOrNull)
        val assumed = snap(loaded(assume = true))
        assertNotEquals(false, assumed["ok"]?.jsonPrimitive?.booleanOrNull)
        assertTrue(assumed["canNavigate"]!!.jsonPrimitive.boolean)
    }

    private fun mapPoint(bridge: WebRoutingBridge, point: MapPoint, proposed: Boolean = false, at: Long = now): JsonObject =
        call(bridge, buildJsonObject {
            put("op", "mapPoint"); put("point", Json.encodeToJsonElement(point)); put("proposed", proposed); put("now", at)
        })

    /** [trust] mirrors the fixture-only worker setting: hand-built routes without feature identities are accepted. */
    private fun loaded(source: String = fixture, trust: Boolean = true, assume: Boolean? = null): WebRoutingBridge = WebRoutingBridge().also { bridge ->
        val result = call(bridge, buildJsonObject {
            put("op", "initialize"); put("trails", source); put("now", now); put("trustSerializedRoutes", trust)
            if (assume != null) put("assumeEstimatedConnections", assume)
        })
        assertTrue(result["ok"]!!.jsonPrimitive.boolean)
        assertTrue(result["updates"]!!.jsonArray.isNotEmpty())
    }
    private fun plan(bridge: WebRoutingBridge, proposed: Boolean = false, from: MapPoint = start, to: MapPoint = finish, at: Long = now): JsonObject =
        call(bridge, buildJsonObject {
            put("op", "plan"); put("start", Json.encodeToJsonElement(from)); put("destination", Json.encodeToJsonElement(to)); put("proposed", proposed); put("now", at)
        })
    private fun call(bridge: WebRoutingBridge, request: JsonObject): JsonObject = Json.parseToJsonElement(bridge.dispatch(request.toString())).jsonObject
}
