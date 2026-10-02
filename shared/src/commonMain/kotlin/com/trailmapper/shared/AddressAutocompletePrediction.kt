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
    /** Straight-line meters from the proximity point the request was made with, when the provider knows it. */
    val distanceMeters: Int? = null,
)
