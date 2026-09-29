/**
 * Job: Apply the user's enabled route layers to normalized trail-network features.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.RouteLayerSelection

object TrailFeatureFilterSijko {
    fun enabledFeatures(
        features: List<TrailNetworkFeature>,
        selection: RouteLayerSelection,
    ): List<TrailNetworkFeature> {
        return features.filter { feature ->
            if (feature.status == TrailFeatureStatus.Proposed && !selection.proposedTrails) {
                false
            } else {
                feature.routeRoles.any { role -> selection.isEnabled(role) }
            }
        }
    }

    private fun RouteLayerSelection.isEnabled(role: TrailNetworkRole): Boolean {
        return when (role) {
            TrailNetworkRole.TrailBranches -> trailBranches
            TrailNetworkRole.ParkConnectors -> parkConnectors
            TrailNetworkRole.SharedRoadways -> sharedRoadways
            TrailNetworkRole.ProposedTrails -> proposedTrails
        }
    }
}
