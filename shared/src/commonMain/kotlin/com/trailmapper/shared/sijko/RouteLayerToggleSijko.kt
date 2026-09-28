/**
 * Job: Apply allowed route-layer toggles while keeping locked core trail layers unchanged.
 *
 */
package com.trailmapper.shared.sijko

object RouteLayerToggleSijko {
    fun setLayerChecked(
        selection: RouteLayerSelection,
        layer: TrailRouteLayer,
        checked: Boolean,
    ): RouteLayerSelection {
        return when (layer) {
            TrailRouteLayer.ProposedTrails -> selection.copy(proposedTrails = checked)
            TrailRouteLayer.TrailBranches,
            TrailRouteLayer.ParkConnectors,
            TrailRouteLayer.SharedRoadways,
            -> selection
        }
    }
}
