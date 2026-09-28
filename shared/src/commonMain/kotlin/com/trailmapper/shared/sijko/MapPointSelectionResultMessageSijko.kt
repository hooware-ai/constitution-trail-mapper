/**
 * Job: Convert map-point picker results into user-facing error text for the shared UI.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.MapPointSelectionResult

object MapPointSelectionResultMessageSijko {
    fun messageFor(result: MapPointSelectionResult): String? {
        return when (result) {
            is MapPointSelectionResult.Success -> null
            MapPointSelectionResult.Cancelled -> null
            MapPointSelectionResult.Unavailable -> "Map point selection is not available."
            is MapPointSelectionResult.Error -> {
                result.message.takeIf { it.isNotBlank() } ?: "Unable to choose a map point."
            }
        }
    }
}
