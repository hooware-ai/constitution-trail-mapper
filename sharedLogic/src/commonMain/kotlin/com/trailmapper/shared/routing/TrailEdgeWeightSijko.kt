/**
 * Job: Convert approved trail-network edge attributes into route-search cost.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max

object TrailEdgeWeightSijko {
    fun cost(edge: TrailGraphEdge): Double {
        val ordinaryAccessDistance = edge.ordinaryAccessDistanceMeters
        val trailDistance = max(0.0, edge.distanceMeters - ordinaryAccessDistance)
        val estimatedAccessDistance = estimatedOrdinaryAccessDistance(edge)
            .coerceAtMost(ordinaryAccessDistance)
        val routedAccessDistance = max(0.0, ordinaryAccessDistance - estimatedAccessDistance)
        return trailDistance *
            facilityMultiplier(edge.facilityType) *
            comfortMultiplier(edge.comfortLevel) *
            TrailRouteRoleCostSijko.multiplier(edge.routeRoles) +
            routedAccessDistance * RoutedOrdinaryAccessPenalty +
            estimatedOrdinaryAccessCost(estimatedAccessDistance) +
            TrailRoutingHazardPenaltySijko.additionalCost(edge)
    }

    fun facilityMultiplier(facilityType: TrailFacilityType): Double {
        return when (facilityType) {
            TrailFacilityType.OffRoadTrail,
            TrailFacilityType.SeparatedTrail,
            TrailFacilityType.UrbanTrail,
            -> 1.0
            TrailFacilityType.BikeLane -> 1.15
            TrailFacilityType.SharedLane -> 1.35
            TrailFacilityType.Other -> 1.2
            TrailFacilityType.Unknown -> 1.1
        }
    }

    fun comfortMultiplier(comfortLevel: TrailComfortLevel): Double {
        return when (comfortLevel) {
            TrailComfortLevel.AllAgesAndAbilities -> 1.0
            TrailComfortLevel.MostAdults -> 1.1
            TrailComfortLevel.ExperiencedBicyclists -> 1.35
            TrailComfortLevel.StrongAndFearless -> 1.75
            TrailComfortLevel.Unknown -> 1.1
        }
    }

    private fun estimatedOrdinaryAccessDistance(edge: TrailGraphEdge): Double {
        return edge.routeSegments
            .filter { segment -> segment.type == TrailRouteSegmentType.Access && !segment.isRouted }
            .sumOf { segment -> TrailDistanceSijko.pathLengthMeters(segment.points) }
    }

    private fun estimatedOrdinaryAccessCost(distanceMeters: Double): Double {
        val excessDistanceMeters = max(0.0, distanceMeters - EstimatedAccessGraceMeters)
        return distanceMeters * EstimatedOrdinaryAccessPenalty +
            excessDistanceMeters * ExcessEstimatedAccessPenalty
    }

    private const val RoutedOrdinaryAccessPenalty = 8.0
    private const val EstimatedAccessGraceMeters = 125.0
    private const val EstimatedOrdinaryAccessPenalty = 75.0
    private const val ExcessEstimatedAccessPenalty = 400.0
}
