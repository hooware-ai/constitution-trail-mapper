/**
 * Job: Provide an empty address autocomplete provider for platforms without autocomplete wired yet.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.RouteEndpointTarget

object NoAddressAutocompleteProvider : AddressAutocompleteProvider {
    override val isAvailable: Boolean = false

    override suspend fun predictions(
        query: String,
        target: RouteEndpointTarget,
    ): List<AddressAutocompletePrediction> = emptyList()

    override suspend fun resolvePrediction(
        prediction: AddressAutocompletePrediction,
        target: RouteEndpointTarget,
    ): AddressAutocompleteSelectionResult = AddressAutocompleteSelectionResult.Unavailable
}
