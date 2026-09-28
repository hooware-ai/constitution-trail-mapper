/**
 * Job: Rate final route candidates by hazard, shared-road exposure, access, and excessive detour.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.max

object TrailRouteRatingSijko {
    fun score(
        route: TrailRoute,
        start: MapPoint,
        destination: MapPoint,
        endpointAccessScore: Double = 0.0,
    ): Double {
        val trailConnectorDistanceMeters = max(
            0.0,
            route.totalDistanceMeters -
                route.ordinaryAccessDistanceMeters -
                route.sharedRoadwayDistanceMeters,
        )
        val straightLineDistanceMeters = TrailDistanceSijko.metersBetween(start, destination)
        val freeDetourMeters = straightLineDistanceMeters * FreeDetourRatio + FreeDetourGraceMeters
        val excessiveDetourMeters = max(0.0, route.totalDistanceMeters - freeDetourMeters)
        return trailConnectorDistanceMeters * TrailConnectorMultiplier +
            route.sharedRoadwayDistanceMeters * SharedRoadwayMultiplier +
            route.ordinaryAccessDistanceMeters * OrdinaryAccessMultiplier +
            excessiveDetourMeters * ExcessiveDetourMultiplier +
            TrailRoutingHazardPenaltySijko.routeCost(route.edges) +
            endpointAccessScore
    }

    private const val TrailConnectorMultiplier = 1.0
    private const val SharedRoadwayMultiplier = 12.0
    private const val OrdinaryAccessMultiplier = 8.0
    private const val FreeDetourRatio = 2.0
    private const val FreeDetourGraceMeters = 400.0
    private const val ExcessiveDetourMultiplier = 20.0
}
