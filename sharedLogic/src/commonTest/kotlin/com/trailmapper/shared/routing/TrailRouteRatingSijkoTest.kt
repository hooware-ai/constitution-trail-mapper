/**
 * Job: Verify final route rating balances shared-road exposure against unreasonable detours.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertTrue

class TrailRouteRatingSijkoTest {
    @Test
    fun reasonableTrailDetourScoresBetterThanSharedRoad() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.0, longitude = -88.99)
        val sharedRoadRoute = route(
            totalDistanceMeters = 1_000.0,
            sharedRoadwayDistanceMeters = 1_000.0,
        )
        val trailRoute = route(
            totalDistanceMeters = 1_500.0,
            sharedRoadwayDistanceMeters = 0.0,
        )

        assertTrue(
            TrailRouteRatingSijko.score(trailRoute, start, destination) <
                TrailRouteRatingSijko.score(sharedRoadRoute, start, destination),
        )
    }

    @Test
    fun excessiveTrailDetourScoresWorseThanSharedRoad() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.0, longitude = -88.99)
        val sharedRoadRoute = route(
            totalDistanceMeters = 1_000.0,
            sharedRoadwayDistanceMeters = 1_000.0,
        )
        val excessiveTrailRoute = route(
            totalDistanceMeters = 4_500.0,
            sharedRoadwayDistanceMeters = 0.0,
        )

        assertTrue(
            TrailRouteRatingSijko.score(sharedRoadRoute, start, destination) <
                TrailRouteRatingSijko.score(excessiveTrailRoute, start, destination),
        )
    }

    private fun route(
        totalDistanceMeters: Double,
        sharedRoadwayDistanceMeters: Double,
    ): TrailRoute {
        return TrailRoute(
            edges = emptyList(),
            totalDistanceMeters = totalDistanceMeters,
            ordinaryAccessDistanceMeters = 0.0,
            sharedRoadwayDistanceMeters = sharedRoadwayDistanceMeters,
            totalCost = 0.0,
        )
    }
}
