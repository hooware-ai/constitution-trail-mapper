/**
 * Job: Model the result of selecting an address autocomplete suggestion.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

sealed class AddressAutocompleteSelectionResult {
    data class Success(
        val address: String,
        val point: MapPoint,
    ) : AddressAutocompleteSelectionResult()

    data class Error(val message: String) : AddressAutocompleteSelectionResult()

    object Unavailable : AddressAutocompleteSelectionResult()
}
