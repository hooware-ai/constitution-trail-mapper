/**
 * Job: Convert current-location lookup results into user-facing error text for the shared UI.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.CurrentLocationAddressResult

object CurrentLocationResultMessageSijko {
    fun messageFor(result: CurrentLocationAddressResult): String? {
        return when (result) {
            is CurrentLocationAddressResult.Success -> null
            CurrentLocationAddressResult.PermissionDenied -> "Location permission was not granted."
            CurrentLocationAddressResult.LocationServicesDisabled -> "Device location is turned off."
            CurrentLocationAddressResult.LocationUnavailable -> {
                "Current location is not available yet. Try again in a moment."
            }
            is CurrentLocationAddressResult.Error -> {
                result.message.takeIf { it.isNotBlank() } ?: "Unable to get current location."
            }
        }
    }
}
