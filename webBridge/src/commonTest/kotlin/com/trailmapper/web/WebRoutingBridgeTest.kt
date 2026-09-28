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
        assertFalse(plan(proposedWithBranchRole, proposed = true)["canNavigate"]!!.jsonPrimitive.boolean)
    }

    @Test fun estimatedAccessCanBePreviewedButCannotStartNavigation() {
        val bridge = loaded()
        val result = plan(bridge, from = MapPoint(40.4, -89.001))
        assertNotEquals(JsonNull, result["route"])
        assertFalse(result["canNavigate"]!!.jsonPrimitive.boolean)
        assertTrue(result["segments"]!!.jsonArray.all { it.jsonObject["isRouted"]!!.jsonPrimitive.boolean })
        val raw = Json.decodeFromJsonElement<TrailRoute>(result.getValue("route"))
        assertTrue(raw.segments.any { !it.isRouted })
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

    private fun mapPoint(bridge: WebRoutingBridge, point: MapPoint, proposed: Boolean = false, at: Long = now): JsonObject =
        call(bridge, buildJsonObject {
            put("op", "mapPoint"); put("point", Json.encodeToJsonElement(point)); put("proposed", proposed); put("now", at)
        })

    private fun loaded(source: String = fixture): WebRoutingBridge = WebRoutingBridge().also { bridge ->
        val result = call(bridge, buildJsonObject { put("op", "initialize"); put("trails", source); put("now", now) })
        assertTrue(result["ok"]!!.jsonPrimitive.boolean)
        assertTrue(result["updates"]!!.jsonArray.isNotEmpty())
    }
    private fun plan(bridge: WebRoutingBridge, proposed: Boolean = false, from: MapPoint = start, to: MapPoint = finish, at: Long = now): JsonObject =
        call(bridge, buildJsonObject {
            put("op", "plan"); put("start", Json.encodeToJsonElement(from)); put("destination", Json.encodeToJsonElement(to)); put("proposed", proposed); put("now", at)
        })
    private fun call(bridge: WebRoutingBridge, request: JsonObject): JsonObject = Json.parseToJsonElement(bridge.dispatch(request.toString())).jsonObject
}
