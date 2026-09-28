/**
 * Job: Carry state for manually saving a named destination from the home screen.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

data class SavedDestinationEditorUiState(
    val name: String = "",
    val address: String = "",
    val point: MapPoint? = null,
    val autocompleteSuggestions: List<AddressAutocompletePrediction> = emptyList(),
    val isResolvingAutocomplete: Boolean = false,
    val autocompleteError: String? = null,
    val isChoosingMapPoint: Boolean = false,
    val mapPointError: String? = null,
)
