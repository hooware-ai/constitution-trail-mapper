/**
 * Job: Verify reroutes reuse the route's planning rules and are searched only when warranted.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.AccessNetworkLoadResult
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class TrailRouteRerouteSijkoTest {
    @Test
    fun usesTheLayersTheRouteWasPlannedWith() {
        val layers = RouteLayerDefaultsSijko.defaultSelection().copy(sharedRoadways = false)

        assertEquals(layers, TrailRouteRerouteSijko.layersFor(routeTo(destination).copy(routeLayers = layers)))
    }

    @Test
    fun aLegacyRouteGetsDefaultsWithProposedTrailsOnlyIfItRidesOne() {
        val plain = routeTo(destination)
        val throughProposed = plain.copy(
            segments = plain.segments + TrailRouteSegment(
                TrailRouteSegmentType.Trail,
                listOf(destination, MapPoint(40.01, -89.0)),
                routeRoles = setOf(TrailNetworkRole.ProposedTrails),
            ),
        )

        assertEquals(RouteLayerDefaultsSijko.defaultSelection(), TrailRouteRerouteSijko.layersFor(plain))
        assertTrue(TrailRouteRerouteSijko.layersFor(throughProposed).proposedTrails)
    }

    @Test
    fun findsARouteFromTheRiderToTheOriginalDestination() {
        val outcome = TrailRouteRerouteSijko.pointToPoint(
            features = listOf(trail("main", existing = true, start, junction, destination)),
            route = routeTo(destination),
            from = MapPoint(40.001, -89.0),
            accessGraph = null,
        )

        val replacement = assertIs<TrailRouteRerouteOutcome.Replacement>(outcome).route
        assertEquals(TrailRouteKind.Navigation, replacement.kind)
        assertEquals(destination, replacement.segments.last().points.last())
        assertEquals(RouteLayerDefaultsSijko.defaultSelection(), replacement.routeLayers)
    }

    @Test
    fun aProposedTrailIsUsedOnlyWhenTheRouteOptedIn() {
        // The only way from the rider to the destination is a proposed trail.
        val features = listOf(
            trail("main", existing = true, start, junction),
            trail("future", existing = false, junction, destination),
        )
        val rider = MapPoint(40.001, -89.0)

        val legacy = TrailRouteRerouteSijko.pointToPoint(features, routeTo(destination), rider, accessGraph = null)
        val optedIn = TrailRouteRerouteSijko.pointToPoint(
            features = features,
            route = routeTo(destination).copy(
                routeLayers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true),
            ),
            from = rider,
            accessGraph = null,
        )

        fun TrailRouteRerouteOutcome.ridesAProposedTrail() = this is TrailRouteRerouteOutcome.Replacement &&
            route.segments.any { segment -> TrailNetworkRole.ProposedTrails in segment.routeRoles }
        // Without the opt-in, any replacement must leave the proposed trail alone.
        assertFalse(legacy.ridesAProposedTrail())
        assertTrue(optedIn.ridesAProposedTrail())
    }

    @Test
    fun aDisconnectedNetworkIsAnExplicitNoSafeRoute() {
        val features = listOf(
            trail("near", existing = true, start, junction),
            trail("far", existing = true, MapPoint(40.02, -89.0), destinationFar),
        )

        val outcome = TrailRouteRerouteSijko.pointToPoint(features, routeTo(destinationFar), start, accessGraph = null)

        assertEquals(TrailRouteRerouteOutcome.NoSafeRoute(emptyList()), outcome)
    }

    @Test
    fun searchesAutomaticallyOnlyOnAConfirmedDepartureAndThenAfterMovingOn() {
        val confirmed = TrailRouteDeviationState(status = TrailRouteDeviationStatus.ConfirmedOffRoute)
        val possible = TrailRouteDeviationState(status = TrailRouteDeviationStatus.PossiblyOffRoute)
        val fix = TrailRouteNavigationFix(start, accuracyMeters = 5.0, timeEpochMillis = 60_000L)

        assertFalse(TrailRouteRerouteSijko.shouldSearchAutomatically(possible, fix, null, searchInProgress = false, nowEpochMillis = 60_000L))
        assertTrue(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, fix, null, searchInProgress = false, nowEpochMillis = 60_000L))
        assertFalse(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, fix, null, searchInProgress = true, nowEpochMillis = 60_000L))

        val recent = TrailRouteRerouteAttempt(start, timeEpochMillis = 50_000L)
        val longAgoHere = TrailRouteRerouteAttempt(start, timeEpochMillis = 0L)
        val longAgoElsewhere = TrailRouteRerouteAttempt(MapPoint(39.998, -89.0), timeEpochMillis = 0L)
        assertFalse(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, fix, recent, searchInProgress = false, nowEpochMillis = 60_000L))
        assertFalse(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, fix, longAgoHere, searchInProgress = false, nowEpochMillis = 60_000L))
        assertTrue(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, fix, longAgoElsewhere, searchInProgress = false, nowEpochMillis = 60_000L))
    }

    @Test
    fun aRetryNeedsAnAccurateCurrentFixEvenWhileTheDepartureStaysConfirmed() {
        val confirmed = TrailRouteDeviationState(status = TrailRouteDeviationStatus.ConfirmedOffRoute)
        val earlier = TrailRouteRerouteAttempt(MapPoint(39.998, -89.0), timeEpochMillis = 0L)
        // 31 s and about 220 m after the last attempt, but from a 60 m fix or a fix 20 s old.
        val coarse = TrailRouteNavigationFix(start, accuracyMeters = 60.0, timeEpochMillis = 31_000L)
        val stale = TrailRouteNavigationFix(start, accuracyMeters = 5.0, timeEpochMillis = 31_000L)

        assertFalse(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, coarse, earlier, false, nowEpochMillis = 31_000L))
        assertFalse(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, stale, earlier, false, nowEpochMillis = 51_000L))
        assertTrue(TrailRouteRerouteSijko.shouldSearchAutomatically(confirmed, stale, earlier, false, nowEpochMillis = 31_000L))
    }

    @Test
    fun aSlowAutomaticSearchIsDroppedOnceTheRiderIsBackOnTheRoute() {
        // Confirmed off route, a search starts, and before it finishes the rider rides back onto the route.
        var deviation = TrailRouteDeviationState()
        listOf(0 to 70.0, 3 to 85.0, 6 to 100.0, 9 to 115.0, 12 to 130.0, 15 to 145.0).forEach { (seconds, off) ->
            deviation = next(deviation, seconds, off, travelMeters = seconds * 5.0)
        }
        assertTrue(deviation.isConfirmed)
        assertTrue(TrailRouteRerouteSijko.shouldAdopt(false, deviation, routeUnchanged = true, navigationActive = true))

        deviation = next(deviation, 18, 10.0, travelMeters = 90.0)
        deviation = next(deviation, 21, 8.0, travelMeters = 105.0)

        assertEquals(TrailRouteDeviationStatus.OnRoute, deviation.status)
        assertFalse(TrailRouteRerouteSijko.shouldAdopt(false, deviation, routeUnchanged = true, navigationActive = true))
        // A search the rider asked for is still adopted from on the route.
        assertTrue(TrailRouteRerouteSijko.shouldAdopt(true, deviation, routeUnchanged = true, navigationActive = true))
    }

    @Test
    fun aSearchIsNeverAdoptedAfterNavigationStopsOrTheRouteChanges() {
        val confirmed = TrailRouteDeviationState(status = TrailRouteDeviationStatus.ConfirmedOffRoute)

        assertFalse(TrailRouteRerouteSijko.shouldAdopt(true, confirmed, routeUnchanged = true, navigationActive = false))
        assertFalse(TrailRouteRerouteSijko.shouldAdopt(true, confirmed, routeUnchanged = false, navigationActive = true))
    }

    @Test
    fun aRoadDataLoadFailureIsReportedInsteadOfSearchingWithEstimatedAccess() {
        val roads = listOf(AccessNetworkFeature(id = "road", name = "Main St", roadClass = "S1400", paths = listOf(listOf(start, destination))))

        assertEquals(TrailRouteRerouteAccess.LoadFailed, TrailRouteRerouteSijko.accessFor(AccessNetworkLoadResult.Error("timeout")))
        assertEquals(TrailRouteRerouteAccess.NotAvailable, TrailRouteRerouteSijko.accessFor(AccessNetworkLoadResult.Unavailable))
        assertEquals(TrailRouteRerouteAccess.Roads(roads), TrailRouteRerouteSijko.accessFor(AccessNetworkLoadResult.Success(roads)))
    }

    @Test
    fun aCancelledSearchThatFinishesLateCannotClearOrAdoptOverTheNextOne() {
        // Search A starts, the rider cancels (or it is superseded), and search B starts before A's cleanup runs.
        var search = TrailRouteRerouteSearch().started()
        val searchA = search.generation
        search = search.cancelled()
        search = search.started()
        val searchB = search.generation

        search = search.finished(searchA)
        assertTrue(search.inProgress, "A's late cleanup must leave B running, so no third search can start")
        assertFalse(search.isCurrent(searchA), "A may not adopt its result")
        assertTrue(search.isCurrent(searchB))

        search = search.finished(searchB)
        assertFalse(search.inProgress)
    }

    private fun next(
        previous: TrailRouteDeviationState,
        seconds: Int,
        offMeters: Double,
        travelMeters: Double,
    ): TrailRouteDeviationState = TrailRouteDeviationSijko.next(
        previous = previous,
        fix = TrailRouteNavigationFix(
            MapPoint(start.latitude + travelMeters / 111_320.0, start.longitude),
            accuracyMeters = 8.0,
            timeEpochMillis = seconds * 1_000L,
        ),
        distanceFromRouteMeters = offMeters,
        nowEpochMillis = seconds * 1_000L,
    )

    private fun routeTo(end: MapPoint) = TrailRoute(
        segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(start, end), name = "Main trail")),
        totalDistanceMeters = TrailDistanceSijko.metersBetween(start, end),
        ordinaryAccessDistanceMeters = 0.0,
        totalCost = 0.0,
    )

    private fun trail(id: String, existing: Boolean, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        name = id,
        status = if (existing) TrailFeatureStatus.Existing else TrailFeatureStatus.Proposed,
        routeRoles = if (existing) {
            setOf(TrailNetworkRole.TrailBranches)
        } else {
            setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ProposedTrails)
        },
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )

    private val start = MapPoint(40.0, -89.0)
    private val junction = MapPoint(40.002, -89.0)
    private val destination = MapPoint(40.004, -89.0)
    private val destinationFar = MapPoint(40.03, -89.0)
}
