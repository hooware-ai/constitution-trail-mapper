/**
 * Job: Verify route edge weighting prefers trail comfort and penalizes ordinary-road access.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertTrue

class TrailEdgeWeightSijkoTest {
    @Test
    fun sharedLaneCostsMoreThanUrbanTrail() {
        val urbanTrail = edge(
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        )
        val sharedLane = edge(
            facilityType = TrailFacilityType.SharedLane,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        )

        assertTrue(TrailEdgeWeightSijko.cost(sharedLane) > TrailEdgeWeightSijko.cost(urbanTrail))
    }

    @Test
    fun ordinaryAccessIsHeavilyPenalized() {
        val accessEdge = edge(
            distanceMeters = 100.0,
            ordinaryAccessDistanceMeters = 100.0,
            facilityType = TrailFacilityType.UrbanTrail,
        )
        val trailEdge = edge(
            distanceMeters = 100.0,
            ordinaryAccessDistanceMeters = 0.0,
            facilityType = TrailFacilityType.UrbanTrail,
        )

        assertTrue(TrailEdgeWeightSijko.cost(accessEdge) > TrailEdgeWeightSijko.cost(trailEdge) * 5.0)
    }

    @Test
    fun estimatedAccessCostsMoreThanRoutedAccessAtSameDistance() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val end = MapPoint(latitude = 40.0009, longitude = -89.0)
        val routedAccess = edge(
            distanceMeters = 100.0,
            ordinaryAccessDistanceMeters = 100.0,
            facilityType = TrailFacilityType.Other,
            routeSegments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(start, end),
                    isRouted = true,
                ),
            ),
        )
        val estimatedAccess = routedAccess.copy(
            routeSegments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(start, end),
                    isRouted = false,
                ),
            ),
        )

        assertTrue(TrailEdgeWeightSijko.cost(estimatedAccess) > TrailEdgeWeightSijko.cost(routedAccess) * 5.0)
    }

    @Test
    fun sharedRoadwayCostsEnoughToPreferMuchLongerTrail() {
        val sharedRoadway = edge(
            distanceMeters = 100.0,
            facilityType = TrailFacilityType.UrbanTrail,
            routeRoles = setOf(TrailNetworkRole.SharedRoadways),
        )
        val trailRoute = edge(
            distanceMeters = 900.0,
            facilityType = TrailFacilityType.UrbanTrail,
            routeRoles = setOf(TrailNetworkRole.TrailBranches),
        )

        assertTrue(TrailEdgeWeightSijko.cost(sharedRoadway) > TrailEdgeWeightSijko.cost(trailRoute))
    }

    @Test
    fun sharedRoadwayWinsWhenTrailDetourIsUntenable() {
        val sharedRoadway = edge(
            distanceMeters = 100.0,
            facilityType = TrailFacilityType.UrbanTrail,
            routeRoles = setOf(TrailNetworkRole.SharedRoadways),
        )
        val trailRoute = edge(
            distanceMeters = 1_100.0,
            facilityType = TrailFacilityType.UrbanTrail,
            routeRoles = setOf(TrailNetworkRole.TrailBranches),
        )

        assertTrue(TrailEdgeWeightSijko.cost(sharedRoadway) < TrailEdgeWeightSijko.cost(trailRoute))
    }

    private fun edge(
        distanceMeters: Double = 100.0,
        ordinaryAccessDistanceMeters: Double = 0.0,
        facilityType: TrailFacilityType,
        comfortLevel: TrailComfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        routeRoles: Set<TrailNetworkRole> = emptySet(),
        routeSegments: List<TrailRouteSegment> = emptyList(),
    ): TrailGraphEdge {
        return TrailGraphEdge(
            id = 0,
            fromNodeId = 0,
            toNodeId = 1,
            distanceMeters = distanceMeters,
            ordinaryAccessDistanceMeters = ordinaryAccessDistanceMeters,
            facilityType = facilityType,
            comfortLevel = comfortLevel,
            routeRoles = routeRoles,
            routeSegments = routeSegments,
        )
    }
}
