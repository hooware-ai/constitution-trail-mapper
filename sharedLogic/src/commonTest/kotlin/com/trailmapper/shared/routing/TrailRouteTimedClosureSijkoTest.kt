/**
 * Job: Verify the timed Willow closure and the Camelback advisory: schedule instants, clipping inside a source leg, and gates.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailRouteTimedClosureSijkoTest {
    // The ACTUAL source leg 97 to 98 of county trail 54:1305, path 0 (790 m): two unchanged source vertices and nothing
    // inserted between them. The closure's bounds lie inside this one leg.
    private val vertex97 = MapPoint(latitude = 40.5096012799, longitude = -88.9843690241)
    private val vertex98 = MapPoint(latitude = 40.5166840740, longitude = -88.9849653323)
    private val rawLeg = trail("54:1305", vertex97, vertex98)
    private val closure = TrailRouteClosureSijko.willowTrailCrossing

    @Test
    fun theClosureBoundsLieInsideTheOneSourceLegAndNotOnItsVertices() {
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        assertTrue(legMeters in 789.0..791.0, "leg is $legMeters m")
        listOf(closure.closedFrom, closure.closedTo).forEach { bound ->
            val projection = TrailDistanceSijko.projectToSegment(bound, vertex97, vertex98)
            assertTrue(projection.distanceMeters < 0.5, "bound is ${projection.distanceMeters} m off the leg")
            assertTrue(TrailDistanceSijko.metersBetween(bound, vertex97) > 100.0)
            assertTrue(TrailDistanceSijko.metersBetween(bound, vertex98) > 100.0)
        }
        val interval = TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        assertTrue(interval in 201.5..203.5, "interval is $interval m")
        assertTrue(closure.boundsProjected)
        assertTrue(closure.mappingNote.contains("Approximate"))
    }

    @Test
    fun cutsInsideTheLegAtItsScheduledInstantAndKeepsBothResidualPortions() {
        val before = TrailRouteClosureSijko.openFeatures(listOf(rawLeg), closure.activeFromEpochMillis - 1)
        assertEquals(listOf(rawLeg), before.features)
        assertTrue(before.appliedClosures.none { it.id == closure.id })

        val after = TrailRouteClosureSijko.openFeatures(listOf(rawLeg), closure.activeFromEpochMillis)
        assertTrue(closure in after.appliedClosures)
        val paths = after.features.single().paths
        assertEquals(2, paths.size)
        // South portion: the unchanged source vertex, then the projected bound. North: the other bound, then vertex 98.
        assertEquals(listOf(vertex97, closure.closedFrom), paths[0])
        assertEquals(listOf(closure.closedTo, vertex98), paths[1])
        val removed = TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        val kept = paths.sumOf { TrailDistanceSijko.pathLengthMeters(it) }
        assertTrue(kotlin.math.abs(kept - (TrailDistanceSijko.metersBetween(vertex97, vertex98) - removed)) < 0.5)
        // Deleting the whole leg would have removed about 587.5 m more than the notice's section.
        assertTrue(kept > 580.0, "kept $kept m")
        // The input is not edited: the source path is exactly as loaded.
        assertEquals(listOf(listOf(vertex97, vertex98)), rawLeg.paths)
    }

    @Test
    fun theSectionIsDrawnFromTheUnchangedSourceLine() {
        val section = assertNotNull(TrailRouteClosureSijko.closedSection(listOf(vertex97, vertex98), closure))
        assertEquals(listOf(closure.closedFrom, closure.closedTo), section)
        // A trail that does not pass through the section has none.
        val elsewhere = listOf(MapPoint(40.52, -88.99), MapPoint(40.53, -88.99))
        assertNull(TrailRouteClosureSijko.closedSection(elsewhere, closure))
    }

    @Test
    fun aRouteBetweenTheTwoEndsOfTheLegIsRefusedOnceActiveAndBothPortionsStayUsable() {
        val south = vertex97
        val north = vertex98
        val activeNow = closure.activeFromEpochMillis
        // Before: the whole leg is one route.
        val early = assertNotNull(findRoute(listOf(rawLeg), south, north, activeNow - 1))
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(early, activeNow - 1).isEmpty())
        // From the instant it begins: no route between the ends, and the guidance names the closure.
        val outcome = TrailRouteCalculationSijko.findRouteOutcome(
            listOf(rawLeg), RouteLayerDefaultsSijko.defaultSelection(), south, north, null, nowEpochMillis = activeNow,
        )
        assertNull(outcome.route)
        assertTrue(closure in outcome.blockingClosures)
        // Each residual portion is still routable up to its bound, and never enters the section.
        val southern = assertNotNull(findRoute(listOf(rawLeg), south, closure.closedFrom, activeNow))
        val northern = assertNotNull(findRoute(listOf(rawLeg), closure.closedTo, north, activeNow))
        listOf(southern, northern).forEach { route ->
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, activeNow).isEmpty())
        }
        // The route planned earlier is gated at the activation instant, not before.
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(early, activeNow - 1).isEmpty())
        val gated = TrailRouteClosureGateSijko.blockingAdvisories(early, activeNow)
        assertEquals(listOf(closure.id), gated.map { it.id })
        assertTrue(gated.single().message.contains("has not been detoured"))
    }

    @Test
    fun beforeItStartsTheNoticeSaysScheduledAndNeverBlocksAfterTheEstimateItStaysClosed() {
        val route = assertNotNull(findRoute(listOf(rawLeg), vertex97, vertex98, closure.activeFromEpochMillis - 1))
        val scheduled = TrailRouteAdvisorySijko.forRoute(route, closure.activeFromEpochMillis - 1)
            .single { it.id == closure.id }
        assertTrue(scheduled.title.startsWith("Scheduled"))
        assertTrue(scheduled.message.startsWith("Scheduled, not closed yet"))
        assertFalse(scheduled.message.contains("closed since"))
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, closure.activeFromEpochMillis - 1).isEmpty())

        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        val during = TrailRouteAdvisorySijko.forRoute(route, estimate).single { it.id == closure.id }
        assertTrue(during.message.contains("closed since 6 a.m. CDT"))
        assertTrue(during.message.contains("an estimate does not confirm reopening"))
        // One millisecond after the estimate: still closed, with the estimate said to have passed. No automatic reopening.
        val after = TrailRouteAdvisorySijko.forRoute(route, estimate + 1).single { it.id == closure.id }
        assertTrue(after.message.contains("has passed; reopening has not been confirmed"))
        assertEquals(
            listOf(closure.id),
            TrailRouteClosureGateSijko.blockingAdvisories(route, estimate + 1).map { it.id },
        )
        assertNull(findRoute(listOf(rawLeg), vertex97, vertex98, estimate + 86_400_000L))
        assertTrue(TrailRouteClosureSijko.activeClosures(estimate + 86_400_000L).any { it.id == closure.id })
    }

    @Test
    fun aCrossingAtTheEndOfTheSectionAndNeighboringTrailsAreNotGated() {
        // A shared-lane crossing that meets the trail at the south bound, as 16:188 does, and a trail that merely
        // starts at the north end.
        val crossing = trail(
            "16:188",
            MapPoint(closure.closedFrom.latitude, closure.closedFrom.longitude - 0.0004),
            closure.closedFrom,
            MapPoint(closure.closedFrom.latitude, closure.closedFrom.longitude + 0.0004),
        )
        val beyond = trail("54:4349", vertex98, MapPoint(vertex98.latitude + 0.003, vertex98.longitude))
        val features = listOf(rawLeg, crossing, beyond)
        val now = closure.activeFromEpochMillis + 1
        val network = TrailRouteClosureSijko.openFeatures(features, now)
        assertEquals(crossing, network.features[1])
        assertEquals(beyond, network.features[2])
        val acrossRoute = assertNotNull(
            findRoute(
                features,
                MapPoint(closure.closedFrom.latitude, closure.closedFrom.longitude - 0.0004),
                MapPoint(closure.closedFrom.latitude, closure.closedFrom.longitude + 0.0004),
                closure.activeFromEpochMillis - 1,
            ),
        )
        assertTrue(TrailRouteAdvisorySijko.forRoute(acrossRoute, now).none { it.id == closure.id })
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(acrossRoute, now).isEmpty())
        // Riding up to the north end from beyond it is not riding through the section.
        val northRoute = assertNotNull(findRoute(features, beyond.paths[0][1], vertex98, now))
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(northRoute, now).isEmpty())
    }

    @Test
    fun theCamelbackNoticeIsScheduledThenAnAdvisoryOnTrailTravelThroughTheCrossingAndNeverBlocks() {
        val crossing = MapPoint(latitude = 40.4982689784, longitude = -88.9834162490)
        val before = MapPoint(latitude = 40.4979744336, longitude = -88.9833910595)
        val after = MapPoint(latitude = 40.4983674522, longitude = -88.9834245174)
        val camelback = trail("54:1305", before, crossing, after)
        val start = 1_791_205_200_000L // 8 a.m. CDT, October 5, 2026
        val end = 1_791_324_000_000L // 5 p.m. CDT, October 6, 2026
        val route = assertNotNull(findRoute(listOf(camelback), before, after, start - 1))
        fun camel(now: Long) = TrailRouteAdvisorySijko.forRoute(route, now)
            .singleOrNull { it.id == "camelback-virginia-trail-crossing-2026-10-05" }
        assertTrue(assertNotNull(camel(start - 1)).message.startsWith("Scheduled, not closed yet"))
        assertTrue(assertNotNull(camel(start)).message.contains("closed Constitution Trail from 8 a.m. CDT"))
        assertTrue(assertNotNull(camel(end + 1)).message.contains("has passed; reopening has not been confirmed"))
        listOf(start - 1, start, end, end + 1).forEach { now ->
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now).isEmpty(), "blocked at $now")
            assertNotNull(findRoute(listOf(camelback), before, after, now))
        }
        // A trail that does not cross there has no notice.
        val elsewhere = trail("54:68", MapPoint(40.4990, -88.9900), MapPoint(40.5000, -88.9900))
        val other = assertNotNull(findRoute(listOf(elsewhere), elsewhere.paths[0][0], elsewhere.paths[0][1], start))
        assertNull(TrailRouteAdvisorySijko.forRoute(other, start).singleOrNull { it.id.startsWith("camelback") })
        // The notice does not claim a mapped closure interval.
        assertTrue(assertNotNull(camel(start)).message.contains("no closure limits along the trail"))
    }

    @Test
    fun hamiltonStaysAnInformationalNoticeWithTheOfficialMapEstimate() {
        val message = TrailRouteAdvisorySijko.forRoute(hamiltonRoute(), closure.activeFromEpochMillis)
            .single { it.id == "hamilton-rhodes-2026-08-17" }.message
        assertTrue(message.contains("object 841"))
        assertTrue(message.contains("October 31, 2026"))
        assertTrue(message.contains("an estimate does not confirm reopening"))
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(hamiltonRoute(), closure.activeFromEpochMillis).isEmpty())
        val late = TrailRouteAdvisorySijko.forRoute(hamiltonRoute(), 1_793_487_600_001L)
            .single { it.id == "hamilton-rhodes-2026-08-17" }.message
        assertTrue(late.contains("has passed; reopening has not been confirmed"))
    }

    @Test
    fun theDisplayCorridorsAreLabeledApproximateAndStartWithTheirClosures() {
        assertTrue(TrailRouteAdvisorySijko.approximateCorridors(closure.activeFromEpochMillis - 1).none { it.advisoryId == closure.id })
        val corridor = TrailRouteAdvisorySijko.approximateCorridors(closure.activeFromEpochMillis)
            .single { it.advisoryId == closure.id }
        assertTrue(corridor.label.contains("approximate; not exact closure limits"))
        assertEquals(closure.closedPath, corridor.points)
    }

    private fun hamiltonRoute() = TrailRoute(
        segments = listOf(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Access,
                name = "W Hamilton Rd",
                points = listOf(
                    MapPoint(latitude = 40.45132199983461, longitude = -88.97905500029931),
                    MapPoint(latitude = 40.45133099984453, longitude = -88.9771480000203),
                ),
            ),
        ),
        totalDistanceMeters = 200.0,
        ordinaryAccessDistanceMeters = 200.0,
        totalCost = 200.0,
    )

    private fun findRoute(features: List<TrailNetworkFeature>, from: MapPoint, to: MapPoint, now: Long) =
        TrailRouteCalculationSijko.findRoute(
            features = features,
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
            startPoint = from,
            destinationPoint = to,
            accessGraph = null,
            nowEpochMillis = now,
        )

    private fun trail(id: String, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        status = TrailFeatureStatus.Existing,
        routeRoles = setOf(TrailNetworkRole.TrailBranches),
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )
}
