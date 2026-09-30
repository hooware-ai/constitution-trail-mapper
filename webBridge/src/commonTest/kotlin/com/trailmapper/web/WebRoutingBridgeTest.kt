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
        assertEquals(listOf("gap-0", "gap-2", "gap-4", "gap-6"), gaps.map { it["id"]!!.jsonPrimitive.content })
        assertEquals(listOf("Start connection", "Near Matlock Dr", "Near Test Trail", "Destination connection"), gaps.map { it["label"]!!.jsonPrimitive.content })
        listOf(24.0, 5.0, 0.275, 14.0).forEachIndexed { index, expected ->
            assertEquals(expected, gaps[index]["distanceMeters"]!!.jsonPrimitive.double, 1e-8)
            assertEquals(Json.encodeToJsonElement(segments[index * 2].points.first()), gaps[index]["from"])
            assertEquals(Json.encodeToJsonElement(segments[index * 2].points.last()), gaps[index]["to"])
        }
        assertEquals(243.275, result["accessDistance"]!!.jsonPrimitive.double)
        assertEquals(43.275, gaps.sumOf { it["distanceMeters"]!!.jsonPrimitive.double }, 1e-8)
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
        assertEquals(setOf("id", "distanceMeters", "from", "to", "label"), described.keys)
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

    private fun inspect(route: TrailRoute): JsonObject = call(loaded(), buildJsonObject {
        put("op", "inspect"); put("route", Json.encodeToJsonElement(route)); put("now", now)
    })

    private fun mapPoint(bridge: WebRoutingBridge, point: MapPoint, proposed: Boolean = false, at: Long = now): JsonObject =
        call(bridge, buildJsonObject {
            put("op", "mapPoint"); put("point", Json.encodeToJsonElement(point)); put("proposed", proposed); put("now", at)
        })

    /** [trust] mirrors the fixture-only worker setting: hand-built routes without feature identities are accepted. */
    private fun loaded(source: String = fixture, trust: Boolean = true): WebRoutingBridge = WebRoutingBridge().also { bridge ->
        val result = call(bridge, buildJsonObject { put("op", "initialize"); put("trails", source); put("now", now); put("trustSerializedRoutes", trust) })
        assertTrue(result["ok"]!!.jsonPrimitive.boolean)
        assertTrue(result["updates"]!!.jsonArray.isNotEmpty())
    }
    private fun plan(bridge: WebRoutingBridge, proposed: Boolean = false, from: MapPoint = start, to: MapPoint = finish, at: Long = now): JsonObject =
        call(bridge, buildJsonObject {
            put("op", "plan"); put("start", Json.encodeToJsonElement(from)); put("destination", Json.encodeToJsonElement(to)); put("proposed", proposed); put("now", at)
        })
    private fun call(bridge: WebRoutingBridge, request: JsonObject): JsonObject = Json.parseToJsonElement(bridge.dispatch(request.toString())).jsonObject
}
