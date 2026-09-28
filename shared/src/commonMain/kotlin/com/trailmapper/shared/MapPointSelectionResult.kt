/**
 * Job: Model every result the shared UI can receive from a map-point picker.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

sealed class MapPointSelectionResult {
    data class Success(
        val point: MapPoint,
        val address: String? = null,
    ) : MapPointSelectionResult()
    object Cancelled : MapPointSelectionResult()
    object Unavailable : MapPointSelectionResult()
    data class Error(val message: String) : MapPointSelectionResult()
}
