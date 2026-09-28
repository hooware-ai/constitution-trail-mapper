/**
 * Job: Verify current-location lookup results map to the expected user-facing messages.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.CurrentLocationAddressResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CurrentLocationResultMessageSijkoTest {
    @Test
    fun successHasNoErrorMessage() {
        assertNull(
            CurrentLocationResultMessageSijko.messageFor(
                CurrentLocationAddressResult.Success("100 Main St"),
            ),
        )
    }

    @Test
    fun mapsKnownFailuresToUserFacingMessages() {
        assertEquals(
            "Location permission was not granted.",
            CurrentLocationResultMessageSijko.messageFor(CurrentLocationAddressResult.PermissionDenied),
        )
        assertEquals(
            "Device location is turned off.",
            CurrentLocationResultMessageSijko.messageFor(CurrentLocationAddressResult.LocationServicesDisabled),
        )
        assertEquals(
            "Current location is not available yet. Try again in a moment.",
            CurrentLocationResultMessageSijko.messageFor(CurrentLocationAddressResult.LocationUnavailable),
        )
    }

    @Test
    fun preservesCustomErrorsAndFallsBackForBlankMessages() {
        assertEquals(
            "Provider failed",
            CurrentLocationResultMessageSijko.messageFor(
                CurrentLocationAddressResult.Error("Provider failed"),
            ),
        )
        assertEquals(
            "Unable to get current location.",
            CurrentLocationResultMessageSijko.messageFor(CurrentLocationAddressResult.Error("")),
        )
    }
}
