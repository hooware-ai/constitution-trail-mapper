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
import kotlin.test.assertIs
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
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, activeNow, emptyList()).isEmpty())
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
        // The check is about estimated hops only. A routed trail route inside the section is the travel gate's business
        // (and is gated), and before the closure begins nothing is inside anything.
        val early = assertNotNull(findRoute(listOf(rawLeg), along(south + 1.0), along(south + 5.0), now - 1))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(early, now - 1))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(early, now))
        assertEquals(listOf(closure.id), gated(early, now))
        // An estimated hop that starts inside the section is what the check exists to stop.
        val hop = early.copy(
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    isRouted = false,
                    points = listOf(along(south + 1.0), closure.closedFrom),
                ),
            ),
            edges = emptyList(),
        )
        assertTrue(TrailRouteAdvisorySijko.entersClosedSection(hop, now))
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(hop, now - 1))
        // A hop that ends at the bound from outside, or crosses beside the section, does not.
        val outside = hop.copy(
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    isRouted = false,
                    points = listOf(along(south - 30.0), closure.closedFrom),
                ),
            ),
        )
        assertFalse(TrailRouteAdvisorySijko.entersClosedSection(outside, now))
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
            // It speaks only for this closure: other notices may already refuse the same route.
            assertFalse(scheduled.contains("can still be started"))
            assertTrue(scheduled.contains("this closure does not stop Trail Mapper from starting a route (other closures and checks may)"))
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

    @Test
    fun aRouteThatFollowsTheNodeAnchoredChordOfTheSourceLegIsGatedAlongTheSameInterval() {
        // The graph puts every vertex within its snap tolerance on one node. A neighboring feature that is listed first
        // owns the node at vertex 98, so the saved route follows a chord to ITS point, a few meters off the raw line.
        val now = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val spur = trail("54:9100", eastOf(vertex98, 4.0), eastOf(vertex98, 60.0))
        var derived = 0
        listOf(listOf(spur, rawLeg), listOf(rawLeg, spur)).forEach { features ->
            derivedLegs = derivedOf(features)
            listOf(1.0, 5.0, 10.0, 14.0, 30.0).forEach { meters ->
                val a = mapped(features, along(0.6 * legMeters))
                val b = mapped(features, along(0.6 * legMeters + meters))
                listOf(a to b, b to a).forEach { (from, to) ->
                    val route = assertNotNull(findRoute(features, from, to, now - 1), "a $meters m route exists")
                    // Positively Start-eligible before the closure: current, no estimated hop, on the source feature.
                    assertTrue(route.segments.none { !it.isRouted }, "no estimated hop at $meters m")
                    assertTrue(route.edges.isNotEmpty() && route.edges.all { it.sourceFeatureId == "54:1305" })
                    assertTrue(gated(route, now - 1).isEmpty())
                    if (route.segments.flatMap { it.points }.any { TrailDistanceSijko.projectToSegment(it, vertex97, vertex98).distanceMeters > 0.5 }) {
                        derived++
                    }
                    assertEquals(listOf(closure.id), gated(route, now), "derived line, $meters m, at the instant")
                    assertEquals(listOf(closure.id), gated(route, estimate + 1), "derived line, $meters m, after the estimate")
                    val outcome = TrailRouteClosureGateSijko.recalculate(
                        features, route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = now, derived = derivedLegs,
                    )
                    assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "recalculating gave $outcome")
                    assertTrue(closure in (outcome as TrailRouteRecalculationOutcome.NoSafeRoute).blockingClosures)
                }
            }
        }
        // Not vacuous: in the spur-first order these routes really do leave the raw line, so a raw-line check would miss them.
        assertTrue(derived >= 10, "only $derived routes followed a derived line")
    }

    @Test
    fun theDerivedLineStillLeavesTheResidualsTheSpurAndAParallelTrackOfAnotherFeatureOpen() {
        val now = closure.activeFromEpochMillis
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val spur = trail("54:9100", eastOf(vertex98, 4.0), eastOf(vertex98, 60.0))
        // A different feature running 4 m beside the closed section is not the closed trail: no blanket radius.
        val parallel = trail("54:9200", eastOf(along(300.0), 4.0), eastOf(along(700.0), 4.0))
        val features = listOf(spur, rawLeg, parallel)
        derivedLegs = derivedOf(features)
        fun open(from: MapPoint, to: MapPoint) {
            val route = assertNotNull(findRoute(features, mapped(features, from), mapped(features, to), now - 1))
            assertTrue(route.segments.none { !it.isRouted })
            assertTrue(gated(route, now).isEmpty(), "outside the section: $from to $to")
        }
        // Residual approaches of the source leg that stop at the bounds, and beyond them.
        open(along(30.0), along(300.0))
        open(along(650.0), along(legMeters - 3.0))
        // The spur itself, and the parallel track's own length across the interval.
        open(eastOf(vertex98, 10.0), eastOf(vertex98, 50.0))
        val onParallel = assertNotNull(findRoute(features, mapped(features, eastOf(along(420.0), 4.0)), mapped(features, eastOf(along(560.0), 4.0)), now - 1))
        assertTrue(onParallel.edges.all { it.sourceFeatureId == "54:9200" })
        assertTrue(gated(onParallel, now).isEmpty())
    }

    @Test
    fun theCamelbackCrossingIsGatedWhenGraphNodeAnchoringMovesTheChordOffTheCrossingPoint() {
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val start = crossing.activeFromEpochMillis
        val end = assertNotNull(crossing.estimatedEndEpochMillis)
        val leg = trail("54:1305", southEnd, vertex6, vertex7, vertex8, northEnd)
        // A spur listed first owns the node at vertex 7, 4 m east. A route that starts or ends partway along the edge
        // then follows a chord to ITS point, which passes the crossing (0.8 m short of vertex 7) about 3.9 m off the line.
        val spur = trail("54:9100", eastOf(vertex7, 4.0), eastOf(vertex7, 60.0))
        fun beside(meters: Double) = MapPoint(crossing.closedFrom.latitude + meters / 111_194.93, crossing.closedFrom.longitude)
        var derived = 0
        listOf(listOf(spur, leg), listOf(leg, spur)).forEach { features ->
            derivedLegs = derivedOf(features)
            val south = mapped(features, beside(-15.0))
            val north = mapped(features, MapPoint(vertex8.latitude + 0.0005, vertex8.longitude))
            listOf(south to north, north to south).forEach { (from, to) ->
                val route = assertNotNull(findRoute(features, from, to, start - 1))
                assertTrue(route.segments.none { !it.isRouted })
                assertTrue(gated(route, start - 1).isEmpty())
                val nearest = route.segments.flatMap { it.points }.zipWithNext()
                    .minOf { (a, b) -> TrailDistanceSijko.projectToSegment(crossing.closedFrom, a, b).distanceMeters }
                if (nearest > 3.0) {
                    derived++
                }
                listOf(start, end + 1).forEach { now -> assertEquals(listOf(crossing.id), gated(route, now), "at $now") }
            }
            // Short of the crossing and beyond it stay open.
            val short = assertNotNull(findRoute(features, mapped(features, beside(-30.0)), south, start))
            val beyond = assertNotNull(findRoute(features, mapped(features, vertex8), north, start))
            listOf(short, beyond).forEach { assertTrue(gated(it, start).isEmpty()) }
        }
        assertTrue(derived >= 2, "only $derived routes passed the crossing off the raw line")
    }

    @Test
    fun aMappedRoadDetourIsEligibleWhateverVerticesItKeepsAndStillRecalculatesWhileTheEstimatedHopEscapeIsRefused() {
        val now = closure.activeFromEpochMillis
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val a = closure.closedFrom
        val b = closure.closedTo
        val m = MapPoint((a.latitude + b.latitude) / 2.0, (a.longitude + b.longitude) / 2.0)
        fun west(point: MapPoint) = eastOf(point, -51.0)
        fun east(point: MapPoint) = eastOf(point, 51.0)
        // An explicitly open mapped road that leaves the trail at one bound, crosses the trail line, and rejoins at the other.
        val sparse = listOf(a, west(a), west(m), east(m), east(b), b, vertex98)
        val dense = listOf(a, west(a), west(m), m, east(m), east(b), b, vertex98)
        listOf(sparse, dense).forEach { path ->
            val roads = listOf(AccessNetworkFeature(id = "8:detour", name = "Detour St", roadClass = "S1400", paths = listOf(path)))
            val graph = AccessGraphBuilderSijko.buildGraph(roads)
            val saved = assertNotNull(findRoute(listOf(rawLeg), vertex97, vertex98, now - 1, graph))
            assertTrue(gated(saved, now - 1).isEmpty())
            // Positively eligible at the instant: an ordinary closure gate and no estimated hop, trail plus mapped road.
            val fresh = assertNotNull(findRoute(listOf(rawLeg), vertex97, vertex98, now, graph), "the detour is planned")
            assertTrue(gated(fresh, now).isEmpty())
            assertTrue(fresh.segments.none { !it.isRouted }, "no estimated hop")
            assertTrue(fresh.segments.any { it.type == TrailRouteSegmentType.Access && it.isRouted }, "the mapped road is used")
            assertEquals(listOf(closure.id), gated(saved, now))
            val outcome = TrailRouteClosureGateSijko.recalculate(listOf(rawLeg), saved, TrailRouteRerouteAccess.Roads(roads), nowEpochMillis = now)
            val replacement = assertIs<TrailRouteRecalculationOutcome.Replacement>(outcome, "${path.size} vertices gave $outcome").route
            assertTrue(gated(replacement, now).isEmpty())
            assertFalse(TrailRouteAdvisorySijko.entersClosedSection(replacement, now))
            // The planner keeps the extra collinear vertex of the dense road in the mapped geometry (not vacuous).
            val keepsM = replacement.segments.flatMap { it.points }.any { TrailDistanceSijko.metersBetween(it, m) < 0.5 }
            assertEquals(path.size == dense.size, keepsM, "${path.size} vertices: the vertex on the trail line is retained")
            // The original escape stays refused: a route that starts inside the section has only an estimated hop out.
            val inside = assertNotNull(findRoute(listOf(rawLeg), along(0.6 * legMeters), along(0.6 * legMeters + 10.0), now - 1, graph))
            val refused = TrailRouteClosureGateSijko.recalculate(listOf(rawLeg), inside, TrailRouteRerouteAccess.Roads(roads), nowEpochMillis = now)
            assertTrue(refused is TrailRouteRecalculationOutcome.NoSafeRoute, "inside route gave $refused")
        }
    }

    @Test
    fun theScheduledCamelbackNoticeDoesNotPromiseStartWhileAnotherClosureAlreadyRefusesTheRoute() {
        val camelback = TrailRouteClosureSijko.camelbackCrossing
        // One trail from the Camelback vertices, around by the east, to the Willow leg's north end and down it: a route
        // that crosses both, planned before either notice (it keeps clear of the Uptown corridor).
        val both = trail(
            "54:1305", southEnd, vertex6, vertex7, vertex8,
            MapPoint(40.4990, -88.9700), MapPoint(40.5200, -88.9700), MapPoint(40.5200, -88.9849), vertex98, vertex97,
        )
        val between = closure.activeFromEpochMillis // 6 a.m. CDT Oct 5: Willow is in force, Camelback still scheduled
        assertTrue(between < camelback.activeFromEpochMillis)
        val route = assertNotNull(findRoute(listOf(both), southEnd, vertex97, between - 1))
        assertTrue(gated(route, between - 1).isEmpty())
        // Willow refuses it while the Camelback notice is only scheduled.
        assertEquals(listOf(closure.id), gated(route, between))
        val notice = assertNotNull(camel(route, between)).message
        assertTrue(notice.startsWith("Scheduled, not closed yet"))
        assertFalse(notice.contains("can still be started"))
        assertFalse(notice.contains("does not start this route"))
        assertTrue(notice.contains("this closure does not stop Trail Mapper from starting a route (other closures and checks may)"))
        // Once Camelback is active both refuse it.
        assertEquals(setOf(closure.id, camelback.id), gated(route, camelback.activeFromEpochMillis).toSet())
    }

    @Test
    fun theDecisionIsInvariantUnderCollinearSubdivisionOfTheSameGeometry() {
        val now = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        // The northern node 14 m east of the raw endpoint: the largest displacement the graph allows, where the transfer
        // error of a single sparse leg is at its largest. The dense copy of a route is the same physical geometry.
        val spur = trail("54:9100", eastOf(vertex98, 14.0), eastOf(vertex98, 60.0))
        var denseChecked = 0
        listOf(listOf(spur, rawLeg), listOf(rawLeg, spur)).forEach { features ->
            derivedLegs = derivedOf(features)
            listOf(1.0, 5.0, 20.0, 100.0).forEach { meters ->
                val a = mapped(features, along(0.6 * legMeters))
                val b = mapped(features, along(0.6 * legMeters + meters))
                listOf(a to b, b to a).forEach { (from, to) ->
                    val sparse = assertNotNull(findRoute(features, from, to, now - 1))
                    assertTrue(sparse.segments.none { !it.isRouted })
                    listOf(0.1, 0.01).forEach { spacing ->
                        val dense = subdivided(sparse, spacing)
                        assertTrue(dense.segments.sumOf { it.points.size } > sparse.segments.sumOf { it.points.size })
                        denseChecked++
                        assertTrue(gated(dense, now - 1).isEmpty())
                        listOf(now, estimate + 1).forEach { at ->
                            assertEquals(listOf(closure.id), gated(sparse, at), "sparse $meters m at $at")
                            assertEquals(gated(sparse, at), gated(dense, at), "dense $meters m ($spacing m legs) at $at")
                        }
                    }
                }
            }
        }
        assertTrue(denseChecked >= 32)
        // The same on the raw source line, and with no recorded source (judged by geometry alone).
        val raw = assertNotNull(findRoute(listOf(rawLeg), along(0.6 * legMeters), along(0.6 * legMeters + 5.0), now - 1))
        listOf(raw, raw.copy(edges = emptyList())).forEach { route ->
            assertEquals(listOf(closure.id), gated(route, now))
            assertEquals(listOf(closure.id), gated(subdivided(route, 0.001), now))
        }
    }

    @Test
    fun collinearSubdivisionDoesNotChangeTheBoundaryControlsOrTheCrossingOrAnEstimatedHop() {
        val now = closure.activeFromEpochMillis
        val south = TrailDistanceSijko.metersBetween(vertex97, closure.closedFrom)
        val north = south + TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        val spur = trail("54:9100", eastOf(vertex98, 14.0), eastOf(vertex98, 60.0))
        listOf(listOf(rawLeg), listOf(spur, rawLeg)).forEach { features ->
            derivedLegs = derivedOf(features)
            fun route(from: Double, to: Double) =
                assertNotNull(findRoute(features, mapped(features, onTheLeg(from)), mapped(features, onTheLeg(to)), now - 1))
            // Penetration at either bound is refused sparse and dense; an approach that ends at a bound is open in both.
            listOf(
                route(south - 4.0, south + 3.0), route(north + 4.0, north - 3.0), route(south - 20.0, north + 20.0),
            ).forEach { sparse ->
                assertEquals(listOf(closure.id), gated(sparse, now))
                assertEquals(listOf(closure.id), gated(subdivided(sparse, 0.05), now))
            }
            listOf(
                route(south - 30.0, south), route(south, south - 30.0), route(north, north + 30.0), route(north + 30.0, north),
            ).forEach { sparse ->
                assertTrue(gated(sparse, now).isEmpty())
                assertTrue(gated(subdivided(sparse, 0.05), now).isEmpty(), "an approach that stops at a bound stays open when dense")
            }
        }
        // The Camelback crossing, on a derived chord and on the raw line, sparse and dense.
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val camelStart = crossing.activeFromEpochMillis
        val leg = trail("54:1305", southEnd, vertex6, vertex7, vertex8, northEnd)
        val camelSpur = trail("54:9100", eastOf(vertex7, 14.0), eastOf(vertex7, 60.0))
        listOf(listOf(leg), listOf(camelSpur, leg)).forEach { features ->
            derivedLegs = derivedOf(features)
            val a = mapped(features, MapPoint(crossing.closedFrom.latitude - 15.0 / 111_194.93, crossing.closedFrom.longitude))
            val b = mapped(features, MapPoint(vertex8.latitude + 0.0005, vertex8.longitude))
            listOf(a to b, b to a).forEach { (from, to) ->
                val sparse = assertNotNull(findRoute(features, from, to, camelStart - 1))
                assertEquals(listOf(crossing.id), gated(sparse, camelStart))
                assertEquals(listOf(crossing.id), gated(subdivided(sparse, 0.05), camelStart))
            }
        }
        // An estimated hop that starts inside the section is refused whatever vertices it keeps.
        val inside = along(south + 40.0)
        val hop = TrailRoute(
            segments = listOf(
                TrailRouteSegment(type = TrailRouteSegmentType.Access, isRouted = false, points = listOf(inside, closure.closedFrom)),
            ),
            totalDistanceMeters = 40.0, ordinaryAccessDistanceMeters = 40.0, totalCost = 40.0,
        )
        assertTrue(TrailRouteAdvisorySijko.entersClosedSection(hop, now))
        assertTrue(TrailRouteAdvisorySijko.entersClosedSection(subdivided(hop, 0.05, allTypes = true), now))
    }

    @Test
    fun anApproachThatEndsAtTheTransferredBoundIsOpenAndAnyPenetrationPastItIsRefusedOnADerivedChord() {
        val now = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val south = TrailDistanceSijko.metersBetween(vertex97, closure.closedFrom)
        val north = south + TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        // The northern node 14 m east of the raw endpoint, listed first, in both feature orders; each bound is carried
        // onto the chord by its fraction of the raw leg, and the control rides to exactly that point and past it.
        val spur = trail("54:9100", eastOf(vertex98, 14.0), eastOf(vertex98, 60.0))
        listOf(listOf(spur, rawLeg), listOf(rawLeg, spur)).forEach { features ->
            derivedLegs = derivedOf(features)
            val leg = derivedLegs.singleOrNull { it.closureId == closure.id }
            if (leg == null) {
                // The spur does not own the node in this order: the geometry is the raw leg and needs no transfer.
                assertTrue(derivedLegs.none { it.closureId == closure.id })
                return@forEach
            }
            val chordMeters = TrailDistanceSijko.metersBetween(leg.from, leg.to)
            fun onChord(position: Double) = MapPoint(
                leg.from.latitude + (leg.to.latitude - leg.from.latitude) * position / chordMeters,
                leg.from.longitude + (leg.to.longitude - leg.from.longitude) * position / chordMeters,
            )
            // Not vacuous: the chord really is off the raw line, and the transferred bounds are not the projected ones.
            assertTrue(TrailDistanceSijko.projectToSegment(onChord(leg.low), vertex97, vertex98).distanceMeters > 1.0)
            assertEquals(south * chordMeters / legMeters, leg.low, 0.05)
            assertEquals(north * chordMeters / legMeters, leg.high, 0.05)
            fun route(from: Double, to: Double) =
                assertNotNull(findRoute(features, mapped(features, onChord(from)), mapped(features, onChord(to)), now - 1), "$from to $to")
            listOf(0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 3.0).forEach { into ->
                listOf(
                    route(leg.low - 20.0, leg.low + into), route(leg.low + into, leg.low - 20.0),
                    route(leg.high + 20.0, leg.high - into), route(leg.high - into, leg.high + 20.0),
                ).forEach { sparse ->
                    assertTrue(sparse.segments.none { !it.isRouted })
                    assertTrue(gated(sparse, now - 1).isEmpty())
                    assertEquals(listOf(closure.id), gated(sparse, now), "$into m past a bound")
                    assertEquals(listOf(closure.id), gated(sparse, estimate + 1))
                    assertEquals(listOf(closure.id), gated(subdivided(sparse, 0.01), now), "$into m past a bound, dense")
                }
            }
            listOf(
                route(leg.low - 30.0, leg.low), route(leg.low, leg.low - 30.0),
                route(leg.high, leg.high + 30.0), route(leg.high + 30.0, leg.high),
            ).forEach { sparse ->
                assertTrue(gated(sparse, now - 1).isEmpty())
                assertTrue(gated(sparse, now).isEmpty(), "ending exactly at the transferred bound is not travel")
                assertTrue(gated(subdivided(sparse, 0.01), now).isEmpty())
            }
        }
    }

    @Test
    fun anOutsideBendCannotHideExactClosedTravelAtTheBoundary() {
        val now = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val low = TrailDistanceSijko.metersBetween(vertex97, closure.closedFrom)
        val straight = assertNotNull(findRoute(listOf(rawLeg), along(low - 21.0), along(low + 0.1), now - 1))
        assertTrue(legMeters > low + 1.0)
        assertEquals(listOf(closure.id), gated(straight, now))
        // The same start and the same closed tail, with a bend that stays outside the closure and inside the 0.5 m the
        // geometry check allows. Distances and cost follow the changed geometry.
        fun point(along: Double, across: Double): MapPoint {
            val base = along(along)
            return eastOf(base, across)
        }
        val bent = listOf(point(low - 21.0, 0.0), point(low - 1.0, 0.4), point(low, 0.0), point(low + 0.1, 0.0))
        val length = TrailDistanceSijko.pathLengthMeters(bent)
        val route = straight.copy(
            segments = listOf(straight.segments.single().copy(points = bent)),
            edges = straight.edges.map { edge -> edge.copy(routeSegments = listOf(edge.routeSegments.single().copy(points = bent)), distanceMeters = length) },
            totalDistanceMeters = length,
            totalCost = straight.totalCost * length / straight.totalDistanceMeters,
        )
        assertTrue(gated(route, now - 1).isEmpty())
        assertEquals(listOf(closure.id), gated(route, now), "the bend outside the closure must not hide the travel inside it")
        assertEquals(listOf(closure.id), gated(route, estimate + 1))
        // An outside bend with no closed tail is not travel; the tail alone, however short and however subdivided, is.
        val ends = bent.take(3)
        assertTrue(gated(route.copy(segments = listOf(route.segments.single().copy(points = ends)), edges = emptyList()), now).isEmpty())
        val tail = bent.takeLast(2)
        assertEquals(listOf(closure.id), gated(subdivided(route.copy(segments = listOf(route.segments.single().copy(points = tail))), 0.01), now))
    }

    @Test
    fun theGraphCarriesAClosureAcrossASourceLegOfAMultiVertexRunPiecewise() {
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val start = crossing.activeFromEpochMillis
        // A vertex 5 m before vertex 6 shares its node, so the run is W, 6, 7 with vertex 6 a bend INSIDE it; a spur
        // listed first owns vertex 7's node, 14 m east. The crossing lies on source leg 6 to 7 only.
        val before = MapPoint(vertex6.latitude - 5.0 / 111_194.93, vertex6.longitude)
        val leg = trail("54:1305", southEnd, before, vertex6, vertex7, vertex8, northEnd)
        val spur = trail("54:9100", eastOf(vertex7, 14.0), eastOf(vertex7, 60.0))
        val features = listOf(spur, leg)
        derivedLegs = derivedOf(features)
        val legs = derivedLegs.filter { it.closureId == crossing.id }
        // The run's own derived form and any junction connector of it each stand for source leg 6 to 7.
        assertTrue(legs.isNotEmpty(), "a derived leg stands for source leg 6 to 7")
        val derivedLeg = legs.first { TrailDistanceSijko.metersBetween(it.from, vertex6) < 0.01 }
        // Piecewise: the leg starts at the unchanged interior vertex 6 and ends on the displaced node, so the position is
        // the crossing's fraction of source leg 6 to 7 (about 0.98), never its fraction of the whole run's length.
        assertTrue(TrailDistanceSijko.metersBetween(derivedLeg.from, vertex6) < 0.01)
        assertEquals(14.0, TrailDistanceSijko.metersBetween(derivedLeg.to, vertex7), 0.5)
        val length = TrailDistanceSijko.metersBetween(derivedLeg.from, derivedLeg.to)
        val fraction = TrailDistanceSijko.metersBetween(vertex6, crossing.closedFrom) / TrailDistanceSijko.metersBetween(vertex6, vertex7)
        assertEquals(fraction * length, derivedLeg.low, 0.05)
        assertEquals(derivedLeg.low, derivedLeg.high, 1e-9)
        // Routes over the crossing on that leg, sparse and dense, both directions: open before, refused from the instant.
        fun onDerived(position: Double) = MapPoint(
            derivedLeg.from.latitude + (derivedLeg.to.latitude - derivedLeg.from.latitude) * position / length,
            derivedLeg.from.longitude + (derivedLeg.to.longitude - derivedLeg.from.longitude) * position / length,
        )
        listOf(0.02, 0.5, 3.0).forEach { into ->
            val a = mapped(features, onDerived(derivedLeg.low - 15.0))
            val b = mapped(features, onDerived(derivedLeg.low + into))
            listOf(a to b, b to a).forEach { (from, to) ->
                val route = assertNotNull(findRoute(features, from, to, start - 1))
                assertTrue(route.segments.none { !it.isRouted })
                assertTrue(gated(route, start - 1).isEmpty())
                assertEquals(listOf(crossing.id), gated(route, start), "$into m past the transferred crossing")
                assertEquals(listOf(crossing.id), gated(subdivided(route, 0.01), start))
            }
        }
        // Ending 10 m short of the transferred crossing is not a crossing.
        val short = assertNotNull(findRoute(features, mapped(features, onDerived(derivedLeg.low - 30.0)), mapped(features, onDerived(derivedLeg.low - 10.0)), start))
        assertTrue(gated(short, start).isEmpty())
    }

    @Test
    fun theGraphIsTheOnlySourceOfTheCorrespondenceAndASavedRouteCannotSupplyIt() {
        val now = closure.activeFromEpochMillis
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val spur = trail("54:9100", eastOf(vertex98, 14.0), eastOf(vertex98, 60.0))
        val features = listOf(spur, rawLeg)
        val legs = derivedOf(features)
        derivedLegs = legs
        val route = assertNotNull(findRoute(features, mapped(features, along(0.6 * legMeters)), mapped(features, along(0.6 * legMeters + 5.0)), now - 1))
        assertEquals(listOf(closure.id), gated(route, now))
        // Nothing in the serialized route can substitute for the graph's legs: a decoded copy is judged identically, with
        // the legs and without them (the default call is conservative, never silent).
        val serialized = kotlinx.serialization.json.Json.decodeFromString(
            TrailRoute.serializer(), kotlinx.serialization.json.Json.encodeToString(TrailRoute.serializer(), route),
        )
        assertEquals(route, serialized)
        assertEquals(gated(route, now), gated(serialized, now))
        assertEquals(
            TrailRouteClosureGateSijko.blockingAdvisories(route, now).map { it.id },
            TrailRouteClosureGateSijko.blockingAdvisories(serialized, now).map { it.id },
        )
        // A graph checked and found to have no derived leg says so with an empty list; that is the caller's statement about
        // a graph without a displaced node, and the unchanged network produces exactly that.
        assertTrue(derivedOf(listOf(rawLeg)).isEmpty())
    }

    @Test
    fun theDecisionDoesNotDependOnHowTheRouteGroupsTheSameGeometryIntoSegments() {
        val now = closure.activeFromEpochMillis
        val low = TrailDistanceSijko.metersBetween(vertex97, closure.closedFrom)
        // 0.02 m of closed travel after a long approach: refused as one segment, and as two or three segments that split
        // the same geometry so each piece alone is below the noise floor.
        val points = listOf(along(low - 20.0), along(low), along(low + 0.01), along(low + 0.02))
        val base = assertNotNull(findRoute(listOf(rawLeg), points.first(), points.last(), now - 1))
        val template = base.segments.single()
        fun regrouped(vararg groups: List<MapPoint>): TrailRoute = base.copy(
            segments = groups.map { template.copy(points = it) },
            edges = base.edges.map { edge -> edge.copy(routeSegments = groups.map { template.copy(points = it) }) },
        )
        val whole = regrouped(points)
        val two = regrouped(points.take(2), points.drop(1))
        val three = regrouped(points.take(2), points.subList(1, 3), points.drop(2))
        listOf(whole, two, three).forEach { route ->
            assertEquals(listOf(closure.id), gated(route, now), "${route.segments.size} segments")
        }
        // And travel that really is below the noise floor stays open however it is grouped.
        val tiny = listOf(along(low - 20.0), along(low), along(low + 0.004), along(low + 0.008))
        listOf(regrouped(tiny), regrouped(tiny.take(2), tiny.drop(1)), regrouped(tiny.take(3), tiny.drop(2))).forEach { route ->
            assertTrue(gated(route, now).isEmpty(), "${route.segments.size} segments of numerical noise")
        }
    }

    @Test
    fun aPartialJunctionLegCarriesTheOverlapOfTheIntervalNotWholeContainment() {
        val now = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        fun lerp(from: MapPoint, to: MapPoint, t: Double) = MapPoint(
            from.latitude + (to.latitude - from.latitude) * t,
            from.longitude + (to.longitude - from.longitude) * t,
        )
        // A junction spur 60% along the source leg: the connector the graph derives from it covers only the part of the
        // leg from its projection on, so the southern bound lies BEHIND it, and the northern node is 14 m east.
        val north = eastOf(vertex98, 14.0)
        val junction = lerp(vertex97, vertex98, 0.6)
        val features = listOf(
            trail("54:9100", north, eastOf(vertex98, 60.0)),
            trail("54:9200", junction, eastOf(junction, 60.0)),
            rawLeg,
        )
        derivedLegs = derivedOf(features)
        val partial = derivedLegs.filter { it.closureId == closure.id && it.low == 0.0 && it.high > 0.0 }
        assertTrue(partial.isNotEmpty(), "a derived leg carries only the part of the interval that lies on it")
        fun onChord(meters: Double) = lerp(junction, north, meters / (legMeters * 0.4))
        listOf(20.0 to 25.0, 30.0 to 50.0, 50.0 to 100.0).forEach { (from, to) ->
            val a = mapped(features, onChord(from))
            val b = mapped(features, onChord(to))
            listOf(a to b, b to a).forEach { (start, end) ->
                val route = assertNotNull(findRoute(features, start, end, now - 1), "$from to $to")
                // Nonvacuous: zero estimated gap, current and eligible before, on the source feature, on a junction connector.
                assertTrue(route.segments.none { !it.isRouted })
                assertTrue(route.edges.isNotEmpty() && route.edges.all { it.sourceFeatureId == "54:1305" })
                assertTrue(route.edges.any { it.connectorOfEdgeId != null }, "$from to $to rides a junction connector")
                assertTrue(gated(route, now - 1).isEmpty())
                // Raw/source partial legs do not carry it (the route is off the raw line), so the graph's legs must.
                assertEquals(listOf(closure.id), gated(route, now), "$from to $to inside the closure")
                assertEquals(listOf(closure.id), gated(route, estimate + 1))
                assertEquals(listOf(closure.id), gated(subdivided(route, 0.05), now), "dense")
                // A cold restore decodes the same route and reaches the same verdict.
                val restored = kotlinx.serialization.json.Json.decodeFromString(
                    TrailRoute.serializer(), kotlinx.serialization.json.Json.encodeToString(TrailRoute.serializer(), route),
                )
                assertEquals(listOf(closure.id), gated(restored, now), "cold restore")
                val outcome = TrailRouteClosureGateSijko.recalculate(
                    features, route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = now, derived = derivedLegs,
                )
                assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "recalculating gave $outcome")
            }
        }
        // Beyond the northern carried bound the same connector is open: a route on it past the interval is not travel.
        val leg = partial.first()
        val chord = TrailDistanceSijko.metersBetween(leg.from, leg.to)
        fun onLeg(position: Double) = lerp(leg.from, leg.to, position / chord)
        val beyond = assertNotNull(
            findRoute(features, mapped(features, onLeg(leg.high + 40.0)), mapped(features, onLeg(leg.high + 80.0)), now - 1),
        )
        assertTrue(beyond.segments.none { !it.isRouted })
        assertTrue(gated(beyond, now).isEmpty(), "past the carried northern bound is open")
        // And a route that penetrates the carried northern bound by half a meter is refused.
        val into = assertNotNull(
            findRoute(features, mapped(features, onLeg(leg.high + 20.0)), mapped(features, onLeg(leg.high - 0.5)), now - 1),
        )
        assertEquals(listOf(closure.id), gated(into, now), "0.5 m inside the carried northern bound")
    }

    @Test
    fun theDefaultCallersKeepADisplacedChordThroughTheSectionGatedWithoutAnyCorrespondence() {
        val now = closure.activeFromEpochMillis
        val estimate = assertNotNull(closure.estimatedEndEpochMillis)
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val spur = trail("54:9100", eastOf(vertex98, 14.0), eastOf(vertex98, 60.0))
        val features = listOf(spur, rawLeg)
        // Planned and picked the way the app does; then judged by the actual default calls, exactly as the Android
        // screen makes them: no derived legs, whatever the web bridge supplies.
        listOf(5.0, 20.0, 100.0).forEach { meters ->
            val a = mapped(features, along(0.6 * legMeters))
            val b = mapped(features, along(0.6 * legMeters + meters))
            listOf(a to b, b to a).forEach { (from, to) ->
                val route = assertNotNull(findRoute(features, from, to, now - 1))
                assertTrue(route.segments.none { !it.isRouted })
                assertTrue(
                    route.segments.flatMap { it.points }
                        .any { TrailDistanceSijko.projectToSegment(it, vertex97, vertex98).distanceMeters > 0.5 },
                    "the route really rides a displaced chord",
                )
                assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now - 1).isEmpty())
                assertEquals(listOf(closure.id), TrailRouteClosureGateSijko.blockingAdvisories(route, now).map { it.id }, "$meters m")
                assertEquals(listOf(closure.id), TrailRouteClosureGateSijko.blockingAdvisories(route, estimate + 1).map { it.id })
                assertTrue(TrailRouteAdvisorySijko.forRoute(route, now).any { it.id == closure.id })
                // The shared recalculation default path judges it the same way.
                val outcome = TrailRouteClosureGateSijko.recalculate(features, route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = now)
                assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "recalculate gave $outcome")
                assertTrue(closure in (outcome as TrailRouteRecalculationOutcome.NoSafeRoute).blockingClosures)
            }
        }
        // The same default path for the Camelback crossing on a displaced chord.
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val leg = trail("54:1305", southEnd, vertex6, vertex7, vertex8, northEnd)
        val camelSpur = trail("54:9100", eastOf(vertex7, 14.0), eastOf(vertex7, 60.0))
        val camelFeatures = listOf(camelSpur, leg)
        val south = mapped(camelFeatures, MapPoint(crossing.closedFrom.latitude - 15.0 / 111_194.93, crossing.closedFrom.longitude))
        val northPoint = mapped(camelFeatures, MapPoint(vertex8.latitude + 0.0005, vertex8.longitude))
        listOf(south to northPoint, northPoint to south).forEach { (from, to) ->
            val route = assertNotNull(findRoute(camelFeatures, from, to, crossing.activeFromEpochMillis - 1))
            assertEquals(listOf(crossing.id), TrailRouteClosureGateSijko.blockingAdvisories(route, crossing.activeFromEpochMillis).map { it.id })
        }
    }

    @Test
    fun theDefaultAndNullCallsFailClosedNearTheClosureAndStillLetFarGeometryAndOtherFeaturesThrough() {
        val now = closure.activeFromEpochMillis
        val south = TrailDistanceSijko.metersBetween(vertex97, closure.closedFrom)
        val north = south + TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        fun defaultGate(route: TrailRoute) = TrailRouteClosureGateSijko.blockingAdvisories(route, now).map { it.id }
        fun nullGate(route: TrailRoute) = TrailRouteClosureGateSijko.blockingAdvisories(route, now, null).map { it.id }
        fun open(route: TrailRoute, label: String) {
            assertTrue(route.segments.none { !it.isRouted }, label)
            assertTrue(defaultGate(route).isEmpty(), label)
            assertTrue(nullGate(route).isEmpty(), label)
            assertTrue(TrailRouteAdvisorySijko.forRoute(route, now).none { it.id == closure.id }, label)
        }
        // With no correspondence the gate cannot tell a raw-bound approach from a graph edge moved along the line, so a leg of
        // the closure's own feature that comes within the graph's reach (15 m) of the section is refused, including an
        // approach that ends exactly at a bound. This is deliberate and stated, not an eligibility promise.
        val raw = listOf(rawLeg)
        fun onRaw(from: Double, to: Double) =
            assertNotNull(findRoute(raw, mapped(raw, along(from)), mapped(raw, along(to)), now - 1), "$from to $to")
        listOf(south - 30.0 to south, south to south - 30.0, north to north + 30.0, south - 30.0 to south - 14.0).forEach { (from, to) ->
            val route = onRaw(from, to)
            assertEquals(listOf(closure.id), defaultGate(route), "$from to $to ends within the reach of a bound")
            assertEquals(listOf(closure.id), nullGate(route))
            // The same route is open for a caller that supplied the (empty) correspondence: the exact rule is unchanged.
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, now, emptyList()).isEmpty())
        }
        // Farther than the reach from the section, on the same feature, the default call lets it through.
        listOf(south - 60.0 to south - 20.0, north + 20.0 to north + 60.0, 40.0 to 200.0, north + 100.0 to north + 200.0)
            .forEach { (from, to) -> open(onRaw(from, to), "$from to $to") }
        // Another feature is never judged by the fallback: the actual Cypress crossing in either feature order, a neighbor.
        val cypress = shared("16:188", *cypressVertices)
        listOf(listOf(rawLeg, cypress), listOf(cypress, rawLeg)).forEach { features ->
            open(assertNotNull(findRoute(features, cypressVertices.first(), cypressVertices.last(), now - 1)), "Cypress")
        }
        val neighbor = trail("54:68", MapPoint(40.4990, -88.9900), MapPoint(40.5000, -88.9900))
        open(assertNotNull(findRoute(listOf(rawLeg, neighbor), neighbor.paths[0][0], neighbor.paths[0][1], now - 1)), "neighbor")
        // Camelback: a route that stays farther than the reach from the crossing is open under the default call.
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val leg = trail("54:1305", southEnd, vertex6, vertex7, vertex8, northEnd)
        val fromBeyond = MapPoint(
            vertex8.latitude + (northEnd.latitude - vertex8.latitude) * 25.0 / 167.0,
            vertex8.longitude + (northEnd.longitude - vertex8.longitude) * 25.0 / 167.0,
        )
        val short = assertNotNull(findRoute(listOf(leg), southEnd, vertex6, crossing.activeFromEpochMillis))
        val beyond = assertNotNull(findRoute(listOf(leg), fromBeyond, northEnd, crossing.activeFromEpochMillis))
        listOf(short, beyond).forEach {
            assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(it, crossing.activeFromEpochMillis).isEmpty())
        }
    }

    @Test
    fun theRotatedCamelbackChordAndTheCollinearWillowAnchorAreRefusedByTheDefaultAndNullCallsAndByTheGraph() {
        // (1) Opposite 14 m anchors rotate the short Camelback source leg, so the chord is neither aligned with it nor within
        // 3 m of the raw crossing. (2) A node 14 m beyond vertex 98 ALONG the line carries the Willow interval along an exactly
        // collinear chord, so on-the-line geometry does not prove the edge unmoved.
        val crossing = TrailRouteClosureSijko.camelbackCrossing
        val camelStart = crossing.activeFromEpochMillis
        val camelEnd = assertNotNull(crossing.estimatedEndEpochMillis)
        fun westOf(point: MapPoint, meters: Double) = eastOf(point, -meters)
        fun lerp(from: MapPoint, to: MapPoint, t: Double) = MapPoint(
            from.latitude + (to.latitude - from.latitude) * t,
            from.longitude + (to.longitude - from.longitude) * t,
        )
        val a = westOf(vertex6, 14.0)
        val b = eastOf(vertex7, 14.0)
        val camelFeatures = listOf(
            trail("54:9100", a, westOf(vertex6, 60.0)),
            trail("54:9200", b, eastOf(vertex7, 60.0)),
            trail("54:1305", southEnd, vertex6, vertex7, vertex8, northEnd),
        )
        val willowNode = lerp(vertex97, vertex98, 1.0 + 14.0 / TrailDistanceSijko.metersBetween(vertex97, vertex98))
        val willowFeatures = listOf(trail("54:9100", willowNode, eastOf(willowNode, 60.0)), rawLeg)
        val legMeters = TrailDistanceSijko.metersBetween(vertex97, vertex98)
        val highFraction = (closure.closedTo.latitude - vertex97.latitude) / (vertex98.latitude - vertex97.latitude)
        val cases = listOf(
            Triple(
                camelFeatures, crossing,
                listOf(lerp(a, b, 0.90) to lerp(a, b, 0.99), lerp(a, b, 0.99) to lerp(a, b, 0.90)),
            ),
            Triple(
                willowFeatures, closure,
                listOf(
                    lerp(vertex97, vertex98, highFraction + 2.0 / legMeters) to lerp(vertex97, vertex98, highFraction + 5.0 / legMeters),
                    lerp(vertex97, vertex98, highFraction + 5.0 / legMeters) to lerp(vertex97, vertex98, highFraction + 2.0 / legMeters),
                ),
            ),
        )
        cases.forEach { (features, closed, pairs) ->
            val end = assertNotNull(closed.estimatedEndEpochMillis)
            derivedLegs = derivedOf(features)
            pairs.forEach { (from, to) ->
                val route = assertNotNull(findRoute(features, mapped(features, from), mapped(features, to), closed.activeFromEpochMillis - 1))
                // Nonvacuous preconditions: source feature only, no estimated hop, eligible before the closure.
                assertTrue(route.segments.none { !it.isRouted })
                assertTrue(route.edges.isNotEmpty() && route.edges.all { it.sourceFeatureId == "54:1305" })
                assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(route, closed.activeFromEpochMillis - 1, null).isEmpty())
                val restored = kotlinx.serialization.json.Json.decodeFromString(
                    TrailRoute.serializer(), kotlinx.serialization.json.Json.encodeToString(TrailRoute.serializer(), route),
                )
                listOf(route, subdivided(route, 0.05), restored).forEach { variant ->
                    listOf(closed.activeFromEpochMillis, end + 1).forEach { now ->
                        // The graph's exact correspondence blocks it...
                        assertEquals(listOf(closed.id), TrailRouteClosureGateSijko.blockingAdvisories(variant, now, derivedLegs).map { it.id }, "graph, ${closed.id}")
                        // ...and so do the omitted-argument and explicit-null calls the Android screen and share paths make.
                        assertEquals(listOf(closed.id), TrailRouteClosureGateSijko.blockingAdvisories(variant, now).map { it.id }, "default, ${closed.id}")
                        assertEquals(listOf(closed.id), TrailRouteClosureGateSijko.blockingAdvisories(variant, now, null).map { it.id }, "null, ${closed.id}")
                        assertTrue(TrailRouteAdvisorySijko.forRoute(variant, now).any { it.id == closed.id })
                    }
                }
            }
        }
        assertTrue(camelEnd > camelStart)
    }

    // Where the loaded graph's derived geometry stands for a closure's source leg (what a front end with the graph passes).
    private var derivedLegs: List<TrailRouteDerivedClosureLeg> = emptyList()

    /** A point [meters] along the raw leg, carried onto the graph's derived leg when it has one (by the same fraction). */
    private fun onTheLeg(meters: Double): MapPoint {
        val leg = derivedLegs.singleOrNull { it.closureId == closure.id } ?: return along(meters)
        val fraction = meters / TrailDistanceSijko.metersBetween(vertex97, vertex98)
        return MapPoint(
            leg.from.latitude + (leg.to.latitude - leg.from.latitude) * fraction,
            leg.from.longitude + (leg.to.longitude - leg.from.longitude) * fraction,
        )
    }

    private fun derivedOf(features: List<TrailNetworkFeature>) =
        TrailRouteClosureDerivationSijko.legsFor(TrailGraphBuilderSijko.buildGraph(features))

    private fun gated(route: TrailRoute, now: Long) =
        TrailRouteClosureGateSijko.blockingAdvisories(route, now, derivedLegs).map { it.id }

    private fun camel(route: TrailRoute, now: Long) =
        TrailRouteAdvisorySijko.forRoute(route, now).singleOrNull { it.id == TrailRouteClosureSijko.camelbackCrossing.id }

    /**
     * The same physical geometry with every two-point trail segment (in the route and in its edges) subdivided into
     * collinear legs about [spacing] meters long; with [allTypes] every two-point segment, estimated hops included.
     */
    private fun subdivided(route: TrailRoute, spacing: Double, allTypes: Boolean = false): TrailRoute {
        fun dense(segment: TrailRouteSegment): TrailRouteSegment {
            if (segment.points.size != 2 || (!allTypes && segment.type != TrailRouteSegmentType.Trail)) return segment
            val (from, to) = segment.points
            val steps = maxOf(1, kotlin.math.ceil(TrailDistanceSijko.metersBetween(from, to) / spacing).toInt())
            return segment.copy(
                points = (0..steps).map { step ->
                    val fraction = step.toDouble() / steps
                    MapPoint(
                        latitude = from.latitude + (to.latitude - from.latitude) * fraction,
                        longitude = from.longitude + (to.longitude - from.longitude) * fraction,
                    )
                },
            )
        }
        return route.copy(
            segments = route.segments.map(::dense),
            edges = route.edges.map { edge -> edge.copy(routeSegments = edge.routeSegments.map(::dense)) },
        )
    }

    /** The point the app's map picker returns for [point]: projected onto the loaded network's own (node-anchored) line. */
    private fun mapped(features: List<TrailNetworkFeature>, point: MapPoint): MapPoint =
        assertNotNull(NearestTrailSnapSijko.nearestSnap(TrailGraphBuilderSijko.buildGraph(features), point)).projectedPoint

    private fun eastOf(point: MapPoint, meters: Double) = MapPoint(
        latitude = point.latitude,
        longitude = point.longitude + meters / (111_194.93 * kotlin.math.cos(point.latitude * kotlin.math.PI / 180.0)),
    )

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

    private fun findRoute(
        features: List<TrailNetworkFeature>,
        from: MapPoint,
        to: MapPoint,
        now: Long,
        accessGraph: TrailGraph? = null,
    ) =
        TrailRouteCalculationSijko.findRoute(
            features = features,
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
            startPoint = from,
            destinationPoint = to,
            accessGraph = accessGraph,
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
