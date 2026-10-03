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
    fun shortRoutesWhollyInsideTheSectionAreGatedAtEveryLengthInBothDirections() {
        val now = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        // Start 60% along the unchanged raw leg, as the review probe did: every length is inside the 202.5 m section.
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val first = along(0.6 * legMeters)
        listOf(1.0, 3.0, 5.0, 10.0, 14.0, 16.0, 30.0, 150.0).forEach { meters ->
            val other = along(0.6 * legMeters + meters)
            listOf(first to other, other to first).forEach { (from, to) ->
                val route = assertNotNull(findRoute(listOf(rawLeg), from, to, now - 1), "a $meters m route exists")
                assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now - 1).isEmpty(), "open before, $meters m")
                assertEquals(listOf(closure.id), gated(route, now), "gated at the instant, $meters m")
                assertEquals(listOf(closure.id), gated(route, estimate + 1), "gated after the estimate, $meters m")
                // A restored route is judged the same way: recalculation offers no way through it either.
                val outcome = TrailRouteClosureGateSijko.recalculate(
                    listOf(rawLeg), route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = now,
                )
                // A start or destination inside the closed section has no way around it: the only geometry a replacement
                // can have is an estimated hop to the nearest bound, which is not a detour. The shared gate must refuse it
                // itself, whatever any front end does with estimated hops.
                assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "recalculating a $meters m route inside the section gave $outcome")
                assertTrue(closure in (outcome as TrailRouteRecalculationOutcome.NoSafeRoute).blockingClosures)
            }
        }
    }

    @Test
    fun partialPenetrationAtEitherBoundaryIsGatedButApproachesThatStopAtABoundAreNot() {
        val now = closure.activeFromEpochMillis
        val south = TrailDistanceSijko.metersBetween(vertex97, closure.closedFrom)
        val north = south + TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        fun routeOf(from: Double, to: Double) =
            assertNotNull(findRoute(listOf(rawLeg), along(from), along(to), now - 1), "route $from to $to")
        listOf(
            // a few meters into the section from the south, and out through the north
            routeOf(south - 4.0, south + 3.0), routeOf(south + 3.0, south - 4.0),
            routeOf(north - 3.0, north + 4.0), routeOf(north + 4.0, north - 3.0),
            // across the whole section and out both sides
            routeOf(south - 20.0, north + 20.0), routeOf(north + 20.0, south - 20.0),
        ).forEach { route -> assertEquals(listOf(closure.id), gated(route, now)) }
        listOf(
            // residual approaches that end exactly at, or short of, a bound
            routeOf(south - 30.0, south), routeOf(south, south - 30.0), routeOf(south - 30.0, south - 0.3),
            routeOf(north, north + 30.0), routeOf(north + 30.0, north), routeOf(north + 0.3, north + 30.0),
        ).forEach { route -> assertTrue(gated(route, now).isEmpty(), "residual approach is not travel along the section") }
    }

    @Test
    fun recalculationNeverOffersAReplacementThatStartsOrEndsInsideTheSectionButStillRepairsUnaffectedRoutes() {
        val now = closure.activeFromEpochMillis
        val south = TrailDistanceSijko.metersBetween(vertex97, closure.closedFrom)
        val north = south + TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        fun recalc(from: Double, to: Double): TrailRouteRecalculationOutcome {
            val route = assertNotNull(findRoute(listOf(rawLeg), along(from), along(to), now - 1), "route $from to $to")
            return TrailRouteClosureGateSijko.recalculate(listOf(rawLeg), route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = now)
        }
        // Brief penetration at either boundary, and routes wholly inside: nothing is offered.
        listOf(
            south - 4.0 to south + 3.0, south + 3.0 to south - 4.0, north - 3.0 to north + 4.0, north + 4.0 to north - 3.0,
            south + 1.0 to south + 5.0, south + 100.0 to south + 114.0,
        ).forEach { (from, to) ->
            val outcome = recalc(from, to)
            assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "$from to $to gave $outcome")
            assertTrue(closure in (outcome as TrailRouteRecalculationOutcome.NoSafeRoute).blockingClosures)
        }
        // An unaffected residual route is still a legitimate recalculation: a replacement, itself outside the section.
        listOf(south - 30.0 to south - 0.3, north + 0.3 to north + 30.0).forEach { (from, to) ->
            val outcome = recalc(from, to)
            assertTrue(outcome is TrailRouteRecalculationOutcome.Replacement, "unaffected $from to $to gave $outcome")
            val replacement = (outcome as TrailRouteRecalculationOutcome.Replacement).route
            assertTrue(gated(replacement, now).isEmpty())
            assertFalse(TrailRouteAdvisorySijko.entersClosedSection(replacement, now))
        }
        // The check is about the mapped section only: before the closure begins nothing is inside anything.
        val early = assertNotNull(findRoute(listOf(rawLeg), along(south + 1.0), along(south + 5.0), now - 1))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(early, now - 1))
        assertTrue(TrailRouteAdvisorySijko.entersClosedSection(early, now))
    }

    @Test
    fun theReversedRawPathAndReversedBoundsCutAndGateTheSameWay() {
        val now = closure.activeFromEpochMillis
        val reversed = trail("54:1305", vertex98, vertex97)
        val cut = TrailRouteClosureSijko.openFeatures(listOf(reversed), now).features.single().paths
        assertEquals(listOf(listOf(vertex98, closure.closedTo), listOf(closure.closedFrom, vertex97)), cut)
        val swapped = closure.copy(closedFrom = closure.closedTo, closedTo = closure.closedFrom)
        // Whichever bound is named first, the section comes out in path order.
        assertEquals(
            listOf(closure.closedFrom, closure.closedTo),
            TrailRouteClosureSijko.closedSection(listOf(vertex97, vertex98), swapped),
        )
        val route = assertNotNull(findRoute(listOf(reversed), vertex98, vertex97, now - 1))
        assertEquals(listOf(closure.id), gated(route, now))
    }

    @Test
    fun theActualCypressCrossingInEitherFeatureOrderIsUsableAndNotGated() {
        val now = closure.activeFromEpochMillis + 1
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        // The ACTUAL vertices 17 to 23 of county 16:188 (a SharedRoadways feature): it meets the trail 0.4 m from the
        // south bound, inside the router's snap distance, and runs east and west across it.
        val cypress = shared("16:188", *cypressVertices)
        listOf(listOf(rawLeg, cypress), listOf(cypress, rawLeg)).forEach { features ->
            listOf(cypressVertices.first() to cypressVertices.last(), cypressVertices.last() to cypressVertices.first())
                .forEach { (from, to) ->
                    val route = assertNotNull(findRoute(features, from, to, closure.activeFromEpochMillis - 1), "crossing route")
                    assertTrue(route.edges.any { it.sourceFeatureId == "16:188" })
                    assertTrue(
                        route.segments.flatMap { it.points }
                            .any { TrailDistanceSijko.metersBetween(it, closure.closedFrom) < 1.0 },
                        "the route really crosses at the south bound",
                    )
                    assertTrue(gated(route, now).isEmpty(), "perpendicular crossing is not travel along the section")
                    assertTrue(gated(route, estimate + 1).isEmpty())
                    // And the cut network still lets the crossing be planned afterwards.
                    assertNotNull(findRoute(features, from, to, now))
                }
            // The crossing together with a residual approach: still no travel along the section.
            val approach = assertNotNull(findRoute(features, vertex97, closure.closedFrom, now))
            assertTrue(gated(approach, now).isEmpty())
        }
    }

    @Test
    fun theCamelbackCrossingBlocksStartFromItsInstantInBothDirectionsAndAfterTheEstimate() {
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val start = crossing.activeFromEpochMillis // 8 a.m. CDT, October 5, 2026
        val end = assertNotNull(crossing.estimatedEndEpochMillis) // 5 p.m. CDT, October 6, 2026
        val trailFeature = trail("54:1305", southEnd, vertex6, vertex7, vertex8, northEnd)
        // The preview is available at every instant, because nothing is cut: the router cannot plan around it.
        listOf(southEnd to northEnd, northEnd to southEnd).forEach { (from, to) ->
            val route = assertNotNull(findRoute(listOf(trailFeature), from, to, start - 1))
            // Scheduled before: a notice, nothing blocks.
            assertTrue(gated(route, start - 1).isEmpty())
            val scheduled = assertNotNull(camel(route, start - 1)).message
            assertTrue(scheduled.startsWith("Scheduled, not closed yet"))
            // Before it begins nothing is refused yet: the notice says what WILL happen, never that it is happening.
            assertFalse(scheduled.contains("does not start this route"))
            assertTrue(scheduled.contains("This route can still be started until then"))
            assertTrue(scheduled.contains("will not start a route that crosses there"))
            // From the instant: refused, including one millisecond after the estimated end and long after it.
            listOf(start, start + 1, end, end + 1, end + 30 * 86_400_000L).forEach { now ->
                assertEquals(listOf(crossing.id), gated(route, now), "blocked at $now")
                assertNotNull(findRoute(listOf(trailFeature), from, to, now), "the preview still exists at $now")
            }
            assertTrue(assertNotNull(camel(route, start)).message.contains("closed Constitution Trail from 8 a.m. CDT"))
            assertTrue(assertNotNull(camel(route, start)).message.contains("does not start this route"))
            assertTrue(assertNotNull(camel(route, end + 1)).message.contains("has passed; reopening has not been confirmed"))
            // Recalculation cannot plan around it, and says so rather than offering the same crossing.
            val outcome = TrailRouteClosureGateSijko.recalculate(
                listOf(trailFeature), route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = start,
            )
            assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute)
            assertEquals(listOf(crossing), (outcome as TrailRouteRecalculationOutcome.NoSafeRoute).blockingClosures)
        }
        // A route that stops short of the crossing, or begins beyond it, does not traverse it.
        val short = assertNotNull(findRoute(listOf(trailFeature), southEnd, vertex6, start))
        val beyond = assertNotNull(findRoute(listOf(trailFeature), vertex8, northEnd, start))
        listOf(short, beyond).forEach { assertTrue(gated(it, start).isEmpty()) }
        // The road that crosses the trail there and the neighboring trails are not closed.
        val road = shared(
            "16:297",
            MapPoint(vertex7.latitude - 0.00005, vertex7.longitude - 0.002),
            vertex7,
            MapPoint(vertex7.latitude + 0.00005, vertex7.longitude + 0.002),
        )
        val neighbor = trail("54:68", MapPoint(40.4990, -88.9900), MapPoint(40.5000, -88.9900))
        val features = listOf(trailFeature, road, neighbor)
        val alongRoad = assertNotNull(findRoute(features, road.paths[0].first(), road.paths[0].last(), start))
        assertTrue(gated(alongRoad, start).isEmpty())
        assertTrue(alongRoad.edges.all { it.sourceFeatureId != "54:1305" })
        val alongNeighbor = assertNotNull(findRoute(features, neighbor.paths[0][0], neighbor.paths[0][1], start))
        assertTrue(gated(alongNeighbor, start).isEmpty())
        assertNull(camel(alongNeighbor, start))
    }

    @Test
    fun theCrossingClosureCutsNothingAndHasNoInterval() {
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val feature = trail("54:1305", southEnd, vertex6, vertex7, vertex8, northEnd)
        val network = TrailRouteClosureSijko.openFeatures(listOf(feature), crossing.activeFromEpochMillis)
        assertEquals(listOf(feature), network.features)
        assertTrue(crossing !in network.appliedClosures)
        assertTrue(crossing.isCrossing)
        assertEquals(crossing.closedFrom, crossing.closedTo)
        assertNull(TrailRouteAdvisorySijko.approximateCorridors(crossing.activeFromEpochMillis).singleOrNull { it.advisoryId == crossing.id })
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

    private fun gated(route: TrailRoute, now: Long) = TrailRouteClosureGateSijko.blockingAdvisories(route, now).map { it.id }

    private fun camel(route: TrailRoute, now: Long) =
        TrailRouteAdvisorySijko.forRoute(route, now).singleOrNull { it.id == TrailRouteClosureSijko.camelbackCrossing.id }

    /** A point [meters] along the raw leg from vertex 97 toward vertex 98. */
    private fun along(meters: Double): MapPoint {
        val fraction = meters / TrailDistanceSijko.metersBetween(vertex97, vertex98)
        return MapPoint(
            latitude = vertex97.latitude + (vertex98.latitude - vertex97.latitude) * fraction,
            longitude = vertex97.longitude + (vertex98.longitude - vertex97.longitude) * fraction,
        )
    }

    private val cypressVertices = arrayOf(
        MapPoint(40.51310035684313, -88.98524723245112),
        MapPoint(40.513108846844446, -88.98489778315425),
        MapPoint(40.513112229536965, -88.9846629215164),
        MapPoint(40.51311225994217, -88.98465752712063),
        MapPoint(40.513113215957986, -88.98460965908697),
        MapPoint(40.51312175214399, -88.98425166848882),
        MapPoint(40.51312759544274, -88.98382329541326),
    )

    // The actual vertices 6, 7 and 8 of county trail 54:1305, path 0, around the Virginia Avenue crossing, with trail
    // ends a short way beyond them so a route has room to snap on both sides.
    private val vertex6 = MapPoint(latitude = 40.4979744336, longitude = -88.9833910595)
    private val vertex7 = MapPoint(latitude = 40.4982765696, longitude = -88.9834168982)
    private val vertex8 = MapPoint(latitude = 40.4983674522, longitude = -88.9834245174)
    private val southEnd = MapPoint(latitude = vertex6.latitude - 0.0015, longitude = vertex6.longitude + 0.00002)
    private val northEnd = MapPoint(latitude = vertex8.latitude + 0.0015, longitude = vertex8.longitude - 0.00002)

    private fun shared(id: String, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        status = TrailFeatureStatus.Existing,
        routeRoles = setOf(TrailNetworkRole.SharedRoadways),
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )

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
