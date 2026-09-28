/**
 * Job: Carry route-planner UI state owned by the lifecycle-scoped ViewModel.
 *
 */
package com.trailmapper.shared

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
    val autocompleteError: String? = null,
    val locationError: String? = null,
    val mapPointError: String? = null,
    val routeDialog: RouteMessageDialog? = null,
    val isFindingRoute: Boolean = false,
) {
    val hasPendingEndpointRequest: Boolean
        get() = resolvingLocationTarget != null ||
            resolvingMapPointTarget != null ||
            isResolvingAutocomplete ||
            pendingLocationTarget != null
}
