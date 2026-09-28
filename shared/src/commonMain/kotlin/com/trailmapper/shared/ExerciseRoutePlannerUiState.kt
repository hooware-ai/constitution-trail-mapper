/**
 * Job: Carry the shared UI state for the distance-targeted exercise route planner.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.ExerciseRouteResult
import com.trailmapper.shared.sijko.MapPoint

data class ExerciseRoutePlannerUiState(
    val startAddress: String = "",
    val startPoint: MapPoint? = null,
    val targetMilesText: String = "",
    val proposedTrailsEnabled: Boolean = false,
    val pendingLocationPrompt: Boolean = false,
    val isResolvingLocation: Boolean = false,
    val locationError: String? = null,
    val isResolvingMapPoint: Boolean = false,
    val mapPointError: String? = null,
    val autocompleteSuggestions: List<AddressAutocompletePrediction> = emptyList(),
    val isResolvingAutocomplete: Boolean = false,
    val autocompleteError: String? = null,
    val isFindingRoute: Boolean = false,
    val result: ExerciseRouteResult? = null,
    /** A new result the map has not shown yet; the planner opens its map once, then clears this. */
    val resultAwaitingMap: Boolean = false,
    val searchError: String? = null,
) {
    val hasPendingEndpointRequest: Boolean
        get() = isResolvingLocation ||
            isResolvingMapPoint ||
            isResolvingAutocomplete ||
            pendingLocationPrompt
}
