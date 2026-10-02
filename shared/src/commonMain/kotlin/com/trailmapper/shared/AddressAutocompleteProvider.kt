/**
 * Job: Define the shared platform boundary for address autocomplete suggestions and selection.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget

interface AddressAutocompleteProvider {
    val isAvailable: Boolean

    /** [proximity], when given, is where the rider is starting from; nearer matches should rank first. */
    suspend fun predictions(
        query: String,
        target: RouteEndpointTarget,
        proximity: MapPoint? = null,
    ): List<AddressAutocompletePrediction>

    suspend fun resolvePrediction(
        prediction: AddressAutocompletePrediction,
        target: RouteEndpointTarget,
    ): AddressAutocompleteSelectionResult
}
