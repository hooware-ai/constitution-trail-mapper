/**
 * Job: Define the default trail-layer selection, keeping proposed trails opt-in.
 *
 */
package com.trailmapper.shared.sijko

object RouteLayerDefaultsSijko {
    fun defaultSelection(): RouteLayerSelection {
        return RouteLayerSelection(
            trailBranches = true,
            parkConnectors = true,
            sharedRoadways = true,
            proposedTrails = false,
        )
    }
}
