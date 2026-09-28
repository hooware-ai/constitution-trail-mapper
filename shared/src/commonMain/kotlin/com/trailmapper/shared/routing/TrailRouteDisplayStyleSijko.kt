/**
 * Job: Map normalized McLean County trail attributes to the official trail-map legend style.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteDisplayStyleSijko {
    fun styleFor(feature: TrailNetworkFeature): TrailRouteDisplayStyle {
        if (feature.status == TrailFeatureStatus.Proposed ||
            TrailNetworkRole.ProposedTrails in feature.routeRoles
        ) {
            return TrailRouteDisplayStyle.Proposed
        }

        return when (feature.name?.trim()) {
            "Bloomer Line" -> TrailRouteDisplayStyle.BloomerLine
            "Collegiate" -> TrailRouteDisplayStyle.Collegiate
            "Illinois Central" -> TrailRouteDisplayStyle.IllinoisCentral
            "Interurban" -> TrailRouteDisplayStyle.Interurban
            "Northtown" -> TrailRouteDisplayStyle.Northtown
            "Route 66" -> TrailRouteDisplayStyle.Route66
            "Route 66 - Advanced" -> TrailRouteDisplayStyle.Route66Advanced
            "Route 66 - Alternate" -> TrailRouteDisplayStyle.Route66Alternate
            "Route 66 & Illinois Central" -> TrailRouteDisplayStyle.Route66IllinoisCentral
            "Route 66 & Southtown" -> TrailRouteDisplayStyle.Route66Southtown
            "Southtown" -> TrailRouteDisplayStyle.Southtown
            else -> fallbackStyleFor(feature.routeRoles)
        }
    }

    private fun fallbackStyleFor(routeRoles: Set<TrailNetworkRole>): TrailRouteDisplayStyle {
        return when {
            TrailNetworkRole.ParkConnectors in routeRoles -> TrailRouteDisplayStyle.ParkTrailConnectors
            TrailNetworkRole.SharedRoadways in routeRoles -> TrailRouteDisplayStyle.SuggestedSharedRoadways
            TrailNetworkRole.TrailBranches in routeRoles -> TrailRouteDisplayStyle.Route66
            else -> TrailRouteDisplayStyle.Unknown
        }
    }
}
