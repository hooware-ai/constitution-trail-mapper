/**
 * Job: Convert trail-network route roles into route-search cost preferences.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteRoleCostSijko {
    fun multiplier(routeRoles: Set<TrailNetworkRole>): Double {
        return when {
            TrailNetworkRole.ParkConnectors in routeRoles -> TrailMultiplier
            TrailNetworkRole.SharedRoadways in routeRoles -> SharedRoadwayMultiplier
            TrailNetworkRole.TrailBranches in routeRoles -> TrailMultiplier
            else -> TrailMultiplier
        }
    }

    private const val TrailMultiplier = 1.0
    private const val SharedRoadwayMultiplier = 10.0
}
