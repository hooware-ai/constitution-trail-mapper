/**
 * Job: Define the shared platform boundary for address autocomplete suggestions and selection.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.RouteEndpointTarget

interface AddressAutocompleteProvider {
    val isAvailable: Boolean

    suspend fun predictions(
        query: String,
        target: RouteEndpointTarget,
    ): List<AddressAutocompletePrediction>

    suspend fun resolvePrediction(
        prediction: AddressAutocompletePrediction,
        target: RouteEndpointTarget,
    ): AddressAutocompleteSelectionResult
}
