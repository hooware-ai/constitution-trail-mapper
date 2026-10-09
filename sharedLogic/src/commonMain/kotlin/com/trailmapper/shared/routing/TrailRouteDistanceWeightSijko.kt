/**
 * Job: Provide distance-first fallback cost while preserving reviewed safety-hazard penalties.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteDistanceWeightSijko {
    fun cost(edge: TrailGraphEdge): Double {
        return edge.distanceMeters + TrailRoutingHazardPenaltySijko.additionalCost(edge)
    }
}
