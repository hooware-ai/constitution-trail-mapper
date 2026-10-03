/**
 * Job: Prove the Willow closure and Camelback advisory on the UNCHANGED actual native/county trail asset.
 *
 * Needs the private, ignored data/generated/mcgis-trails.normalized.json (the native asset). Like the other real-data
 * tests it fails, rather than skipping, when the asset is missing.
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class TimedClosureRealDataTest {
    private val closure = TrailRouteClosureSijko.willowTrailCrossing
    private val features by lazy(::loadFeatures)
    private val trail1305 get() = features.single { it.id == "54:1305" }

    @Test
    fun theRawSourceLegIsUnchangedAndTheClosureBoundsLieInsideIt() {
        val path = trail1305.paths[0]
        // Vertices 97 and 98 exactly as the closure-mapping brief recorded them from the licensed source.
        assertPoint(path[97], 40.5096012799, -88.9843690241)
        assertPoint(path[98], 40.5166840740, -88.9849653323)
        assertTrue(TrailDistanceSijko.metersBetween(path[97], path[98]) in 789.0..791.0)
        listOf(closure.closedFrom, closure.closedTo).forEach { bound ->
            val onLeg = TrailDistanceSijko.projectToSegment(bound, path[97], path[98])
            assertTrue(onLeg.distanceMeters < 0.5, "bound is ${onLeg.distanceMeters} m off the real leg")
            // Strictly inside the leg: not a source vertex.
            assertTrue(path.none { TrailDistanceSijko.metersBetween(it, bound) < 50.0 && it != path[97] })
            assertTrue(TrailDistanceSijko.metersBetween(path[97], bound) > 100.0)
            assertTrue(TrailDistanceSijko.metersBetween(path[98], bound) > 100.0)
        }
        assertTrue(TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo) in 201.5..203.5)
    }

    @Test
    fun theCutClipsInsideTheRealLegKeepsBothPortionsAndTouchesNothingElse() {
        val original = features
        val now = closure.activeFromEpochMillis
        val before = TrailRouteClosureSijko.openFeatures(original, now - 1)
        assertTrue(before.appliedClosures.none { it.id == closure.id })
        val cut = TrailRouteClosureSijko.openFeatures(original, now)
        assertTrue(closure in cut.appliedClosures)
        // The input is exactly what was loaded: nothing was edited, no vertex was inserted.
        assertEquals(loadFeatures(), original)
        val changed = cut.features.filterIndexed { index, feature -> feature != original[index] }
        check(changed.size == 1) { "changed features: ${changed.map { it.id }}; applied ${cut.appliedClosures.map { it.id }}" }
        assertEquals(listOf("54:1305"), changed.map { it.id })
        val rawPath = trail1305.paths[0]
        val pieces = changed.single().paths
        // On the real path the Uptown closure (cut at source vertices) also applies from September 21, so the Willow
        // leg lives in the northern remainder of that cut: from the Uptown Circle entry vertex to vertex 98.
        val uptownEnd = rawPath.indexOfFirst {
            TrailDistanceSijko.metersBetween(it, TrailRouteClosureSijko.uptownUnderpass.closedTo) <= 1.0
        }
        assertTrue(uptownEnd in 1..97)
        val southPiece = pieces.firstOrNull { it.last() == closure.closedFrom }
            ?: error("no south piece among ${pieces.map { listOf(it.size, it.first(), it.last()) }}")
        val northPiece = pieces.firstOrNull { it.first() == closure.closedTo }
            ?: error("no north piece among ${pieces.map { listOf(it.size, it.first(), it.last()) }}")
        // Unchanged source vertices on each side, ending exactly at the projected bounds; nothing else inserted.
        assertEquals(rawPath.subList(uptownEnd, 98) + closure.closedFrom, southPiece)
        assertEquals(listOf(closure.closedTo) + rawPath.subList(98, rawPath.size), northPiece)
        // Only the section's length is gone from the leg: both residual portions (about 388 m and 200 m) are kept.
        val removed = TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        val remainder = TrailDistanceSijko.pathLengthMeters(rawPath.subList(uptownEnd, rawPath.size))
        val keptHere = TrailDistanceSijko.pathLengthMeters(southPiece) + TrailDistanceSijko.pathLengthMeters(northPiece)
        assertTrue(abs((remainder - removed) - keptHere) < 1.0)
        assertTrue(TrailDistanceSijko.metersBetween(rawPath[97], closure.closedFrom) in 380.0..395.0)
        assertTrue(TrailDistanceSijko.metersBetween(closure.closedTo, rawPath[98]) in 195.0..205.0)
        // The explicitly identified neighbors and crossing are untouched.
        listOf("16:188", "54:2578", "54:4349", "16:297", "16:1297", "16:1348").forEach { id ->
            assertEquals(original.single { it.id == id }, cut.features.single { it.id == id }, id)
        }
    }

    @Test
    fun bothResidualPortionsStayRoutableAndTheSectionIsRefused() {
        val now = closure.activeFromEpochMillis
        val path = trail1305.paths[0]
        val south = path[97]
        val north = path[98]
        val southern = assertNotNull(find(south, closure.closedFrom, now))
        val northern = assertNotNull(find(closure.closedTo, north, now))
        listOf(southern, northern).forEach { route ->
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now).isEmpty())
            assertTrue(TrailRouteAdvisorySijko.forRoute(route, now).none { it.id == closure.id })
        }
        // End to end: any route that exists does not ride the section; the real network may offer a different way.
        find(south, north, now)?.let { route ->
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now).isEmpty())
        }
    }

    @Test
    fun aRoutePlannedBeforeTheClosureIsGatedAtItsInstantAndAfterTheEstimate() {
        val path = trail1305.paths[0]
        val planned = assertNotNull(find(path[97], path[98], closure.activeFromEpochMillis - 1))
        val ridesSection = planned.segments.any { segment ->
            segment.points.zipWithNext().any { (a, b) ->
                TrailDistanceSijko.projectToSegment(closure.closedFrom, a, b).distanceMeters < 1.0
            }
        }
        assertTrue(ridesSection, "the earlier route does ride the section")
        val start = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(planned, start - 1).isEmpty())
        assertTrue(
            TrailRouteAdvisorySijko.forRoute(planned, start - 1).single { it.id == closure.id }.message
                .startsWith("Scheduled, not closed yet"),
        )
        assertEquals(listOf(closure.id), TrailRouteClosureGateSijko.blockingAdvisories(planned, start).map { it.id })
        assertEquals(listOf(closure.id), TrailRouteClosureGateSijko.blockingAdvisories(planned, estimate).map { it.id })
        // After the estimate: still gated, nothing reopened by the date alone.
        val after = TrailRouteClosureGateSijko.blockingAdvisories(planned, estimate + 1)
        assertEquals(listOf(closure.id), after.map { it.id })
        assertTrue(after.single().message.contains("has passed; reopening has not been confirmed"))
        // Recalculating gives a replacement that avoids the section, or says no route avoids it.
        val outcome = TrailRouteClosureGateSijko.recalculate(
            features, planned, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = estimate + 1,
        )
        when (outcome) {
            is TrailRouteRecalculationOutcome.Replacement ->
                assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(outcome.route, estimate + 1).isEmpty())
            is TrailRouteRecalculationOutcome.NoSafeRoute -> assertTrue(closure in outcome.blockingClosures)
            TrailRouteRecalculationOutcome.RoadDataFailed -> error("no road data was requested")
        }
    }

    @Test
    fun theCrossingAtTheSouthBoundIsNotGated() {
        val crossing = features.single { it.id == "16:188" }
        val path = crossing.paths.first { p -> p.any { TrailDistanceSijko.metersBetween(it, closure.closedFrom) < 15.0 } }
        val index = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedFrom) < 15.0 }
        val from = path[maxOf(0, index - 1)]
        val to = path[minOf(path.lastIndex, index + 1)]
        val now = closure.activeFromEpochMillis + 1
        val route = find(from, to, closure.activeFromEpochMillis - 1)
        if (route != null) {
            assertTrue(TrailRouteAdvisorySijko.forRoute(route, now).none { it.id == closure.id })
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now).isEmpty())
        }
    }

    @Test
    fun camelbackIsAnAdvisoryOnTheRealCrossingAndBothClosuresCanBeActiveTogether() {
        val path = trail1305.paths[0]
        assertPoint(path[7], 40.4982765696, -88.9834168982)
        val route = assertNotNull(find(path[6], path[8], 1_791_205_200_000L - 1))
        val id = "camelback-virginia-trail-crossing-2026-10-05"
        val start = 1_791_205_200_000L
        val end = 1_791_324_000_000L
        assertTrue(TrailRouteAdvisorySijko.forRoute(route, start - 1).single { it.id == id }.message.startsWith("Scheduled, not closed yet"))
        assertTrue(TrailRouteAdvisorySijko.forRoute(route, start).single { it.id == id }.message.contains("closed Constitution Trail"))
        assertTrue(TrailRouteAdvisorySijko.forRoute(route, end + 1).single { it.id == id }.message.contains("has passed"))
        listOf(start - 1, start, end, end + 1).forEach { now ->
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now).isEmpty(), "blocked at $now")
            assertNotNull(find(path[6], path[8], now))
        }
        // Both together: Willow still cuts while Camelback is in force and never joins the cut.
        val together = TrailRouteClosureSijko.openFeatures(features, start)
        assertTrue(closure in together.appliedClosures)
        assertEquals(features.single { it.id == "16:297" }, together.features.single { it.id == "16:297" })
        assertNull(TrailRouteClosureSijko.activeClosures(start).singleOrNull { it.id.startsWith("camelback") })
    }

    private fun find(from: MapPoint, to: MapPoint, now: Long) = TrailRouteCalculationSijko.findRoute(
        features = features,
        routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
        startPoint = from,
        destinationPoint = to,
        accessGraph = null,
        nowEpochMillis = now,
    )

    private fun assertPoint(point: MapPoint, latitude: Double, longitude: Double) {
        assertEquals(latitude, point.latitude, 1e-9)
        assertEquals(longitude, point.longitude, 1e-9)
    }

    private fun loadFeatures(): List<TrailNetworkFeature> {
        val root = Json.parseToJsonElement(assetFile().readText()).jsonObject
        return root.getValue("layers").jsonArray.flatMap { layer ->
            layer.jsonObject.getValue("features").jsonArray.map { element ->
                val feature = element.jsonObject
                TrailNetworkFeature(
                    id = feature.getValue("id").jsonPrimitive.content,
                    name = feature["name"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.jsonPrimitive?.content,
                    status = if (feature["status"]?.jsonPrimitive?.content == "Proposed") {
                        TrailFeatureStatus.Proposed
                    } else {
                        TrailFeatureStatus.Existing
                    },
                    routeRoles = roles(feature),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = paths(feature),
                )
            }
        }
    }

    private fun roles(feature: JsonObject): Set<TrailNetworkRole> {
        val element = feature.getValue("routeRoles")
        val names = if (element is JsonArray) element.map { it.jsonPrimitive.content } else listOf(element.jsonPrimitive.content)
        return names.map { TrailNetworkRole.valueOf(it) }.toSet()
    }

    private fun paths(feature: JsonObject): List<List<MapPoint>> = feature.getValue("paths").jsonArray.map { path ->
        path.jsonArray.map { pair ->
            val coordinate = pair.jsonArray
            MapPoint(latitude = coordinate[1].jsonPrimitive.double, longitude = coordinate[0].jsonPrimitive.double)
        }
    }

    private fun assetFile(): File {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).absoluteFile
        repeat(5) {
            val candidate = directory.resolve("data/generated/mcgis-trails.normalized.json")
            if (candidate.isFile) return candidate
            directory = directory.parentFile ?: return@repeat
        }
        error("Unable to locate data/generated/mcgis-trails.normalized.json from ${System.getProperty("user.dir")}")
    }
}
