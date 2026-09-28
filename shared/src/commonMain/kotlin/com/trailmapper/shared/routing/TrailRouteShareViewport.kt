/**
 * Job: Carry padded geographic bounds for rendering a complete shared route image.
 *
 */
package com.trailmapper.shared.routing

data class TrailRouteShareViewport(
    val southLatitude: Double,
    val westLongitude: Double,
    val northLatitude: Double,
    val eastLongitude: Double,
)
