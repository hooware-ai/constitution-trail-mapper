/**
 * Job: Carry a selected map coordinate in latitude/longitude form.
 *
 */
package com.trailmapper.shared.sijko

import kotlinx.serialization.Serializable

@Serializable
data class MapPoint(
    val latitude: Double,
    val longitude: Double,
)
