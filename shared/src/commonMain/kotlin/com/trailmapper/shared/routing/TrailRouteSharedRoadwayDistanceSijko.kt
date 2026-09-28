/**
 * Job: Measure how much of a final approved route uses shared-roadway segments.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max

object TrailRouteSharedRoadwayDistanceSijko {
    fun distanceMeters(edges: List<TrailGraphEdge>): Double {
        return edges
            .filter { edge -> TrailNetworkRole.SharedRoadways in edge.routeRoles }
            .sumOf { edge -> max(0.0, edge.distanceMeters - edge.ordinaryAccessDistanceMeters) }
    }
}
