/**
 * Job: Verify only active trail closures block a route's start, never road-work advisories or earlier days.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteClosureGateSijkoTest {
    private val closure = TrailRouteClosureSijko.uptownUnderpass

    // Along Constitution Trail through the Uptown section, from Phoenix Avenue toward Uptown Circle.
    private val throughUptown = TrailRoute(
        segments = listOf(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(
                    MapPoint(latitude = 40.506900, longitude = -88.984250),
                    MapPoint(latitude = 40.507656, longitude = -88.984202),
                    MapPoint(latitude = 40.507719, longitude = -88.983807),
                    MapPoint(latitude = 40.508049, longitude = -88.983831),
                    MapPoint(latitude = 40.508292, longitude = -88.983692),
                    MapPoint(latitude = 40.508589, longitude = -88.983823),
                    MapPoint(latitude = 40.509170, longitude = -88.982741),
                ),
            ),
        ),
        totalDistanceMeters = 350.0,
        ordinaryAccessDistanceMeters = 0.0,
        totalCost = 350.0,
    )

    @Test
    fun aRouteThroughAnActiveClosureIsBlockedByItsAdvisory() {
        val blocking = TrailRouteClosureGateSijko.blockingAdvisories(throughUptown, closure.activeFromEpochMillis + 1)

        assertEquals(listOf(closure.id), blocking.map { it.id })
        assertEquals(closure.noticeUrl, blocking.single().sourceUrl)
    }

    @Test
    fun theSameRouteIsNotBlockedBeforeTheClosureBegins() {
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(throughUptown, closure.activeFromEpochMillis - 1).isEmpty())
    }

    @Test
    fun aRoadWorkAdvisoryInformsWithoutBlocking() {
        val alongHamilton = TrailRoute(
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    isRouted = true,
                    name = "E Hamilton Rd",
                    points = listOf(
                        MapPoint(latitude = 40.4512277313916, longitude = -88.9813226624867),
                        MapPoint(latitude = 40.4513485856116, longitude = -88.9667059346487),
                    ),
                ),
            ),
            totalDistanceMeters = 1240.0,
            ordinaryAccessDistanceMeters = 1240.0,
            totalCost = 1240.0,
        )
        val now = closure.activeFromEpochMillis + 1

        assertTrue(TrailRouteAdvisorySijko.forRoute(alongHamilton, now).isNotEmpty(), "the advisory must apply for this to test anything")
        assertTrue(TrailRouteClosureGateSijko.blockingAdvisories(alongHamilton, now).isEmpty())
    }

    @Test
    fun roadDataThatFailedToLoadStopsRecalculationButMissingRoadDataDoesNot() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val end = MapPoint(latitude = 40.009, longitude = -89.0)
        val trail = TrailNetworkFeature(
            id = "straight",
            status = TrailFeatureStatus.Existing,
            routeRoles = setOf(TrailNetworkRole.TrailBranches),
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            paths = listOf(listOf(start, end)),
        )
        val route = TrailRoute(
            segments = listOf(TrailRouteSegment(type = TrailRouteSegmentType.Trail, points = listOf(start, end))),
            totalDistanceMeters = 1000.0,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1000.0,
        )

        assertEquals(
            TrailRouteRecalculationOutcome.RoadDataFailed,
            TrailRouteClosureGateSijko.recalculate(listOf(trail), route, TrailRouteRerouteAccess.LoadFailed),
        )
        // No road data for the area is how planning works too: it searches with estimated access.
        assertTrue(
            TrailRouteClosureGateSijko.recalculate(listOf(trail), route, TrailRouteRerouteAccess.NotAvailable) is
                TrailRouteRecalculationOutcome.Replacement,
        )
    }

    @Test
    fun recalculationNeedsRoadsAtTheStartAndAPointToPointDestination() {
        val start = MapPoint(latitude = 40.506900, longitude = -88.984250)
        val end = MapPoint(latitude = 40.509170, longitude = -88.982741)

        assertEquals(listOf(start, end), TrailRouteClosureGateSijko.accessEndpoints(throughUptown))
        assertEquals(listOf(start), TrailRouteClosureGateSijko.accessEndpoints(throughUptown.copy(kind = TrailRouteKind.ExerciseLoop)))
    }
}
