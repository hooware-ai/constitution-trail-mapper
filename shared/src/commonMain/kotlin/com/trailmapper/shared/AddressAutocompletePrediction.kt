/**
 * Job: Carry one address autocomplete suggestion that can be selected into a route endpoint.
 *
 */
package com.trailmapper.shared

data class AddressAutocompletePrediction(
    val placeId: String,
    val primaryText: String,
    val secondaryText: String,
    val fullText: String,
)
