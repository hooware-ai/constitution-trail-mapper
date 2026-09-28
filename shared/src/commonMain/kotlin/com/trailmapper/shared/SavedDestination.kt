/**
 * Job: Carry one saved destination with display text and routeable coordinates.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import kotlinx.serialization.Serializable

@Serializable
data class SavedDestination(
    val id: String,
    val title: String,
    val address: String,
    val point: MapPoint,
)
