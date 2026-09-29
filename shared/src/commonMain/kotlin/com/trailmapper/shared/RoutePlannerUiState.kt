/**
 * Job: Carry route-planner UI state owned by the lifecycle-scoped ViewModel.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.RouteEndpoints
import com.trailmapper.shared.sijko.RouteLayerSelection

data class RoutePlannerUiState(
    val endpoints: RouteEndpoints,
    val routeLayers: RouteLayerSelection,
    val pendingLocationTarget: RouteEndpointTarget? = null,
    val resolvingLocationTarget: RouteEndpointTarget? = null,
    val resolvingMapPointTarget: RouteEndpointTarget? = null,
    val autocompleteTarget: RouteEndpointTarget? = null,
    val autocompleteSuggestions: List<AddressAutocompletePrediction> = emptyList(),
    val isResolvingAutocomplete: Boolean = false,
    /** The Start point the pending or shown suggestions were measured from; null for the local-area fallback. */
    val autocompleteAnchor: MapPoint? = null,
    val autocompleteError: String? = null,
    val locationError: String? = null,
    val mapPointError: String? = null,
    val routeDialog: RouteMessageDialog? = null,
    val isFindingRoute: Boolean = false,
    /** The route found for the current endpoints, kept so the rider can reopen its map after Back. */
    val lastRoute: TrailRoute? = null,
) {
    val hasPendingEndpointRequest: Boolean
        get() = resolvingLocationTarget != null ||
            resolvingMapPointTarget != null ||
            isResolvingAutocomplete ||
            pendingLocationTarget != null
}
