/**
 * Job: Score endpoint access candidates, strongly preferring mapped-road access over estimated connectors.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max

object TrailRouteEndpointAccessScoreSijko {
    fun score(access: TrailRouteEndpointAccess): Double {
        val routedDistanceMeters = access.accessSegments
            .filter { it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        val estimatedDistanceMeters = access.accessSegments
            .filter { !it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        val excessEstimatedDistanceMeters = max(
            0.0,
            estimatedDistanceMeters - ESTIMATED_ACCESS_GRACE_METERS,
        )
        val estimatedAccessMultiplier = if (routedDistanceMeters > MINIMUM_ROUTED_ACCESS_METERS) {
            ROUTED_SNAP_ESTIMATED_ACCESS_MULTIPLIER
        } else {
            DIRECT_ESTIMATED_ACCESS_MULTIPLIER
        }
        val baseScore = routedDistanceMeters +
            estimatedDistanceMeters * estimatedAccessMultiplier +
            excessEstimatedDistanceMeters * ESTIMATED_ACCESS_PENALTY
        return baseScore * routeRoleMultiplier(access.snap.edge.routeRoles)
    }

    private fun routeRoleMultiplier(routeRoles: Set<TrailNetworkRole>): Double {
        return when {
            TrailNetworkRole.ParkConnectors in routeRoles -> PARK_CONNECTOR_ENDPOINT_MULTIPLIER
            TrailNetworkRole.SharedRoadways in routeRoles -> SHARED_ROADWAY_ENDPOINT_MULTIPLIER
            else -> 1.0
        }
    }

    private const val MINIMUM_ROUTED_ACCESS_METERS = 0.01
    private const val ESTIMATED_ACCESS_GRACE_METERS = 125.0
    private const val ROUTED_SNAP_ESTIMATED_ACCESS_MULTIPLIER = 8.0
    private const val DIRECT_ESTIMATED_ACCESS_MULTIPLIER = 50.0
    private const val ESTIMATED_ACCESS_PENALTY = 400.0
    private const val PARK_CONNECTOR_ENDPOINT_MULTIPLIER = 0.5
    private const val SHARED_ROADWAY_ENDPOINT_MULTIPLIER = 0.75
}
