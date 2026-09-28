/**
 * Job: Model every result the shared UI can receive from a current-location address lookup.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

sealed class CurrentLocationAddressResult {
    data class Success(
        val address: String,
        val point: MapPoint? = null,
    ) : CurrentLocationAddressResult()
    object PermissionDenied : CurrentLocationAddressResult()
    object LocationServicesDisabled : CurrentLocationAddressResult()
    object LocationUnavailable : CurrentLocationAddressResult()
    data class Error(val message: String) : CurrentLocationAddressResult()
}
