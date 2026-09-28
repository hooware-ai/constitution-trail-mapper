/**
 * Job: Carry the geographic bounds shown by the shared map-point picker.
 *
 */
package com.trailmapper.shared.sijko

data class MapViewport(
    val northLatitude: Double,
    val southLatitude: Double,
    val westLongitude: Double,
    val eastLongitude: Double,
)
